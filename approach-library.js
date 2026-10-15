// Biblioteca determinística: sem IA, envios ou serviços pagos.
const APPROACH_FIELDS=['empresa','cidade','segmento','produto','beneficio'];
const librarySelections=new Map();
let radarModelIds=new Set(),radarModelAccount=null;
function validateLibraryBody(body){
  const unknown=[...String(body).matchAll(/\{([^{}]*)\}/g)].map(m=>m[1]).filter(k=>!APPROACH_FIELDS.includes(k));
  if(unknown.length)throw new Error('Campo desconhecido: '+unknown.join(', '));
  if(!body.includes('{produto}'))throw new Error('Inclua {produto} para identificar a oferta na mensagem.');
}
function fillLibraryBody(body,c,snapshot){
  const values={empresa:c.nome,cidade:c.cidade,segmento:c.segmento,produto:snapshot.product,beneficio:snapshot.benefit};
  const missing=[];
  const text=String(body||'').replace(/\{([^{}]*)\}/g,(token,key)=>{
    if(!APPROACH_FIELDS.includes(key)||!String(values[key]??'').trim()){missing.push(key);return token;}
    return String(values[key]).trim();
  });
  return {text,missing:[...new Set(missing)]};
}
function libraryChoices(c){
  const radarIds=new Set([c.radarId,...(c.approachRadarIds||[]),...(c.offerMatches||[]).map(m=>m.radar_id)].filter(Boolean));
  return (state.radarApproaches||[]).filter(m=>radarIds.has(m.radar_id));
}
function selectedLibraryApproach(c){return libraryChoices(c).find(m=>m.id===librarySelections.get(c.id))||null;}
function libraryDraftKey(c,tone){const selection=selectedLibraryApproach(c);return c.id+'|'+tone+(selection?'|'+selection.id:'');}
function renderLibraryPicker(c){
  const choices=libraryChoices(c),selected=selectedLibraryApproach(c);
  if(!choices.length)return '<p class="muted">Esta empresa não tem modelos personalizados vinculados às pesquisas. Os modelos gerais continuam disponíveis.</p>';
  const products=[...new Set(choices.map(m=>m.snapshot.offer_id))];
  return `<div class="field"><label class="label" for="diagnosticApproach">Abordagem da pesquisa</label><select class="input" id="diagnosticApproach"><option value="">Texto salvo / modelos gerais</option>${products.map(id=>{const rows=choices.filter(m=>m.snapshot.offer_id===id);return `<optgroup label="${esc(rows[0].snapshot.product)}">${rows.map(m=>`<option value="${esc(m.id)}" ${selected?.id===m.id?'selected':''}>${esc(m.snapshot.name)} · ${esc(m.snapshot.channel)} · v${m.snapshot.revision}</option>`).join('')}</optgroup>`;}).join('')}</select><p class="muted">Selecione um modelo para preparar um novo texto. Mensagens salvas continuam no histórico; rascunhos são separados por modelo.</p>${selected?`<p class="muted">Modelo da pesquisa: ${esc(selected.snapshot.name)} · ${esc(selected.snapshot.product)} · ${esc(selected.snapshot.channel)} · versão ${selected.snapshot.revision}. ${fillLibraryBody(selected.snapshot.body,c,selected.snapshot).missing.length?'Há campos sem dados: '+esc(fillLibraryBody(selected.snapshot.body,c,selected.snapshot).missing.join(', '))+'. Preencha a mensagem manualmente antes de salvar.':''}</p>`:''}</div>`;
}
function radarChosenModels(){
  const offers=Array.from(document.querySelectorAll('[data-radar-offer]:checked')).map(e=>e.value);
  return (state.approachModels||[]).filter(m=>m.active&&offers.includes(m.offer_id)&&radarModelIds.has(m.id));
}
function renderRadarModelPicker(){return '<div class="field"><label class="label">Abordagens desta pesquisa (opcional)</label><input class="input" id="radarModelSearch" placeholder="Filtrar modelos por nome ou nicho" aria-label="Filtrar modelos"><div id="radarModelOptions" style="margin-top:10px"></div><p class="muted">Escolha um ou mais modelos por produto. Sem seleção, ficam disponíveis os modelos gerais. A seleção não gera envio automático.</p></div>';}
function bindRadarModelPicker(){
  const host=document.getElementById('radarModelOptions');if(!host)return;
  if(radarModelAccount!==state.userId){radarModelIds=new Set();radarModelAccount=state.userId;}
  const paint=()=>{
    const offers=Array.from(document.querySelectorAll('[data-radar-offer]:checked')).map(e=>e.value);
    const active=(state.approachModels||[]).filter(m=>m.active&&offers.includes(m.offer_id));
    radarModelIds=new Set([...radarModelIds].filter(id=>active.some(m=>m.id===id)));
    const query=document.getElementById('radarModelSearch').value.toLocaleLowerCase('pt-BR');
    host.innerHTML=state.approachLibraryReady===false?'<p class="muted">Biblioteca indisponível. Aplique o SQL 06 e atualize a página para usar modelos personalizados.</p>':offers.map(id=>{
      const rows=active.filter(m=>m.offer_id===id&&[m.name,m.niches].join(' ').toLocaleLowerCase('pt-BR').includes(query));
      return `<fieldset style="border:1px solid var(--border);border-radius:10px;margin:8px 0;padding:12px;min-width:0"><legend>${esc(state.offers.find(o=>o.id===id)?.nome||'Produto')}</legend>${rows.length?rows.map(m=>`<label class="checkbox-row" style="align-items:flex-start;overflow-wrap:anywhere"><input type="checkbox" data-radar-model value="${esc(m.id)}" ${radarModelIds.has(m.id)?'checked':''}><span><b>${esc(m.name)}</b><br><span class="muted">${esc(m.niches||'Todos os nichos')} · ${esc(m.channel)} · v${m.revision}</span></span></label>`).join(''):'<p class="muted">Nenhum modelo ativo nesta seleção. Cadastre em Configurações › Abordagens.</p>'}</fieldset>`;
    }).join('');
    host.querySelectorAll('[data-radar-model]').forEach(e=>e.onchange=()=>{if(e.checked)radarModelIds.add(e.value);else radarModelIds.delete(e.value);});
  };
  document.getElementById('radarModelSearch').oninput=paint;
  document.querySelectorAll('[data-radar-offer]').forEach(e=>e.addEventListener('change',paint));paint();
}
async function persistRadarModels(radarId){
  const models=radarChosenModels();if(!models.length)return;
  const {error}=await sb.from('radar_approach_models').insert(models.map(m=>({user_id:state.userId,radar_id:radarId,model_id:m.id,snapshot:{}})));
  if(error)throw new Error('Não foi possível preservar as abordagens. Confira o SQL 06. Nenhuma coleta foi iniciada.');
}
function renderApproachLibrary(){
  const models=state.approachModels||[];
  return `<div class="row between wrap"><h2 class="card-title">Biblioteca de abordagens</h2><button class="btn btn-primary" id="newApproachModel" ${state.readOnly||!state.approachLibraryReady?'disabled':''}>+ Novo modelo</button></div><p class="muted">Crie modelos por produto e nicho. Escolha quais usar em cada pesquisa. Editar ou desativar um modelo não altera pesquisas anteriores.</p>${!state.approachLibraryReady?'<div class="verification-note">Aplique o SQL 06 da biblioteca e atualize a página.</div>':''}<div class="field"><label class="label" for="libraryFilter">Pesquisar modelos</label><input class="input" id="libraryFilter" placeholder="Nome, produto ou nicho"></div><div id="libraryRows">${models.length?models.map(m=>`<article data-library-row data-search="${esc([m.name,m.niches,state.offers.find(o=>o.id===m.offer_id)?.nome].join(' ').toLowerCase())}" style="padding:14px 0;border-top:1px solid var(--border);overflow-wrap:anywhere"><div class="row between wrap"><b>${esc(m.name)}</b><span class="badge badge-gray">${m.active?'Ativo':'Inativo'} · v${m.revision}</span></div><p class="muted">${esc(state.offers.find(o=>o.id===m.offer_id)?.nome||'Produto indisponível')} · ${esc(m.niches||'Todos os nichos')} · ${esc(m.channel)}</p><p style="white-space:pre-wrap">${esc(m.body)}</p><div class="row gap-8 wrap"><button class="btn btn-sm" data-library-edit="${esc(m.id)}" ${state.readOnly?'disabled':''}>Editar</button><button class="btn btn-sm" data-library-copy="${esc(m.id)}" ${state.readOnly?'disabled':''}>Duplicar</button></div></article>`).join(''):'<p class="muted">Nenhum modelo cadastrado. Comece selecionando um produto.</p>'}</div>`;
}
function bindApproachLibrary(){
  const create=document.getElementById('newApproachModel');if(!create)return;
  create.onclick=()=>openApproachModel();
  document.getElementById('libraryFilter').oninput=e=>document.querySelectorAll('[data-library-row]').forEach(row=>row.hidden=!row.dataset.search.includes(e.target.value.toLowerCase()));
  document.querySelectorAll('[data-library-edit],[data-library-copy]').forEach(b=>b.onclick=()=>openApproachModel((state.approachModels||[]).find(m=>m.id===(b.dataset.libraryEdit||b.dataset.libraryCopy)),!!b.dataset.libraryCopy));
}
function openApproachModel(model=null,duplicate=false){
  if(state.readOnly)return;
  const account=state.userId;
  const dialog=document.createElement('dialog');dialog.className='card';dialog.setAttribute('aria-label',duplicate?'Duplicar abordagem':model?'Editar abordagem':'Nova abordagem');
  dialog.style.cssText='width:min(680px,calc(100vw - 32px));max-height:90vh;overflow:auto;color:var(--text);background:var(--surface);border:1px solid var(--border);box-sizing:border-box';
  dialog.innerHTML=`<form id="approachModelForm"><h2>${duplicate?'Duplicar modelo':model?'Editar modelo':'Novo modelo de abordagem'}</h2><div class="field"><label class="label" for="modelName">Nome</label><input class="input" id="modelName" required maxlength="120" value="${esc((model?.name||'')+(duplicate?' — cópia':''))}"></div><div class="field"><label class="label" for="modelOffer">Produto</label><select class="input" id="modelOffer" required><option value="">Selecione</option>${state.offers.map(o=>`<option value="${esc(o.id)}" ${o.id===model?.offer_id?'selected':''}>${esc(o.nome)}${o.ativo?'':' (inativo)'}</option>`).join('')}</select></div><div class="field"><label class="label" for="modelNiches">Nichos (separados por vírgula)</label><input class="input" id="modelNiches" maxlength="500" value="${esc(model?.niches||'')}" placeholder="Ex.: escolas de idiomas, cursos"></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px"><div class="field"><label class="label" for="modelChannel">Canal</label><select class="input" id="modelChannel">${['whatsapp','email'].map(v=>`<option value="${v}" ${model?.channel===v?'selected':''}>${v==='email'?'E-mail':'WhatsApp'}</option>`).join('')}</select></div><div class="field"><label class="label" for="modelTone">Tom</label><select class="input" id="modelTone">${[['direto','Direto'],['consultivo','Consultivo'],['informal','Informal profissional']].map(([v,l])=>`<option value="${v}" ${model?.tone===v?'selected':''}>${l}</option>`).join('')}</select></div></div><div class="field"><label class="label" for="modelBody">Mensagem</label><textarea class="input" id="modelBody" required maxlength="3500" rows="7" style="resize:vertical">${esc(model?.body||'Olá, pessoal da {empresa}! Trabalho com o {produto}. Nossa proposta é: {beneficio}. Posso enviar um resumo para vocês avaliarem?')}</textarea><p class="muted">Campos disponíveis: ${APPROACH_FIELDS.map(k=>'{'+k+'}').join(', ')}. Inclua {produto}. Nichos organizam a escolha; não são uma análise automática.</p></div><label class="checkbox-row"><input type="checkbox" id="modelActive" ${!model||model.active?'checked':''}> Modelo ativo para novas pesquisas</label><h3>Prévia ilustrativa</h3><p id="modelPreview" style="white-space:pre-wrap;overflow-wrap:anywhere"></p><p id="modelError" role="alert" style="color:var(--orange)"></p><div class="row gap-8 wrap"><button class="btn btn-primary" id="modelSubmit" type="submit">Salvar modelo</button><button class="btn" type="button" id="modelCancel">Cancelar</button></div></form>`;
  document.body.append(dialog);dialog.showModal();
  const field=id=>dialog.querySelector('#'+id);
  const preview=()=>{const offer=state.offers.find(o=>o.id===field('modelOffer').value);field('modelPreview').textContent=fillLibraryBody(field('modelBody').value,{nome:'Empresa exemplo',cidade:'Cidade exemplo',segmento:'Segmento exemplo'},{product:offer?.nome||'Produto exemplo',benefit:offer?.resultado||'Benefício a cadastrar'}).text;};
  field('modelBody').oninput=preview;field('modelOffer').onchange=preview;preview();
  dialog.addEventListener('close',()=>dialog.remove());field('modelCancel').onclick=()=>dialog.close();
  field('approachModelForm').onsubmit=async e=>{
    e.preventDefault();const button=field('modelSubmit');button.disabled=true;
    try{
      if(state.readOnly||state.userId!==account)throw new Error('A conta mudou. Reabra o modelo.');
      const body=field('modelBody').value.trim();validateLibraryBody(body);
      const payload={user_id:account,offer_id:field('modelOffer').value,name:field('modelName').value.trim(),niches:field('modelNiches').value.trim(),channel:field('modelChannel').value,tone:field('modelTone').value,body,active:field('modelActive').checked};
      const query=model&&!duplicate?sb.from('approach_models').update(payload).eq('id',model.id).eq('revision',model.revision):sb.from('approach_models').insert(payload);
      const {data,error}=await query.select('id');if(error)throw error;if(!data?.length)throw new Error('Outra pessoa editou este modelo. Atualize a lista antes de tentar novamente.');
      dialog.close();await loadAllData(state.authUserId||state.userId);toast('Modelo salvo. Pesquisas anteriores foram preservadas.');
    }catch(error){field('modelError').textContent=error.message||'Não foi possível salvar.';}finally{button.disabled=false;}
  };
}

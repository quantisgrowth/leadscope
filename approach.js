// Deterministic templates, not AI. No network calls or automatic sending.
const approachDrafts=new Map(),approachVariants=new Map();
function approachKey(c,tone){return typeof libraryDraftKey==='function'?libraryDraftKey(c,tone):c.id+'|'+tone;}
function approachLibrarySelection(c){return typeof selectedLibraryApproach==='function'?selectedLibraryApproach(c):null;}
function approachOfferContext(c){
  const selection=approachLibrarySelection(c);
  const offer=selection?{nome:selection.snapshot.product,resultado:selection.snapshot.benefit,ativo:true}:c.offerRecommendation?.offer;
  const text=(value,max)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max).replace(/[.!?]+$/,'');
  const product=text(offer?.nome,180),benefit=text(offer?.resultado,350);
  return {offer,product,benefit,ready:!!(product&&benefit&&offer?.ativo!==false)};
}
function renderApproachOfferContext(c,tone){
  const info=approachOfferContext(c),key=approachKey(c,tone);
  const stored=approachDrafts.has(key)||(!approachLibrarySelection(c)&&c.mensagemTom===tone&&c.mensagemGerada&&(approachVariants.get(key)||0)===0);
  return `<div class="verification-note" style="margin-bottom:14px"><b>Produto de referência para novas sugestões: ${esc(info.product||'Nenhum produto associado')}</b>${info.benefit?`<p>Benefício cadastrado: ${esc(info.benefit)}</p>`:''}${!info.ready?`<p>${info.product?'Preencha o resultado que este produto entrega em Configurações › Oferta comercial.':'Associe uma oferta ao diagnóstico por uma pesquisa ou reanálise com o produto correto.'} Não geramos uma abordagem genérica para substituir esses dados.</p>`:''}${stored?'<p class="muted">Texto salvo ou rascunho preservado. “Outra sugestão do modelo” cria um novo texto com o produto acima; não altera o histórico.</p>':''}</div>`;
}
function approachTemplates(c,variant=0){
  const selection=approachLibrarySelection(c);
  if(selection){const text=fillLibraryBody(selection.snapshot.body,c,selection.snapshot).text;return {direto:text,consultivo:text,informal:text};}
  const {offer,product,benefit,ready}=approachOfferContext(c);
  if(!ready)return {direto:'',consultivo:'',informal:''};
  const company=String(c.nome||'sua empresa').trim().slice(0,180);
  const q=c.qualification||{},need=String(q.need||'').replace(/\s+/g,' ').trim().slice(0,180).replace(/[.!?]+$/,'');
  const words=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(word=>word.length>=4&&!['para','como','empresa','empresas','servico','servicos','produto','produtos','sistema','sistemas','gestao','solucao','operacao','site'].includes(word));
  const productWords=new Set(words([product,benefit,offer.descricao,offer.publicoAlvo].join(' ')));
  const signals=c.siteAudit?.status==='concluido'&&Array.isArray(c.siteAudit.metrics?.operational_signals)?c.siteAudit.metrics.operational_signals:[];
  const operation=signals.find(signal=>words(signal?.label).some(word=>productWords.has(word)))?.label;
  const context=operation?`Vi no site uma menção a ${String(operation).slice(0,120).toLowerCase()}. `:'';
  const proposition=`A proposta do ${product} é: ${benefit}.`;
  const question=need?`Faz sentido conversarmos sobre ${need}?`:'Esse resultado é uma prioridade para vocês hoje?';
  const index=Number.isInteger(variant)&&variant>=0?variant%3:0;
  const options={
    direto:[`Olá, pessoal da ${company}! ${context}${proposition} ${question}`,
      `Olá! Trabalho com o ${product} e gostaria de apresentá-lo à ${company}. A proposta é: ${benefit}. Posso enviar um resumo de como funciona para vocês avaliarem?`,
      `Olá, equipe da ${company}. ${context}${proposition} Quem seria a pessoa indicada para avaliar se isso faz sentido para vocês?`],
    consultivo:[`Olá, equipe da ${company}. ${context}${proposition} Antes de sugerir uma apresentação, gostaria de entender: ${question.charAt(0).toLowerCase()+question.slice(1)}`,
      `Olá! Gostaria de avaliar se o ${product} faz sentido para a ${company}. O resultado proposto é: ${benefit}. Como vocês lidam com esse objetivo hoje?`,
      `Olá, pessoal da ${company}. ${context}${proposition} Podemos conversar brevemente para avaliar a aplicação desse resultado ao cenário de vocês?`],
    informal:[`Oi, pessoal da ${company}! Trabalho com o ${product}. A proposta é: ${benefit}. ${question}`,
      `Oi! Tudo bem com a equipe da ${company}? ${context}${proposition} Posso te mandar um resumo e você me diz se vale conversarmos?`,
      `Olá, pessoal da ${company}! Queria apresentar o ${product}, que tem esta proposta: ${benefit}. Quem por aí seria a melhor pessoa para avaliar isso com a gente?`]
  };
  return Object.fromEntries(Object.entries(options).map(([tone,variants])=>[tone,variants[index]]));
}
function approachMessage(c,tone){const key=approachKey(c,tone);return approachDrafts.has(key)?approachDrafts.get(key).text:(!approachLibrarySelection(c)&&(approachVariants.get(key)||0)===0&&c.mensagemTom===tone&&c.mensagemGerada?c.mensagemGerada:approachTemplates(c,approachVariants.get(key)||0)[tone]);}
function nextApproachSuggestion(c,tone){
  if(!c||!approachOfferContext(c).ready)return false;
  if(approachLibrarySelection(c))return false;
  const key=approachKey(c,tone);
  approachVariants.set(key,(approachVariants.get(key)||0)+1);approachDrafts.delete(key);return true;
}
async function saveApproachVersion(used=false){
  if(state.readOnly)throw new Error('Seu acesso é somente leitura.');
  const c=state.companies.find(x=>x.id===currentDiagId),text=document.getElementById('msgBox').innerText.trim(),selection=approachLibrarySelection(c),tone=selection?.snapshot.tone||state.diagTone;
  if(!text||text.length>5000)throw new Error('Use uma mensagem entre 1 e 5.000 caracteres.');
  if(selection&&/\{[^{}]*\}/.test(text))throw new Error('Preencha os campos entre chaves antes de salvar.');
  const generated=approachTemplates(c,approachVariants.get(approachKey(c,tone))||0)[tone];
  const args={p_company:c.id,p_text:text,p_origin:text===generated?'template':'edited',p_used:used,p_expected:c.mensagemGerada||''};
  if(selection)args.p_selection=selection.id;else args.p_tone=tone;
  const {error}=await sb.rpc(selection?'save_library_approach':'save_approach_message',args);
  if(error)throw new Error(/function|schema/i.test(error.message||'')?(selection?'Aplique o SQL 06 para salvar modelos da biblioteca.':'Aplique o SQL 05 para salvar versões.'):error.message);
  c.mensagemGerada=text;c.mensagemTom=tone;if(used)c.mensagemUtilizada=true;approachDrafts.set(approachKey(c,tone),{text});await loadApproachVersions();
}
async function loadApproachVersions(){
  const host=document.getElementById('approachHistory'),id=currentDiagId;if(!host)return;
  try{let result=await sb.from('approach_message_versions').select('id,body,tone,origin,used,captured_at,model_context').eq('empresa_id',id).order('captured_at',{ascending:false}).limit(20);
    if(result.error&&/model_context|42703|PGRST204/.test((result.error.message||'')+' '+result.error.code))result=await sb.from('approach_message_versions').select('id,body,tone,origin,used,captured_at').eq('empresa_id',id).order('captured_at',{ascending:false}).limit(20);
    const {data,error}=result;if(error)throw error;if(!host.isConnected||id!==currentDiagId)return;
    host.innerHTML=(data||[]).map(v=>`<article style="padding:12px 0;border-bottom:1px solid var(--border)"><div class="muted">${esc(fmtDateTime(v.captured_at))} · ${esc(v.tone)} · ${{template:'Modelo',edited:'Editada',legacy:'Texto anterior preservado'}[v.origin]||'Modelo'}${v.model_context?` · ${esc(v.model_context.name)} v${esc(v.model_context.revision)} · ${esc(v.model_context.product)} · ${esc(v.model_context.channel)}`:''}${v.used?' · Marcada como utilizada':''}</div><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(v.body)}</p></article>`).join('')||'<p class="muted">Nenhuma versão salva.</p>';
  }catch(e){if(host.isConnected)host.textContent='Histórico indisponível. Confira o SQL 05.';}
}
function bindApproach(){const box=document.getElementById('msgBox'),save=document.getElementById('saveMsg');if(!box)return;box.contentEditable=state.readOnly?'false':'true';box.oninput=()=>{const c=state.companies.find(x=>x.id===currentDiagId);approachDrafts.set(approachKey(c,state.diagTone),{text:box.innerText});};
  const regen=document.getElementById('regenMsg'),company=state.companies.find(x=>x.id===currentDiagId);
  if(regen&&company){regen.disabled=!approachOfferContext(company).ready;regen.title=regen.disabled?'Associe um produto e preencha seu resultado para gerar sugestões.':'Criar outra variação com o produto de referência, no mesmo tom';}
  if(company&&approachLibrarySelection(company)){
    if(regen){regen.disabled=true;regen.title='Este é um modelo autoral. Edite o texto ou selecione outro modelo.';}
    document.querySelectorAll('[data-tone]').forEach(e=>{e.hidden=true;});
  }
  const picker=document.getElementById('diagnosticApproach');if(picker&&company)picker.onchange=()=>{librarySelections.set(company.id,picker.value);const selection=approachLibrarySelection(company);if(selection)state.diagTone=selection.snapshot.tone;render();};
  if(save){save.disabled=!!state.readOnly;save.onclick=async()=>{save.disabled=true;try{await saveApproachVersion();toast('Versão salva no histórico.');}catch(e){toast(e.message);}finally{save.disabled=!!state.readOnly;}};}
  const details=document.getElementById('approachVersions');if(details)details.ontoggle=()=>{if(details.open)loadApproachVersions();};
}

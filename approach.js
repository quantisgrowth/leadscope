// Deterministic templates, not AI. No network calls or automatic sending.
const approachDrafts=new Map(),approachVariants=new Map();
function approachTemplates(c,variant=0){
  const offer=c.offerRecommendation?.offer,q=c.qualification||{};
  const result=String(offer?.resultado||'a organização da operação').replace(/[.]$/,'').toLowerCase();
  const product=offer?.nome||'nossa solução';
  const operation=(c.siteAudit?.status==='concluido'&&Array.isArray(c.siteAudit.metrics?.operational_signals)?c.siteAudit.metrics.operational_signals:[])[0]?.label;
  const context=operation?`No site da ${c.nome}, encontrei uma menção a ${String(operation).toLowerCase()}.`:`Encontrei a ${c.nome} pesquisando empresas de ${c.segmento||'seu setor'}.`;
  const question=q.need?`Podemos retomar o ponto registrado sobre ${String(q.need).slice(0,200).replace(/[.!?]$/,'')}?`:'Como vocês organizam contratos, ordens de serviço e acompanhamento da operação hoje?';
  const options={
    direto:[`${context} Trabalho com o ${product}, voltado a ${result}. ${question}`,`Olá! Tudo bem com a equipe da ${c.nome}? O ${product} tem como proposta ${result}. Posso fazer duas perguntas para entender se isso faz sentido para vocês?`,`${context} Antes de apresentar o ${product}, queria entender o cenário atual. ${question}`],
    consultivo:[`${context} Queria entender como essa operação funciona na prática antes de sugerir qualquer solução. ${question}`,`Olá, equipe da ${c.nome}. A proposta do ${product} é ${result}. Os dados públicos não confirmam como vocês trabalham internamente. Podemos conversar para avaliar se existe encaixe?`,`${context} Estamos conversando com empresas do setor sobre ${result}. ${question}`],
    informal:[`Oi, pessoal da ${c.nome}! ${context} Posso entender rapidinho como vocês organizam a operação hoje?`,`Olá! Trabalho com o ${product}. Em poucas palavras, a proposta é ${result}. Quem seria a melhor pessoa na ${c.nome} para conversar sobre isso?`,`Oi! ${context} Não quero presumir que vocês tenham um problema. ${question}`]
  };
  return Object.fromEntries(Object.entries(options).map(([tone,variants])=>[tone,variants[variant%variants.length]]));
}
function approachMessage(c,tone){const key=c.id+'|'+tone;return approachDrafts.get(key)?.text||((approachVariants.get(key)||0)===0&&c.mensagemTom===tone&&c.mensagemGerada?c.mensagemGerada:approachTemplates(c,approachVariants.get(key)||0)[tone]);}
async function saveApproachVersion(used=false){
  if(state.readOnly)throw new Error('Seu acesso é somente leitura.');
  const c=state.companies.find(x=>x.id===currentDiagId),text=document.getElementById('msgBox').innerText.trim(),tone=state.diagTone;
  if(!text||text.length>5000)throw new Error('Use uma mensagem entre 1 e 5.000 caracteres.');
  const generated=approachTemplates(c,approachVariants.get(c.id+'|'+tone)||0)[tone];
  const {error}=await sb.rpc('save_approach_message',{p_company:c.id,p_text:text,p_tone:tone,p_origin:text===generated?'template':'edited',p_used:used,p_expected:c.mensagemGerada||''});
  if(error)throw new Error(/function|schema/i.test(error.message||'')?'Aplique o SQL 05 para salvar versões.':error.message);
  c.mensagemGerada=text;c.mensagemTom=tone;if(used)c.mensagemUtilizada=true;approachDrafts.set(c.id+'|'+tone,{text});await loadApproachVersions();
}
async function loadApproachVersions(){
  const host=document.getElementById('approachHistory'),id=currentDiagId;if(!host)return;
  try{const {data,error}=await sb.from('approach_message_versions').select('id,body,tone,origin,used,captured_at').eq('empresa_id',id).order('captured_at',{ascending:false}).limit(20);if(error)throw error;if(!host.isConnected||id!==currentDiagId)return;
    host.innerHTML=(data||[]).map(v=>`<article style="padding:12px 0;border-bottom:1px solid var(--border)"><div class="muted">${esc(fmtDateTime(v.captured_at))} · ${esc(v.tone)} · ${{template:'Modelo',edited:'Editada',legacy:'Texto anterior preservado'}[v.origin]||'Modelo'}${v.used?' · Marcada como utilizada':''}</div><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(v.body)}</p></article>`).join('')||'<p class="muted">Nenhuma versão salva.</p>';
  }catch(e){if(host.isConnected)host.textContent='Histórico indisponível. Confira o SQL 05.';}
}
function bindApproach(){const box=document.getElementById('msgBox'),save=document.getElementById('saveMsg');if(!box)return;box.contentEditable=state.readOnly?'false':'true';box.oninput=()=>approachDrafts.set(currentDiagId+'|'+state.diagTone,{text:box.innerText});
  if(save){save.disabled=!!state.readOnly;save.onclick=async()=>{save.disabled=true;try{await saveApproachVersion();toast('Versão salva no histórico.');}catch(e){toast(e.message);}finally{save.disabled=!!state.readOnly;}};}
  const details=document.getElementById('approachVersions');if(details)details.ontoggle=()=>{if(details.open)loadApproachVersions();};
}

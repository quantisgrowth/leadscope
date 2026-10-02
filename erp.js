// Public observations and human qualification are deliberately kept separate.
const ERP_QUESTIONS = [
  ['system','Sistema utilizado','text'], ['equipment','Quantidade de equipamentos / veículos','number'],
  ['users','Quantidade de usuários previstos','number'], ['monthlyOrders','Ordens de serviço / contratos por mês','number'],
  ['spreadsheets','Utiliza planilhas?','choice'], ['need','Necessidade confirmada','text'],
  ['decisionMaker','Responsável pela decisão (nome / função)','text'], ['timing','Prazo desejado para contratar','text'],
  ['notes','Observações da conversa','textarea'],
];
function erpObservations(c){
  const p=c.sourcePayload||{}, metrics=c.siteAudit?.status==='concluido'?c.siteAudit.metrics||{}:{};
  const rows=[];
  const add=(label,context,source,at)=>{if(label&&context&&!rows.some(r=>r.label===label&&r.context===context))rows.push({label,context:String(context).slice(0,400),source,at});};
  (Array.isArray(metrics.operational_signals)?metrics.operational_signals:[]).filter(r=>r&&typeof r==='object').forEach(r=>add(r.label,r.context,r.source||c.siteAudit.final_url||c.site,c.siteAudit.finished_at));
  if(p.description)add('Descrição do perfil público',p.description,p.url,c.collectedAt);
  (Array.isArray(p.categories)?p.categories:[]).forEach(v=>add('Atividade cadastrada',v,p.url,c.collectedAt));
  return rows.slice(0,30);
}
function erpAssessment(c){
  const q=c.qualification||{}, fit=c.offerRecommendation?.compatibilidade;
  const fields=[c.nome,c.segmento,c.endereco,c.telefone,c.site,c.nota,c.avaliacoes];
  const coverage=Math.round(fields.filter(v=>v!=null&&v!=='').length/fields.length*100);
  const confirmed=!!(q.need&&q.decisionMaker&&q.timing);
  return {fit:fit==null?'Não avaliada':`${Number(fit)}%`,coverage,confirmed,label:confirmed?'Necessidade, decisor e prazo registrados':Object.keys(q).some(k=>!k.startsWith('_')&&q[k]!==''&&q[k]!=null)?'Qualificação em andamento':'Ainda não qualificada em conversa'};
}
function renderErpReviews(c){
  const rows=Array.isArray(c.sourcePayload?.reviews)?c.sourcePayload.reviews.filter(r=>r&&typeof r==='object').slice(0,5):[];
  const themes=[['Prazos e entrega',/atras|prazo|entrega/i],['Reserva e disponibilidade',/reserva|disponib|estoque/i],['Atendimento',/atend|retorno|resposta/i],['Manutenção',/manuten|quebr|defeito/i]];
  return `<h3>Amostra de avaliações públicas</h3><p class="muted">${rows.length?'Até cinco avaliações coletadas. Uma menção pode ser positiva ou negativa e não comprova uma dor operacional.':'Nenhum texto disponível nesta coleta. Habilite a amostra no próximo radar, se necessário.'}</p>${rows.map(r=>{const text=String(r.text||r.textTranslated||'').slice(0,1200);return `<div class="evidence-item"><div class="muted">${r.publishedAtDate?esc(fmtDate(new Date(r.publishedAtDate))):'Data não informada'} · Nota ${esc(r.stars??'não informada')}</div><p>${esc(text||'Sem texto')}</p>${themes.filter(([,rule])=>rule.test(text)).map(([label])=>`<span class="badge badge-gray">Menção: ${label}</span>`).join(' ')} ${externalSiteLink(r.reviewUrl||c.sourcePayload.url)}</div>`;}).join('')}`;
}
function renderErpSummary(c){
  const a=erpAssessment(c);
  return `<div class="card" style="margin-bottom:18px;"><div class="card-title">Qualificação para a oferta</div><div class="grid erp-summary"><div><b>Aderência à oferta</b><h3>${esc(a.fit)}</h3><span class="muted">Estimativa de encaixe, não chance de compra.</span></div><div><b>Cobertura do perfil</b><h3>${a.coverage}%</h3><span class="muted">Campos públicos disponíveis; não mede saúde financeira.</span></div><div><b>Qualificação comercial</b><p>${esc(a.label)}</p><span class="muted">Informações declaradas em conversa, não verificadas pelo robô.</span></div></div></div>`;
}
function renderErpTab(c){
  const q=c.qualification||{}, observations=erpObservations(c);
  return `<div class="verification-note">Sinais públicos ajudam a preparar perguntas. Não comprovam uso de planilhas, tamanho da frota, faturamento ou necessidade de ERP.</div>
    <h3>Atividades e sinais operacionais</h3>${observations.length?observations.map(r=>`<div class="evidence-item"><b>${esc(r.label)}</b><p>${esc(r.context)}</p>${externalSiteLink(r.source)}<span class="muted"> · ${r.at?esc(fmtDate(new Date(r.at))):'Data não informada'}</span></div>`).join(''):'<p class="muted">Nenhum sinal operacional coletado. Audite o site para verificar a página inicial; ausência de sinal não significa ausência de atividade.</p>'}
    <h3>Confirmar na conversa</h3><p class="muted">Preencha somente informações fornecidas pelo contato. Campos vazios permanecem desconhecidos. O histórico de versões preserva as alterações.</p>
    <form id="erpQualificationForm"><div class="grid erp-fields">${ERP_QUESTIONS.map(([key,label,type])=>`<div class="field"><label class="label" for="erp-${key}">${label}</label>${type==='textarea'?`<textarea class="input" id="erp-${key}" maxlength="2000">${esc(q[key]||'')}</textarea>`:type==='choice'?`<select class="input" id="erp-${key}">${[['','Não informado'],['sim','Sim'],['nao','Não'],['parcial','Parcialmente']].map(([v,l])=>`<option value="${v}" ${q[key]===v?'selected':''}>${l}</option>`).join('')}</select>`:`<input class="input" id="erp-${key}" type="${type}" ${type==='number'?'min="0" max="1000000" step="1"':'maxlength="500"'} value="${esc(q[key]??'')}" placeholder="Não informado">`}</div>`).join('')}</div>
    <p class="muted">${q._updatedAt?'Último registro: '+esc(fmtDateTime(q._updatedAt)):'Nenhuma conversa registrada.'}</p><button class="btn btn-primary" id="saveErpQualification" ${state.accountRole==='viewer'?'disabled':''}>Salvar qualificação</button><span role="status" id="erpSaveStatus" style="margin-left:12px;"></span></form>`;
}
function renderQualificationVersion(snapshot){
  const q=snapshot.commercial_qualification;
  if(!q||!Object.keys(q).length)return '';
  return `<details style="margin-top:8px;"><summary>Qualificação comercial desta versão</summary>${ERP_QUESTIONS.filter(([key])=>q[key]!==''&&q[key]!=null).map(([key,label])=>`<p><b>${esc(label)}:</b> ${esc(q[key])}</p>`).join('')}</details>`;
}
function bindErpQualification(){
  const form=document.getElementById('erpQualificationForm');if(!form)return;
  const current=state.companies.find(x=>x.id===currentDiagId);
  if(state.readOnly||current?.qualificationReady===false){
    document.getElementById('saveErpQualification').disabled=true;
    document.getElementById('erpSaveStatus').textContent=state.readOnly?'Acesso somente leitura.':'Salvamento aguarda a atualização da plataforma (SQL 04).';
    form.onsubmit=e=>e.preventDefault();return;
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(state.readOnly)return;
    const c=state.companies.find(x=>x.id===currentDiagId);if(!c)return;
    const values={};
    for(const [key,,type]of ERP_QUESTIONS){const input=document.getElementById('erp-'+key);if(!input.checkValidity()){input.reportValidity();return;}values[key]=type==='number'?(input.value===''?null:Number(input.value)):input.value.trim();}
    const button=document.getElementById('saveErpQualification'),status=document.getElementById('erpSaveStatus');button.disabled=true;status.textContent='Salvando…';
    try{
      const {data,error}=await sb.rpc('save_commercial_qualification',{p_company:c.id,p_values:values,p_expected:c.qualification||{}});
      if(error)throw error;c.qualification=data;setState({companies:state.companies});toast('Qualificação salva com histórico.');
    }catch(error){status.textContent='Não foi salvo.';toast(/function|column|schema/i.test(error.message||'')?'Aplique o SQL 04 de qualificação no Supabase.':error.message||'Falha ao salvar.');}
    finally{button.disabled=false;}
  };
}
function radarEnrichmentOptions(){
  return {exclude_terms:document.getElementById('rExclude').value.split(',').map(v=>v.trim()).filter(Boolean).slice(0,10),review_limit:document.getElementById('rReviews').checked?5:0,contacts:document.getElementById('rContacts').checked};
}
function bindRadarErpOptions(){
  const scope=document.getElementById('rScope'),local=document.getElementById('rLocalizacao');
  const sync=()=>{document.getElementById('rAreaHint').textContent=scope.value==='city'?'A coleta utiliza a área da cidade informada. Não há raio em quilômetros aplicado.':'A coleta utiliza a área da região, estado ou país informado. Comece com poucas empresas para validar os resultados.';};
  scope.value=/^brasil$/i.test(local.value.trim())?'region':'city';scope.onchange=sync;sync();
  const profile=()=>{const selected=state.offers.filter(o=>Array.from(document.querySelectorAll('[data-radar-offer]:checked')).some(el=>el.value===o.id));document.getElementById('rIdealProfile').textContent=selected.map(o=>`${o.nome}: ${o.publicoAlvo||'Público-alvo ainda não definido'}${o.resultado?' · Resultado a validar: '+o.resultado:''}`).join(' | ')||'Selecione um produto.';};
  document.querySelectorAll('[data-radar-offer]').forEach(el=>el.addEventListener('change',profile));profile();
}

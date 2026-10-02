/* Pure calculations: no inferred stages, sample values, revenue estimates or external calls. */
function dashboardTime(value){
  if(!value)return null;
  const time=new Date(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00':value).getTime();
  return Number.isFinite(time)?time:null;
}
function dashboardModel(companies,period,now,availability,audits){
  availability=availability||{};
  const end=dashboardTime(now)||Date.now(),day=86400000;
  const days=[7,30,90].includes(Number(period))?Number(period):30;
  const byId=new Map(companies.map(c=>[c.id,c]));
  const canonical=id=>{
    const visited=new Set();
    while(byId.get(id)?.mergedInto&&!visited.has(id)){visited.add(id);id=byId.get(id).mergedInto;}
    return id;
  };
  const records=companies.filter(c=>!c.mergedInto);
  const active=records.filter(c=>!c.archivedAt);
  const creation=new Map();
  companies.forEach(c=>{
    const id=canonical(c.id),time=dashboardTime(c.createdAt);
    if(byId.has(id)&&time!==null&&time<=end)creation.set(id,Math.min(creation.get(id)??Infinity,time));
  });
  const midnight=new Date(end);midnight.setHours(0,0,0,0);midnight.setDate(midnight.getDate()-days+1);
  const knownDates=[...creation.values(),...companies.flatMap(c=>[c.analysisRecordedAt,...(c.statusHistory||[]).map(e=>e.at)]).map(dashboardTime),...(audits||[]).map(a=>dashboardTime(a.finished_at))].filter(time=>time!==null&&time<=end);
  const start=period==='all'?knownDates.reduce((min,time)=>Math.min(min,time),end):midnight.getTime();
  const inPeriod=value=>{const time=dashboardTime(value);return time!==null&&time>=start&&time<=end;};
  const stages=['Nova','Em análise','Priorizada','Abordagem preparada','Contatada','Respondeu','Reunião agendada','Cliente','Descartada'];
  const events=[],seen=new Set();
  companies.forEach(c=>(c.statusHistory||[]).forEach(event=>{
    // A migrated initial snapshot does not date an actual commercial transition.
    if(!event.from||event.from===event.to||!stages.includes(event.to)||!inPeriod(event.at))return;
    const id=canonical(c.id),key=id+'|'+event.to+'|'+dashboardTime(event.at);
    if(!byId.has(id)||seen.has(key))return;
    seen.add(key);events.push({...event,id});
  }));
  events.sort((a,b)=>dashboardTime(b.at)-dashboardTime(a.at));
  const reached=stage=>new Set(events.filter(e=>e.to===stage).map(e=>e.id));
  const newIds=new Set([...creation].filter(([,at])=>inPeriod(at)).map(([id])=>id));
  const cohortClients=[...reached('Cliente')].filter(id=>newIds.has(id));
  const analyzed=records.filter(c=>c.score!=null&&Number.isFinite(Number(c.score))&&inPeriod(c.analysisRecordedAt));
  const analyzedTotal=active.filter(c=>c.score!=null&&Number.isFinite(Number(c.score))&&dashboardTime(c.analysisRecordedAt)!==null);
  const auditedIds=new Set((audits||[]).filter(a=>a.status==='concluido'&&inPeriod(a.finished_at)&&byId.has(canonical(a.empresa_id))).map(a=>canonical(a.empresa_id)));
  const current=stages.map(stage=>({label:stage,v:active.filter(c=>c.status===stage).length,entered:reached(stage).size}));
  const bins=Math.max(1,Math.min(8,Math.ceil((end-start+1)/(7*day))));
  const span=Math.max(1,(end-start+1)/bins);
  const timeline=Array.from({length:bins},(_,i)=>{
    const from=start+i*span,to=i===bins-1?end:start+(i+1)*span;
    return {from,to,label:new Date(from).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}),newCount:[...creation.values()].filter(at=>at>=from&&(i===bins-1?at<=to:at<to)).length,clients:new Set(events.filter(e=>e.to==='Cliente'&&dashboardTime(e.at)>=from&&(i===bins-1?dashboardTime(e.at)<=to:dashboardTime(e.at)<to)).map(e=>e.id)).size};
  });
  const signals=new Map();
  analyzed.forEach(c=>new Set((c.sinais||[]).map(s=>s.texto).filter(Boolean)).forEach(text=>signals.set(text,(signals.get(text)||0)+1)));
  const pending=active.filter(c=>c.status!=='Cliente'&&c.status!=='Descartada'&&(dashboardTime(c.createdAt)===null||dashboardTime(c.createdAt)<=end)).sort((a,b)=>Number(b.score)-Number(a.score)).slice(0,5);
  const undated=records.filter(c=>dashboardTime(c.createdAt)===null).length;
  const legacy=active.filter(c=>c.status&&c.status!=='Nova'&&!(c.statusHistory||[]).some(e=>e.from&&e.to!==e.from&&dashboardTime(e.at)!==null)).length;
  const undatedAnalyses=records.filter(c=>c.score!=null&&dashboardTime(c.analysisRecordedAt)===null).length;
  return {start,end,active,records,newIds,analyzed,analyzedTotal,auditedIds,current,events,reached,cohortClients,timeline,pending,signals:[...signals].sort((a,b)=>b[1]-a[1]).slice(0,6),undated,undatedAnalyses,legacy,availability};
}
function dashboardBars(items){
  const max=Math.max(1,...items.map(item=>item.v));
  return items.map(item=>`<div class="dashboard-bar-row"><div class="row between gap-8"><span>${esc(item.label)}</span><b>${item.v}</b></div><div class="dashboard-bar-track"><span style="width:${item.v/max*100}%"></span></div></div>`).join('');
}
function renderDashboard(){
  const available=state.dashboardAvailability||{};
  if(available.companies===false)return '<h1 class="page-title">Visão geral</h1><div class="card empty"><h4>Não foi possível carregar os indicadores</h4><p>Atualize a página para consultar a carteira. Dados indisponíveis não serão exibidos como zero.</p></div>';
  const m=dashboardModel(state.companies,state.dashboardPeriod||'30',new Date(),available,state.dashboardAudits||[]);
  const history=available.history!==false;
  const val=value=>history?value:'—';
  const periodLabel=state.dashboardPeriod==='all'?'Todo o histórico':'Últimos '+([7,30,90].includes(Number(state.dashboardPeriod))?state.dashboardPeriod:30)+' dias';
  const kpis=[
    ['Novas empresas',m.newIds.size,'Cadastros únicos criados no período'],
    ['Empresas analisadas',m.analyzed.length,'Última análise registrada no período'],
    ['Sites auditados',available.audits===false?'—':m.auditedIds.size,'Empresas com auditoria concluída no período'],
    ['Contatadas',val(m.reached('Contatada').size),'Entrada explícita nessa etapa no período'],
    ['Reuniões agendadas',val(m.reached('Reunião agendada').size),'Empresas que entraram nessa etapa no período'],
    ['Negócios registrados',val(m.reached('Cliente').size),'Empresas que entraram em Cliente no período']
  ];
  const quality=[
    ['Com análise datada',m.analyzedTotal.length],
    ['Alto potencial registrado',m.active.filter(c=>c.potencial==='alto').length],
    ['Monitoradas (sem verificação automática)',m.active.filter(c=>c.monitorada).length],
    ['Sem site localizado',m.active.filter(c=>!c.site).length],
    ['Site encontrado, não auditado',m.active.filter(c=>c.site&&c.siteAudit?.status!=='concluido').length],
    ['Sem consulta de CNPJ registrada',m.active.filter(c=>!c.cnpj||!c.cnpjValidatedAt).length]
  ];
  const cohort=history&&m.newIds.size?Math.round(m.cohortClients.length/m.newIds.size*100)+'%':'—';
  const warnings=[];
  if(!history)warnings.push('Histórico comercial indisponível: movimentações e conversão não podem ser calculadas.');
  if(available.audits===false)warnings.push('Auditorias indisponíveis: não foi possível calcular a verificação dos sites.');
  if(available.evidence===false)warnings.push('Evidências indisponíveis: contagens de fontes não podem ser calculadas.');
  if(available.scores===false)warnings.push('Componentes de score indisponíveis: datas dependem dos registros de coleta/análise disponíveis.');
  if(m.legacy)warnings.push(m.legacy+' empresa(s) em etapas comerciais sem uma transição datada disponível. Não inferimos quando foram abordadas ou convertidas.');
  if(m.undated)warnings.push(m.undated+' cadastro(s) sem data de criação: excluídos dos indicadores por período.');
  if(m.undatedAnalyses)warnings.push(m.undatedAnalyses+' empresa(s) com score, mas sem data explícita de análise/coleta: não usamos a criação do cadastro como data de análise.');
  return `<div class="row between wrap"><div><h1 class="page-title">Visão geral</h1><p class="page-sub">${esc(state.user.empresa)} · ${periodLabel} · ${dashboardDate(m.start)} a ${dashboardDate(m.end)}</p></div><div class="row gap-8 wrap"><button class="btn btn-sm" id="refreshDashboard">Atualizar dados</button><button class="btn btn-sm" data-nav="#/oportunidades">Abrir carteira</button></div></div>
    <p class="dashboard-note">Indicadores de empresas únicas, não de tentativas de contato ou quantidade de reuniões. “Cliente” é um negócio registrado no CRM, não comprovação de pagamento. Receita e ticket realizado ainda não são medidos.</p>
    ${warnings.length?`<div class="verification-note">${warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}
    <div class="kpi-grid dashboard-kpis" style="margin:20px 0;">${kpis.map(([label,value,help])=>`<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-val">${value}</div><div class="muted" style="font-size:12px;">${help}</div></div>`).join('')}</div>
    <div class="dashboard-grid">
      <section class="card"><h2 class="card-title">Da descoberta ao negócio</h2><p class="card-sub">Histórico do período: empresas que entraram explicitamente em cada etapa. Não presumimos etapas puladas; a mesma empresa pode aparecer em várias linhas.</p>
      ${history?dashboardBars([{label:'Novas empresas',v:m.newIds.size},{label:'Última análise no período',v:m.analyzed.length},...m.current.filter(s=>s.label!=='Nova').map(s=>({label:s.label,v:s.entered}))]):'<p class="muted">Sem histórico disponível.</p>'}
      </section>
      <section class="card"><h2 class="card-title">Carteira atual por etapa</h2><p class="card-sub">Posição atual, independentemente do período. ${m.active.length} ativas · ${m.records.filter(c=>c.archivedAt).length} arquivadas. Cadastros mesclados não duplicam a carteira.</p>
      ${dashboardBars(m.current)}
      <p class="dashboard-note">${m.active.filter(c=>!m.current.some(s=>s.label===c.status)).length} empresa(s) com etapa não reconhecida. O histórico do período inclui arquivadas, para preservar resultados.</p>
      </section>
      <section class="card"><h2 class="card-title">Novos cadastros e negócios por intervalo</h2><p class="card-sub">Início de cada intervalo do período. Negócios podem vir de empresas cadastradas anteriormente.</p>
      <div class="table-scroll"><table><thead><tr><th>Desde</th><th>Novos cadastros</th><th>Entraram em Cliente</th></tr></thead><tbody>${m.timeline.map(b=>`<tr><td>${dashboardDate(b.from)}</td><td>${b.newCount}</td><td>${val(b.clients)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card"><h2 class="card-title">Conversão da nova carteira</h2><div class="kpi-val">${cohort}</div><p>${history?m.cohortClients.length:'—'} de ${m.newIds.size} novos cadastros tiveram entrada registrada em Cliente no mesmo período.</p><p class="dashboard-note">Não mistura clientes antigos com leads novos. O ciclo pode continuar após o período; ausência de histórico não prova ausência de negócios.</p>
      <div class="divider"></div><h3 class="card-title">Cobertura de análise · carteira atual</h3>${quality.map(([label,count])=>`<div class="row between gap-8" style="padding:9px 0;"><span>${label}</span><b>${available.audits===false&&label.includes('auditado')?'—':count}</b></div>`).join('')}
      </section>
      <section class="card"><h2 class="card-title">Próximas empresas para qualificar</h2><p class="card-sub">Até 5 empresas ativas por score registrado, excluindo Clientes e Descartadas. Não é previsão de compra.</p>
      ${m.pending.map(c=>`<div class="dashboard-priority"><div><b>${esc(c.nome)}</b><p class="muted">${esc(companyLocation(c))} · ${esc(c.status||'Sem etapa')}</p><p class="muted">${esc(c.servicoRecomendado||'Sem oferta definida')} · Score ${esc(c.score??'Não informado')}</p></div><button class="btn btn-sm" data-diag="${esc(c.id)}">Qualificar</button></div>`).join('')||'<p class="muted">Nenhuma empresa pendente de qualificação.</p>'}</section>
      <section class="card"><h2 class="card-title">Sinais nas análises do período</h2><p class="card-sub">Sinais registrados no diagnóstico; não equivalem automaticamente a fatos confirmados por auditoria.</p>${m.signals.map(([label,count])=>`<div class="row between gap-8" style="padding:9px 0;border-bottom:1px solid var(--border);"><span>${esc(label)}</span><b>${count}</b></div>`).join('')||'<p class="muted">Sem sinais em análises datadas deste período.</p>'}
      </section>
    </div>
    <section class="card" style="margin-top:20px;"><h2 class="card-title">Últimas movimentações comerciais</h2><p class="card-sub">Até 10 transições registradas no período. Reentradas contam uma vez por empresa em cada indicador, mas continuam visíveis no histórico.</p>
    ${history?`<div class="table-scroll"><table><thead><tr><th>Empresa</th><th>De</th><th>Para</th><th>Quando</th><th></th></tr></thead><tbody>${m.events.slice(0,10).map(e=>`<tr><td>${esc(m.records.find(c=>c.id===e.id)?.nome||'Cadastro mesclado')}</td><td>${esc(e.from)}</td><td>${esc(e.to)}</td><td>${dashboardDate(e.at)}</td><td><button class="btn btn-sm" data-diag="${esc(e.id)}">Ver histórico</button></td></tr>`).join('')||'<tr><td colspan="5">Nenhuma transição registrada neste período.</td></tr>'}</tbody></table></div>`:'<p class="muted">Histórico indisponível.</p>'}</section>
    <p class="dashboard-note" style="margin-top:16px;">Os indicadores usam datas registradas, score atual e o histórico disponível. Não reconstituem análises antigas sobrescritas nem o valor financeiro das vendas. Atualize a página para recarregar os dados da equipe.</p>`;
}
function dashboardDate(value){
  return new Date(dashboardTime(value)).toLocaleDateString('pt-BR');
}

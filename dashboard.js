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
function dashboardResearch(results,start,end){
  const rows=(results||[]).filter(x=>{const at=dashboardTime(x.created_at);return at!=null&&at>=start&&at<=end;});
  const reasons=new Map();rows.filter(x=>x.decision==='discarded').forEach(x=>(x.reasons||[]).forEach(reason=>reasons.set(reason,(reasons.get(reason)||0)+1)));
  return {rows,total:rows.length,counts:['accepted','duplicate','discarded','error'].map(decision=>({decision,count:rows.filter(x=>x.decision===decision).length})),reasons:[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,5)};
}
function dashboardTrend(items,history){
  const max=Math.max(1,...items.flatMap(x=>[x.newCount,history?x.clients:0])),plot=items.map((x,i)=>{
    const step=560/Math.max(1,items.length),left=38+i*step,w=Math.min(22,step/3),h=x.newCount/max*140,clientH=x.clients/max*140;
    return `<g><title>${esc(x.label)}: ${x.newCount} novos cadastros${history?', '+x.clients+' negócios registrados':''}</title><rect x="${left}" y="${170-h}" width="${w}" height="${h}" rx="3" fill="var(--blue)"/>${history?`<rect x="${left+w+3}" y="${170-clientH}" width="${w}" height="${clientH}" rx="3" fill="var(--text-secondary)" opacity=".6"/>`:''}<text x="${left+w}" y="192" text-anchor="middle" fill="var(--text-secondary)" font-size="11">${esc(x.label)}</text><text x="${left+w/2}" y="${Math.max(15,165-h)}" text-anchor="middle" fill="var(--text)" font-size="11">${x.newCount}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 640 205" role="img" aria-label="Evolução de novos cadastros e negócios por intervalo" style="width:100%;display:block"><line x1="25" y1="170" x2="620" y2="170" stroke="var(--border)"/>${plot}</svg><div class="row gap-16 wrap muted" style="font-size:12px"><span>● Novos cadastros</span><span>${history?'○ Negócios registrados':'Histórico comercial indisponível'}</span></div>`;
}
function dashboardDonut(research){
  const colors=['var(--blue)','#709fce','#e4a548','#d66969'],labels=['Novas na carteira','Já cadastradas','Fora dos critérios','Com erro'];let offset=0;
  const segments=research.counts.map((x,i)=>{const part=research.total?x.count/research.total*100:0;const circle=`<circle cx="70" cy="70" r="52" fill="none" stroke="${colors[i]}" stroke-width="16" pathLength="100" stroke-dasharray="${part} ${100-part}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"/>`;offset+=part;return circle;}).join('');
  return `<div class="dashboard-outcome"><svg viewBox="0 0 140 140" role="img" aria-label="${research.total} resultados retornados, distribuídos por decisão"><circle cx="70" cy="70" r="52" fill="none" stroke="var(--border)" stroke-width="16"/>${segments}<text x="70" y="70" text-anchor="middle" fill="var(--text)" font-size="25" font-weight="700">${research.total}</text><text x="70" y="89" text-anchor="middle" fill="var(--text-secondary)" font-size="10">resultados</text></svg><div>${research.counts.map((x,i)=>`<div class="row between gap-8" style="margin:12px 0"><span><span style="color:${colors[i]}">●</span> ${labels[i]}</span><b>${x.count}</b></div>`).join('')}</div></div>`;
}
function renderDashboard(){
  const a=state.dashboardAvailability||{};
  if(a.companies===false)return '<h1 class="page-title">Visão geral</h1><div class="card empty"><h4>Não foi possível carregar os indicadores</h4><p>Atualize a página. Dados indisponíveis não serão exibidos como zero.</p></div>';
  const m=dashboardModel(state.companies,state.dashboardPeriod||'30',new Date(),a,state.dashboardAudits||[]),history=a.history!==false;
  const period=state.dashboardPeriod==='all'?'Todo o histórico':'Últimos '+([7,30,90].includes(Number(state.dashboardPeriod))?state.dashboardPeriod:30)+' dias';
  const research=dashboardResearch(state.dashboardResults,m.start,m.end);
  const qualified=m.active.filter(c=>{const q=c.qualification||{};return q.need&&q.decisionMaker&&q.timing;}).length;
  const rate=history&&m.newIds.size?(m.cohortClients.length/m.newIds.size*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
  const kpis=[['Novos cadastros',m.newIds.size,'Empresas únicas criadas no período'],['Analisadas',m.analyzed.length,'Última análise registrada no período'],['Contatadas',history?m.reached('Contatada').size:'—','Entrada explícita na etapa no período'],['Reuniões',history?m.reached('Reunião agendada').size:'—','Empresas que entraram nesta etapa'],['Negócios',history?m.reached('Cliente').size:'—','Entrada em Cliente; não comprova pagamento'],['Conversão',rate,'Novos cadastros que entraram em Cliente no mesmo período']];
  const coverage=[{label:'Análise datada',v:m.analyzedTotal.length},{label:'Qualificação preenchida',v:qualified},{label:'Alto potencial',v:m.active.filter(c=>c.potencial==='alto').length},{label:'Site auditado',v:m.active.filter(c=>c.siteAudit?.status==='concluido').length}];
  const details=`<details class="card" style="margin-top:20px"><summary>Definições, qualidade dos dados e histórico</summary><p class="muted">Indicadores comerciais contam empresas únicas. Resultados de pesquisa contam ocorrências retornadas, inclusive a mesma empresa em pesquisas diferentes. Cliente não comprova receita ou pagamento.</p><p class="muted">Qualificação preenchida exige necessidade, decisor e prazo registrados pelo comercial; score alto sozinho não é qualificação confirmada.</p>${!history?'<p>Histórico comercial indisponível. Sem histórico disponível para entradas por etapa.</p>':''}${a.results===false?'<p>Resultados de pesquisa indisponíveis: confira o SQL 05. Não usamos zero no lugar de informação indisponível.</p>':''}<p class="muted">${m.legacy} cadastros sem transição comercial datada · ${m.undated} sem criação datada · ${m.undatedAnalyses} sem análise datada. Não inferimos etapas puladas. Análises usam a última data registrada; análises antigas não são reconstruídas.</p><h3>Entradas comerciais no período</h3>${history?dashboardBars(m.current.map(x=>({label:x.label,v:x.entered}))):'<p>Sem histórico disponível.</p>'}<h3>Últimas movimentações comerciais</h3><div class="table-scroll"><table><thead><tr><th>Empresa</th><th>De</th><th>Para</th><th>Quando</th></tr></thead><tbody>${history?m.events.slice(0,10).map(e=>`<tr><td>${esc(m.records.find(c=>c.id===e.id)?.nome||'Cadastro mesclado')}</td><td>${esc(e.from)}</td><td>${esc(e.to)}</td><td>${dashboardDate(e.at)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma transição registrada neste período.</td></tr>':'<tr><td colspan="4">Histórico comercial indisponível</td></tr>'}</tbody></table></div><details><summary>Dados do gráfico de evolução</summary><div class="table-scroll"><table><thead><tr><th>Desde</th><th>Novos cadastros</th><th>Negócios</th></tr></thead><tbody>${m.timeline.map(x=>`<tr><td>${dashboardDate(x.from)}</td><td>${x.newCount}</td><td>${history?x.clients:'—'}</td></tr>`).join('')}</tbody></table></div></details></details>`;
  return `<div class="row between wrap"><div><h1 class="page-title">Visão geral</h1><p class="page-sub">${esc(state.user.empresa)} · ${period}</p></div><div class="row gap-8"><button class="btn btn-sm" id="refreshDashboard">Atualizar dados</button><button class="btn btn-sm" data-nav="#/radar">Ver pesquisas</button></div></div><div class="kpi-grid dashboard-kpis" style="margin:20px 0">${kpis.map(([label,value,help],index)=>`<button class="kpi-card dashboard-metric" type="button" data-dashboard-metric="${index}" data-dashboard-label="${esc(label)}" title="${esc(help)} · Abrir empresas correspondentes" ${index>=2&&!history?'disabled':''}><div class="kpi-label">${label} <span aria-label="${esc(help)}" title="${esc(help)}">ⓘ</span></div><div class="kpi-val">${value}</div></button>`).join('')}</div>
  <div class="dashboard-grid">
    <section class="card"><h2 class="card-title">Evolução da carteira</h2><p class="card-sub">Novos cadastros e negócios por intervalo</p>${dashboardTrend(m.timeline,history)}</section>
    <section class="card"><h2 class="card-title">Aproveitamento das pesquisas</h2><p class="card-sub">Resultados retornados no período · não são empresas únicas</p>${a.results===false?'<p class="muted">Histórico de pesquisas indisponível. Aplique o SQL 05.</p>':dashboardDonut(research)}${research.total===0&&a.results!==false?'<p class="muted">Sem resultados registrados. Descartes antigos não são reconstruídos.</p>':''}</section>
    <section class="card"><h2 class="card-title">Carteira atual por etapa</h2><p class="card-sub">${m.active.length} ativas · posição atual, sem filtro de período</p>${dashboardBars(m.current)}<button class="btn btn-sm" data-nav="#/oportunidades">Abrir carteira</button></section>
    <section class="card"><h2 class="card-title">Cobertura da carteira atual</h2>${dashboardBars(coverage.filter(x=>a.audits!==false||x.label!=='Site auditado'))}<details><summary>Principais motivos de descarte</summary>${research.reasons.map(([reason,count])=>`<div class="row between gap-8" style="margin:10px 0"><span>${esc(typeof RADAR_REASON_LABELS!=='undefined'?RADAR_REASON_LABELS[reason]||reason:reason)}</span><b>${count}</b></div>`).join('')||'<p class="muted">Sem motivos disponíveis neste período.</p>'}</details></section>
    <section class="card" style="grid-column:1/-1"><div class="row between"><h2 class="card-title">Próximas ações</h2><button class="btn btn-sm" data-nav="#/diagnostico">Ver diagnósticos</button></div>${m.pending.map(c=>`<div class="dashboard-priority"><div><b>${esc(c.nome)}</b><span class="muted"> · ${esc(companyLocation(c))}</span><div class="muted">${esc(c.status||'Sem etapa')} · ${esc(c.servicoRecomendado||'Sem oferta definida')}</div></div><div class="row gap-8"><b style="color:var(--blue)">${esc(c.score??'—')}</b><button class="btn btn-sm" data-diag="${esc(c.id)}">Qualificar</button></div></div>`).join('')||'<p class="muted">Nenhuma empresa pendente.</p>'}</section>
  </div>${details}`;
}
function dashboardDate(value){
  return new Date(dashboardTime(value)).toLocaleDateString('pt-BR');
}
function dashboardMetricIds(model,index){
  return [()=>[...model.newIds],()=>model.analyzed.map(c=>c.id),()=>[...model.reached('Contatada')],()=>[...model.reached('Reunião agendada')],()=>[...model.reached('Cliente')],()=>model.cohortClients][index]?.()||[];
}
function bindDashboardDrilldown(){
  document.querySelectorAll('[data-dashboard-metric]').forEach(button=>button.onclick=()=>{
    const a=state.dashboardAvailability||{},m=dashboardModel(state.companies,state.dashboardPeriod||'30',new Date(),a,state.dashboardAudits||[]),index=Number(button.dataset.dashboardMetric);
    if(index>=2&&a.history===false)return;
    state.dashboardDrilldown={ids:dashboardMetricIds(m,index),label:button.dataset.dashboardLabel+' · '+dashboardDate(m.start)+' a '+dashboardDate(m.end)};
    state.selectedOpps=[];state.oppFilterOpen=false;
    state.oppFilters=Object.assign({},DEFAULT_OPP_FILTERS,{archive:'todas'});navigate('#/oportunidades');
  });
}

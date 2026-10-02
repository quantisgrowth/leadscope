import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const js=read('dashboard.js'),html=read('index.html'),inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(js);new vm.Script(inline);
const now='2026-10-01T18:00:00Z';
const event=(from,to,at)=>({from,to,at});
const companies=[
  {id:'a',nome:'Máquinas Árvore',createdAt:'2026-09-20',analysisRecordedAt:'2026-09-21',score:88,potencial:'alto',status:'Cliente',statusHistory:[event('Nova','Contatada','2026-09-22'),event('Contatada','Respondeu','2026-09-24'),event('Respondeu','Reunião agendada','2026-09-26'),event('Reunião agendada','Cliente','2026-09-29'),event('Respondeu','Contatada','2026-09-30')]},
  {id:'b',nome:'Cliente antigo',createdAt:'2026-08-01',analysisRecordedAt:'2026-08-01',score:80,status:'Cliente',statusHistory:[event('Contatada','Cliente','2026-09-30')]},
  {id:'c',nome:'Arquivada com negócio',createdAt:'2026-09-05',archivedAt:'2026-09-09',analysisRecordedAt:'2026-09-06',score:75,status:'Cliente',statusHistory:[event('Reunião agendada','Cliente','2026-09-08')]},
  {id:'d',nome:'Legado',createdAt:'2026-08-01',score:70,status:'Cliente',statusHistory:[event(null,'Cliente','2026-09-05')]},
  {id:'e',nome:'Cadastro sem análise',createdAt:'2026-09-10',score:70,status:'Em análise',statusHistory:[event('Nova','Em análise','2026-09-11')]},
  {id:'source',nome:'Origem mesclada',createdAt:'2026-09-19',mergedInto:'a',score:88,status:'Cliente',statusHistory:[event('Reunião agendada','Cliente','2026-09-29')]},
  {id:'invalid',nome:'Sem data',createdAt:'inválida',score:null,status:'Nova',statusHistory:[]},
  {id:'future',nome:'Data futura',createdAt:'2026-10-05',analysisRecordedAt:'2026-10-05',score:100,status:'Nova',statusHistory:[event('Nova','Cliente','2026-10-05')]}
];
const audits=[{empresa_id:'a',status:'concluido',finished_at:'2026-09-25'},{empresa_id:'source',status:'concluido',finished_at:'2026-09-25'},{empresa_id:'e',status:'falhou',finished_at:'2026-09-25'}];
const state={companies,dashboardPeriod:'30',dashboardAudits:audits,dashboardAvailability:{companies:true,history:true,audits:true,evidence:true,scores:true},user:{empresa:'Empresa teste'}};
const deps={state,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),companyLocation:c=>c.cidade||'Não informado'};
const ctx=vm.createContext(deps);vm.runInContext(js,ctx);
let m=ctx.dashboardModel(companies,'30',now,{},audits);
assert.equal(m.newIds.size,3,'Merge source is not a second lead');
assert.equal(m.analyzed.length,2,'Creation alone does not count as analysis; archived analyses retained');
assert.equal(m.auditedIds.size,1,'Audit counted per canonical company, successful and dated');
assert.equal(m.reached('Cliente').size,3,'No double count for repeat or merged history; initial snapshot excluded');
assert.equal(m.reached('Contatada').size,1,'Repeat entries count one company');
assert.equal(m.reached('Reunião agendada').size,1,'A Client entry does not infer a meeting');
assert.equal(m.cohortClients.length,2,'Old clients excluded from new-lead conversion');
assert.equal(m.current.find(s=>s.label==='Cliente').v,3,'Current stock excludes archived and merged');
assert.equal(m.legacy,1);
assert.equal(m.undated,1);
assert.equal(ctx.dashboardDate('2026-09-30'),'30/09/2026');
assert.ok(!m.pending.some(c=>c.status==='Cliente'||c.archivedAt||c.mergedInto));
assert.equal(m.timeline.reduce((sum,b)=>sum+b.newCount,0),m.newIds.size);
assert.equal(ctx.dashboardModel(companies,'7',now,{},audits).newIds.size,0);
assert.equal(ctx.dashboardModel(companies,'7',now,{},audits).reached('Cliente').size,2);
assert.equal(ctx.dashboardModel(companies,'all',now,{},audits).newIds.size,5);
assert.ok(ctx.dashboardBars([{label:'Zero',v:0}]).includes('width:0%'));
assert.ok(!ctx.dashboardBars([{label:'Zero',v:0}]).includes('NaN'));
state.dashboardAvailability.history=false;
let markup=ctx.renderDashboard();assert.ok(markup.includes('Histórico comercial indisponível'));assert.ok(markup.includes('Sem histórico disponível'));
state.dashboardAvailability.companies=false;assert.ok(ctx.renderDashboard().includes('Não foi possível carregar'));
state.dashboardAvailability={};state.companies=[];markup=ctx.renderDashboard();assert.ok(markup.includes('Nenhuma transição registrada'));assert.ok(!markup.includes('NaN'));
const readStart=inline.indexOf('async function readAllRows('),readEnd=inline.indexOf('async function loadAllData(',readStart);
vm.runInContext(inline.slice(readStart,readEnd),ctx);
const data=Array.from({length:1201},(_,id)=>({id})),ranges=[];
const result=await ctx.readAllRows(()=>({range:async(from,to)=>{ranges.push([from,to]);return {data:data.slice(from,Math.min(to+1,from+200)),error:null};}}));
assert.equal(result.data.length,1201,'Handles server caps smaller than requested pages');
assert.equal(ranges[1][0],200);
let calls=0;
const failed=await ctx.readAllRows(()=>({range:async()=>++calls===1?{data:[{id:1}],error:null}:{data:null,error:Error('failed')}}));
assert.equal(failed.data,null,'Partial data must never masquerade as complete');
assert.ok(failed.error);
const unavailable=await ctx.readAllRows(()=>({range:async()=>{throw Error('offline')}}));assert.equal(unavailable.data,null);
assert.ok(html.includes('src="dashboard.js"'));
assert.ok(!html.includes('cs.length*8+34'));
assert.ok(!html.includes('3 novas atualizações'));
console.log('Dashboard tests passed: dates, stages, repeated/merged/archived history, cohort conversion, no inferred meetings/analyses, unavailable vs zero and complete pagination.');

if(process.env.LEADSCOPE_BROWSER_QA){
  const {chromium}=await import(process.env.LEADSCOPE_PLAYWRIGHT);
  const browser=await chromium.launch({headless:true,executablePath:process.env.LEADSCOPE_CHROME});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const fixture={...state,companies,dashboardPeriod:'30',dashboardAudits:audits,dashboardAvailability:{history:true,companies:true,audits:true}};
  const boot=`const state=${JSON.stringify(fixture)};const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const companyLocation=c=>c.cidade||'Não informado';${js}function render(){document.getElementById('root').innerHTML=renderDashboard();}document.getElementById('testPeriod').onchange=e=>{state.dashboardPeriod=e.target.value;render();};render();`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html data-theme="light"><head><meta charset="utf-8">'+html.match(/<style>[\s\S]*?<\/style>/)[0]+'</head><body><select id="testPeriod"><option value="30">30 dias</option><option value="7">7 dias</option><option value="all">Tudo</option></select><main id="root" style="padding:24px"></main><script>'+boot+'</script></body></html>'}));
  await page.goto('http://localhost:43128');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    for(const period of ['7','30','all']){await page.locator('#testPeriod').selectOption(period);assert.ok(await page.locator('h1').textContent());}
    await page.screenshot({path:'/tmp/leadscope-dashboard-'+width+'.png',fullPage:width>900});
    if(width<900){
      await page.locator('.dashboard-grid').scrollIntoViewIfNeeded();
      await page.screenshot({path:'/tmp/leadscope-dashboard-mobile-etapas.png'});
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      await page.screenshot({path:'/tmp/leadscope-dashboard-mobile-escuro.png'});
      await page.evaluate(()=>document.documentElement.dataset.theme='light');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.evaluate(()=>{state.companies=[];state.dashboardAudits=[];render();});
  assert.ok((await page.locator('#root').innerText()).includes('Nenhuma transição registrada'));
  await page.evaluate(()=>{state.dashboardAvailability.history=false;render();});
  assert.ok((await page.locator('#root').innerText()).includes('Histórico comercial indisponível'));
  assert.deepEqual(errors,[]);await browser.close();
  console.log('Dashboard browser QA passed: 7/30/all periods, empty/unavailable data, desktop/mobile layout and no script errors.');
}

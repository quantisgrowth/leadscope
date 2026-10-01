import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const defaults=script.slice(script.indexOf('const DEFAULT_OPP_FILTERS'),script.indexOf('const DEFAULT_UI_PREFS'));
const lists=script.slice(script.indexOf('function companyListScope'),script.indexOf('/* ================= DIAGNOSTICO (empresa)'));
const monitoring=script.slice(script.indexOf('function renderMonitoradas'),script.indexOf('/* ================= RELATORIOS'));
const events=script.slice(script.indexOf('function bindPageEvents'),script.indexOf('function bindResultados'));
const fixture={
  route:'#/oportunidades',userId:'test-account',authUserId:'test-member',selectedOpps:[],listFilters:{},
  folders:[{id:'f',nome:'Sorocaba',cor:'#10a37f'}],offers:[{id:'offer',nome:'Sistema',tipo:'software',ativo:true}],
  companies:Array.from({length:45},(_,i)=>({
    id:'c'+i,nome:'Empresa '+i,segmento:i%2?'Locação':'Transportadora',cidade:i%2?'Sorocaba':'Tatuí',
    score:80+i%20,potencial:'alto',status:'Nova',confianca:'Alta',servicoRecomendado:'Sistema',
    createdAt:'2026-10-01',analyzedAt:i===44?null:'2026-10-01',monitorada:i%2===0,
    archivedAt:i===42?'2026-10-01':null,folderIds:i%2===0?['f']:[],sinais:[],evidencias:[]
  }))
};
const state=structuredClone(fixture);
const dependencies={
  state,document:{addEventListener(){}},localStorage:{getItem:()=>null},
  esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  icon:()=>'',companyLocation:c=>c.cidade||'Não informado',classificacao:()=>({color:'var(--blue)'}),
  OFFER_TYPES:{software:'Software'},COMMERCIAL_STAGES:['Nova','Priorizada']
};
dependencies.formatCnpj=value=>value;
const scope=vm.createContext(dependencies);
vm.runInContext(defaults+'state.oppFilters={...DEFAULT_OPP_FILTERS};'+lists+monitoring,scope);
scope.renderOportunidades();
assert.equal(scope.opportunityDataset().length,44);
scope.companyListFilters().search='Empresa 1';
scope.companyListFilters().view='cards';
const oppPrefs=scope.companyListFilters();
state.selectedOpps=['c1'];
state.route='#/monitoradas';
let markup=scope.renderMonitoradas();
assert.equal(state.selectedOpps.length,0,'Switching lists clears selections');
assert.equal(scope.opportunityDataset().length,22);
assert.equal(scope.folderCompanyCount('f'),22);
assert.ok(markup.includes('Empresas monitoradas'));
assert.ok(markup.includes('monitoramento automático não está ativado'));
assert.ok(!markup.includes('Nova avaliação negativa'));
assert.equal(scope.companyListFilters().search,'');
scope.companyListFilters().scoreMin=90;
assert.ok(scope.opportunityDataset().every(c=>c.monitorada&&c.score>=90&&!c.archivedAt));
state.selectedOpps=['c0','c1','c42'];
assert.deepEqual(Array.from(scope.opportunityExportRows('selected'),c=>c.id),['c0','c42'],'Export excludes other scopes even with stale IDs');
scope.companyListFilters().archive='arquivadas';
scope.companyListFilters().scoreMin='';
assert.equal(scope.opportunityDataset()[0].id,'c42');
state.route='#/diagnostico';
scope.renderDiagnosticoList();
assert.equal(scope.opportunityDataset().length,43,'Only available analyses, excluding archived by default');
scope.companyListFilters().view='funil';
scope.companyListFilters().pageSize=1;
scope.companyListFilters().page=2;
scope.companyListFilters().cidade='Sorocaba';
scope.renderDiagnosticoList();
const diagnosisPrefs=scope.companyListFilters();
state.diagReturnRoute=state.route;
state.route='#/diagnostico/c1';
state.route=state.diagReturnRoute;
scope.renderDiagnosticoList();
assert.equal(scope.companyListFilters(),diagnosisPrefs);
assert.equal(scope.companyListFilters().page,2);
assert.equal(scope.companyListFilters().view,'funil');
state.route='#/oportunidades';
scope.renderOportunidades();
assert.equal(scope.companyListFilters(),oppPrefs);
assert.equal(scope.companyListFilters().search,'Empresa 1');
assert.equal(scope.companyListFilters().view,'cards');
scope.setCompanyListFilters({...scope.companyListFilters(),search:''});
assert.equal(diagnosisPrefs.cidade,'Sorocaba','Resetting one scope preserves others');
for(const route of ['#/oportunidades','#/diagnostico','#/monitoradas']){
  state.route=route;scope.setCompanyListFilters({...scope.companyListFilters(),archive:'ativas',scoreMin:'',cidade:'todos'});
  for(const view of ['tabela','cards','funil']){
    scope.companyListFilters().view=view;
    markup=scope.renderOportunidades();
    for(const id of ['fSearch','openOppFilters','csvExportPicker','oppFolderPicker'])assert.ok(markup.includes('id="'+id+'"'));
    state.oppFilterOpen=true;markup=scope.renderOportunidades();
    for(const id of ['fCreatedFrom','fAnalyzedTo','fScoreMin','fPotencial','fStatus','fOffer','fOfferType','fSegmento','fCidade','fFolder'])assert.ok(markup.includes('id="'+id+'"'));
    state.oppFilterOpen=false;
  }
}
state.companies=[];state.route='#/monitoradas';assert.ok(scope.renderMonitoradas().includes('Nenhuma empresa monitorada ainda'));
state.route='#/diagnostico';assert.ok(scope.renderDiagnosticoList().includes('Nenhum diagnóstico disponível'));
assert.ok(script.includes('if(detailRoute) bindDiagnostico();'));
assert.ok(script.includes('listFilters:state.listFilters'));
assert.ok(!script.includes('Alertas simulados nesta versão'));
const reviews=[
  {id:'r0',score:70,analyzedAt:'2026-10-01',evidencias:[]},
  {id:'r1',score:70,analyzedAt:'2026-10-01',site:'https://example.test',evidencias:[{texto:'Perfil coletado',url:'https://example.test'}]},
  {id:'r2',score:70,analyzedAt:'2026-10-01',site:'https://example.test',siteAudit:{status:'concluido',finished_at:'2026-10-01'},evidencias:[{texto:'Perfil coletado',url:'https://example.test'}]},
  {id:'r3',score:70,analyzedAt:'2026-10-01',site:'https://example.test',siteAudit:{status:'concluido',finished_at:'2026-10-01'},cnpj:'11222333000181',cnpjValidatedAt:'2026-10-01',evidencias:[{texto:'Perfil coletado',url:'https://example.test'}]}
];
assert.deepEqual(reviews.map(c=>scope.diagnosisReview(c).stage),['evidencias','site','cnpj','registradas']);
assert.equal(scope.diagnosisReview({evidencias:[{texto:'Sem URL'}]}).evidenceCount,0);
assert.equal(scope.diagnosisReview({...reviews[3],cnpjActive:false}).stage,'cnpj');
assert.ok(scope.diagnosisReview(reviews[0]).pending.includes('Localizar ou confirmar o site'));
state.companies=reviews;state.route='#/diagnostico';scope.setCompanyListFilters({...scope.companyListFilters(),validation:'site',cidade:'todos',archive:'ativas',scoreMin:''});
assert.deepEqual(Array.from(scope.opportunityDataset(),c=>c.id),['r1']);
const diagnosisHtml=scope.renderDiagnosisList(reviews,'tabela');
assert.ok(diagnosisHtml.includes('Evidências com fonte'));
assert.ok(diagnosisHtml.includes('O que falta validar'));
assert.ok(!diagnosisHtml.includes('Etapa comercial'));
const board=scope.renderDiagnosisList(reviews,'funil');
assert.ok(board.includes('Quadro de validação'));
assert.ok(!board.includes('data-funnel-status'));
const diagnosticCsv=scope.buildCompanyCsv(reviews);
assert.ok(diagnosticCsv.includes('Pendências de validação'));
state.selectedOpps=['r1'];markup=scope.renderDiagnosticoList();
assert.ok(markup.includes('id="bulkReanalyze"'));
assert.ok(!markup.includes('id="bulkStatus"'));
assert.ok(!markup.includes('id="bulkArchive"'));
assert.ok(!markup.includes('id="bulkMonitor"'));
state.route='#/oportunidades';markup=scope.renderOportunidades();
assert.ok(markup.includes('id="bulkStatus"')===false,'Selection clears when changing scopes');
assert.ok(scope.renderOppTable(reviews).includes('Etapa comercial'));
console.log('Company lists passed: independent filters/views, monitored/analysis scope, folders, export isolation, archive, empty states and return preferences. No external calls.');

// Optional browser QA uses only synthetic fixtures and blocks all external traffic.
if(process.env.LEADSCOPE_BROWSER_QA){
  const {chromium}=await import(process.env.LEADSCOPE_PLAYWRIGHT);
  const browser=await chromium.launch({headless:true,executablePath:process.env.LEADSCOPE_CHROME});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const bootstrap=`
    const state=${JSON.stringify(fixture)};
    ${defaults}
    state.oppFilters={...DEFAULT_OPP_FILTERS};
    const OFFER_TYPES={software:'Software'},COMMERCIAL_STAGES=['Nova','Priorizada'];
    const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const icon=()=>'',companyLocation=c=>c.cidade||'',classificacao=()=>({color:'var(--blue)'});
    let currentDiagId=null;
    function saveUiPrefs(){} function toast(){} function setState(p){Object.assign(state,p);render();}
    function navigate(route){state.route=route;render();}
    function render(){document.getElementById('root').innerHTML=state.route.split('/')[2]?'<button id="testBack">Voltar</button>':renderOportunidades();if(state.route.split('/')[2])document.getElementById('testBack').onclick=()=>navigate(state.diagReturnRoute);else bindPageEvents(state.route.split('/')[1]);}
    function bindDiagnostico(){}
    ${lists}
    ${monitoring}
    ${events}
    render();
  `;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html data-theme="light"><head><meta charset="utf-8">'+html.match(/<style>[\s\S]*?<\/style>/)[0]+'</head><body><main id="root" style="padding:24px"></main><script>'+bootstrap+'</script></body></html>'}));
  await page.goto('http://localhost:43127');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(()=>navigate('#/monitoradas'));
    await page.locator('#viewCards').click();
    await page.locator('#openOppFilters').click();
    await page.locator('#fCidade').selectOption('Tatuí');
    await page.locator('#applyOppFilters').click();
    assert.equal(await page.locator('#fSearch').inputValue(),'');
    await page.locator('[data-diag]').first().click();
    await page.locator('#testBack').click();
    assert.equal(await page.evaluate(()=>state.route),'#/monitoradas');
    assert.equal(await page.evaluate(()=>companyListFilters().cidade),'Tatuí');
    assert.equal(await page.evaluate(()=>companyListFilters().view),'cards');
    await page.screenshot({path:'/tmp/leadscope-monitoradas-'+width+'.png',fullPage:true});
    await page.evaluate(()=>navigate('#/diagnostico'));
    await page.locator('#viewTabela').click();
    await page.locator('#selAll').check();
    await page.locator('#csvExportPicker summary').click();
    assert.ok((await page.locator('[data-export-csv="selected"]').textContent()).includes('(20)'));
    await page.screenshot({path:'/tmp/leadscope-diagnosticos-'+width+'.png',fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,'No document-wide horizontal overflow at '+width);
  }
  await page.evaluate(rows=>{
    state.companies=rows.map((row,i)=>({...state.companies[0],...row,nome:'Empresa de teste '+i}));
    navigate('#/diagnostico');setCompanyListFilters({...companyListFilters(),validation:'todos',view:'tabela'});render();
  },reviews);
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#viewFunnel').click();
  assert.equal(await page.locator('[data-funnel-status]').count(),0);
  assert.equal(await page.locator('.funnel-column').count(),4);
  await page.screenshot({path:'/tmp/leadscope-validacao-1440.png',fullPage:true});
  await page.locator('#viewCards').click();
  await page.locator('#openOppFilters').click();
  await page.locator('#fValidation').selectOption('cnpj');
  await page.locator('#applyOppFilters').click();
  assert.equal(await page.locator('.selOpp').count(),1);
  await page.setViewportSize({width:390,height:1000});
  await page.screenshot({path:'/tmp/leadscope-validacao-390.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('Browser QA passed: desktop/mobile filters, view toggles, selection, export menu, detail return, no page errors or horizontal overflow.');
}

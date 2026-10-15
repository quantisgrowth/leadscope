import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const context=vm.createContext({Map,esc});vm.runInContext(read('approach.js'),context);
const company={id:'school',nome:'Tenaz Idiomas',segmento:'Escola de idiomas',qualification:{},offerRecommendation:{offer:{id:'offer',nome:'Assistente Comercial',resultado:'Responder dúvidas no WhatsApp e agendar aulas experimentais',publicoAlvo:'Escolas de idiomas',ativo:true}}};
for(const variant of [0,1,2])for(const tone of ['direto','consultivo','informal']){
  const text=context.approachTemplates(company,variant)[tone];
  assert.ok(text.includes(company.offerRecommendation.offer.nome),`${tone}/${variant} must name the product`);
  assert.ok(text.includes(company.offerRecommendation.offer.resultado),`${tone}/${variant} must include the registered outcome`);
  assert.ok(text.includes('Tenaz Idiomas'));assert.ok(text.includes('?'));
  assert.ok(!/contratos|ordens de serviço|organizam a operação|presumir que/.test(text),'No ERP boilerplate or awkward disclaimers for an unrelated product');
  assert.ok(!/encontrei.*Tenaz.*pesquisando empresas de/i.test(text));
}
for(const tone of ['direto','consultivo','informal'])assert.equal(new Set([0,1,2].map(v=>context.approachTemplates(company,v)[tone])).size,3);
const missing={...company,offerRecommendation:null};assert.equal(context.approachTemplates(missing).informal,'');assert.equal(context.nextApproachSuggestion(missing,'informal'),false);
assert.equal(context.approachTemplates({...company,offerRecommendation:{offer:{nome:'Sem benefício'}}}).direto,'');
assert.equal(context.approachTemplates({...company,offerRecommendation:{offer:{...company.offerRecommendation.offer,ativo:false}}}).direto,'');
const saved={...company,mensagemTom:'informal',mensagemGerada:'Texto anterior editado pelo comercial'};
assert.equal(context.approachMessage(saved,'informal'),saved.mensagemGerada);
assert.ok(context.renderApproachOfferContext(saved,'informal').includes('Texto salvo ou rascunho preservado'));
assert.equal(context.nextApproachSuggestion(saved,'informal'),true);assert.notEqual(context.approachMessage(saved,'informal'),saved.mensagemGerada);assert.equal(saved.mensagemGerada,'Texto anterior editado pelo comercial');
context.emptyCompany=company;vm.runInContext("approachDrafts.set(emptyCompany.id+'|direto',{text:''})",context);assert.equal(context.approachMessage(company,'direto'),'','Empty draft must not resurrect saved or generated text');
assert.ok(context.renderApproachOfferContext({...company,offerRecommendation:{offer:{nome:'<img src=x>',resultado:'<script>benefit'}}},'direto').includes('&lt;script>'));
const irrelevant={...company,siteAudit:{status:'concluido',metrics:{operational_signals:[{label:'Locação de equipamentos'}]}}};
assert.ok(!context.approachTemplates(irrelevant).consultivo.includes('Locação de equipamentos'));
const relevant={...company,siteAudit:{status:'concluido',metrics:{operational_signals:[{label:'WhatsApp visível'}]}}};assert.ok(context.approachTemplates(relevant).direto.includes('whatsapp visível'));
assert.ok(!context.approachTemplates({...relevant,siteAudit:{...relevant.siteAudit,status:'falhou'}}).direto.includes('Vi no site'));
assert.ok(context.approachTemplates({...company,qualification:{need:'Responder contatos de interessados'}}).informal.includes('Faz sentido conversarmos sobre Responder contatos de interessados?'));
console.log('Approach product regression: all 9 suggestions include selected product/outcome, no unrelated ERP text, real variations, missing/inactive offers, relevant evidence, saved/empty drafts and escaped offer labels passed.');

if(process.env.LEADSCOPE_BROWSER_QA){
  const {chromium}=await import(process.env.LEADSCOPE_PLAYWRIGHT),browser=await chromium.launch({headless:true,executablePath:process.env.LEADSCOPE_CHROME}),page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const html=read('index.html'),boot=`const state={companies:[${JSON.stringify(company)}],diagTone:'informal',readOnly:false};let currentDiagId='school';const esc=${esc.toString()},toast=()=>{},fmtDateTime=s=>s;const sb={};${read('approach.js')}function render(){const c=state.companies[0];document.getElementById('root').innerHTML='<section class="card"><h2>Como abordar</h2>'+renderApproachOfferContext(c,state.diagTone)+'<div class="row gap-8 wrap">'+['direto','consultivo','informal'].map(t=>'<button class="btn" data-tone="'+t+'">'+t+'</button>').join('')+'</div><div class="message-box" id="msgBox" contenteditable="true">'+esc(approachMessage(c,state.diagTone))+'</div><div class="row gap-8 wrap"><button class="btn" id="regenMsg">Outra sugestão do modelo</button><button class="btn" id="saveMsg">Salvar versão</button></div></section>';bindApproach();document.querySelectorAll('[data-tone]').forEach(b=>b.onclick=()=>{state.diagTone=b.dataset.tone;render();});document.getElementById('regenMsg').onclick=()=>{if(nextApproachSuggestion(c,state.diagTone))render();};}render();`;
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+html.match(/<style>[\s\S]*?<\/style>/)[0]+'</head><body><main style="padding:20px" id="root"></main><script>'+boot+'</script></body></html>'}));await page.goto('http://localhost:43133');
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);for(const tone of ['direto','consultivo','informal']){await page.locator(`[data-tone="${tone}"]`).click();assert.ok((await page.locator('#msgBox').innerText()).includes('Assistente Comercial'));assert.ok((await page.locator('#msgBox').innerText()).includes('agendar aulas experimentais'));}await page.locator('#regenMsg').click();assert.ok((await page.locator('#msgBox').innerText()).includes('Assistente Comercial'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`/tmp/leadscope-product-approach-${width}-${theme}.png`});}}
  await page.evaluate(()=>{state.companies[0].offerRecommendation=null;render();});assert.equal(await page.locator('#regenMsg').isEnabled(),false);assert.ok((await page.locator('#root').innerText()).includes('Nenhum produto associado'));assert.equal(await page.locator('#msgBox').innerText(),'');
  assert.deepEqual(errors,[]);await browser.close();console.log('Approach browser QA: explicit product/benefit, all tones, variation, missing-offer guidance and desktop/mobile light/dark layouts passed.');
}

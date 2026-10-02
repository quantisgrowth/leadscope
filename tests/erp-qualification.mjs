import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html'),inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(inline);new vm.Script(read('erp.js'));
const context=vm.createContext({esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),externalSiteLink:s=>s&&/^https?:/.test(s)?'link':'',fmtDate:()=> '01/10/2026',fmtDateTime:()=> '01/10/2026',state:{readOnly:false},URL});
vm.runInContext(read('erp.js'),context);
assert.equal(context.erpAssessment({}).coverage,0);
assert.equal(context.erpAssessment({qualification:{_updatedAt:'now'}}).label,'Ainda não qualificada em conversa');
assert.equal(context.erpAssessment({qualification:{need:'Contratos',decisionMaker:'Diretor',timing:'30 dias'}}).confirmed,true);
assert.equal(context.erpAssessment({qualification:{need:'Contratos'}}).confirmed,false);
assert.equal(context.erpObservations({sourcePayload:{categories:'invalid'},siteAudit:{status:'concluido',metrics:{operational_signals:'invalid'}}}).length,0);
const sample={sourcePayload:{reviews:[{text:'Entrega rápida sem atrasos <script>',stars:5}],categories:['Locadora']},qualification:{need:'<script>'}};
assert.ok(context.renderErpReviews(sample).includes('&lt;script>'));
assert.ok(!context.renderErpReviews(sample).includes('Sentimento negativo'));
assert.ok(context.renderErpTab(sample).includes('&lt;script>'));
for(const file of ['search-places','reanalyze-opportunities']){
  const js=stripTypeScriptTypes(read(`supabase/functions/${file}/index.ts`).replace(/^import .+;\n/gm,''));
  const ctx=vm.createContext({withSupabase:()=>{},Response,console});
  vm.runInContext(js.replace('export default','const handler ='),ctx);
  const offer={nome:'ERP operacional',resultado:'Gestão de contratos',publico_alvo:'Locadoras',categorias:['locadora'],sinais:['semSite'],prioridade:100,etapa:'principal'};
  let match=file==='search-places'?ctx.matchOffer({title:'Dentista',categoryName:'Odontologia'},['semSite'],offer):ctx.matchOffer({nome:'Dentista',segmento:'Odontologia'}, {},['semSite'],offer);
  assert.equal(match.compatibility,0,'No fabricated fit from priority or website absence');
  match=file==='search-places'?ctx.matchOffer({title:'Locadora de máquinas'},[],offer):ctx.matchOffer({nome:'Locadora de máquinas'}, {},[],offer);
  assert.equal(match.compatibility,70);
  if(file==='reanalyze-opportunities')assert.equal(ctx.matchOffer({nome:'ABC'}, {},[],offer,'Locadora de máquinas').compatibility,70);
  const full={title:'ABC',address:'Rua',phone:'123',website:'https://example.org',url:'https://maps.google.com',totalScore:5,reviewsCount:1000};
  const score=file==='search-places'?ctx.scorePlace(full,0):ctx.scoreCompany({nome:'ABC',endereco:'Rua',telefone:'123',site:full.website,nota:5,avaliacoes:1000,source_url:full.url},{},0);
  assert.equal(score.total,40,'Unmatched profile cannot become high potential from reputation');
  assert.equal(score.total,score.profile+score.compatibility+score.reputation+score.contact+score.confidence);
}
const search=read('supabase/functions/search-places/index.ts');
assert.ok(search.includes('scrapeReviewsPersonalData: false'));
assert.ok(search.includes('maxTotalChargeUsd=0.50'));
assert.ok(search.includes('maximumLeadsEnrichmentRecords: 0'));
assert.ok(search.includes('review_limit === 5 ? 5 : 0'));
assert.ok(!html.includes('id="rRaio"'));
assert.ok(html.includes('bindRadarErpOptions();'));
console.log('ERP: unknown vs confirmed, public observations, escaped content, real offer fit, optional bounded enrichment and radar integration passed.');

if(process.env.LEADSCOPE_PGLITE){
  const {PGlite}=await import(process.env.LEADSCOPE_PGLITE);const db=new PGlite();
  const owner='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',id='10000000-0000-0000-0000-000000000001';
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.current_account_id() returns uuid language sql stable as $$select coalesce(nullif(current_setting('test.account',true),'')::uuid,auth.uid())$$;
    create function public.current_account_can_write() returns boolean language sql stable as $$select current_setting('test.write',true)='true'$$;
    create table public.empresas(id uuid primary key,user_id uuid,merged_into uuid);
    create table public.company_versions(id bigint generated always as identity,empresa_id uuid,snapshot jsonb);
    create function public.test_capture() returns trigger language plpgsql security definer as $$begin insert into public.company_versions(empresa_id,snapshot) values(NEW.id,to_jsonb(NEW));return NEW;end$$;
    create trigger versions after update on public.empresas for each row execute function public.test_capture();
    alter table public.empresas enable row level security;
    grant usage on schema auth to authenticated;grant select,update on public.empresas to authenticated;
    create policy account_rows on public.empresas for all to authenticated using(user_id=public.current_account_id()) with check(user_id=public.current_account_id());
    insert into public.empresas values('${id}','${owner}',null);`);
  await db.exec(read('supabase/manual/04_erp_qualification.sql')); // Actual Postgres parses migration and RPC.
  await db.exec(`set role authenticated;set test.uid='${owner}';set test.write='true'`);
  const save=async(values,expected={})=>(await db.query('select public.save_commercial_qualification($1,$2::jsonb,$3::jsonb) as value',[id,JSON.stringify(values),JSON.stringify(expected)])).rows[0].value;
  const saved=await save({equipment:0,spreadsheets:'nao',need:'Contratos'});assert.equal(saved.equipment,0);assert.equal(saved._updatedBy,owner);
  await assert.rejects(()=>save({need:'Outra'}),/Outra pessoa/);
  await assert.rejects(()=>save({equipment:-1},saved),/Quantidade inválida/);
  await assert.rejects(()=>save({equipment:1.5},saved),/Quantidade inválida/);
  await assert.rejects(()=>save({equipment:'abc'},saved));
  await assert.rejects(()=>save({_updatedBy:other},saved),/Campo/);
  await assert.rejects(()=>save({notes:'x'.repeat(2001)},saved),/Texto/);
  await assert.rejects(()=>save({spreadsheets:'maybe'},saved),/Opção/);
  await db.exec(`set test.write='false'`);await assert.rejects(()=>save({},saved),/somente leitura/);
  await db.exec(`set test.write='true';set test.uid='${other}'`);await assert.rejects(()=>save({},saved),/Empresa não encontrada/);
  await db.exec(`set test.account='${owner}'`);const edited=await save({need:'Ordens de serviço'},saved);assert.equal(edited._updatedBy,other,'Editor author preserved');
  await db.exec(`reset role`);const versions=await db.query('select snapshot from public.company_versions order by id');assert.equal(versions.rows.length,2);assert.equal(versions.rows[0].snapshot.commercial_qualification.need,'Contratos');
  await db.exec(`set role anon`);await assert.rejects(()=>save({},saved),/permission denied/);
  await db.close();console.log('PostgreSQL SQL04: syntax, real RPC, history trigger, authorization, bad input and concurrent edit conflict passed (isolated database).');
}

if(process.env.LEADSCOPE_BROWSER_QA){
  const {chromium}=await import(process.env.LEADSCOPE_PLAYWRIGHT);
  const browser=await chromium.launch({headless:true,executablePath:process.env.LEADSCOPE_CHROME});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const radar=inline.slice(inline.indexOf('function renderRadar(){'),inline.indexOf('\nfunction bindRadarProcessing(){'));
  const company={...sample,id:'a',nome:'Locadora de máquinas',segmento:'Locadora',site:'https://example.org',telefone:'1599999999',cidade:'Sorocaba',qualificationReady:true,offerRecommendation:{compatibilidade:70},qualification:{need:'Gestão de contratos'},siteAudit:{status:'concluido',finished_at:'2026-10-01',metrics:{operational_signals:[{label:'Locação de equipamentos',context:'Locação de retroescavadeiras com operador',source:'https://example.org'}]}}};
  const boot=`const state={companies:[${JSON.stringify(company)}],readOnly:false,onboarding:{segmentosDesejados:'Locadora',regiao:'Brasil',palavrasChave:'',qtdOportunidades:'5'},offers:[{id:'offer',nome:'Quantis Lift',publicoAlvo:'Locadoras e prestadores de serviços',resultado:'Gestão de contratos e ordens de serviço',ativo:true,etapa:'principal'}],radars:[]};let radarCategories=null,radarOfferIds=null,currentDiagId='a';const OFFER_STAGES=[{key:'principal',label:'Oferta principal'}];const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const externalSiteLink=s=>/^https?:/.test(s||'')?'<a target="_blank" href="'+esc(s)+'">Fonte pública ↗</a>':'';const fmtDate=()=> '01/10/2026',fmtDateTime=()=> '01/10/2026',formatOfferPrice=()=> 'Sob consulta',icon=()=>'',toast=()=>{};let writes=0;const sb={rpc:async(name,args)=>{writes++;return {data:{...args.p_values,_updatedAt:'2026-10-01'}}}};function setState(){render('operacao');}${read('erp.js')}${radar}function render(view){document.getElementById('root').innerHTML=view==='radar'?renderRadar():renderErpSummary(state.companies[0])+renderErpTab(state.companies[0]);if(view==='radar')bindRadarErpOptions();else bindErpQualification();}render('radar');`;
  const fixture='<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+html.match(/<style>[\s\S]*?<\/style>/)[0]+'</head><body><main id="root" style="padding:20px"></main><script>'+boot+'</script></body></html>';
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));await page.goto('http://localhost:43129');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:950});await page.evaluate(()=>render('radar'));
    assert.equal(await page.locator('#rScope').inputValue(),'region');
    assert.ok((await page.locator('#rIdealProfile').textContent()).includes('Locadoras'));
    assert.equal(await page.locator('#rContacts').isChecked(),false);
    assert.equal(await page.locator('#rReviews').isChecked(),false);
    await page.locator('summary').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Radar must fit');
    await page.screenshot({path:`/tmp/leadscope-erp-radar-${width}.png`,fullPage:width>900});
    await page.evaluate(()=>render('operacao'));await page.locator('#erp-system').fill('Planilha');await page.locator('#erp-equipment').fill('0');
    await page.locator('#saveErpQualification').click();assert.equal(await page.evaluate(()=>state.companies[0].qualification.equipment),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Qualification must fit');
    await page.screenshot({path:`/tmp/leadscope-erp-ficha-${width}.png`,fullPage:width>900});
  }
  await page.evaluate(()=>{state.readOnly=true;render('operacao');});assert.equal(await page.locator('#saveErpQualification').isDisabled(),true);
  await page.evaluate(()=>{state.readOnly=false;state.companies[0].qualificationReady=false;render('operacao');});assert.equal(await page.locator('#saveErpQualification').isDisabled(),true);
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:'/tmp/leadscope-erp-ficha-dark.png'});
  assert.deepEqual(errors,[]);await browser.close();console.log('ERP browser QA: responsive radar/form, inherited audience, opt-in costs, manual zero persistence, read-only and installation gate passed.');
}

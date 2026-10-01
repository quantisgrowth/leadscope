import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const ts=read('supabase/functions/team-invitations/index.ts').replace(/^import .+;\n/gm,'');
const envVars={SUPABASE_SERVICE_ROLE_KEY:'FAKE_TEST_SECRET',SUPABASE_URL:'https://test.invalid'};
let sent=0,lastEmail,acceptedArgs;
const fakeUser={id:'owner',email:'owner@example.org',email_confirmed_at:'2026-01-01T00:00:00Z'};
const admin={auth:{admin:{getUserById:async()=>({data:{user:fakeUser}})}},rpc:async(name,args)=>{acceptedArgs=args;return {data:'account',error:null}},from:()=>{
  let row;
  const query={select(){return this},eq(){return this},in(){return this},gte(){return this},order(){return this},limit(){return this},update(){return this},insert(value){row={id:'test-invitation',...value};return this},single:async()=>({data:row,error:null}),then(resolve){return Promise.resolve({data:[],count:0,error:null}).then(resolve)}};
  return query;
}};
const scope=vm.createContext({Response,crypto:webcrypto,TextEncoder,AbortSignal,URL,Deno:{env:{get:key=>envVars[key]}},createClient:()=>admin,withSupabase:(_,fn)=>fn,accountId:async ctx=>ctx.owner||ctx.userClaims.id,fetch:async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent++;lastEmail=JSON.parse(options.body);assert.ok(options.headers['Idempotency-Key']);return {ok:true,json:async()=>({id:'mock-message'})}}});
const handler=vm.runInContext(stripTypeScriptTypes(ts).replace('export default','const handler =')+'\nhandler.fetch',scope);
const request=body=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)});
const owner={userClaims:{id:'owner'}};
assert.equal((await handler(request({action:'invite'}),{userClaims:{}})).status,401);
assert.equal((await handler(request({action:'invite'}),{userClaims:{id:'member'},owner:'owner'})).status,403);
assert.equal((await handler(request({action:'invite',email:'guest@example.org'}),owner)).status,503);
assert.equal(sent,0);
envVars.RESEND_API_KEY='FAKE_TEST_EMAIL_KEY';envVars.INVITE_FROM_EMAIL='LeadScope <invite@example.org>';
assert.equal((await handler(request({action:'invite',email:'bad-email'}),owner)).status,400);
assert.equal((await handler(request({action:'invite',email:'owner@example.org'}),owner)).status,400);
const sentResponse=await handler(request({action:'invite',email:'guest@example.org',role:'viewer'}),owner);
assert.equal(sentResponse.status,200);
assert.equal((await sentResponse.json()).sent,true);
assert.equal(sent,1);assert.equal(lastEmail.to[0],'guest@example.org');
assert.ok(lastEmail.html.includes('team_invite='));assert.ok(!lastEmail.html.includes('FAKE_TEST_SECRET'));
assert.equal((await handler(request({action:'accept',token:'bad'}),owner)).status,400);
fakeUser.email_confirmed_at=null;
assert.equal((await handler(request({action:'accept',token:'a'.repeat(64)}),owner)).status,403);
fakeUser.email_confirmed_at='2026-01-01';
assert.equal((await handler(request({action:'accept',token:'a'.repeat(64)}),owner)).status,200);
assert.equal(acceptedArgs.p_email,fakeUser.email);assert.equal(acceptedArgs.p_user,'owner');
assert.equal(acceptedArgs.p_hash.length,64);assert.notEqual(acceptedArgs.p_hash,'a'.repeat(64));

const inline=read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(inline);
const start=inline.indexOf('function opportunityDataset()'),end=inline.indexOf('\nfunction ',start+1);
const state={companies:[{id:'a',folderIds:[],score:50,nome:'A'},{id:'b',folderIds:['folder'],score:70,nome:'B'}],oppFilters:{folderId:'sem_pasta',archive:'ativas',search:'',potencial:'todos',status:'todos',segmento:'todos',cidade:'todos',offerId:'todos',offerType:'todos',scoreMin:'',scoreMax:'',createdFrom:'',createdTo:'',analyzedFrom:'',analyzedTo:'',sort:'score_desc'}};
const browser=vm.createContext({state,normalizedText:s=>String(s||'').toLowerCase(),companyLocation:c=>c.cidade||'',companyOffer:()=>null});
vm.runInContext(inline.slice(start,end),browser);
assert.equal(browser.opportunityDataset().length,1);assert.equal(browser.opportunityDataset()[0].id,'a');
state.oppFilters.folderId='todos';assert.equal(browser.opportunityDataset().length,2);
state.oppFilters.folderId='folder';assert.equal(browser.opportunityDataset()[0].id,'b');

for(const name of ['search-places','search-google-places','reanalyze-opportunities']){
  const source=read(`supabase/functions/${name}/index.ts`);
  assert.ok(!source.includes('.from("score_components").delete()'));
  assert.ok(!source.includes('status: "Nova"'));
}
console.log('Local mocks passed: invitation authorization/configuration, verified-email acceptance, folder views and append-only analysis source. No actual emails, database calls or credits used.');

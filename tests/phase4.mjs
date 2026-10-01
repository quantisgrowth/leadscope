import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const html=read('index.html');
const inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(inline); // All browser JavaScript must still parse.
function browserFunction(name){
  const start=inline.indexOf(`function ${name}(`);
  const rest=inline.slice(start);
  const end=rest.indexOf('\nfunction ',1);
  return rest.slice(0,end<0?rest.length:end);
}
const context=vm.createContext({URL,normalizeText:s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()});
vm.runInContext(browserFunction('collectedChannels')+'\n'+browserFunction('possibleDuplicates'),context);
const audit={url:'https://example.org',finished_at:'2026-10-01T00:00:00Z'};
const channels=context.collectedChannels({social_links:['https://instagram.com/company','https://instagram.com/company','https://instagram.com.evil.test/user','https://facebook.com/sharer.php','javascript:alert(1)'],email_links:['mailto:contact@example.org?subject=Hi','javascript:alert(1)'],phone_links:['tel:+5515999999999','tel:evil'],whatsapp_links:['https://wa.me/5515999999999','https://wa.me.evil.test/user']},audit);
assert.equal(channels.length,4);
assert.ok(channels.every(channel=>channel.source===audit.url));
const company={id:'a',nome:'Empresa Árvore',site:'https://www.example.org',telefone:'+55 (15) 99999-9999',endereco:'Rua Um, 100, Centro'};
assert.equal(context.possibleDuplicates(company,[company,{...company,id:'b'}])[0].reasons.length,3);
assert.equal(context.possibleDuplicates({...company,site:'https://instagram.com/a',telefone:''},[{id:'b',site:'https://instagram.com/b'}]).length,0);
assert.equal(context.possibleDuplicates(company,[{...company,id:'b',archivedAt:'2026-01-01'}]).length,0);
assert.equal(context.possibleDuplicates(company,[{id:'b',nome:'Outra',site:'https://other.org',telefone:'+55 (11) 99999-9999'}]).length,0);

const ts=read('supabase/functions/audit-site/index.ts');
const definition=ts.slice(ts.indexOf('const PAGE_FUNCTION ='),ts.indexOf('\nfunction cleanText'));
const pageFunction=vm.runInNewContext(definition+'\n('+ 'PAGE_FUNCTION'+')');
new vm.Script('('+pageFunction+')');
async function extract(bodyText){
  const links=['https://instagram.com/company','https://instagram.com.evil.test/user','https://facebook.com/sharer.php','mailto:contact@example.org','tel:+5515999999999'].map(href=>({href,textContent:'Contato',getBoundingClientRect:()=>({width:10,height:10})}));
  const document={title:'Empresa Árvore',body:{innerText:bodyText,prepend(){}},documentElement:{scrollWidth:390},querySelector:s=>s.includes('description')?{getAttribute:()=> 'Descrição pública da empresa com informações para os clientes interessados.'}:s.includes('viewport')?{getAttribute:()=> 'width=device-width, initial-scale=1'}:null,querySelectorAll:s=>s==='a[href]'?links:s==='h1'?[{}]:[],createElement:()=>({setAttribute(){}})};
  const c=vm.createContext({URL,TextEncoder,document,window:{innerWidth:390,getComputedStyle:()=>({display:'block',visibility:'visible'})},location:{href:audit.url,protocol:'https:'},btoa:s=>Buffer.from(s,'binary').toString('base64')});
  const fn=vm.runInContext('('+pageFunction+')',c);
  let result;
  await fn({page:{setViewportSize:async()=>{},waitForTimeout:async()=>{},evaluate:async(callback,arg)=>{
    c.arg=arg;
    const output=vm.runInContext('('+callback.toString()+')(arg)',c);
    if(output&&output.checks) result=output;
    return output;
  }}});
  return result;
}
const result=await extract('CNPJ: 11.222.333/0001-81. CNPJ: 11.222.333/0001-81. CNPJ: 00.000.000/0000-00. CNPJ: 11.222.333/0001-82');
assert.equal(result.cnpjCandidates.length,1);
assert.equal(result.cnpjCandidates[0].cnpj,'11222333000181');
assert.equal(result.socialLinks.length,1);
assert.equal(result.emailLinks.length,1);
assert.equal(result.phoneLinks.length,1);
assert.equal((await extract('Número de pedido: 11222333000181')).cnpjCandidates.length,0);
assert.equal((await extract('CNPJ: 12.ABC.345/01DE-35')).cnpjCandidates.length,1);

const validateTs=read('supabase/functions/validate-cnpj/index.ts');
const validateJs=stripTypeScriptTypes(validateTs.replace(/^import .+;\n/gm,''));
let writes=0,fetches=0;
let registry={cnpj:'11222333000181',razao_social:'Outra Empresa Ltda',municipio:'Recife',descricao_situacao_cadastral:'ATIVA'};
const query={select(){return this},eq(){return this},single:async()=>({data:{nome:'Empresa Árvore',cidade:'Sorocaba, SP',telefone:'15999999999'}}),update(){writes++;return this},then(resolve){resolve({error:null})}};
const env=vm.createContext({Response,AbortController,DOMException,setTimeout,clearTimeout,console,fetch:async()=>{fetches++;return {ok:true,status:200,json:async()=>registry}},withSupabase:(_,handler)=>handler});
const accountJs=stripTypeScriptTypes(read('supabase/functions/_shared/account.ts')).replace('export async','async');
vm.runInContext(accountJs,env);
const handler=vm.runInContext(validateJs.replace('export default','const exported =')+'\nexported.fetch',env);
assert.equal(vm.runInContext("cnpjIsValid('12ABC34501DE35')",env),true);
assert.equal(vm.runInContext("cnpjIsValid('12ABC34501DE36')",env),false);
const req=(body)=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)});
const ctx={userClaims:{id:'owner'},supabase:{from:()=>query,rpc:async(name)=>({data:name==='current_account_id'?'owner':true,error:null})}};
assert.equal((await handler(req({company_id:'a',cnpj:'11222333000181'}),{...ctx,userClaims:{}})).status,401);
assert.equal(fetches,0);
assert.equal((await handler(req({company_id:'a',cnpj:'11222333000182'}),ctx)).status,400);
assert.equal(fetches,0);
const preview=await handler(req({company_id:'a',cnpj:'11222333000181'}),ctx);
assert.equal((await preview.json()).requires_confirmation,true);
assert.equal(writes,0);
await handler(req({company_id:'a',cnpj:'11222333000181',confirm_identity:true}),ctx);
assert.equal(writes,1);
registry={...registry,cnpj:'00000000000000'};
assert.equal((await handler(req({company_id:'a',cnpj:'11222333000181',confirm_identity:true}),ctx)).status,500);
assert.equal(writes,1);
registry={...registry,cnpj:'11222333000181',razao_social:'Empresa Árvore Ltda',municipio:'Sorocaba'};
const matched=await handler(req({company_id:'a',cnpj:'11222333000181'}),ctx);
assert.equal((await matched.json()).identity_score,90);
assert.equal(writes,2);
console.log('Phase 4: browser syntax, extraction, channel safety, duplicate detection and protected CNPJ handler passed. No external calls or customer data writes.');

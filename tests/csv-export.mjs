import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const functions=script.slice(script.indexOf('function dateKey('),script.indexOf('function normalizedText('));
const format=script.slice(script.indexOf('function formatCnpj('),script.indexOf('\n}',script.indexOf('function formatCnpj('))+2);
const state={selectedOpps:['c1','c35','missing','c1'],companies:Array.from({length:45},(_,i)=>({id:'c'+i,nome:'Empresa '+i,score:i===1?0:i,folderIds:['folder'],potencial:'alto',telefone:'+55 15 99999-0000',cnpj:'00123456000100'})),folders:[{id:'folder',nome:'Sorocaba'}]};
state.companies[1].nome='Locação; "Máquinas"\nSorocaba';
state.companies[1].site='=HYPERLINK("https://bad.invalid")';
let filtered=state.companies.slice(0,30),blob,download,clicked=0,removed=0,revoked=0;
const messages=[],timers=[],picker={open:true};
const scope=vm.createContext({state,Blob,Set,Date,opportunityDataset:()=>filtered,toast:m=>messages.push(m),URL:{createObjectURL:b=>{blob=b;return 'blob:test'},revokeObjectURL:()=>revoked++},setTimeout:fn=>timers.push(fn),document:{addEventListener(){},getElementById:()=>picker,body:{appendChild:a=>download=a},createElement:()=>({click:()=>clicked++,remove:()=>removed++})}});
scope.companyListBase=()=>state.companies;
scope.companyListScope=()=>'oportunidades';
vm.runInContext(format+functions,scope);
assert.equal(scope.opportunityExportRows('filtered').length,30,'All filtered rows, not just a 20-row page');
assert.deepEqual(Array.from(scope.opportunityExportRows('selected'),c=>c.id),['c1','c35'],'Selection can include other pages/filters; stale IDs omitted, duplicates removed');
assert.throws(()=>scope.opportunityExportRows('invalid'));
for(const v of ['=SUM(1,2)','+cmd','-cmd','@SUM(A1)','\t=1',' \r\n=1','＝1'])assert.ok(scope.csvCell(v).startsWith('"\''));
assert.equal(scope.csvCell(null),'""');assert.equal(scope.csvCell(0),'"0"');
function parse(csv){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=1;i<csv.length;i++){const ch=csv[i];if(ch==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===';'&&!quoted){row.push(cell);cell='';}else if(ch==='\r'&&csv[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=ch;}
  return rows;
}
const csv=scope.buildCompanyCsv(scope.opportunityExportRows('selected'));
assert.ok(csv.startsWith('\ufeff'));const rows=parse(csv);assert.equal(rows.length,3);assert.ok(rows.every(row=>row.length===19));
assert.equal(rows[1][0],state.companies[1].nome);assert.equal(rows[1][5],"'+55 15 99999-0000");
assert.equal(rows[1][6],"'=HYPERLINK(\"https://bad.invalid\")");assert.equal(rows[1][7],'00.123.456/0001-00');assert.equal(rows[1][9],'0');assert.equal(rows[1][15],'Sorocaba');
const blobText=async()=>new TextDecoder('utf-8',{ignoreBOM:true}).decode(await blob.arrayBuffer());
scope.downloadCompanyCsv('selected');assert.equal(clicked,1);assert.equal(removed,1);assert.equal(picker.open,false);assert.match(download.download,/^leadscope-selecionadas-.*\.csv$/);assert.equal(await blobText(),csv);assert.equal(blob.type,'text/csv;charset=utf-8;');timers.at(-1)();assert.equal(revoked,1);
scope.downloadCompanyCsv('filtered');assert.equal(parse(await blobText()).length,31);assert.match(download.download,/filtradas/);
state.selectedOpps=[];scope.downloadCompanyCsv('selected');assert.equal(clicked,2);
filtered=[];scope.downloadCompanyCsv('filtered');assert.equal(clicked,2);assert.ok(messages.at(-1).includes('Não há resultados'));
assert.ok(!html.includes('Exportação CSV simulada'));
console.log('CSV export passed: selected/filtered scope, all pages, UTF-8, delimiters/quotes/newlines, formula safety, CNPJ/zero values, download and empty states. No customer data exported.');

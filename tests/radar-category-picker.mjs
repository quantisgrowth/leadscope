import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(inline);
const pickerCode=inline.slice(inline.indexOf('let radarCategoryCloseTimer='),inline.indexOf('function renderRadar(){'));
const categories=['Academia','Advogado','Escola de idiomas','Locadora','Restaurante','Transportadora','Terraplenagem'];
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const normalizeText=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const elements=Object.fromEntries(['rCategoryInput','rCategorySuggestions','rCategoryChips'].map(id=>[id,{value:'',innerHTML:'',attrs:{},classes:new Set(),setAttribute(k,v){this.attrs[k]=v;},classList:{}}]));
for(const e of Object.values(elements)){e.classList.remove=c=>e.classes.delete(c);e.classList.toggle=(c,on)=>on?e.classes.add(c):e.classes.delete(c);}
let timerId=0;const timers=new Map();const context=vm.createContext({esc,normalizeText,AbortController,state:{companies:[]},CURATED_BUSINESS_CATEGORIES:categories,document:{activeElement:elements.rCategoryInput,getElementById:id=>elements[id]},toast:()=>{},setTimeout:(fn,ms)=>{assert.equal(ms,5000);timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
vm.runInContext('let radarCategories=[];'+pickerCode,context);
context.paintRadarCategorySuggestions();assert.ok(elements.rCategorySuggestions.classes.has('show'));assert.equal(timers.size,1);
elements.rCategoryInput.value='Trans';context.paintRadarCategorySuggestions();assert.equal(timers.size,1,'Typing replaces the inactivity timeout');
[...timers.values()][0]();assert.ok(!elements.rCategorySuggestions.classes.has('show'));assert.equal(elements.rCategoryInput.attrs['aria-expanded'],'false');
for(const category of categories.slice(0,5))context.addRadarCategory(category);
assert.equal(elements.rCategoryInput.readOnly,true);assert.ok(!elements.rCategorySuggestions.classes.has('show'));assert.equal(context.addRadarCategory('Extra'),false);
vm.runInContext('radarCategories.pop();paintRadarCategoryPicker()',context);assert.equal(elements.rCategoryInput.readOnly,false);assert.ok(elements.rCategorySuggestions.classes.has('show'));
console.log('Radar category picker: single 5-second inactivity timeout, typing reset, close state, five-category limit and removal passed.');

if(process.env.LEADSCOPE_BROWSER_QA){
  const {chromium}=await import(process.env.LEADSCOPE_PLAYWRIGHT),browser=await chromium.launch({headless:true,executablePath:process.env.LEADSCOPE_CHROME});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  const boot=`const esc=${esc.toString()},normalizeText=${normalizeText.toString()},CURATED_BUSINESS_CATEGORIES=${JSON.stringify(categories)},state={companies:[]},toast=()=>{};let radarCategories=[];${pickerCode}bindRadarCategoryPicker();`;
  await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+html.match(/<style>[\s\S]*?<\/style>/)[0]+'</head><body><main style="padding:20px"><h1>Radar</h1><div class="category-picker" id="rCategoryPicker"><span id="rCategoryChips"></span><input class="category-input" id="rCategoryInput" autocomplete="off"><div class="category-suggestions" id="rCategorySuggestions"></div></div><div id="outside" style="margin-top:280px">Produtos e abordagens</div><button class="btn" id="outsideButton">Continuar</button></main><script>'+boot+'</script></body></html>'}));await page.goto('http://localhost:43141');
  const input=page.locator('#rCategoryInput'),list=page.locator('#rCategorySuggestions');
  await input.click();assert.equal(await list.isVisible(),true);await page.clock.runFor(4999);assert.equal(await list.isVisible(),true);await page.clock.runFor(1);assert.equal(await list.isVisible(),false);
  await input.fill('Trans');assert.equal(await list.isVisible(),true);await page.clock.runFor(4000);await input.fill('Transport');await page.clock.runFor(4000);assert.equal(await list.isVisible(),true);await page.clock.runFor(1000);assert.equal(await list.isVisible(),false);
  await input.fill('');await page.locator('[data-category="Academia"]').click();assert.equal(await page.locator('.category-chip').count(),1);assert.equal(await list.isVisible(),true);await page.clock.runFor(5000);assert.equal(await list.isVisible(),false);
  await input.click();assert.equal(await list.isVisible(),true);await page.locator('#outside').click();assert.equal(await list.isVisible(),false,'A non-focusable outside click must close immediately');
  await input.click();await input.press('Escape');assert.equal(await list.isVisible(),false);await input.click();await input.press('Tab');assert.equal(await list.isVisible(),false);
  for(const name of ['Advogado','Escola de idiomas','Locadora','Restaurante']){await input.fill(name);await input.press('Enter');}
  assert.equal(await page.locator('.category-chip').count(),5);assert.equal(await list.isVisible(),false);assert.equal(await input.getAttribute('readonly'),'');await input.click();assert.equal(await list.isVisible(),false);
  await page.locator('[data-remove-category="4"]').click();assert.equal(await input.getAttribute('readonly'),null);assert.equal(await list.isVisible(),true);await input.fill('Transportadora');await input.press('Enter');assert.equal(await page.locator('.category-chip').count(),5);assert.equal(await list.isVisible(),false);
  for(const width of [1440,390]){await page.setViewportSize({width,height:850});for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`/tmp/leadscope-category-limit-${width}-${theme}.png`});}}
  assert.deepEqual(errors,[]);await browser.close();console.log('Category browser QA: 5 seconds, typing resets, selection timer, outside pointer, Escape/Tab, max-five, removal/reopen and responsive light/dark passed.');
}

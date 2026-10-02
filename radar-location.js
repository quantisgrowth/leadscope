// Brazil: official municipality IDs; other countries: explicitly manual subdivisions.
const RADAR_UFS=[['AC','Acre'],['AL','Alagoas'],['AP','Amapá'],['AM','Amazonas'],['BA','Bahia'],['CE','Ceará'],['DF','Distrito Federal'],['ES','Espírito Santo'],['GO','Goiás'],['MA','Maranhão'],['MT','Mato Grosso'],['MS','Mato Grosso do Sul'],['MG','Minas Gerais'],['PA','Pará'],['PB','Paraíba'],['PR','Paraná'],['PE','Pernambuco'],['PI','Piauí'],['RJ','Rio de Janeiro'],['RN','Rio Grande do Norte'],['RS','Rio Grande do Sul'],['RO','Rondônia'],['RR','Roraima'],['SC','Santa Catarina'],['SP','São Paulo'],['SE','Sergipe'],['TO','Tocantins']];
const RADAR_COUNTRY_CODES='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const radarGeoCache=new Map();
function radarCountries(){const names=new Intl.DisplayNames(['pt-BR'],{type:'region'});return RADAR_COUNTRY_CODES.map(code=>({code,name:names.of(code)})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));}
function radarGeoNormalize(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();}
async function radarMunicipalities(uf){
  if(!RADAR_UFS.some(([code])=>code===uf))throw new Error('Estado inválido.');
  if(radarGeoCache.has(uf))return radarGeoCache.get(uf);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,{signal:controller.signal});
    if(!response.ok)throw new Error('Falha ao consultar cidades.');const data=await response.json();
    if(!Array.isArray(data)||!data.length||data.some(x=>!Number.isInteger(x.id)||typeof x.nome!=='string'))throw new Error('Lista de cidades inválida.');
    const cities=data.map(x=>({id:x.id,name:x.nome}));radarGeoCache.set(uf,cities);return cities;
  }finally{clearTimeout(timer);}
}
function renderRadarLocation(initial){return `<style>#rStateField[hidden],#rCityField[hidden],#rState[hidden],#rStateManual[hidden],#rGeoRetry[hidden]{display:none!important}</style><div class="grid erp-fields">
  <div class="field"><label class="label" for="rCountry">País</label><select class="input" id="rCountry">${radarCountries().map(c=>`<option value="${c.code}" ${c.code==='BR'?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
  <div class="field"><label class="label" for="rScope">Abrangência</label><select class="input" id="rScope"><option value="city">Cidade</option><option value="state">Todo o estado / região</option><option value="country">Todo o país</option></select></div>
  <div class="field" id="rStateField"><label class="label" for="rState">Estado</label><select class="input" id="rState"><option value="">Selecione o estado</option>${RADAR_UFS.map(([code,name])=>`<option value="${code}">${esc(name)} (${code})</option>`).join('')}</select><input class="input" id="rStateManual" hidden placeholder="Digite o estado / região" maxlength="100" aria-label="Estado ou região"></div>
  <div class="field" id="rCityField"><label class="label" for="rCity">Cidade</label><input class="input" id="rCity" list="rCityOptions" autocomplete="off" disabled placeholder="Selecione primeiro um estado"><datalist id="rCityOptions"></datalist><button class="btn btn-sm" type="button" id="rGeoRetry" hidden>Tentar carregar cidades novamente</button></div>
  </div><input type="hidden" id="rLocalizacao" value=""><p class="muted" id="rAreaHint" role="status"></p>${initial&&!/^brasil$/i.test(initial.trim())?`<p class="muted">Localização anterior: ${esc(initial)}. Selecione o estado e confirme a cidade para evitar cidades homônimas.</p>`:''}`;}
function radarGeography(){
  const country=document.getElementById('rCountry'),scope=document.getElementById('rScope').value;
  const code=country.value,name=country.selectedOptions[0].textContent;
  const uf=document.getElementById('rState').value;
  const region=code==='BR'?(RADAR_UFS.find(([key])=>key===uf)||[])[1]:document.getElementById('rStateManual').value.trim();
  const input=document.getElementById('rCity'),typed=input.value.trim();
  const city=code==='BR'?(radarGeoCache.get(uf)||[]).find(c=>radarGeoNormalize(c.name)===radarGeoNormalize(typed)):null;
  if(scope!=='country'&&!region)return null;
  if(scope==='city'&&(!typed||(code==='BR'&&!city)))return null;
  return {country_code:code,country:name,state:scope==='country'?null:region,state_code:code==='BR'&&scope!=='country'?uf:null,city:scope==='city'?(city?.name||typed):null,city_id:scope==='city'?city?.id||null:null,scope,location:[scope==='city'?(city?.name||typed):null,scope!=='country'?region:null,name].filter(Boolean).join(', ')};
}
function bindRadarLocation(){
  const country=document.getElementById('rCountry'),scope=document.getElementById('rScope'),uf=document.getElementById('rState'),city=document.getElementById('rCity'),manual=document.getElementById('rStateManual'),hint=document.getElementById('rAreaHint'),retry=document.getElementById('rGeoRetry');let revision=0;
  scope.value=/^brasil$/i.test(state.onboarding.regiao||'')?'country':'city';
  function sync(){const brazil=country.value==='BR';document.getElementById('rStateField').hidden=scope.value==='country';document.getElementById('rCityField').hidden=scope.value!=='city';uf.hidden=!brazil;manual.hidden=brazil;city.disabled=brazil&&!radarGeoCache.has(uf.value);city.placeholder=brazil?'Digite e selecione uma cidade':'Digite a cidade';
    const geo=radarGeography();document.getElementById('rLocalizacao').value=geo?.location||'';
    hint.textContent=(geo?'Área selecionada: '+geo.location+'. ':'Selecione a localização. ')+(brazil?'Cidades da base oficial do IBGE. ':'Estado e cidade preenchidos manualmente neste país. ')+(scope.value==='city'?'Sem raio em quilômetros; a coleta usa a área da cidade.':'Uma execução limitada não cobre todas as empresas da região.');}
  async function load(){const stamp=++revision,selected=uf.value;city.value='';document.getElementById('rCityOptions').innerHTML='';retry.hidden=true;sync();if(country.value!=='BR'||!selected)return;
    hint.textContent='Carregando cidades…';try{const cities=await radarMunicipalities(selected);if(stamp!==revision||!uf.isConnected)return;document.getElementById('rCityOptions').innerHTML=cities.map(c=>`<option value="${esc(c.name)}"></option>`).join('');sync();}
    catch(error){if(stamp!==revision||!uf.isConnected)return;city.disabled=true;hint.textContent='Não foi possível carregar as cidades. Tente novamente; nenhuma coleta foi iniciada.';retry.hidden=false;}}
  country.onchange=()=>{revision++;uf.value='';manual.value='';city.value='';document.getElementById('rCityOptions').innerHTML='';retry.hidden=true;sync();};uf.onchange=load;retry.onclick=load;scope.onchange=sync;city.oninput=sync;manual.oninput=sync;sync();
}

import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { accountId } from "../_shared/account.ts";

const APIFY_ACTOR = "compass~crawler-google-places";
const PROVIDER = "apify_google_maps";

type ApifyPlace = {
  placeId?: string;
  cid?: string;
  title?: string;
  categoryName?: string;
  description?: string;
  categories?: string[];
  address?: string;
  city?: string;
  phone?: string;
  website?: string;
  totalScore?: number;
  reviewsCount?: number;
  url?: string;
  emails?: string[];
  facebooks?: string[];
  instagrams?: string[];
  linkedIns?: string[];
  tiktoks?: string[];
  youtubes?: string[];
  location?: { lat?: number; lng?: number };
  temporarilyClosed?: boolean;
  permanentlyClosed?: boolean;
};

type Offer = {
  id: string;
  nome: string;
  resultado: string;
  descricao: string;
  publico_alvo: string;
  tipo: string;
  etapa: string;
  categorias: string[];
  sinais: string[];
  prioridade: number;
};

function cleanText(value: unknown, max = 240) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const STOP_WORDS = new Set(["para", "com", "sem", "das", "dos", "uma", "por", "que", "empresa", "empresas", "servico", "servicos", "produto", "produtos", "sistema", "sistemas"]);

function meaningfulTokens(value: unknown) {
  return [...new Set(normalizeText(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)).map((word) => {
    if (word.endsWith("oes") && word.length > 5) return `${word.slice(0, -3)}ao`;
    if (word.endsWith("ais") && word.length > 5) return `${word.slice(0, -3)}al`;
    if (word.endsWith("s") && word.length > 5) return word.slice(0, -1);
    return word;
  }))];
}

function matchOffer(place: ApifyPlace, signals: string[], offer: Offer) {
  const placeText = normalizeText([place.title, place.description, place.categoryName, ...(place.categories ?? [])].join(" "));
  const categoryMatches = (offer.categorias ?? []).filter((category) => placeText.includes(normalizeText(category)));
  const digitalOffer = /site|marketing|seo|digital|tr[aá]fego/i.test([offer.nome, offer.resultado, offer.descricao].join(' '));
  const signalMatches = (offer.sinais ?? []).filter((signal) => signals.includes(signal) && (digitalOffer || !['semSite','semWhats'].includes(signal)));
  const placeTokens = new Set(meaningfulTokens(placeText));
  const offerTokens = meaningfulTokens([offer.publico_alvo, ...(offer.categorias ?? [])].join(" "));
  const tokenMatches = offerTokens.filter((token) => placeTokens.has(token));
  // Priority and ladder position are not evidence of product fit.
  let compatibility = categoryMatches.length ? 70 : Math.min(70, tokenMatches.length * 14);
  compatibility += Math.min(30, signalMatches.length * 10);
  compatibility = Math.min(100, compatibility);
  const reasons = [];
  if (categoryMatches.length) reasons.push(`categoria compatível: ${categoryMatches.slice(0, 2).join(", ")}`);
  else if (tokenMatches.length) reasons.push(`atividade compatível: ${tokenMatches.slice(0, 3).join(", ")}`);
  if (signalMatches.length) reasons.push(`${signalMatches.length} sinal(is) de oportunidade relacionado(s)`);
  if (!reasons.length) reasons.push("nenhuma correspondência pública encontrada; validar atividade em conversa");
  const outcome = cleanText(offer.resultado, 180);
  return { offer, compatibility, reason: `Aderência baseada em ${reasons.join(" e ")}.${outcome ? ` Resultado a validar: ${outcome}` : ""}` };
}

async function radarOffers(ctx: any, radarId: string): Promise<Offer[]> {
  const { data: links, error: linkError } = await ctx.supabase.from("radar_offers").select("offer_id").eq("radar_id", radarId);
  if (linkError) throw linkError;
  const ids = (links ?? []).map((link: { offer_id: string }) => link.offer_id);
  if (!ids.length) return [];
  const { data, error } = await ctx.supabase.from("offers").select("id,nome,resultado,descricao,publico_alvo,tipo,etapa,categorias,sinais,prioridade").in("id", ids).eq("ativo", true);
  if (error) throw error;
  return (data ?? []) as Offer[];
}

async function apifyRequest(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://api.apify.com/v2/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = cleanText(payload?.error?.message || payload?.message, 420);
    } catch {
      // Mantém a mensagem segura sem expor a resposta completa do provedor.
    }
    console.error(JSON.stringify({ event: "place_provider_http_error", status: response.status, detail }));
    throw new Error(`A fonte pública respondeu com status ${response.status}.`);
  }
  return response.json();
}

function scorePlace(place: ApifyPlace, offerCompatibility: number | null) {
  const rating = Number(place.totalScore) || 0;
  const reviews = Math.max(0, Number(place.reviewsCount) || 0);
  const isOpen = !place.permanentlyClosed && !place.temporarilyClosed;
  const profile = Math.min(10, 2 + (place.address ? 2 : 0) + (isOpen ? 2 : 0) + (rating ? 4 : 0));
  const compatibility = offerCompatibility == null ? 0 : Math.round(Math.max(0, Math.min(100, offerCompatibility)) * 0.6);
  const reputation = Math.min(5, Math.round((rating / 5) * 3) + Math.min(2, Math.floor(Math.log10(reviews + 1))));
  const contact = (place.phone ? 7 : 0) + (place.website ? 3 : 0);
  const confidence = Math.min(15, 5 + [place.address, place.phone, rating, place.url, place.website].filter(Boolean).length * 2);
  const total = Math.min(100, profile + compatibility + reputation + contact + confidence);
  return { total, profile, compatibility, reputation, contact, confidence, rating, reviews };
}

async function markFailed(ctx: any, runId: string | null, radarId: string | null, message: string) {
  const finishedAt = new Date().toISOString();
  if (runId) {
    await ctx.supabase.from("radar_runs").update({
      status: "falhou", provider_status: "FAILED", erro: message, concluido_em: finishedAt,
    }).eq("id", runId);
  }
  if (radarId) await ctx.supabase.from("radares").update({ status: "falhou", erro: message }).eq("id", radarId);
}

function validateReputationFilters(input: any) {
  const minReviews = input?.min_reviews ?? null;
  const minRating = input?.min_rating ?? null;
  if (minReviews !== null && (typeof minReviews !== 'number' || !Number.isInteger(minReviews) || minReviews < 0 || minReviews > 10000000)) throw new Error('Quantidade mínima de avaliações inválida.');
  if (minRating !== null && (typeof minRating !== 'number' || ![2, 2.5, 3, 3.5, 4, 4.5, 5].includes(minRating))) throw new Error('Nota mínima inválida.');
  return { min_reviews: minReviews, min_rating: minRating };
}
function matchesReputation(place: ApifyPlace, filters: any) {
  const { min_reviews: reviews, min_rating: rating } = filters || {};
  if (reviews != null && (typeof place.reviewsCount !== 'number' || !Number.isFinite(place.reviewsCount) || place.reviewsCount < reviews)) return false;
  if (rating != null && (typeof place.totalScore !== 'number' || !Number.isFinite(place.totalScore) || place.totalScore < rating)) return false;
  return true;
}
function validateRadarCriteria(input: any) {
  const reputation = validateReputationFilters(input);
  const mode = (value: unknown) => {
    if (value == null) return 'required';
    if (!['required','preferred','off'].includes(String(value))) throw new Error('Modo de critério inválido.');
    return String(value);
  };
  const categories = Array.isArray(input?.categories) ? input.categories.map((v: unknown) => cleanText(v,100)).filter(Boolean).slice(0,5) : [];
  return {...reputation, min_reviews_mode:mode(input?.min_reviews_mode),min_rating_mode:mode(input?.min_rating_mode),
    category_mode:input?.category_mode == null ? 'off' : mode(input.category_mode),categories};
}
function evaluateRadarPlace(place: ApifyPlace, criteria: any) {
  const reasons: string[] = [], preferences: string[] = [], unknowns: string[] = [];
  const apply = (key: string, mode: string, known: boolean, passes: boolean) => {
    if (mode === 'off') return;
    if (!known) unknowns.push(key);
    if (mode === 'required' && !passes) reasons.push(known ? key : key+'_unknown');
    if (mode === 'preferred' && passes) preferences.push(key);
  };
  if (!cleanText(place.title) || !cleanText(place.placeId || place.cid || place.url || place.address)) reasons.push('invalid_profile');
  if (place.permanentlyClosed) reasons.push('permanently_closed');
  if (criteria.min_reviews != null) apply('min_reviews',criteria.min_reviews_mode||'required',typeof place.reviewsCount==='number'&&Number.isFinite(place.reviewsCount),typeof place.reviewsCount==='number'&&place.reviewsCount>=criteria.min_reviews);
  if (criteria.min_rating != null) apply('min_rating',criteria.min_rating_mode||'required',typeof place.totalScore==='number'&&Number.isFinite(place.totalScore),typeof place.totalScore==='number'&&place.totalScore>=criteria.min_rating);
  const categories = [place.categoryName,...(Array.isArray(place.categories)?place.categories:[])].filter(Boolean).map(normalizeText);
  if (criteria.categories?.length) apply('category',criteria.category_mode||'off',categories.length>0,criteria.categories.some((v: string)=>categories.includes(normalizeText(v))));
  const activity = normalizeText([place.title,place.description,...categories].join(' '));
  if ((criteria.exclude_terms||[]).some((term: string)=>activity.includes(normalizeText(term)))) reasons.push('excluded_activity');
  return {decision:reasons.length?'discarded':'accepted',reasons,preferences,unknowns};
}
function radarSnapshot(place: ApifyPlace) {
  const textList=(value: unknown,max=10)=>Array.isArray(value)?value.slice(0,max).map(v=>cleanText(v,240)).filter(Boolean):[];
  const snapshot = {placeId:cleanText(place.placeId,300)||null,cid:cleanText(place.cid,300)||null,title:cleanText(place.title),
    categoryName:cleanText(place.categoryName,100)||null,categories:textList(place.categories),description:cleanText(place.description,1500),
    address:cleanText(place.address,500)||null,city:cleanText(place.city,100)||null,phone:cleanText(place.phone,100)||null,website:cleanText(place.website,1000)||null,
    totalScore:typeof place.totalScore==='number'&&Number.isFinite(place.totalScore)?place.totalScore:null,
    reviewsCount:typeof place.reviewsCount==='number'&&Number.isFinite(place.reviewsCount)?place.reviewsCount:null,
    url:cleanText(place.url,1000)||null,permanentlyClosed:!!place.permanentlyClosed,temporarilyClosed:!!place.temporarilyClosed,
    emails:textList(place.emails,5),instagrams:textList(place.instagrams,3),facebooks:textList(place.facebooks,3),linkedIns:textList(place.linkedIns,3),
    tiktoks:textList(place.tiktoks,3),youtubes:textList(place.youtubes,3),
    openingHours:Array.isArray((place as any).openingHours)?(place as any).openingHours.slice(0,7).map((v:any)=>({day:cleanText(v.day,30),hours:cleanText(v.hours,100)})):[],
    reviews:Array.isArray((place as any).reviews)?(place as any).reviews.slice(0,5).map((v:any)=>({text:cleanText(v.text,1200),stars:typeof v.stars==='number'?v.stars:null,publishedAtDate:cleanText(v.publishedAtDate,40)})):[],
    location:place.location && Number.isFinite(place.location.lat)&&Number.isFinite(place.location.lng)?{lat:place.location.lat,lng:place.location.lng}:null};
  // Bound UTF-8 storage even for long multilingual descriptions and review samples.
  if(JSON.stringify(snapshot).length>6000){
    snapshot.reviews=[];snapshot.description='';
    snapshot.emails=snapshot.emails.slice(0,1);snapshot.openingHours=[];
    snapshot.instagrams=[];snapshot.facebooks=[];snapshot.linkedIns=[];snapshot.tiktoks=[];snapshot.youtubes=[];
  }
  if(JSON.stringify(snapshot).length>6000){snapshot.emails=[];}
  return snapshot;
}
function radarAnalysis(place: ApifyPlace, run: any, offers: Offer[], collectedAt: string) {
  const name=cleanText(place.title),sourceUrl=place.url||null;
  const placeId=cleanText(place.placeId||place.cid||place.url||`${name}-${place.address}`,300);
  const signals: string[]=[];if(!place.website)signals.push('semSite');if(!place.phone)signals.push('semWhats');
  const matches=offers.map(offer=>matchOffer(place,signals,offer)).sort((a,b)=>b.compatibility-a.compatibility);
  const recommendation=matches.find(match=>match.compatibility>0),score=scorePlace(place,recommendation?.compatibility??null);
  const company={user_id:run.user_id,radar_id:run.radar_id,source_provider:'google_maps',source_place_id:placeId,source_url:sourceUrl,
    source_payload:place,google_place_id:place.placeId||null,google_maps_url:sourceUrl,dados_google:place,nome:name,
    segmento:place.categoryName||place.categories?.[0]||null,cidade:place.city||null,endereco:place.address||null,telefone:place.phone||null,site:place.website||null,
    nota:score.rating||null,avaliacoes:place.reviewsCount??null,score:score.total,confianca:score.confidence>=13?'Alta':score.confidence>=9?'Média':'Baixa',
    potencial:score.total>=70?'alto':score.total>=45?'medio':'baixo',ultima_atualizacao:collectedAt.slice(0,10),servico_recomendado:recommendation?.offer.nome||null,sinais_keys:signals,
    business_status:place.temporarilyClosed?'CLOSED_TEMPORARILY':'OPERATIONAL',latitude:place.location?.lat??null,longitude:place.location?.lng??null,coletado_em:collectedAt,analisado_em:collectedAt};
  const components=[
    ['Perfil comercial público',score.profile,10,'Completude pública do estabelecimento.'],
    ['Compatibilidade com a oferta',score.compatibility,60,recommendation?.reason||'Sem correspondência; validar em conversa.'],
    ['Reputação',score.reputation,5,'Nota e avaliações não comprovam faturamento.'],
    ['Contato',score.contact,10,'Canais públicos encontrados.'],
    ['Confiança',score.confidence,15,'Cobertura dos campos públicos.']
  ].map(([dimensao,pontos,maximo,explicacao])=>({dimensao,pontos,maximo,explicacao}));
  const channels: any[]=[];
  if(sourceUrl)channels.push({tipo:'google_maps',valor:sourceUrl,url:sourceUrl,principal:true});
  if(place.website)channels.push({tipo:'site',valor:place.website,url:place.website,principal:!sourceUrl});
  if(place.phone)channels.push({tipo:'telefone',valor:place.phone,url:null,principal:!sourceUrl&&!place.website});
  for(const [key,type] of [['emails','email'],['instagrams','instagram'],['facebooks','facebook'],['linkedIns','linkedin'],['tiktoks','tiktok'],['youtubes','outro']]){
    for(const value of (place as any)[key]||[])channels.push({tipo:type,valor:value,url:type==='email'?'mailto:'+value:value,principal:false});
  }
  const evidence=[];
  if(!place.website)evidence.push({texto:'Site não encontrado no perfil comercial público.'});
  if(!place.phone)evidence.push({texto:'Telefone não informado no perfil comercial público.'});
  if(score.rating)evidence.push({texto:`Nota pública ${score.rating.toFixed(1)} de 5 com ${place.reviewsCount??'quantidade não informada de'} avaliações.`});
  return {company,matches:matches.map((m,i)=>({offer_id:m.offer.id,compatibilidade:m.compatibility,motivo:m.reason,principal:i===0&&m.compatibility>0})),components,channels,evidence};
}
async function savePlaces(ctx: any, run: any, places: ApifyPlace[]) {
  const saved: any[]=[];
  const offers=await radarOffers(ctx,run.radar_id),collectedAt=new Date().toISOString();
  for(let index=0;index<places.length;index++){
    const original=places[index]&&typeof places[index]==='object'?places[index]:{};
    const snapshot=radarSnapshot(original);
    const evaluation=evaluateRadarPlace(original,run.provider_payload?.enrichment||{});
    const entry={...evaluation,snapshot,analysis:radarAnalysis(snapshot as ApifyPlace,run,offers,collectedAt)};
    let {data,error}=await ctx.supabase.rpc('persist_radar_result',{p_run:run.id,p_index:index,p_entry:entry});
    if(error){
      // The failed item transaction rolls back; preserve a separate, safe error result.
      const failure=await ctx.supabase.rpc('persist_radar_result',{p_run:run.id,p_index:index,p_entry:{...entry,decision:'error',reasons:['persistence_error']}});
      if(failure.error)throw failure.error;
      data=failure.data;
    }
    if(data?.company_id)saved.push({id:data.company_id});
  }
  return saved;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método não permitido" }, { status: 405 });
    const token = Deno.env.get("APIFY_API_TOKEN");
    if (!token) return Response.json({ error: "A fonte de dados do radar ainda não foi configurada." }, { status: 503 });

    let runId: string | null = null;
    let radarId: string | null = null;
    try {
      const body = await req.json();
      if(body.action==='capabilities')return Response.json({research_version:1});
      const action = body.action === "status" ? "status" : "start";
      const userId = await accountId(ctx);
      if (!userId) return Response.json({ error: "Não foi possível identificar o usuário autenticado." }, { status: 401 });

      if (action === "start") {
        radarId = cleanText(body.radar_id, 64);
        const requestedQueries = Array.isArray(body.queries)
          ? body.queries.map((item: unknown) => cleanText(item)).filter(Boolean).slice(0, 5)
          : [];
        const query = cleanText(body.query || requestedQueries[0]);
        const queries = requestedQueries.length ? requestedQueries : [query];
        const location = cleanText(body.location);
        const limit = Math.max(1, Math.min(20, Number(body.result_limit) || 20));
        let reputation;
        try { reputation = validateRadarCriteria(body.enrichment); }
        catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Filtros inválidos.' }, { status: 400 }); }
        const enrichment = {
          ...reputation,
          exclude_terms: Array.isArray(body.enrichment?.exclude_terms) ? body.enrichment.exclude_terms.map((v: unknown) => cleanText(v, 80)).filter(Boolean).slice(0, 10) : [],
          review_limit: body.enrichment?.review_limit === 5 ? 5 : 0,
          contacts: body.enrichment?.contacts === true,
        };
        const criteria = {
          actor: APIFY_ACTOR, queries, enrichment,
          geography: body.geography ? {
            country_code: cleanText(body.geography.country_code, 2), state_code: cleanText(body.geography.state_code, 2),
            state: cleanText(body.geography.state, 100), city: cleanText(body.geography.city, 100),
            city_id: Number.isInteger(body.geography.city_id) ? body.geography.city_id : null,
          } : null,
          area_scope: ['country', 'state', 'region'].includes(body.area_scope) ? body.area_scope : 'city',
        };
        if (!radarId || !query || !location) return Response.json({ error: "Radar, segmento e localização são obrigatórios." }, { status: 400 });
        const {error: installationError}=await ctx.supabase.from('radar_results').select('id').limit(0);
        if(installationError)return Response.json({error:'Aplique o SQL 05 de resultados das pesquisas antes de iniciar uma nova coleta.'},{status:503});

        const { data: radar, error: radarError } = await ctx.supabase.from("radares").select("id").eq("id", radarId).single();
        if (radarError || !radar) return Response.json({ error: "Radar não encontrado." }, { status: 404 });
        const { data: run, error: runError } = await ctx.supabase.from("radar_runs").insert({
          radar_id: radarId, user_id: userId, consulta: query, localizacao: location,
          limite_resultados: limit, provider: "apify", provider_status: "STARTING",
          provider_payload: criteria, // Persist filters before starting a paid collection.
        }).select("id").single();
        if (runError) throw runError;
        runId = run.id;

        const apifyPayload = await apifyRequest(`acts/${APIFY_ACTOR}/runs?maxItems=${limit}&maxTotalChargeUsd=0.50`, token, {
          method: "POST",
          body: JSON.stringify({
            searchStringsArray: queries, locationQuery: location, maxCrawledPlacesPerSearch: limit,
            language: "pt-BR", skipClosedPlaces: false, scrapePlaceDetailPage: true,
            maxReviews: enrichment.review_limit, reviewsSort: "newest", reviewsOrigin: "google", scrapeReviewsPersonalData: false,
            maxImages: 0, scrapeContacts: enrichment.contacts,
            scrapeSocialMediaProfiles: {
              facebooks: false, instagrams: false, youtubes: false, tiktoks: false, twitters: false,
            },
            maximumLeadsEnrichmentRecords: 0,
            maxCompetitorsToAnalyze: 0,
          }),
        });
        const providerRun = apifyPayload?.data;
        if (!providerRun?.id) throw new Error("O provedor não retornou a identificação da coleta.");

        await ctx.supabase.from("radar_runs").update({
          provider_run_id: providerRun.id, provider_dataset_id: providerRun.defaultDatasetId ?? null,
          provider_status: providerRun.status ?? "RUNNING", provider_payload: criteria,
        }).eq("id", runId);
        await ctx.supabase.from("radares").update({
          status: "processando", fonte: PROVIDER, iniciado_em: new Date().toISOString(), erro: null,
        }).eq("id", radarId);
        return Response.json({ status: "processando", radar_id: radarId, run_id: runId }, { status: 202 });
      }

      runId = cleanText(body.run_id, 64);
      if (!runId) return Response.json({ error: "Execução do radar não informada." }, { status: 400 });
      const { data: run, error: runError } = await ctx.supabase.from("radar_runs").select("*").eq("id", runId).single();
      if (runError || !run) return Response.json({ error: "Execução do radar não encontrada." }, { status: 404 });
      radarId = run.radar_id;
      if (run.status === "concluido") return Response.json({ status: "concluido", radar_id: radarId, run_id: runId, found: run.encontrados });
      if (run.status === "falhou") return Response.json({ status: "falhou", error: run.erro || "A coleta não foi concluída." }, { status: 500 });
      if (!run.provider_run_id) throw new Error("A execução não possui uma coleta vinculada.");

      const providerPayload = await apifyRequest(`actor-runs/${run.provider_run_id}`, token);
      const providerRun = providerPayload?.data;
      const providerStatus = cleanText(providerRun?.status, 40) || "UNKNOWN";
      await ctx.supabase.from("radar_runs").update({
        provider_status: providerStatus, provider_dataset_id: providerRun?.defaultDatasetId ?? run.provider_dataset_id,
      }).eq("id", runId);

      if (["FAILED", "TIMED-OUT", "ABORTED"].includes(providerStatus)) {
        const message = `A coleta terminou com status ${providerStatus}.`;
        await markFailed(ctx, runId, radarId, message);
        return Response.json({ status: "falhou", error: message }, { status: 500 });
      }
      if (providerStatus !== "SUCCEEDED") return Response.json({ status: "processando", provider_status: providerStatus, run_id: runId }, { status: 202 });

      const datasetId = providerRun?.defaultDatasetId || run.provider_dataset_id;
      if (!datasetId) throw new Error("A coleta foi concluída sem disponibilizar o conjunto de resultados.");
      const {data:claimed,error:claimError}=await ctx.supabase.rpc('claim_radar_run',{p_run:runId});
      if(claimError)throw claimError;
      if(!claimed)return Response.json({status:'processando',run_id:runId},{status:202});
      await ctx.supabase.from("radar_runs").update({ provider_status: "SAVING" }).eq("id", runId);
      const places = await apifyRequest(`datasets/${datasetId}/items?clean=true&format=json`, token);
      if (!Array.isArray(places)) throw new Error("A fonte pública retornou um formato de resultados inesperado.");
      if(places.length>1000)throw new Error('A coleta ultrapassou o limite seguro de processamento. Nenhum resultado adicional foi descartado silenciosamente.');
      const saved = await savePlaces(ctx, run, places);

      const finishedAt = new Date().toISOString();
      await ctx.supabase.from("radar_runs").update({
        status: "concluido", provider_status: "SUCCEEDED", encontrados: saved.length, concluido_em: finishedAt,
      }).eq("id", runId);
      await ctx.supabase.from("radares").update({ status: "concluido", concluido_em: finishedAt, erro: null }).eq("id", radarId);
      return Response.json({ status: "concluido", radar_id: radarId, run_id: runId, found: saved.length, companies: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao executar o radar.";
      console.error(JSON.stringify({ event: "apify_google_maps_error", run_id: runId, radar_id: radarId, message }));
      await markFailed(ctx, runId, radarId, message);
      return Response.json({ error: message }, { status: 500 });
    }
  }),
};

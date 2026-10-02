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
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
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
async function savePlaces(ctx: any, run: any, places: ApifyPlace[]) {
  const saved = [];
  const excluded = Array.isArray(run.provider_payload?.enrichment?.exclude_terms) ? run.provider_payload.enrichment.exclude_terms : [];
  const seen = new Set<string>();
  const collectedAt = new Date().toISOString();
  const offers = await radarOffers(ctx, run.radar_id);

  for (const place of places.slice(0, run.limite_resultados)) {
    const name = cleanText(place.title);
    const placeId = cleanText(place.placeId || place.cid || place.url || `${name}-${place.address}`, 300);
    if (!placeId || !name || place.permanentlyClosed) continue;
    if (!matchesReputation(place, run.provider_payload?.enrichment)) continue;
    const activity = normalizeText([place.title, place.description, place.categoryName, ...(place.categories ?? [])].join(' '));
    if (excluded.some((term: string) => activity.includes(normalizeText(term))) || seen.has(placeId)) continue;
    seen.add(placeId);

    const signals: string[] = [];
    if (!place.website) signals.push("semSite");
    if (!place.phone) signals.push("semWhats");
    const sourceUrl = place.url ?? null;
    const offerMatches = offers.map((offer) => matchOffer(place, signals, offer)).sort((a, b) => b.compatibility - a.compatibility);
    const recommendation = offerMatches.find(match => match.compatibility > 0);
    const score = scorePlace(place, recommendation?.compatibility ?? null);
    const potential = score.total >= 70 ? "alto" : score.total >= 45 ? "medio" : "baixo";
    const confidence = score.confidence >= 13 ? "Alta" : score.confidence >= 9 ? "Média" : "Baixa";

    const { data: company, error: companyError } = await ctx.supabase.rpc("save_company_collection", { p_payload: {
      user_id: run.user_id,
      radar_id: run.radar_id,
      source_provider: "google_maps",
      source_place_id: placeId,
      source_url: sourceUrl,
      source_payload: place,
      google_place_id: place.placeId ?? null,
      google_maps_url: sourceUrl,
      dados_google: place,
      nome: name,
      segmento: place.categoryName ?? place.categories?.[0] ?? run.consulta,
      cidade: place.city || null,
      endereco: place.address ?? null,
      telefone: place.phone ?? null,
      site: place.website ?? null,
      nota: score.rating || null,
      avaliacoes: score.reviews,
      score: score.total,
      confianca: confidence,
      potencial: potential,
      ultima_atualizacao: collectedAt.slice(0, 10),
      servico_recomendado: recommendation?.offer.nome ?? null,
      sinais_keys: signals,
      business_status: place.temporarilyClosed ? "CLOSED_TEMPORARILY" : "OPERATIONAL",
      latitude: place.location?.lat ?? null,
      longitude: place.location?.lng ?? null,
      coletado_em: collectedAt,
      analisado_em: collectedAt,
    } }).single();
    if (companyError) throw companyError;

    if (offerMatches.length) {
      const { error: matchError } = await ctx.supabase.from("company_offer_matches").insert(offerMatches.map((match, index) => ({
        user_id: run.user_id, empresa_id: company.id, radar_id: run.radar_id, offer_id: match.offer.id,
        compatibilidade: match.compatibility, motivo: match.reason, principal: index === 0, analysis_batch: collectedAt,
      })));
      if (matchError) throw matchError;
    }

    const { error: scoreError } = await ctx.supabase.from("score_components").insert([
      ["Perfil comercial público", score.profile, 10, "Completude e situação pública do estabelecimento na fonte consultada."],
      ["Compatibilidade com a oferta", score.compatibility, 60, recommendation ? recommendation.reason : "Nenhuma correspondência com uma oferta foi identificada; valide em conversa."],
      ["Reputação", score.reputation, 5, "Nota e volume de avaliações, sem inferir faturamento ou orçamento."],
      ["Contato", score.contact, 10, "Canais públicos de contato encontrados."],
      ["Confiança", score.confidence, 15, "Quantidade de campos públicos verificáveis coletados."],
    ].map(([dimensao, pontos, maximo, explicacao]) => ({
      user_id: run.user_id, empresa_id: company.id, radar_run_id: run.id,
      versao_modelo: "erp-public-fit-v4", dimensao, pontos, maximo, explicacao, calculado_em: collectedAt,
    })));
    if (scoreError) throw scoreError;

    const channels: Array<{ tipo: string; valor: string; url: string | null; principal: boolean }> = [];
    if (sourceUrl) channels.push({ tipo: "google_maps", valor: sourceUrl, url: sourceUrl, principal: true });
    if (place.website) channels.push({ tipo: "site", valor: place.website, url: place.website, principal: !sourceUrl });
    if (place.phone) channels.push({ tipo: "telefone", valor: place.phone, url: null, principal: !sourceUrl && !place.website });
    for (const email of place.emails ?? []) channels.push({ tipo: "email", valor: email, url: `mailto:${email}`, principal: false });
    for (const url of place.instagrams ?? []) channels.push({ tipo: "instagram", valor: url, url, principal: false });
    for (const url of place.facebooks ?? []) channels.push({ tipo: "facebook", valor: url, url, principal: false });
    for (const url of place.linkedIns ?? []) channels.push({ tipo: "linkedin", valor: url, url, principal: false });
    for (const url of place.tiktoks ?? []) channels.push({ tipo: "tiktok", valor: url, url, principal: false });
    for (const url of place.youtubes ?? []) channels.push({ tipo: "outro", valor: url, url, principal: false });
    if (channels.length) {
      const { error: channelError } = await ctx.supabase.from("company_channels").upsert(
        channels.map((channel) => ({ ...channel, user_id: run.user_id, empresa_id: company.id, fonte: PROVIDER, verificado_em: collectedAt })),
        { onConflict: "empresa_id,tipo,valor" },
      );
      if (channelError) throw channelError;
    }

    const evidence = [];
    if (!place.website) evidence.push({ texto: "Site não encontrado no perfil comercial público.", fonte: "Perfil comercial público", confianca: "Alta" });
    if (!place.phone) evidence.push({ texto: "Telefone não informado no perfil comercial público.", fonte: "Perfil comercial público", confianca: "Alta" });
    if (score.rating) evidence.push({ texto: `Nota pública ${score.rating.toFixed(1)} de 5 com ${score.reviews} avaliações.`, fonte: "Perfil comercial público", confianca: "Alta" });
    await ctx.supabase.from("evidencias").delete().eq("empresa_id", company.id).eq("tipo_fonte", PROVIDER);
    if (evidence.length) {
      const { error: evidenceError } = await ctx.supabase.from("evidencias").insert(evidence.map((item) => ({
        ...item, empresa_id: company.id, data: collectedAt.slice(0, 10), tipo_fonte: PROVIDER,
        url_fonte: sourceUrl, coletado_em: collectedAt, metadata: { provider: "apify", actor: APIFY_ACTOR },
      })));
      if (evidenceError) throw evidenceError;
    }
    saved.push(company);
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
        try { reputation = validateReputationFilters(body.enrichment); }
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
            language: "pt-BR", skipClosedPlaces: true, scrapePlaceDetailPage: true,
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
      await ctx.supabase.from("radar_runs").update({ provider_status: "SAVING" }).eq("id", runId);
      const places = await apifyRequest(`datasets/${datasetId}/items?clean=true&format=json`, token);
      if (!Array.isArray(places)) throw new Error("A fonte pública retornou um formato de resultados inesperado.");
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

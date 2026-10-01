import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type Offer = {
  id: string;
  nome: string;
  resultado: string | null;
  publico_alvo: string | null;
  etapa: string;
  categorias: string[];
  sinais: string[];
  prioridade: number;
};

type Company = {
  id: string;
  user_id: string;
  radar_id: string | null;
  nome: string;
  segmento: string | null;
  endereco: string | null;
  telefone: string | null;
  site: string | null;
  nota: number | null;
  avaliacoes: number | null;
  business_status: string | null;
  google_maps_url: string | null;
  source_url: string | null;
  source_payload: Record<string, unknown> | null;
  dados_google: Record<string, unknown> | null;
  sinais_keys: string[] | null;
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

function matchOffer(company: Company, payload: Record<string, unknown>, signals: string[], offer: Offer) {
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const companyText = normalizeText([company.nome, company.segmento, payload.categoryName, ...categories].join(" "));
  const categoryMatches = (offer.categorias ?? []).filter((category) => companyText.includes(normalizeText(category)));
  const signalMatches = (offer.sinais ?? []).filter((signal) => signals.includes(signal));
  const companyTokens = new Set(meaningfulTokens(companyText));
  const offerTokens = meaningfulTokens([offer.publico_alvo, ...(offer.categorias ?? [])].join(" "));
  const tokenMatches = offerTokens.filter((token) => companyTokens.has(token));
  let compatibility = 10 + Math.round((Number(offer.prioridade) || 50) * 0.15);
  compatibility += categoryMatches.length ? 35 : Math.min(35, tokenMatches.length * 9);
  compatibility += Math.min(20, signalMatches.length * 12);
  if (offer.etapa === "principal") compatibility += 5;
  compatibility = Math.min(100, compatibility);
  const reasons: string[] = [];
  if (categoryMatches.length) reasons.push(`categoria compatível: ${categoryMatches.slice(0, 2).join(", ")}`);
  else if (tokenMatches.length) reasons.push(`atividade compatível: ${tokenMatches.slice(0, 3).join(", ")}`);
  if (signalMatches.length) reasons.push(`${signalMatches.length} sinal(is) de oportunidade relacionado(s)`);
  if (!reasons.length) reasons.push("produto ativo na esteira para validação comercial");
  const outcome = cleanText(offer.resultado, 180);
  return { offer, compatibility, reason: `Aderência baseada em ${reasons.join(" e ")}.${outcome ? ` Resultado a validar: ${outcome}` : ""}` };
}

function scoreCompany(company: Company, payload: Record<string, unknown>, offerCompatibility: number | null) {
  const rating = Number(company.nota ?? payload.totalScore) || 0;
  const reviews = Math.max(0, Number(company.avaliacoes ?? payload.reviewsCount) || 0);
  const isOpen = company.business_status !== "CLOSED_PERMANENTLY" && payload.permanentlyClosed !== true;
  const sourceUrl = company.google_maps_url || company.source_url;
  const profile = Math.min(20, 7 + (company.endereco ? 4 : 0) + (isOpen ? 4 : 0) + (rating ? 5 : 0));
  const compatibility = offerCompatibility == null ? 15 : Math.round(Math.max(0, Math.min(100, offerCompatibility)) * 0.3);
  const reputation = Math.min(15, Math.round((rating / 5) * 9) + Math.min(6, Math.floor(Math.log10(reviews + 1) * 3)));
  const contact = (company.telefone ? 10 : 0) + (company.site ? 5 : 0);
  const confidence = Math.min(20, 5 + [company.endereco, company.telefone, rating, sourceUrl, company.site].filter(Boolean).length * 3);
  return { total: Math.min(100, profile + compatibility + reputation + contact + confidence), profile, compatibility, reputation, contact, confidence };
}

async function reanalyzeCompany(ctx: any, company: Company, offers: Offer[]) {
  const payload = (company.source_payload && Object.keys(company.source_payload).length ? company.source_payload : company.dados_google) ?? {};
  const signals = Array.isArray(company.sinais_keys) ? company.sinais_keys : [];
  const matches = offers.map((offer) => matchOffer(company, payload, signals, offer)).sort((a, b) => b.compatibility - a.compatibility || b.offer.prioridade - a.offer.prioridade);
  const recommendation = matches[0];
  const score = scoreCompany(company, payload, recommendation?.compatibility ?? null);
  const analyzedAt = new Date().toISOString();
  const potential = score.total >= 70 ? "alto" : score.total >= 45 ? "medio" : "baixo";
  const confidence = score.confidence >= 17 ? "Alta" : score.confidence >= 11 ? "Média" : "Baixa";

  const { error: deleteMatchError } = await ctx.supabase.from("company_offer_matches").delete().eq("empresa_id", company.id);
  if (deleteMatchError) throw deleteMatchError;
  if (matches.length) {
    const { error: matchError } = await ctx.supabase.from("company_offer_matches").insert(matches.map((match, index) => ({
      user_id: company.user_id,
      empresa_id: company.id,
      radar_id: company.radar_id,
      offer_id: match.offer.id,
      compatibilidade: match.compatibility,
      motivo: match.reason,
      principal: index === 0,
    })));
    if (matchError) throw matchError;
  }

  const { error: deleteScoreError } = await ctx.supabase.from("score_components").delete().eq("empresa_id", company.id).in("versao_modelo", ["apify-google-v1", "offer-fit-v2", "offer-reanalysis-v3"]);
  if (deleteScoreError) throw deleteScoreError;
  const { error: scoreError } = await ctx.supabase.from("score_components").insert([
    ["Perfil comercial público", score.profile, 20, "Completude e situação pública do estabelecimento na fonte consultada."],
    ["Compatibilidade com a oferta", score.compatibility, 30, recommendation ? recommendation.reason : "Nenhuma oferta ativa foi encontrada; compatibilidade ainda não avaliada."],
    ["Reputação", score.reputation, 15, "Nota e volume de avaliações na fonte pública consultada."],
    ["Contato", score.contact, 15, "Canais públicos de contato encontrados."],
    ["Confiança", score.confidence, 20, "Quantidade de campos públicos verificáveis já coletados."],
  ].map(([dimensao, pontos, maximo, explicacao]) => ({
    user_id: company.user_id,
    empresa_id: company.id,
    radar_run_id: null,
    versao_modelo: "offer-reanalysis-v3",
    dimensao,
    pontos,
    maximo,
    explicacao,
    calculado_em: analyzedAt,
  })));
  if (scoreError) throw scoreError;

  const { error: companyError } = await ctx.supabase.from("empresas").update({
    score: score.total,
    confianca: confidence,
    potencial: potential,
    servico_recomendado: recommendation?.offer.nome ?? null,
    analisado_em: analyzedAt,
  }).eq("id", company.id);
  if (companyError) throw companyError;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método não permitido" }, { status: 405 });
    try {
      const userId = ctx.userClaims?.id;
      if (!userId) return Response.json({ error: "Não foi possível identificar o usuário autenticado." }, { status: 401 });
      const body = await req.json().catch(() => ({}));
      const requestedIds = Array.isArray(body.company_ids) ? [...new Set(body.company_ids.map((value: unknown) => cleanText(value, 64)).filter(Boolean))] : [];
      if (requestedIds.length > 100) return Response.json({ error: "Selecione no máximo 100 empresas por reanálise." }, { status: 400 });

      let companyQuery = ctx.supabase.from("empresas").select("id,user_id,radar_id,nome,segmento,endereco,telefone,site,nota,avaliacoes,business_status,google_maps_url,source_url,source_payload,dados_google,sinais_keys").eq("user_id", userId).order("analisado_em", { ascending: true }).limit(500);
      if (requestedIds.length) companyQuery = companyQuery.in("id", requestedIds);
      const [{ data: companies, error: companiesError }, { data: offers, error: offersError }] = await Promise.all([
        companyQuery,
        ctx.supabase.from("offers").select("id,nome,resultado,publico_alvo,etapa,categorias,sinais,prioridade").eq("user_id", userId).eq("ativo", true),
      ]);
      if (companiesError) throw companiesError;
      if (offersError) throw offersError;
      if (!requestedIds.length && (companies ?? []).length >= 500) return Response.json({ error: "Há muitas empresas para uma única reanálise. Selecione grupos de até 100 oportunidades." }, { status: 400 });

      let updated = 0;
      const failed: Array<{ id: string; error: string }> = [];
      for (const company of (companies ?? []) as Company[]) {
        try {
          await reanalyzeCompany(ctx, company, (offers ?? []) as Offer[]);
          updated += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao recalcular a oportunidade.";
          console.error(JSON.stringify({ event: "opportunity_reanalysis_error", company_id: company.id, message }));
          failed.push({ id: company.id, error: "Não foi possível recalcular esta oportunidade." });
        }
      }

      return Response.json({ updated, failed, used_external_source: false, active_offers: (offers ?? []).length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao reanalisar as oportunidades.";
      console.error(JSON.stringify({ event: "opportunity_reanalysis_failed", message }));
      return Response.json({ error: message }, { status: 500 });
    }
  }),
};

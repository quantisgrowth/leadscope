import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { accountId } from "../_shared/account.ts";

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
  cnpj_cnae_description: string | null;
  cnpj_identity_score: number | null;
  cnpj_validated_at: string | null;
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

function matchOffer(company: Company, payload: Record<string, unknown>, signals: string[], offer: Offer, operationalText = '') {
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const verifiedActivity = company.cnpj_validated_at && Number(company.cnpj_identity_score) >= 50 ? company.cnpj_cnae_description : null;
  const companyText = normalizeText([company.nome, company.segmento, payload.categoryName, payload.description, ...categories, verifiedActivity, operationalText].join(" "));
  const categoryMatches = (offer.categorias ?? []).filter((category) => companyText.includes(normalizeText(category)));
  const digitalOffer = /site|marketing|seo|digital|tr[aá]fego/i.test([offer.nome, offer.resultado].join(' '));
  const signalMatches = (offer.sinais ?? []).filter((signal) => signals.includes(signal) && (digitalOffer || !['semSite','semWhats'].includes(signal)));
  const companyTokens = new Set(meaningfulTokens(companyText));
  const offerTokens = meaningfulTokens([offer.publico_alvo, ...(offer.categorias ?? [])].join(" "));
  const tokenMatches = offerTokens.filter((token) => companyTokens.has(token));
  let compatibility = categoryMatches.length ? 70 : Math.min(70, tokenMatches.length * 14);
  compatibility += Math.min(30, signalMatches.length * 10);
  compatibility = Math.min(100, compatibility);
  const reasons: string[] = [];
  if (categoryMatches.length) reasons.push(`categoria compatível: ${categoryMatches.slice(0, 2).join(", ")}`);
  else if (tokenMatches.length) reasons.push(`atividade compatível: ${tokenMatches.slice(0, 3).join(", ")}`);
  if (signalMatches.length) reasons.push(`${signalMatches.length} sinal(is) de oportunidade relacionado(s)`);
  if (verifiedActivity && (categoryMatches.length || tokenMatches.length)) reasons.push("atividade cadastral da empresa incluída na comparação");
  if (operationalText && (categoryMatches.length || tokenMatches.length)) reasons.push("sinais públicos da página auditada incluídos; necessidade ainda não confirmada");
  if (!reasons.length) reasons.push("nenhuma correspondência pública encontrada; validar atividade em conversa");
  const outcome = cleanText(offer.resultado, 180);
  return { offer, compatibility, reason: `Aderência baseada em ${reasons.join(" e ")}.${outcome ? ` Resultado a validar: ${outcome}` : ""}` };
}

function scoreCompany(company: Company, payload: Record<string, unknown>, offerCompatibility: number | null) {
  const rating = Number(company.nota ?? payload.totalScore) || 0;
  const reviews = Math.max(0, Number(company.avaliacoes ?? payload.reviewsCount) || 0);
  const isOpen = !['CLOSED_PERMANENTLY','CLOSED_TEMPORARILY'].includes(company.business_status||'') && payload.permanentlyClosed !== true && payload.temporarilyClosed !== true;
  const sourceUrl = company.google_maps_url || company.source_url;
  const profile = Math.min(10, 2 + (company.endereco ? 2 : 0) + (isOpen ? 2 : 0) + (rating ? 4 : 0));
  const compatibility = offerCompatibility == null ? 0 : Math.round(Math.max(0, Math.min(100, offerCompatibility)) * 0.6);
  const reputation = Math.min(5, Math.round((rating / 5) * 3) + Math.min(2, Math.floor(Math.log10(reviews + 1))));
  const contact = (company.telefone ? 7 : 0) + (company.site ? 3 : 0);
  const confidence = Math.min(15, 5 + [company.endereco, company.telefone, rating, sourceUrl, company.site].filter(Boolean).length * 2);
  const total = Math.min(100, profile + compatibility + reputation + contact + confidence);
  return { total, profile, compatibility, reputation, contact, confidence };
}

async function reanalyzeCompany(ctx: any, company: Company, offers: Offer[]) {
  const payload = (company.source_payload && Object.keys(company.source_payload).length ? company.source_payload : company.dados_google) ?? {};
  const signals = Array.isArray(company.sinais_keys) ? company.sinais_keys : [];
  const {data:audit,error:auditError} = await ctx.supabase.from('site_audits').select('metrics').eq('empresa_id',company.id).eq('user_id',company.user_id).eq('status','concluido').order('finished_at',{ascending:false}).limit(1).maybeSingle();
  if(auditError) throw auditError;
  const operationalText = Array.isArray(audit?.metrics?.operational_signals) ? audit.metrics.operational_signals.map((v: any) => cleanText(v.context,400)).join(' ') : '';
  const matches = offers.map((offer) => matchOffer(company, payload, signals, offer, operationalText)).sort((a, b) => b.compatibility - a.compatibility || b.offer.prioridade - a.offer.prioridade);
  const recommendation = matches.find(match => match.compatibility > 0);
  const score = scoreCompany(company, payload, recommendation?.compatibility ?? null);
  const analyzedAt = new Date().toISOString();
  const potential = score.total >= 70 ? "alto" : score.total >= 45 ? "medio" : "baixo";
  const confidence = score.confidence >= 13 ? "Alta" : score.confidence >= 9 ? "Média" : "Baixa";

  const matchRows = matches.map((match, index) => ({
      user_id: company.user_id,
      empresa_id: company.id,
      radar_id: company.radar_id,
      offer_id: match.offer.id,
      compatibilidade: match.compatibility,
      motivo: match.reason,
      principal: index === 0,
      analysis_batch: analyzedAt,
    }));

  const componentRows = [
    ["Perfil comercial público", score.profile, 10, "Completude e situação pública do estabelecimento na fonte consultada."],
    ["Compatibilidade com a oferta", score.compatibility, 60, recommendation ? recommendation.reason : "Nenhuma correspondência com uma oferta foi identificada; valide em conversa."],
    ["Reputação", score.reputation, 5, "Nota e volume de avaliações, sem inferir faturamento ou orçamento."],
    ["Contato", score.contact, 10, "Canais públicos de contato encontrados."],
    ["Confiança", score.confidence, 15, "Quantidade de campos públicos verificáveis já coletados."],
  ].map(([dimensao, pontos, maximo, explicacao]) => ({
    user_id: company.user_id,
    empresa_id: company.id,
    radar_run_id: null,
    versao_modelo: "erp-public-fit-v4",
    dimensao,
    pontos,
    maximo,
    explicacao,
    calculado_em: analyzedAt,
  }));

  const { error: companyError } = await ctx.supabase.rpc('save_company_analysis',{p_company:company.id,p_matches:matchRows,p_components:componentRows,p_update:{
    score: score.total,
    confianca: confidence,
    potencial: potential,
    servico_recomendado: recommendation?.offer.nome ?? null,
    analisado_em: analyzedAt,
  }});
  if (companyError) throw companyError;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método não permitido" }, { status: 405 });
    try {
      const userId = await accountId(ctx);
      if (!userId) return Response.json({ error: "Não foi possível identificar o usuário autenticado." }, { status: 401 });
      const body = await req.json().catch(() => ({}));
      const requestedIds = Array.isArray(body.company_ids) ? [...new Set(body.company_ids.map((value: unknown) => cleanText(value, 64)).filter(Boolean))] : [];
      if (requestedIds.length > 100) return Response.json({ error: "Selecione no máximo 100 empresas por reanálise." }, { status: 400 });

      let companyQuery = ctx.supabase.from("empresas").select("id,user_id,radar_id,nome,segmento,endereco,telefone,site,nota,avaliacoes,business_status,google_maps_url,source_url,source_payload,dados_google,sinais_keys,cnpj_cnae_description,cnpj_identity_score,cnpj_validated_at").eq("user_id", userId).order("analisado_em", { ascending: true }).limit(500);
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

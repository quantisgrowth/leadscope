import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type Place = {
  id: string;
  displayName?: { text?: string };
  types?: string[];
  primaryType?: string;
  nationalPhoneNumber?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  websiteUri?: string;
  businessStatus?: string;
};

const GOOGLE_FIELDS = ["places.id", "places.displayName", "places.types", "places.primaryType",
  "places.nationalPhoneNumber", "places.formattedAddress", "places.location", "places.rating",
  "places.userRatingCount", "places.googleMapsUri", "places.websiteUri", "places.businessStatus"].join(",");

function cleanText(value: unknown, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

async function describeGoogleError(response: Response) {
  const fallback = `Google Places respondeu com status ${response.status}.`;
  try {
    const payload = await response.json();
    const googleError = payload?.error;
    const reason = Array.isArray(googleError?.details)
      ? googleError.details.find((detail: { reason?: string }) => detail?.reason)?.reason
      : undefined;
    const message = cleanText(googleError?.message, 420);
    const code = cleanText(reason || googleError?.status, 80);
    return [fallback, code && `Código: ${code}.`, message].filter(Boolean).join(" ");
  } catch {
    return fallback;
  }
}

function scorePlace(place: Place) {
  const profile = Math.min(20, 7 + (place.formattedAddress ? 4 : 0) + (place.businessStatus === "OPERATIONAL" ? 4 : 0) + (place.rating ? 5 : 0));
  const opportunity = place.websiteUri ? 9 : 25;
  const reputation = Math.min(20, Math.round(((place.rating ?? 0) / 5) * 12) + Math.min(8, Math.floor(Math.log10((place.userRatingCount ?? 0) + 1) * 4)));
  const contact = (place.nationalPhoneNumber ? 9 : 0) + (place.websiteUri ? 6 : 0);
  const confidence = Math.min(20, 5 + [place.formattedAddress, place.nationalPhoneNumber, place.rating, place.googleMapsUri, place.websiteUri].filter(Boolean).length * 3);
  return { total: Math.min(100, profile + opportunity + reputation + contact + confidence), profile, opportunity, reputation, contact, confidence };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método não permitido" }, { status: 405 });
    let runId: string | null = null;
    let radarId: string | null = null;
    try {
      const body = await req.json();
      radarId = cleanText(body.radar_id, 64);
      const query = cleanText(body.query);
      const location = cleanText(body.location);
      const limit = Math.max(1, Math.min(20, Number(body.result_limit) || 20));
      if (!radarId || !query || !location) return Response.json({ error: "Radar, segmento e localização são obrigatórios." }, { status: 400 });
      const userId = ctx.userClaims?.id;
      if (!userId) return Response.json({ error: "Não foi possível identificar o usuário autenticado." }, { status: 401 });

      const { data: radar, error: radarError } = await ctx.supabase.from("radares").select("id").eq("id", radarId).single();
      if (radarError || !radar) return Response.json({ error: "Radar não encontrado." }, { status: 404 });
      const { data: run, error: runError } = await ctx.supabase.from("radar_runs").insert({
        radar_id: radarId, user_id: userId, consulta: query, localizacao: location, limite_resultados: limit,
      }).select("id").single();
      if (runError) throw runError;
      runId = run.id;
      await ctx.supabase.from("radares").update({ status: "processando", iniciado_em: new Date().toISOString(), erro: null }).eq("id", radarId);

      const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
      if (!apiKey) throw new Error("Integração do Google ainda não foi configurada.");
      const googleResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": GOOGLE_FIELDS },
        body: JSON.stringify({ textQuery: `${query} em ${location}`, languageCode: "pt-BR", regionCode: "BR", pageSize: limit }),
      });
      if (!googleResponse.ok) {
        const googleError = await describeGoogleError(googleResponse);
        console.error(JSON.stringify({ event: "google_places_error", status: googleResponse.status, message: googleError }));
        throw new Error(googleError);
      }
      const payload = await googleResponse.json();
      const places: Place[] = Array.isArray(payload.places) ? payload.places : [];
      const saved = [];

      for (const place of places) {
        if (!place.id || !place.displayName?.text) continue;
        const score = scorePlace(place);
        const potencial = score.total >= 70 ? "alto" : score.total >= 45 ? "medio" : "baixo";
        const confianca = score.confidence >= 17 ? "Alta" : score.confidence >= 11 ? "Média" : "Baixa";
        const signals: string[] = [];
        if (!place.websiteUri) signals.push("semSite");
        if (!place.nationalPhoneNumber) signals.push("semWhats");
        const { data: company, error: companyError } = await ctx.supabase.from("empresas").upsert({
          user_id: userId, radar_id: radarId, google_place_id: place.id, nome: place.displayName.text,
          segmento: place.primaryType ?? place.types?.[0] ?? query, cidade: location,
          endereco: place.formattedAddress ?? null, telefone: place.nationalPhoneNumber ?? null,
          site: place.websiteUri ?? null, nota: place.rating ?? null, avaliacoes: place.userRatingCount ?? 0,
          score: score.total, confianca, potencial, status: "Nova", ultima_atualizacao: new Date().toISOString().slice(0, 10),
          servico_recomendado: place.websiteUri ? "Otimização da presença digital e conversão" : "Criação de site e presença digital",
          sinais_keys: signals, business_status: place.businessStatus ?? null, google_maps_url: place.googleMapsUri ?? null,
          latitude: place.location?.latitude ?? null, longitude: place.location?.longitude ?? null,
          dados_google: place, coletado_em: new Date().toISOString(),
        }, { onConflict: "user_id,google_place_id" }).select("id,nome,score,potencial").single();
        if (companyError) throw companyError;

        await ctx.supabase.from("score_components").delete().eq("empresa_id", company.id).eq("versao_modelo", "google-v1");
        await ctx.supabase.from("score_components").insert([
          ["Perfil Google", score.profile, 20, "Completude e situação pública do perfil."],
          ["Oportunidade", score.opportunity, 25, place.websiteUri ? "Site encontrado; há espaço para otimização." : "Site não encontrado no perfil."],
          ["Reputação", score.reputation, 20, "Nota e volume de avaliações públicas."],
          ["Contato", score.contact, 15, "Canais públicos de contato encontrados."],
          ["Confiança", score.confidence, 20, "Quantidade de campos verificáveis retornados pelo Google."],
        ].map(([dimensao, pontos, maximo, explicacao]) => ({ user_id: userId, empresa_id: company.id, radar_run_id: runId, dimensao, pontos, maximo, explicacao })));

        const channels: Array<{ tipo: string; valor: string; url: string | null; principal: boolean }> = [];
        if (place.googleMapsUri) channels.push({ tipo: "google_maps", valor: place.googleMapsUri, url: place.googleMapsUri, principal: true });
        if (place.websiteUri) channels.push({ tipo: "site", valor: place.websiteUri, url: place.websiteUri, principal: false });
        if (place.nationalPhoneNumber) channels.push({ tipo: "telefone", valor: place.nationalPhoneNumber, url: null, principal: false });
        const channelRows = channels.map((channel) => ({ ...channel, user_id: userId, empresa_id: company.id, fonte: "google_places", verificado_em: new Date().toISOString() }));
        if (channelRows.length) await ctx.supabase.from("company_channels").upsert(channelRows, { onConflict: "empresa_id,tipo,valor" });

        const evidence = [];
        if (!place.websiteUri) evidence.push({ texto: "Site não encontrado no Perfil da Empresa no Google.", fonte: "Google Places", confianca: "Alta" });
        if (!place.nationalPhoneNumber) evidence.push({ texto: "Telefone não informado no perfil público do Google.", fonte: "Google Places", confianca: "Alta" });
        if (place.rating) evidence.push({ texto: `Nota pública ${place.rating} com ${place.userRatingCount ?? 0} avaliações.`, fonte: "Google Places", confianca: "Alta" });
        await ctx.supabase.from("evidencias").delete().eq("empresa_id", company.id).eq("tipo_fonte", "google_places");
        if (evidence.length) await ctx.supabase.from("evidencias").insert(evidence.map((item) => ({ ...item, empresa_id: company.id, data: new Date().toISOString().slice(0, 10), tipo_fonte: "google_places", url_fonte: place.googleMapsUri ?? null, coletado_em: new Date().toISOString() })));
        saved.push(company);
      }

      const finishedAt = new Date().toISOString();
      await ctx.supabase.from("radar_runs").update({ status: "concluido", encontrados: saved.length, concluido_em: finishedAt }).eq("id", runId);
      await ctx.supabase.from("radares").update({ status: "concluido", concluido_em: finishedAt }).eq("id", radarId);
      return Response.json({ radar_id: radarId, run_id: runId, found: saved.length, companies: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao executar o radar.";
      if (runId) await ctx.supabase.from("radar_runs").update({ status: "falhou", erro: message, concluido_em: new Date().toISOString() }).eq("id", runId);
      if (radarId) await ctx.supabase.from("radares").update({ status: "falhou", erro: message }).eq("id", radarId);
      return Response.json({ error: message }, { status: 500 });
    }
  }),
};

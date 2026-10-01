import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

function normalizeText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const NAME_STOP_WORDS = new Set(["ltda", "limitada", "me", "epp", "sa", "s", "eireli", "empresa", "comercio", "servicos"]);

function nameTokens(value: unknown) {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length >= 3 && !NAME_STOP_WORDS.has(token)));
}

function tokenSimilarity(left: unknown, right: unknown) {
  const a = nameTokens(left);
  const b = nameTokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

function numericCnpjIsValid(cnpj: string) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, value, index) => total + Number(value) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(`${cnpj.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${first}${second}`);
}

function cleanCnpj(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function safeDate(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function fetchRegistry(cnpj: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, {
      headers: { Accept: "application/json", "User-Agent": "LeadScope/1.0" },
      signal: controller.signal,
    });
    if (response.status === 404) throw new Error("CNPJ não encontrado no cadastro público.");
    if (response.status === 400) throw new Error("CNPJ inválido ou mal formatado.");
    if (!response.ok) {
      console.error(JSON.stringify({ event: "cnpj_registry_http_error", status: response.status }));
      throw new Error("A consulta cadastral está temporariamente indisponível.");
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método não permitido" }, { status: 405 });
    try {
      const userId = ctx.userClaims?.id;
      if (!userId) return Response.json({ error: "Não foi possível identificar o usuário autenticado." }, { status: 401 });
      const body = await req.json().catch(() => ({}));
      const companyId = String(body.company_id ?? "").trim();
      const cnpj = cleanCnpj(body.cnpj);
      if (!companyId) return Response.json({ error: "Empresa não informada." }, { status: 400 });
      if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return Response.json({ error: "Informe um CNPJ com 14 caracteres válidos." }, { status: 400 });
      if (/^\d{14}$/.test(cnpj) && !numericCnpjIsValid(cnpj)) return Response.json({ error: "Os dígitos verificadores do CNPJ são inválidos." }, { status: 400 });

      const { data: company, error: companyError } = await ctx.supabase.from("empresas").select("id,nome,cidade,telefone").eq("id", companyId).eq("user_id", userId).single();
      if (companyError || !company) return Response.json({ error: "Empresa não encontrada." }, { status: 404 });

      const registry = await fetchRegistry(cnpj);
      const legalName = String(registry.razao_social ?? "").trim();
      const tradeName = String(registry.nome_fantasia ?? "").trim();
      const nameMatch = Math.max(tokenSimilarity(company.nome, tradeName), tokenSimilarity(company.nome, legalName));
      const companyCity = normalizeText(company.cidade).split(" sp")[0].split(" mg")[0].split(" rj")[0].trim();
      const registryCity = normalizeText(registry.municipio);
      const cityMatch = !!companyCity && !!registryCity && (companyCity.includes(registryCity) || registryCity.includes(companyCity));
      const companyPhone = String(company.telefone ?? "").replace(/\D/g, "").slice(-8);
      const registryPhones = [registry.ddd_telefone_1, registry.ddd_telefone_2].map((value) => String(value ?? "").replace(/\D/g, "").slice(-8)).filter(Boolean);
      const phoneMatch = !!companyPhone && registryPhones.includes(companyPhone);
      const identityScore = Math.min(100, Math.round(nameMatch * 70) + (cityMatch ? 20 : 0) + (phoneMatch ? 10 : 0));
      const status = String(registry.descricao_situacao_cadastral ?? "NÃO INFORMADA").trim().toUpperCase();
      const active = status === "ATIVA";
      const validatedAt = new Date().toISOString();

      const update = {
        cnpj,
        cnpj_status: status,
        cnpj_active: active,
        cnpj_legal_name: legalName || null,
        cnpj_trade_name: tradeName || null,
        cnpj_cnae_code: registry.cnae_fiscal == null ? null : String(registry.cnae_fiscal),
        cnpj_cnae_description: String(registry.cnae_fiscal_descricao ?? "").trim() || null,
        cnpj_size: String(registry.porte || registry.descricao_porte || "").trim() || null,
        cnpj_opening_date: safeDate(registry.data_inicio_atividade),
        cnpj_identity_score: identityScore,
        cnpj_validated_at: validatedAt,
      };
      const { error: updateError } = await ctx.supabase.from("empresas").update(update).eq("id", companyId).eq("user_id", userId);
      if (updateError) throw updateError;

      return Response.json({
        cnpj,
        status,
        active,
        legal_name: update.cnpj_legal_name,
        trade_name: update.cnpj_trade_name,
        cnae_code: update.cnpj_cnae_code,
        cnae_description: update.cnpj_cnae_description,
        size: update.cnpj_size,
        opening_date: update.cnpj_opening_date,
        identity_score: identityScore,
        validated_at: validatedAt,
      });
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "A consulta cadastral demorou demais. Tente novamente."
        : error instanceof Error ? error.message : "Falha inesperada ao validar o CNPJ.";
      console.error(JSON.stringify({ event: "cnpj_validation_failed", message }));
      return Response.json({ error: message }, { status: 500 });
    }
  }),
};

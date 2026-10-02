import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { accountId } from "../_shared/account.ts";

const APIFY_ACTOR = "apify~website-content-crawler";
const PROVIDER = "apify_website_content_crawler";
const CACHE_DAYS = 7;

const PAGE_FUNCTION = `async function pageFunction({ page }) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const links = Array.from(document.querySelectorAll('a[href]')).filter(visible).map((link) => ({
      href: link.href,
      text: (link.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
    }));
    const haystack = links.map((link) => link.text + ' ' + link.href).join(' ').toLowerCase();
    const whatsappLinks = links.filter((link) => /wa\\.me|api\\.whatsapp\\.com|whatsapp:\\/\\//i.test(link.href));
    const bookingLinks = links.filter((link) => /agend|marcar|reserv|book|schedule|calendly|doctoralia|trinks/i.test(link.text + ' ' + link.href));
    const contactForms = Array.from(document.querySelectorAll('form')).filter(visible).filter((form) => {
      const content = ((form.textContent || '') + ' ' + (form.getAttribute('action') || '')).toLowerCase();
      return /contato|contact|mensagem|message|email|telefone|phone|nome|name/.test(content) || form.querySelector('input[type="email"], input[type="tel"], textarea');
    });
    const title = (document.title || '').trim();
    const description = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').trim();
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    const h1Count = document.querySelectorAll('h1').length;
    const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 4;
    const hasResponsiveViewport = /width\\s*=\\s*device-width/i.test(viewportMeta);
    const socialLinks = links.filter((link) => {
      try {
        const url = new URL(link.href);
        return ['http:', 'https:'].includes(url.protocol) && /(^|\\.)(instagram\\.com|facebook\\.com|linkedin\\.com|tiktok\\.com|youtube\\.com|x\\.com|twitter\\.com)$/.test(url.hostname) && !/shar(e|er|ing)|intent/i.test(url.pathname);
      } catch { return false; }
    }).map((link) => link.href).slice(0, 20);
    // Candidates are evidence only: a footer can belong to a parent company or supplier.
    const bodyText = (document.body.innerText || '').slice(0, 150000);
    const cnpjCandidates = [];
    const pattern = /\\b(?:[0-9A-Z]{2}\\.[0-9A-Z]{3}\\.[0-9A-Z]{3}\\/[0-9A-Z]{4}-[0-9]{2}|[0-9A-Z]{14})\\b/gi;
    for (const match of bodyText.matchAll(pattern)) {
      const context = bodyText.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80).replace(/\\s+/g, ' ');
      if (!/cnpj/i.test(context)) continue;
      const value = match[0].toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(value) || /^(.)\\1{13}$/.test(value)) continue;
      const digit = (base, weights) => {
        const remainder = [...base].reduce((sum, char, i) => sum + (char.charCodeAt(0) - 48) * weights[i], 0) % 11;
        return remainder < 2 ? 0 : 11 - remainder;
      };
      const first = digit(value.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
      const second = digit(value.slice(0, 12) + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
      if (!value.endsWith('' + first + second) || cnpjCandidates.some(item => item.cnpj === value)) continue;
      cnpjCandidates.push({ cnpj: value, context, source: location.href });
      if (cnpjCandidates.length >= 5) break;
    }
    const emailLinks = links.filter(link => /^mailto:/i.test(link.href)).map(link => link.href.split('?')[0]).slice(0, 10);
    const phoneLinks = links.filter(link => /^tel:/i.test(link.href)).map(link => link.href).slice(0, 10);
    // Deterministic observations, not instructions to an AI and not confirmed pains.
    const operationalRules = [
      ['Locação de equipamentos', /loca[çc][aã]o|aluguel/i],
      ['Terraplanagem e obras', /terraplanagem|escava[çc][aã]o|demoli[çc][aã]o/i],
      ['Transporte e frota', /transporte|frota|log[íi]stica/i],
      ['Máquinas e equipamentos', /retroescavadeira|escavadeira|guindaste|munck|empilhadeira|compactador|betoneira/i],
      ['Manutenção e assistência', /manuten[çc][aã]o|assist[êe]ncia t[ée]cnica/i],
      ['Contratos e recorrência', /contratos?|loca[çc][aã]o mensal|mensalidade/i],
      ['Operador', /com operador|sem operador/i],
      ['Unidades e filiais', /filiais|filial|nossas unidades/i],
      ['Orçamento e reserva', /solicite.{0,20}or[çc]amento|reserv(e|a)|cota[çc][aã]o/i],
    ];
    const operationalSignals = operationalRules.flatMap(([label, pattern]) => {
      const match = bodyText.match(pattern);
      return match ? [{ label, context: bodyText.slice(Math.max(0, match.index - 70), match.index + match[0].length + 110).replace(/\\s+/g, ' '), source: location.href }] : [];
    });
    const seoPassed = title.length >= 10 && description.length >= 50 && h1Count >= 1;
    return {
      pageUrl: location.href,
      title,
      description,
      canonical,
      h1Count,
      viewportMeta,
      horizontalOverflow,
      hasResponsiveViewport,
      whatsappLinks: whatsappLinks.map((link) => link.href).slice(0, 10),
      bookingLinks: bookingLinks.map((link) => link.href).slice(0, 10),
      contactForms: contactForms.length,
      socialLinks,
      emailLinks,
      phoneLinks,
      cnpjCandidates,
      operationalSignals,
      checks: {
        https: location.protocol === 'https:',
        responsive: hasResponsiveViewport && !horizontalOverflow,
        whatsapp: whatsappLinks.length > 0,
        form: contactForms.length > 0,
        booking: bookingLinks.length > 0,
        seo: seoPassed,
      },
      evidence: {
        responsive: hasResponsiveViewport ? (horizontalOverflow ? 'A página possui viewport mobile, mas apresentou rolagem horizontal.' : 'Viewport mobile configurado sem rolagem horizontal detectada.') : 'Meta viewport responsiva não encontrada.',
        whatsapp: whatsappLinks.length ? 'Link público de WhatsApp encontrado.' : 'Link público de WhatsApp não encontrado na página inicial.',
        form: contactForms.length ? contactForms.length + ' formulário(s) de contato visível(is) encontrado(s).' : 'Formulário de contato visível não encontrado na página inicial.',
        booking: bookingLinks.length ? 'Link ou chamada de agendamento encontrada.' : 'Link de agendamento não encontrado na página inicial.',
        seo: seoPassed ? 'Título, descrição e H1 básicos encontrados.' : 'O SEO básico está incompleto: título, descrição ou H1 ausente/insuficiente.',
      },
      haystackSample: haystack.slice(0, 300),
    };
  });
  const encoded = await page.evaluate((value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, result);
  await page.evaluate((value) => {
    const marker = document.createElement('div');
    marker.id = 'leadscope-audit-result';
    marker.setAttribute('data-leadscope-audit', value);
    marker.textContent = 'LEADSCOPE_AUDIT_' + value;
    document.body.prepend(marker);
  }, encoded);
}`;

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function normalizePublicUrl(value: unknown) {
  const raw = cleanText(value, 2048);
  const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("O site precisa usar HTTP ou HTTPS.");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateIpv6 = hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || /^fe[89ab]/.test(hostname);
  if (!hostname || hostname === "localhost" || privateIpv6 || hostname.endsWith(".local") || isPrivateIpv4(hostname)) {
    throw new Error("O endereço informado não é um site público válido.");
  }
  parsed.hash = "";
  return parsed.href;
}

async function apifyRequest(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://api.apify.com/v2/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = cleanText(payload?.error?.message || payload?.message, 420);
    } catch {
      // A mensagem genérica evita expor respostas completas do provedor.
    }
    console.error(JSON.stringify({ event: "site_provider_http_error", status: response.status, detail }));
    throw new Error(`O serviço de auditoria respondeu com status ${response.status}.`);
  }
  return response.json();
}

function decodeAuditPayload(item: Record<string, unknown>) {
  const candidates = [item.html, item.markdown, item.text].filter((value) => typeof value === "string") as string[];
  const source = candidates.join("\n");
  const match = source.match(/data-leadscope-audit=["']([A-Za-z0-9+/=]+)["']/) || source.match(/LEADSCOPE_AUDIT_([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error("O robô concluiu a visita, mas não retornou os dados técnicos esperados.");
  const binary = atob(match[1]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function auditScore(checks: Record<string, boolean>) {
  const weights: Record<string, number> = { https: 15, responsive: 20, whatsapp: 15, form: 15, booking: 10, seo: 25 };
  return Object.entries(weights).reduce((total, [key, weight]) => total + (checks[key] === true ? weight : 0), 0);
}

async function markFailed(ctx: any, auditId: string | null, message: string) {
  if (!auditId) return;
  await ctx.supabase.from("site_audits").update({ status: "falhou", error: message, finished_at: new Date().toISOString() }).eq("id", auditId);
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método não permitido" }, { status: 405 });
    const token = Deno.env.get("APIFY_API_TOKEN");
    if (!token) return Response.json({ error: "O serviço de auditoria ainda não foi configurado." }, { status: 503 });

    let auditId: string | null = null;
    try {
      const body = await req.json();
      const action = body.action === "status" ? "status" : "start";
      const userId = await accountId(ctx);
      if (!userId) return Response.json({ error: "Não foi possível identificar o usuário autenticado." }, { status: 401 });

      if (action === "start") {
        const companyId = cleanText(body.company_id, 64);
        if (!companyId) return Response.json({ error: "Empresa não informada." }, { status: 400 });
        const { data: company, error: companyError } = await ctx.supabase.from("empresas").select("id,site").eq("id", companyId).eq("user_id", userId).single();
        if (companyError || !company) return Response.json({ error: "Empresa não encontrada." }, { status: 404 });
        if (!company.site) return Response.json({ error: "Esta empresa não possui um site público para auditar." }, { status: 400 });
        const url = normalizePublicUrl(company.site);

        if (!body.force) {
          const cacheDate = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString();
          const { data: cached } = await ctx.supabase.from("site_audits").select("*").eq("empresa_id", companyId)
            .eq("status", "concluido").gte("created_at", cacheDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (cached) return Response.json({ status: "concluido", cached: true, audit: cached });
        }

        const { data: audit, error: auditError } = await ctx.supabase.from("site_audits").insert({
          user_id: userId, empresa_id: companyId, status: "pendente", provider: PROVIDER, url,
        }).select("id").single();
        if (auditError) throw auditError;
        auditId = audit.id;

        const payload = await apifyRequest(`acts/${APIFY_ACTOR}/runs?maxItems=1&maxTotalChargeUsd=0.25&timeout=180`, token, {
          method: "POST",
          body: JSON.stringify({
            startUrls: [{ url }], crawlerType: "playwright:firefox", maxCrawlDepth: 0, maxCrawlPages: 1, maxResults: 1,
            useSitemaps: false, proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: [] }, initialConcurrency: 1, maxConcurrency: 1,
            requestTimeoutSecs: 60, maxRequestRetries: 0, maxScrollHeightPixels: 2500, removeCookieWarnings: true,
            blockMedia: true, expandIframes: false, clickElementsCssSelector: "", pageFunction: PAGE_FUNCTION,
            keepElementsCssSelector: "#leadscope-audit-result", removeElementsCssSelector: "script,style,noscript,svg",
            htmlTransformer: "none", saveHtml: true, saveMarkdown: true, saveHtmlAsFile: false,
            saveScreenshots: false, summarize: false, saveFiles: false, debugMode: false,
          }),
        });
        const run = payload?.data;
        if (!run?.id) throw new Error("O serviço não retornou a identificação da auditoria.");
        await ctx.supabase.from("site_audits").update({
          status: "processando", provider_run_id: run.id, provider_dataset_id: run.defaultDatasetId ?? null,
        }).eq("id", auditId);
        return Response.json({ status: "processando", audit_id: auditId }, { status: 202 });
      }

      auditId = cleanText(body.audit_id, 64);
      if (!auditId) return Response.json({ error: "Auditoria não informada." }, { status: 400 });
      const { data: audit, error: auditError } = await ctx.supabase.from("site_audits").select("*").eq("id", auditId).eq("user_id", userId).single();
      if (auditError || !audit) return Response.json({ error: "Auditoria não encontrada." }, { status: 404 });
      if (audit.status === "concluido") return Response.json({ status: "concluido", audit });
      if (audit.status === "falhou") return Response.json({ status: "falhou", error: audit.error || "A auditoria falhou." }, { status: 500 });
      if (!audit.provider_run_id) throw new Error("A auditoria não possui uma execução vinculada.");

      const runPayload = await apifyRequest(`actor-runs/${audit.provider_run_id}`, token);
      const run = runPayload?.data;
      const providerStatus = cleanText(run?.status, 40) || "UNKNOWN";
      if (["FAILED", "TIMED-OUT", "ABORTED"].includes(providerStatus)) throw new Error(`A auditoria terminou com status ${providerStatus}.`);
      if (providerStatus !== "SUCCEEDED") return Response.json({ status: "processando", provider_status: providerStatus, audit_id: auditId }, { status: 202 });

      const datasetId = run?.defaultDatasetId || audit.provider_dataset_id;
      if (!datasetId) throw new Error("A auditoria foi concluída sem disponibilizar o resultado técnico.");
      const items = await apifyRequest(`datasets/${datasetId}/items?clean=true&format=json&limit=1`, token);
      if (!Array.isArray(items) || !items.length) throw new Error("Nenhum resultado técnico foi retornado pelo serviço de auditoria.");
      const item = items[0] as Record<string, any>;
      const technical = decodeAuditPayload(item);
      const checks = technical.checks as Record<string, boolean>;
      const score = auditScore(checks);
      const finalUrl = cleanText(technical.pageUrl || item.url || item.crawl?.loadedUrl, 2048) || audit.url;
      const httpStatus = Number(item.statusCode || item.crawl?.httpStatusCode || item.crawl?.statusCode) || null;
      const evidence = Object.entries(technical.evidence || {}).map(([key, description]) => ({ key, description, source: finalUrl }));
      const metrics = {
        title: technical.title || null, description: technical.description || null, canonical: technical.canonical || null,
        h1_count: technical.h1Count || 0, viewport: technical.viewportMeta || null, horizontal_overflow: !!technical.horizontalOverflow,
        whatsapp_links: technical.whatsappLinks || [], booking_links: technical.bookingLinks || [],
        contact_forms: technical.contactForms || 0, social_links: technical.socialLinks || [],
        email_links: technical.emailLinks || [], phone_links: technical.phoneLinks || [],
        cnpj_candidates: technical.cnpjCandidates || [], enrichment_version: 2,
        operational_signals: technical.operationalSignals || [],
      };
      const finishedAt = new Date().toISOString();
      const { data: saved, error: saveError } = await ctx.supabase.from("site_audits").update({
        status: "concluido", provider_dataset_id: datasetId, final_url: finalUrl, http_status: httpStatus,
        checks, evidence, metrics, score, confidence: "Média", error: null, finished_at: finishedAt,
      }).eq("id", auditId).select("*").single();
      if (saveError) throw saveError;
      const { error: companyUpdateError } = await ctx.supabase.from("empresas").update({
        analisado_em: finishedAt, ultima_atualizacao: finishedAt.slice(0, 10),
      }).eq("id", audit.empresa_id).eq("user_id", userId);
      if (companyUpdateError) throw companyUpdateError;
      return Response.json({ status: "concluido", audit: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao auditar o site.";
      console.error(JSON.stringify({ event: "site_audit_error", audit_id: auditId, message }));
      await markFailed(ctx, auditId, message);
      return Response.json({ error: message }, { status: 500 });
    }
  }),
};

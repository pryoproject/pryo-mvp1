import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";

const MAX_HTML_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PAGES = 6;

export type CrawlErrorCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "DNS_LOOKUP_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "URL_UNREACHABLE"
  | "NON_HTML_RESPONSE"
  | "HTML_TOO_LARGE";

export type PageKind = "homepage" | "pricing" | "product" | "features" | "solutions" | "customers" | "integrations" | "about" | "other";

export class CrawlError extends Error {
  constructor(public readonly code: CrawlErrorCode, message: string) {
    super(message);
    this.name = "CrawlError";
  }
}

export interface PageSnapshot {
  url: string;
  kind: PageKind;
  statusCode: number;
  title?: string;
  description?: string;
  canonical?: string;
  language?: string;
  robots?: string;
  h1: string[];
  h2: string[];
  text: string;
  links: string[];
  ctas: string[];
  wordCount: number;
  htmlBytes: number;
  responseTimeMs: number;
}

export interface SiteSnapshot {
  homepage: PageSnapshot;
  pages: PageSnapshot[];
  failedPages: Array<{ url: string; code: CrawlErrorCode | "UNKNOWN" }>;
  discoveredCount: number;
}

function normalizeInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new CrawlError("INVALID_URL", "Enter a website URL.");
  if (trimmed.length > 2048) throw new CrawlError("INVALID_URL", "URL is too long.");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isUnsafeHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal" || host === "metadata" || host === "instance-data";
}

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isPrivateIpv6(ip: string) {
  const value = ip.toLowerCase();
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (net.isIPv4(mapped)) return isPrivateIpv4(mapped);
  }
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value) || value.startsWith("ff");
}

function isUnsafeIp(ip: string) {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true;
}

export async function assertSafeUrl(input: string) {
  let url: URL;
  try { url = new URL(normalizeInput(input)); }
  catch { throw new CrawlError("INVALID_URL", "Enter a valid public website URL."); }

  if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:")) throw new CrawlError("UNSAFE_URL", "Only http and https URLs are allowed.");
  if (url.username || url.password) throw new CrawlError("UNSAFE_URL", "URLs containing credentials are not allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new CrawlError("UNSAFE_URL", "Custom ports are not allowed.");
  if (isUnsafeHostname(url.hostname)) throw new CrawlError("UNSAFE_URL", "Private or internal addresses are blocked.");

  let resolved: Array<{ address: string; family: number }>;
  try { resolved = await dns.lookup(url.hostname, { all: true }); }
  catch { throw new CrawlError("DNS_LOOKUP_FAILED", "The website domain could not be resolved."); }
  if (!resolved.length || resolved.some(({ address }) => isUnsafeIp(address))) throw new CrawlError("UNSAFE_URL", "Private or internal addresses are blocked.");

  url.hash = "";
  return url;
}

async function fetchSafely(input: string) {
  let current = await assertSafeUrl(input);
  const startedAt = Date.now();
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "user-agent": "PryoBot/0.4 (+website-audit)", accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" }
      });
    } catch { throw new CrawlError("URL_UNREACHABLE", "The website did not respond in time."); }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new CrawlError("URL_UNREACHABLE", `Website returned redirect ${response.status} without a destination.`);
      if (redirectCount === MAX_REDIRECTS) throw new CrawlError("TOO_MANY_REDIRECTS", "The website redirected too many times.");
      current = await assertSafeUrl(new URL(location, current).toString());
      continue;
    }
    return { response, finalUrl: current, responseTimeMs: Date.now() - startedAt };
  }
  throw new CrawlError("TOO_MANY_REDIRECTS", "The website redirected too many times.");
}

async function readHtmlWithLimit(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > MAX_HTML_BYTES) throw new CrawlError("HTML_TOO_LARGE", "Page HTML exceeds the crawl limit.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new CrawlError("HTML_TOO_LARGE", "Page HTML exceeds the crawl limit.");
    }
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

function normalizeText(value: string) { return value.replace(/\s+/g, " ").trim(); }

function looksLikeCta(text: string, className: string, id: string, tagName: string) {
  const normalized = text.toLowerCase();
  const attributes = `${className} ${id}`.toLowerCase();
  if (tagName === "button") return Boolean(normalized);
  if (/\b(cta|button|btn)\b/.test(attributes)) return Boolean(normalized);
  return /\b(get started|start|try|book|demo|sign up|signup|buy|shop|contact|request|download|join|subscribe|register|order|pricing|talk to|learn more|see how|free trial)\b/i.test(normalized);
}

export function classifyPage(url: string): PageKind {
  const path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (path === "/") return "homepage";
  if (/\bpricing\b/.test(path)) return "pricing";
  if (/customers?|case-stud|stories|success/.test(path)) return "customers";
  if (/integrations?|apps?/.test(path)) return "integrations";
  if (/solutions?|use-cases?/.test(path)) return "solutions";
  if (/features?/.test(path)) return "features";
  if (/product|platform/.test(path)) return "product";
  if (/about|company/.test(path)) return "about";
  return "other";
}

function candidateScore(url: URL) {
  const path = url.pathname.toLowerCase();
  if (/\.(?:pdf|jpg|jpeg|png|gif|svg|webp|zip|xml|json|txt|css|js)$/i.test(path)) return -100;
  if (/\/(?:blog|docs?|help|support|changelog|careers?|jobs?|legal|privacy|terms|security|login|signin|signup|register)(?:\/|$)/.test(path)) return -50;
  const kind = classifyPage(url.toString());
  const base: Record<PageKind, number> = { homepage: 0, pricing: 100, product: 95, features: 92, solutions: 88, customers: 85, integrations: 72, about: 60, other: 20 };
  return base[kind] - Math.min(20, path.split("/").filter(Boolean).length * 2);
}

export async function crawlPage(input: string, forcedKind?: PageKind): Promise<PageSnapshot> {
  const { response, finalUrl, responseTimeMs } = await fetchSafely(input);
  if (!response.ok) throw new CrawlError("URL_UNREACHABLE", `Page returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new CrawlError("NON_HTML_RESPONSE", "The URL did not return an HTML page.");

  const html = await readHtmlWithLimit(response);
  const htmlBytes = Buffer.byteLength(html, "utf8");
  const $ = cheerio.load(html);
  const title = normalizeText($("title").first().text()) || undefined;
  const description = normalizeText($("meta[name='description']").attr("content") || "") || undefined;
  const canonicalHref = $("link[rel='canonical']").attr("href");
  const canonical = canonicalHref ? new URL(canonicalHref, finalUrl).toString() : undefined;
  const language = normalizeText($("html").attr("lang") || "") || undefined;
  const robots = normalizeText($("meta[name='robots']").attr("content") || "") || undefined;
  const h1 = $("h1").map((_, element) => normalizeText($(element).text())).get().filter(Boolean);
  const h2 = $("h2").map((_, element) => normalizeText($(element).text())).get().filter(Boolean);
  const ctas = $("a,button").map((_, element) => {
    const node = $(element);
    const text = normalizeText(node.text());
    const className = node.attr("class") || "";
    const id = node.attr("id") || "";
    const tagName = String(node.prop("tagName") || "").toLowerCase();
    return looksLikeCta(text, className, id, tagName) ? text : "";
  }).get().filter(Boolean).slice(0, 100);
  const links = $("a[href]").map((_, element) => $(element).attr("href") || "").get().filter(Boolean).slice(0, 700);

  $("script,style,noscript,svg,template").remove();
  const text = normalizeText($("body").text());
  return {
    url: finalUrl.toString(), kind: forcedKind || classifyPage(finalUrl.toString()), statusCode: response.status, title, description, canonical, language, robots,
    h1, h2, text: text.slice(0, 50_000), links, ctas, wordCount: text ? text.split(/\s+/).length : 0, htmlBytes, responseTimeMs
  };
}

export async function crawlHomepage(input: string) { return crawlPage(input, "homepage"); }

function discoverCandidates(homepage: PageSnapshot) {
  const base = new URL(homepage.url);
  const unique = new Map<string, { url: string; score: number; kind: PageKind }>();
  for (const href of homepage.links) {
    let resolved: URL;
    try { resolved = new URL(href, base); } catch { continue; }
    if (!["http:", "https:"].includes(resolved.protocol)) continue;
    if (resolved.hostname !== base.hostname) continue;
    resolved.hash = "";
    resolved.search = "";
    if (resolved.pathname === base.pathname || resolved.pathname === "/") continue;
    const score = candidateScore(resolved);
    if (score < 0) continue;
    const key = resolved.toString().replace(/\/$/, "");
    const kind = classifyPage(resolved.toString());
    const current = unique.get(key);
    if (!current || score > current.score) unique.set(key, { url: resolved.toString(), score, kind });
  }
  return [...unique.values()].sort((a, b) => b.score - a.score);
}

export async function crawlMarketingSite(input: string, maxPages = DEFAULT_MAX_PAGES): Promise<SiteSnapshot> {
  const homepage = await crawlHomepage(input);
  const candidates = discoverCandidates(homepage);
  const selected: typeof candidates = [];
  const seenKinds = new Set<PageKind>();

  for (const candidate of candidates) {
    if (selected.length >= Math.max(0, maxPages - 1)) break;
    if (candidate.kind !== "other" && seenKinds.has(candidate.kind)) continue;
    selected.push(candidate);
    seenKinds.add(candidate.kind);
  }
  for (const candidate of candidates) {
    if (selected.length >= Math.max(0, maxPages - 1)) break;
    if (!selected.some((item) => item.url === candidate.url)) selected.push(candidate);
  }

  const pages: PageSnapshot[] = [homepage];
  const failedPages: SiteSnapshot["failedPages"] = [];
  for (let index = 0; index < selected.length; index += 2) {
    const batch = selected.slice(index, index + 2);
    const results = await Promise.all(batch.map(async (candidate) => {
      try { return { page: await crawlPage(candidate.url, candidate.kind), candidate }; }
      catch (error) { return { error, candidate }; }
    }));
    for (const result of results) {
      if ("page" in result && result.page) pages.push(result.page);
      else {
        const error = result.error;
        failedPages.push({ url: result.candidate.url, code: error instanceof CrawlError ? error.code : "UNKNOWN" });
      }
    }
  }

  return { homepage, pages, failedPages, discoveredCount: candidates.length };
}

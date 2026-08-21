import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";

export interface PageSnapshot {
  url: string;
  statusCode: number;
  title?: string;
  description?: string;
  h1: string[];
  h2: string[];
  text: string;
  links: string[];
  ctas: string[];
  wordCount: number;
}

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 0;
  }
  const value = ip.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
}

export async function assertSafeUrl(input: string) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https URLs are allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Custom ports are not allowed");
  const resolved = await dns.lookup(url.hostname, { all: true });
  if (!resolved.length || resolved.some(({ address }) => isPrivateIp(address))) throw new Error("Private/internal addresses are blocked");
  return url;
}

export async function crawlHomepage(input: string): Promise<PageSnapshot> {
  const url = await assertSafeUrl(input);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "user-agent": "PryoBot/0.1 (+website-audit)" } });
  if (!response.ok) throw new Error(`Homepage returned ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) throw new Error("URL is not an HTML page");
  const html = await response.text();
  if (html.length > 5_000_000) throw new Error("HTML exceeds crawl limit");
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const ctas = $("a,button").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 100);
  return {
    url: url.toString(),
    statusCode: response.status,
    title: $("title").first().text().trim() || undefined,
    description: $('meta[name="description"]').attr("content")?.trim(),
    h1: $("h1").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean),
    h2: $("h2").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean),
    text: text.slice(0, 40000),
    links: $("a[href]").map((_, el) => $(el).attr("href") || "").get().filter(Boolean).slice(0, 500),
    ctas,
    wordCount: text ? text.split(/\s+/).length : 0
  };
}

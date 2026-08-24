import type { Evidence, Finding, ProjectContext, RootCause } from "@pryo/domain";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ice(impact: number, confidence: number, ease: number) {
  return Math.round(clamp(impact, 1, 10) * clamp(confidence, 1, 10) * clamp(ease, 1, 10));
}

function priorityScore(iceScore: number, urgency = 1, unlock = 1) {
  return clamp(Math.round((clamp(iceScore, 0, 1000) / 1000) * 100 * urgency * unlock), 0, 100);
}

export interface MarketKeyword {
  keyword: string;
  targetPosition?: number;
  resultCount?: number;
  competitorCount?: number;
  competitiveDensity?: "low" | "medium" | "high";
}

export interface SearchCompetitor {
  domain: string;
  intersections: number;
  appearances: number;
  sharePct: number;
  avgPosition?: number;
  bestPosition?: number;
  queries: string[];
  sampleTitle?: string;
  sampleUrl?: string;
}

export interface KeywordGap {
  competitorDomain: string;
  keyword: string;
  competitorPosition?: number;
  resultUrl?: string;
}

export interface MarketIntelligenceResult {
  available: boolean;
  provider: "brave" | "unavailable";
  targetDomain: string;
  locationName: string;
  languageName: string;
  keywords: MarketKeyword[];
  competitors: SearchCompetitor[];
  gaps: KeywordGap[];
  queryCount: number;
  successfulQueries: number;
  fetchedAt: string;
  errorCode?: "NOT_CONFIGURED" | "PROVIDER_ERROR";
}

export interface MarketArtifacts {
  result: MarketIntelligenceResult;
  evidence: Evidence[];
  findings: Finding[];
  rootCauses: RootCause[];
}

interface BraveWebResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
  domain: string;
  position: number;
}

interface QueryRun {
  query: string;
  results: SearchResult[];
  ok: boolean;
}

const NOISE_DOMAINS = [
  "youtube.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "wikipedia.org",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "medium.com",
  "quora.com",
  "github.com"
];

function cleanPhrase(value: string | undefined, max = 76) {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[|•]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, "")
    .trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function configuration() {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  const rawCountry = process.env.BRAVE_COUNTRY?.trim().toUpperCase() || "US";
  const country = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : "US";
  const rawLanguage = process.env.BRAVE_SEARCH_LANG?.trim().toLowerCase() || "en";
  const searchLang = /^[a-z]{2,5}$/.test(rawLanguage) ? rawLanguage : "en";
  return { apiKey, country, searchLang };
}

function targetDomain(url: string) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

function domainFromUrl(url: string) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return undefined; }
}

function sameDomain(candidate: string, target: string) {
  return candidate === target || candidate.endsWith(`.${target}`);
}

function isNoiseDomain(domain: string) {
  return NOISE_DOMAINS.some((noise) => domain === noise || domain.endsWith(`.${noise}`));
}

function addQuery(list: string[], value: string | undefined) {
  const query = cleanPhrase(value, 150);
  if (!query || query.length < 3) return;
  if (list.some((existing) => existing.toLowerCase() === query.toLowerCase())) return;
  list.push(query);
}

function buildQueries(project: ProjectContext) {
  const queries: string[] = [];
  const category = cleanPhrase(project.category);
  const product = cleanPhrase(project.product);
  const audience = cleanPhrase(project.targetAudience[0], 60);

  if (category) {
    addQuery(queries, category);
    addQuery(queries, `best ${category}`);
    if (!/\b(software|platform|tool|tools|app|apps)\b/i.test(category)) addQuery(queries, `${category} software`);
    addQuery(queries, `${category} tools`);
    if (audience) addQuery(queries, `${category} for ${audience}`);
  }

  if (queries.length < 4 && product) {
    addQuery(queries, product);
    addQuery(queries, `best ${product}`);
    if (audience) addQuery(queries, `${product} for ${audience}`);
  }

  if (queries.length < 4 && audience) {
    addQuery(queries, `software for ${audience}`);
    addQuery(queries, `tools for ${audience}`);
  }

  // The sample is intentionally small to keep MVP costs predictable.
  return queries.slice(0, 6);
}

async function braveSearch(query: string, country: string, searchLang: string): Promise<SearchResult[]> {
  const config = configuration();
  if (!config.apiKey) throw new Error("Brave Search API key is not configured");

  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", "10");
  endpoint.searchParams.set("country", country);
  endpoint.searchParams.set("search_lang", searchLang);

  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: "application/json",
      "X-Subscription-Token": config.apiKey
    }
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}`);

  let data: BraveSearchResponse;
  try { data = JSON.parse(raw) as BraveSearchResponse; }
  catch { throw new Error("Brave Search returned invalid JSON"); }

  const rows = Array.isArray(data.web?.results) ? data.web?.results || [] : [];
  const results: SearchResult[] = [];

  rows.slice(0, 10).forEach((item, index) => {
    const url = typeof item.url === "string" ? item.url : "";
    const domain = domainFromUrl(url);
    if (!url || !domain) return;
    results.push({
      title: typeof item.title === "string" ? item.title : domain,
      url,
      description: typeof item.description === "string" ? item.description : "",
      domain,
      position: index + 1
    });
  });

  return results;
}

function competitiveDensity(competitorCount: number): "low" | "medium" | "high" {
  if (competitorCount >= 7) return "high";
  if (competitorCount >= 4) return "medium";
  return "low";
}

function buildMarketData(target: string, runs: QueryRun[]) {
  const successful = runs.filter((run) => run.ok);
  const keywords: MarketKeyword[] = [];
  const competitorMap = new Map<string, {
    positions: number[];
    queries: Set<string>;
    sampleTitle?: string;
    sampleUrl?: string;
  }>();

  for (const run of successful) {
    const targetResult = run.results.find((result) => sameDomain(result.domain, target));
    const queryCompetitors = new Set<string>();

    for (const result of run.results) {
      if (sameDomain(result.domain, target) || isNoiseDomain(result.domain)) continue;
      queryCompetitors.add(result.domain);

      const current: { positions: number[]; queries: Set<string>; sampleTitle?: string; sampleUrl?: string } =
        competitorMap.get(result.domain) || { positions: [], queries: new Set<string>() };
      current.positions.push(result.position);
      current.queries.add(run.query);
      current.sampleTitle ||= result.title;
      current.sampleUrl ||= result.url;
      competitorMap.set(result.domain, current);
    }

    keywords.push({
      keyword: run.query,
      targetPosition: targetResult?.position,
      resultCount: run.results.length,
      competitorCount: queryCompetitors.size,
      competitiveDensity: competitiveDensity(queryCompetitors.size)
    });
  }

  const totalSuccessful = Math.max(1, successful.length);
  const competitors: SearchCompetitor[] = [...competitorMap.entries()]
    .map(([domain, data]) => {
      const appearances = data.queries.size;
      const avgPosition = data.positions.length
        ? Math.round((data.positions.reduce((sum, value) => sum + value, 0) / data.positions.length) * 10) / 10
        : undefined;
      return {
        domain,
        intersections: appearances,
        appearances,
        sharePct: Math.round((appearances / totalSuccessful) * 100),
        avgPosition,
        bestPosition: data.positions.length ? Math.min(...data.positions) : undefined,
        queries: [...data.queries].slice(0, 6),
        sampleTitle: data.sampleTitle,
        sampleUrl: data.sampleUrl
      };
    })
    .sort((a, b) => b.appearances - a.appearances || (a.bestPosition || 99) - (b.bestPosition || 99))
    .slice(0, 6);

  const gaps: KeywordGap[] = [];
  for (const run of successful) {
    const targetPresent = run.results.some((result) => sameDomain(result.domain, target));
    if (targetPresent) continue;

    const competitor = run.results.find(
      (result) => result.position <= 5 && !sameDomain(result.domain, target) && !isNoiseDomain(result.domain)
    );
    if (!competitor) continue;

    gaps.push({
      competitorDomain: competitor.domain,
      keyword: run.query,
      competitorPosition: competitor.position,
      resultUrl: competitor.url
    });
  }

  return { keywords, competitors, gaps };
}

function evidenceArtifacts(
  auditId: string,
  result: MarketIntelligenceResult
): Evidence[] {
  if (!result.available) return [];

  const targetAppearances = result.keywords.filter((item) => item.targetPosition !== undefined).length;
  const evidence: Evidence[] = [{
    id: `${auditId}:market:serp:evidence`,
    type: "measured",
    sourceProvider: "brave_search",
    observedAt: result.fetchedAt,
    reliability: 0.76,
    excerpt: `Pryo sampled ${result.successfulQueries} commercial search intents. ${result.targetDomain} appeared in the top 10 for ${targetAppearances}/${result.successfulQueries} successful queries.`,
    data: {
      provider: "brave",
      country: result.locationName,
      searchLang: result.languageName,
      querySignals: result.keywords
    }
  }];

  if (result.competitors.length) {
    evidence.push({
      id: `${auditId}:market:competitors:evidence`,
      type: "measured",
      sourceProvider: "brave_search",
      observedAt: result.fetchedAt,
      reliability: 0.74,
      excerpt: `Recurring SERP domains include ${result.competitors.slice(0, 5).map((item) => `${item.domain} (${item.appearances}/${result.successfulQueries} sampled intents)`).join(" | ")}.`,
      data: { competitors: result.competitors }
    });
  }

  if (result.gaps.length) {
    evidence.push({
      id: `${auditId}:market:gaps:evidence`,
      type: "measured",
      sourceProvider: "brave_search",
      observedAt: result.fetchedAt,
      reliability: 0.72,
      excerpt: `The target domain was absent from the top 10 for ${result.gaps.length} sampled commercial intents where another non-platform domain appeared in the top 5.`,
      data: { gaps: result.gaps }
    });
  }

  return evidence;
}

function marketFindings(
  auditId: string,
  result: MarketIntelligenceResult
): { findings: Finding[]; rootCauses: RootCause[] } {
  if (!result.available || result.successfulQueries === 0 || result.gaps.length === 0) {
    return { findings: [], rootCauses: [] };
  }

  const gapRatio = result.gaps.length / result.successfulQueries;
  if (gapRatio < 0.5) return { findings: [], rootCauses: [] };

  const now = result.fetchedAt;
  const impact = gapRatio >= 0.75 ? 8 : 7;
  const confidence = 7;
  const ease = 5;
  const iceScore = ice(impact, confidence, ease);
  const priority = priorityScore(iceScore, 1, 1.1);
  const findingId = `${auditId}:market:serp-coverage:finding`;
  const evidenceIds = [
    `${auditId}:market:serp:evidence`,
    ...(result.gaps.length ? [`${auditId}:market:gaps:evidence`] : [])
  ];

  const action = "Validate the sampled commercial intents against product fit, then strengthen or create only the pages that address strategically relevant gaps.";
  const validation = "Re-run the same SERP sample after changes and track whether relevant pages begin appearing for the selected intents; later validate qualified organic traffic with first-party analytics.";

  const finding: Finding = {
    id: findingId,
    auditId,
    area: "market",
    code: "MARKET_SERP_COVERAGE_GAP",
    title: "The site is absent from many sampled commercial search intents",
    description: `Pryo found the target outside the top 10 for ${result.gaps.length}/${result.successfulQueries} successful commercial SERP samples. This is a directional visibility signal, not search-volume evidence and not proof that every sampled query deserves a page.`,
    status: gapRatio >= 0.75 ? "important" : "improve",
    decision: "validate",
    evidenceIds,
    recommendation: {
      id: `${auditId}:market:serp-coverage:recommendation`,
      title: "Validate the most relevant search-intent gaps.",
      action,
      validation,
      dependencies: [],
      affectedKpis: ["organic_visibility", "qualified_organic_traffic"],
      estimatedEffort: "m",
      timeToSignal: "4–12 weeks"
    },
    scores: {
      impact,
      confidence,
      ease,
      ice: iceScore,
      urgency: 1,
      unlock: 1.1,
      priority
    },
    affectedKpis: ["organic_visibility", "qualified_organic_traffic"],
    dependencies: [],
    expectedOutcome: "Increase presence across strategically relevant commercial search intents without treating SERP sampling as guaranteed demand.",
    timeToSignal: "4–12 weeks",
    validationMethod: validation,
    createdAt: now
  };

  const root: RootCause = {
    id: `${auditId}:root:search-market-coverage`,
    area: "market",
    title: "Search market coverage",
    description: "Repeated absence across sampled commercial SERPs suggests a market-visibility constraint worth validating before broader content expansion.",
    findingIds: [findingId],
    evidenceIds,
    decision: "validate",
    status: finding.status,
    confidence: 72,
    priority: Math.min(100, priority + 5),
    action,
    validation,
    timeToSignal: "4–12 weeks"
  };

  return { findings: [finding], rootCauses: [root] };
}

export async function runMarketIntelligence(
  auditId: string,
  project: ProjectContext
): Promise<MarketArtifacts> {
  const config = configuration();
  const domain = targetDomain(project.canonicalUrl);
  const fetchedAt = new Date().toISOString();
  const queries = buildQueries(project);

  const unavailable = (
    errorCode: "NOT_CONFIGURED" | "PROVIDER_ERROR",
    keywords: MarketKeyword[] = [],
    competitors: SearchCompetitor[] = [],
    gaps: KeywordGap[] = [],
    successfulQueries = 0
  ): MarketArtifacts => ({
    result: {
      available: false,
      provider: errorCode === "NOT_CONFIGURED" ? "unavailable" : "brave",
      targetDomain: domain,
      locationName: config.country,
      languageName: config.searchLang,
      keywords,
      competitors,
      gaps,
      queryCount: queries.length,
      successfulQueries,
      fetchedAt,
      errorCode
    },
    evidence: [],
    findings: [],
    rootCauses: []
  });

  if (!config.apiKey) return unavailable("NOT_CONFIGURED");
  if (queries.length < 2) return unavailable("PROVIDER_ERROR");

  const runs: QueryRun[] = await Promise.all(
    queries.map(async (query) => {
      try {
        const results = await braveSearch(query, config.country, config.searchLang);
        return { query, results, ok: results.length > 0 };
      } catch {
        return { query, results: [], ok: false };
      }
    })
  );

  const successfulQueries = runs.filter((run) => run.ok).length;
  const data = buildMarketData(domain, runs);
  const minimumSuccessful = Math.max(2, Math.ceil(queries.length * 0.5));

  if (successfulQueries < minimumSuccessful) {
    return unavailable("PROVIDER_ERROR", data.keywords, data.competitors, data.gaps, successfulQueries);
  }

  const result: MarketIntelligenceResult = {
    available: true,
    provider: "brave",
    targetDomain: domain,
    locationName: config.country,
    languageName: config.searchLang,
    keywords: data.keywords,
    competitors: data.competitors,
    gaps: data.gaps,
    queryCount: queries.length,
    successfulQueries,
    fetchedAt
  };

  const evidence = evidenceArtifacts(auditId, result);
  const decision = marketFindings(auditId, result);
  return { result, evidence, findings: decision.findings, rootCauses: decision.rootCauses };
}

import type { Evidence, Finding, RootCause } from "@pryo/domain";

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
  searchVolume?: number;
  cpc?: number;
  competition?: string;
  competitionIndex?: number;
  monthlyTrendPct?: number;
}

export interface SearchCompetitor {
  domain: string;
  intersections: number;
  avgPosition?: number;
  organicKeywords?: number;
  organicEtv?: number;
}

export interface KeywordGap {
  competitorDomain: string;
  keyword: string;
  searchVolume?: number;
  cpc?: number;
  competitorPosition?: number;
}

export interface MarketIntelligenceResult {
  available: boolean;
  provider: "dataforseo" | "unavailable";
  targetDomain: string;
  locationName: string;
  languageName: string;
  keywords: MarketKeyword[];
  competitors: SearchCompetitor[];
  gaps: KeywordGap[];
  fetchedAt: string;
  errorCode?: "NOT_CONFIGURED" | "PROVIDER_ERROR";
}

export interface MarketArtifacts {
  result: MarketIntelligenceResult;
  evidence: Evidence[];
  findings: Finding[];
  rootCauses: RootCause[];
}

interface DataForSeoResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: unknown[];
  }>;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function configuration() {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  const locationName = process.env.DATAFORSEO_LOCATION_NAME?.trim() || "United States";
  const languageName = process.env.DATAFORSEO_LANGUAGE_NAME?.trim() || "English";
  return { login, password, locationName, languageName };
}

function targetDomain(url: string) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

function monthlyTrendPct(monthlySearches: unknown): number | undefined {
  if (!Array.isArray(monthlySearches)) return undefined;
  const values = monthlySearches
    .map((item) => numberOrUndefined((item as Record<string, unknown>)?.search_volume))
    .filter((value): value is number => value !== undefined);
  if (values.length < 2) return undefined;
  const newest = values[0];
  const oldest = values[values.length - 1];
  if (oldest <= 0) return undefined;
  return Math.round(((newest - oldest) / oldest) * 100);
}

async function postDataForSeo(path: string, payload: Record<string, unknown>) {
  const config = configuration();
  if (!config.login || !config.password) throw new Error("DataForSEO credentials are not configured");

  const response = await fetch(`https://api.dataforseo.com${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Basic ${Buffer.from(`${config.login}:${config.password}`).toString("base64")}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify([payload])
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`DataForSEO returned HTTP ${response.status}`);

  let data: DataForSeoResponse;
  try { data = JSON.parse(raw) as DataForSeoResponse; }
  catch { throw new Error("DataForSEO returned invalid JSON"); }

  if (data.status_code !== 20000) {
    throw new Error(data.status_message || `DataForSEO request failed (${data.status_code || "unknown"})`);
  }

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(task?.status_message || `DataForSEO task failed (${task?.status_code || "unknown"})`);
  }

  return {
    result: task.result || [],
    costUsd: (numberOrUndefined(data.cost) || 0) + (numberOrUndefined(task.cost) || 0)
  };
}

async function fetchDemand(domain: string, locationName: string, languageName: string) {
  const response = await postDataForSeo("/v3/keywords_data/google_ads/keywords_for_site/live", {
    target: domain,
    target_type: "site",
    location_name: locationName,
    language_name: languageName,
    sort_by: "search_volume",
    include_adult_keywords: false
  });

  const keywords = response.result
    .map((raw) => raw as Record<string, unknown>)
    .map((item): MarketKeyword | undefined => {
      const keyword = stringOrUndefined(item.keyword);
      if (!keyword) return undefined;
      return {
        keyword,
        searchVolume: numberOrUndefined(item.search_volume),
        cpc: numberOrUndefined(item.cpc),
        competition: stringOrUndefined(item.competition),
        competitionIndex: numberOrUndefined(item.competition_index),
        monthlyTrendPct: monthlyTrendPct(item.monthly_searches)
      };
    })
    .filter((item): item is MarketKeyword => Boolean(item))
    .sort((a, b) => (b.searchVolume || 0) - (a.searchVolume || 0))
    .slice(0, 20);

  return { keywords, costUsd: response.costUsd };
}

async function fetchCompetitors(domain: string, locationName: string, languageName: string) {
  const response = await postDataForSeo("/v3/dataforseo_labs/google/competitors_domain/live", {
    target: domain,
    location_name: locationName,
    language_name: languageName,
    item_types: ["organic"],
    exclude_top_domains: true,
    exclude_domains: [domain],
    max_rank_group: 20,
    limit: 8,
    order_by: ["metrics.organic.count,desc"]
  });

  const first = response.result[0] as Record<string, unknown> | undefined;
  const items = Array.isArray(first?.items) ? first.items : [];
  const competitors = items
    .map((raw) => raw as Record<string, unknown>)
    .map((item): SearchCompetitor | undefined => {
      const competitorDomain = stringOrUndefined(item.domain);
      if (!competitorDomain || competitorDomain === domain) return undefined;
      const fullDomainMetrics = item.full_domain_metrics as Record<string, unknown> | undefined;
      const organic = fullDomainMetrics?.organic as Record<string, unknown> | undefined;
      return {
        domain: competitorDomain,
        intersections: numberOrUndefined(item.intersections) || 0,
        avgPosition: numberOrUndefined(item.avg_position),
        organicKeywords: numberOrUndefined(organic?.count),
        organicEtv: numberOrUndefined(organic?.etv)
      };
    })
    .filter((item): item is SearchCompetitor => Boolean(item))
    .slice(0, 5);

  return { competitors, costUsd: response.costUsd };
}

async function fetchGaps(domain: string, competitors: SearchCompetitor[], locationName: string, languageName: string) {
  const gaps: KeywordGap[] = [];
  let costUsd = 0;

  for (const competitor of competitors.slice(0, 2)) {
    try {
      const response = await postDataForSeo("/v3/dataforseo_labs/google/domain_intersection/live", {
        target1: competitor.domain,
        target2: domain,
        location_name: locationName,
        language_name: languageName,
        intersections: false,
        item_types: ["organic"],
        limit: 10,
        order_by: ["keyword_data.keyword_info.search_volume,desc"]
      });
      costUsd += response.costUsd;
      const first = response.result[0] as Record<string, unknown> | undefined;
      const items = Array.isArray(first?.items) ? first.items : [];
      for (const raw of items) {
        const item = raw as Record<string, unknown>;
        const keywordData = item.keyword_data as Record<string, unknown> | undefined;
        const keywordInfo = keywordData?.keyword_info as Record<string, unknown> | undefined;
        const firstSerp = item.first_domain_serp_element as Record<string, unknown> | undefined;
        const keyword = stringOrUndefined(keywordData?.keyword);
        if (!keyword) continue;
        gaps.push({
          competitorDomain: competitor.domain,
          keyword,
          searchVolume: numberOrUndefined(keywordInfo?.search_volume),
          cpc: numberOrUndefined(keywordInfo?.cpc),
          competitorPosition: numberOrUndefined(firstSerp?.rank_group) || numberOrUndefined(firstSerp?.rank_absolute)
        });
      }
    } catch {
      // Keep the rest of the market audit usable if one competitor gap call fails.
    }
  }

  const deduped = [...new Map(
    gaps
      .sort((a, b) => (b.searchVolume || 0) - (a.searchVolume || 0))
      .map((gap) => [`${gap.competitorDomain}:${gap.keyword.toLowerCase()}`, gap])
  ).values()].slice(0, 15);

  return { gaps: deduped, costUsd };
}

function evidenceArtifacts(auditId: string, result: MarketIntelligenceResult): Evidence[] {
  if (!result.available) return [];
  const observedAt = result.fetchedAt;
  const evidence: Evidence[] = [];

  if (result.keywords.length) {
    evidence.push({
      id: `${auditId}:market:demand:evidence`,
      type: "measured",
      sourceProvider: "dataforseo_google_ads",
      observedAt,
      reliability: 0.82,
      excerpt: `Top observed demand terms include ${result.keywords.slice(0, 5).map((item) => `${item.keyword}${item.searchVolume === undefined ? "" : ` (${item.searchVolume}/mo)`}`).join(" | ")}.`,
      data: { locationName: result.locationName, languageName: result.languageName, keywords: result.keywords }
    });
  }

  if (result.competitors.length) {
    evidence.push({
      id: `${auditId}:market:competitors:evidence`,
      type: "measured",
      sourceProvider: "dataforseo_labs",
      observedAt,
      reliability: 0.84,
      excerpt: `Search-overlap competitors: ${result.competitors.map((item) => `${item.domain} (${item.intersections} shared keywords)`).join(" | ")}.`,
      data: { locationName: result.locationName, languageName: result.languageName, competitors: result.competitors }
    });
  }

  if (result.gaps.length) {
    evidence.push({
      id: `${auditId}:market:gaps:evidence`,
      type: "measured",
      sourceProvider: "dataforseo_labs",
      observedAt,
      reliability: 0.8,
      excerpt: `Competitor-owned keyword gaps detected: ${result.gaps.slice(0, 6).map((item) => `${item.keyword}${item.searchVolume === undefined ? "" : ` (${item.searchVolume}/mo)`}`).join(" | ")}.`,
      data: { locationName: result.locationName, languageName: result.languageName, gaps: result.gaps }
    });
  }

  return evidence;
}

function marketFindings(auditId: string, result: MarketIntelligenceResult): Finding[] {
  if (!result.available || !result.gaps.length) return [];
  const now = result.fetchedAt;
  const evidenceId = `${auditId}:market:gaps:evidence`;
  const searchVolumeKnown = result.gaps.filter((gap) => gap.searchVolume !== undefined);
  const topGapVolume = Math.max(0, ...searchVolumeKnown.map((gap) => gap.searchVolume || 0));
  const impact = topGapVolume >= 10_000 ? 8 : topGapVolume >= 1_000 ? 7 : 6;
  const confidence = 8;
  const ease = 5;
  const iceScore = ice(impact, confidence, ease);

  return [{
    id: `${auditId}:market:keyword-gap:finding`,
    auditId,
    area: "market",
    code: "MARKET_COMPETITOR_KEYWORD_GAPS",
    title: "Competitors capture search demand the site may not cover",
    description: `Pryo found ${result.gaps.length} high-priority search terms where sampled competitors rank and the audited domain does not appear in the same dataset. This is an opportunity signal, not proof that every term should become a page.`,
    status: "important",
    decision: "validate",
    evidenceIds: [evidenceId],
    recommendation: {
      id: `${auditId}:market:keyword-gap:recommendation`,
      title: "Validate the highest-value search gaps against product fit and buyer intent.",
      action: "Review the top competitor-owned terms, cluster them by buyer problem and map only the strategically relevant clusters to existing or new pages.",
      validation: "Confirm product relevance and search intent before creating content; then track rankings, qualified organic visits and assisted conversions for the selected cluster.",
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
      priority: priorityScore(iceScore, 1, 1.1)
    },
    affectedKpis: ["organic_visibility", "qualified_organic_traffic"],
    dependencies: [],
    expectedOutcome: "Expand relevant search coverage without treating raw keyword volume as guaranteed business demand.",
    timeToSignal: "4–12 weeks",
    validationMethod: "Validate intent and product fit, publish or improve the selected page cluster, then measure rankings and qualified organic traffic.",
    createdAt: now
  }];
}

export async function runMarketIntelligence(auditId: string, url: string): Promise<MarketArtifacts> {
  const config = configuration();
  const domain = targetDomain(url);
  const fetchedAt = new Date().toISOString();

  if (!config.login || !config.password) {
    return {
      result: {
        available: false,
        provider: "unavailable",
        targetDomain: domain,
        locationName: config.locationName,
        languageName: config.languageName,
        keywords: [],
        competitors: [],
        gaps: [],
        fetchedAt,
        errorCode: "NOT_CONFIGURED"
      },
      evidence: [],
      findings: [],
      rootCauses: []
    };
  }

  const [demandAttempt, competitorAttempt] = await Promise.allSettled([
    fetchDemand(domain, config.locationName, config.languageName),
    fetchCompetitors(domain, config.locationName, config.languageName)
  ]);

  const demand = demandAttempt.status === "fulfilled" ? demandAttempt.value : { keywords: [], costUsd: 0 };
  const competitorData = competitorAttempt.status === "fulfilled" ? competitorAttempt.value : { competitors: [], costUsd: 0 };
  const gapData = competitorData.competitors.length
    ? await fetchGaps(domain, competitorData.competitors, config.locationName, config.languageName)
    : { gaps: [], costUsd: 0 };

  const available = Boolean(demand.keywords.length || competitorData.competitors.length || gapData.gaps.length);
  const result: MarketIntelligenceResult = {
    available,
    provider: "dataforseo",
    targetDomain: domain,
    locationName: config.locationName,
    languageName: config.languageName,
    keywords: demand.keywords,
    competitors: competitorData.competitors,
    gaps: gapData.gaps,
    fetchedAt,
    errorCode: available ? undefined : "PROVIDER_ERROR"
  };
  const evidence = evidenceArtifacts(auditId, result);
  const findings = marketFindings(auditId, result);
  const rootCauses: RootCause[] = findings.map((finding) => ({
    id: `${auditId}:root:market_capture`,
    area: "market",
    title: "Uncaptured search demand",
    description: finding.description,
    findingIds: [finding.id],
    evidenceIds: finding.evidenceIds,
    decision: finding.decision,
    status: finding.status,
    confidence: finding.scores.confidence * 10,
    priority: finding.scores.priority,
    action: finding.recommendation?.action || "Validate the market opportunity.",
    validation: finding.recommendation?.validation || finding.validationMethod || "Validate the market opportunity before acting.",
    timeToSignal: finding.timeToSignal
  }));
  const rootedFindings = findings.map((finding) => rootCauses[0] ? { ...finding, rootCauseId: rootCauses[0].id } : finding);
  return { result, evidence, findings: rootedFindings, rootCauses };
}

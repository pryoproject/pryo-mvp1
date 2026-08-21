import type { AuditCheck, Evidence, Finding } from "@pryo/domain";
import { ice, priorityScore } from "@pryo/scoring";

export interface PageSpeedLabResult {
  available: boolean;
  performanceScore?: number;
  lcpMs?: number;
  cls?: number;
  tbtMs?: number;
  fetchedAt: string;
  error?: string;
}

export interface PerformanceArtifacts {
  result: PageSpeedLabResult;
  checks: AuditCheck[];
  evidence: Evidence[];
  findings: Finding[];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function fetchPageSpeedLab(url: string): Promise<PageSpeedLabResult> {
  const fetchedAt = new Date().toISOString();
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.append("category", "performance");
  if (process.env.PAGESPEED_API_KEY) endpoint.searchParams.set("key", process.env.PAGESPEED_API_KEY);

  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(45_000), headers: { accept: "application/json" } });
    if (!response.ok) return { available: false, fetchedAt, error: `PageSpeed returned HTTP ${response.status}` };
    const data = await response.json() as any;
    const audits = data?.lighthouseResult?.audits || {};
    const categoryScore = finiteNumber(data?.lighthouseResult?.categories?.performance?.score);
    const performanceScore = categoryScore === undefined ? undefined : Math.round(categoryScore * 100);
    const lcpMs = finiteNumber(audits?.["largest-contentful-paint"]?.numericValue);
    const cls = finiteNumber(audits?.["cumulative-layout-shift"]?.numericValue);
    const tbtMs = finiteNumber(audits?.["total-blocking-time"]?.numericValue);
    if (performanceScore === undefined && lcpMs === undefined && cls === undefined && tbtMs === undefined) {
      return { available: false, fetchedAt, error: "PageSpeed returned no usable Lighthouse metrics" };
    }
    return { available: true, performanceScore, lcpMs, cls, tbtMs, fetchedAt };
  } catch (error) {
    return { available: false, fetchedAt, error: error instanceof Error ? error.message : "PageSpeed request failed" };
  }
}

function makeIds(auditId: string, code: string) {
  const slug = code.toLowerCase();
  return { evidenceId: `${auditId}:${slug}:evidence`, checkId: `${auditId}:${slug}:check`, findingId: `${auditId}:${slug}:finding`, recommendationId: `${auditId}:${slug}:recommendation` };
}

function findingForMetric(auditId: string, input: {
  code: string; title: string; description: string; value: number; evidence: string; score: number; passed: boolean; confidence: number;
  impact: number; ease: number; recommendation: string; validation: string; kpis: string[]; timeToSignal: string;
}): { check: AuditCheck; evidence: Evidence; finding?: Finding } {
  const ids = makeIds(auditId, input.code);
  const observedAt = new Date().toISOString();
  const evidence: Evidence = {
    id: ids.evidenceId, type: "measured", sourceProvider: "google_pagespeed_lighthouse", observedAt, reliability: input.confidence,
    excerpt: input.evidence, data: { value: input.value, strategy: "mobile", source: "Lighthouse lab" }
  };
  const check: AuditCheck = {
    id: ids.checkId, code: input.code, area: "performance", label: input.title, passed: input.passed, score: input.score,
    confidence: input.confidence, weight: 1, evidenceIds: [ids.evidenceId], metadata: { strategy: "mobile", source: "pagespeed_lab" }
  };
  if (input.passed) return { check, evidence };

  const confidence10 = Math.round(input.confidence * 10);
  const iceScore = ice(input.impact, confidence10, input.ease);
  const finding: Finding = {
    id: ids.findingId, auditId, area: "performance", code: input.code, title: input.title, description: input.description,
    status: input.score < 45 ? "important" : "improve", decision: "validate", evidenceIds: [ids.evidenceId],
    recommendation: {
      id: ids.recommendationId, title: input.recommendation, action: input.recommendation, validation: input.validation,
      dependencies: [], affectedKpis: input.kpis, estimatedEffort: input.ease >= 8 ? "s" : input.ease >= 5 ? "m" : "l", timeToSignal: input.timeToSignal
    },
    scores: { impact: input.impact, confidence: confidence10, ease: input.ease, ice: iceScore, urgency: 1, unlock: 1, priority: priorityScore(iceScore) },
    affectedKpis: input.kpis, dependencies: [], expectedOutcome: "Improve measured mobile loading or interaction performance without assuming a guaranteed conversion uplift.",
    timeToSignal: input.timeToSignal, validationMethod: input.validation, createdAt: observedAt
  };
  return { check, evidence, finding };
}

export async function runPerformanceAudit(auditId: string, url: string): Promise<PerformanceArtifacts> {
  const result = await fetchPageSpeedLab(url);
  const checks: AuditCheck[] = [];
  const evidence: Evidence[] = [];
  const findings: Finding[] = [];
  if (!result.available) return { result, checks, evidence, findings };

  if (result.performanceScore !== undefined) {
    const ids = makeIds(auditId, "PERF_LIGHTHOUSE_SCORE");
    evidence.push({
      id: ids.evidenceId, type: "measured", sourceProvider: "google_pagespeed_lighthouse", sourceUrl: url, observedAt: result.fetchedAt,
      reliability: 0.85, excerpt: `Mobile Lighthouse performance score: ${result.performanceScore}/100.`, data: { score: result.performanceScore, strategy: "mobile" }
    });
    checks.push({
      id: ids.checkId, code: "PERF_LIGHTHOUSE_SCORE", area: "performance", label: "Mobile Lighthouse performance", passed: result.performanceScore >= 90,
      score: result.performanceScore, confidence: 0.85, weight: 1.2, evidenceIds: [ids.evidenceId], metadata: { strategy: "mobile" }
    });
  }

  const metrics = [
    result.lcpMs === undefined ? undefined : findingForMetric(auditId, {
      code: "PERF_LCP_LAB", title: "Largest Contentful Paint", description: "The mobile lab test indicates the main content may appear later than recommended.",
      value: result.lcpMs, evidence: `Mobile Lighthouse LCP: ${(result.lcpMs / 1000).toFixed(2)}s.`, passed: result.lcpMs <= 2500,
      score: result.lcpMs <= 2500 ? 100 : result.lcpMs <= 4000 ? 60 : 30, confidence: 0.82, impact: 8, ease: 5,
      recommendation: "Inspect the LCP element and reduce the work or transfer blocking its render before making broader performance changes.",
      validation: "Re-run mobile PageSpeed after remediation and compare LCP under the same test conditions.", kpis: ["page_speed", "conversion_rate"], timeToSignal: "Immediate"
    }),
    result.cls === undefined ? undefined : findingForMetric(auditId, {
      code: "PERF_CLS_LAB", title: "Cumulative Layout Shift", description: "The mobile lab test detected visual instability during page load.",
      value: result.cls, evidence: `Mobile Lighthouse CLS: ${result.cls.toFixed(3)}.`, passed: result.cls <= 0.1,
      score: result.cls <= 0.1 ? 100 : result.cls <= 0.25 ? 60 : 30, confidence: 0.82, impact: 7, ease: 6,
      recommendation: "Identify shifting elements and reserve layout space for media, embeds and late-loading interface components.",
      validation: "Re-run mobile PageSpeed and confirm CLS improves under the same test conditions.", kpis: ["page_speed", "engagement"], timeToSignal: "Immediate"
    }),
    result.tbtMs === undefined ? undefined : findingForMetric(auditId, {
      code: "PERF_TBT_LAB", title: "Total Blocking Time", description: "The mobile lab test indicates main-thread work may delay responsiveness.",
      value: result.tbtMs, evidence: `Mobile Lighthouse Total Blocking Time: ${Math.round(result.tbtMs)}ms.`, passed: result.tbtMs <= 200,
      score: result.tbtMs <= 200 ? 100 : result.tbtMs <= 600 ? 60 : 30, confidence: 0.78, impact: 6, ease: 5,
      recommendation: "Profile long main-thread tasks and reduce or defer expensive JavaScript before pursuing generic optimization work.",
      validation: "Re-run mobile PageSpeed and compare Total Blocking Time after changes.", kpis: ["page_speed", "engagement"], timeToSignal: "Immediate"
    })
  ].filter(Boolean) as Array<ReturnType<typeof findingForMetric>>;

  for (const metric of metrics) {
    metric.evidence.sourceUrl = url;
    checks.push(metric.check); evidence.push(metric.evidence); if (metric.finding) findings.push(metric.finding);
  }

  const healthy = result.performanceScore !== undefined && result.performanceScore >= 90 && (result.lcpMs ?? 0) <= 2500 && (result.cls ?? 0) <= 0.1 && (result.tbtMs ?? 0) <= 200;
  if (healthy) {
    const ids = makeIds(auditId, "PERF_MOBILE_HEALTHY");
    evidence.push({ id: ids.evidenceId, type: "measured", sourceProvider: "google_pagespeed_lighthouse", sourceUrl: url, observedAt: result.fetchedAt, reliability: 0.82, excerpt: "Mobile Lighthouse metrics are within Pryo's healthy lab thresholds.", data: { performanceScore: result.performanceScore, lcpMs: result.lcpMs, cls: result.cls, tbtMs: result.tbtMs } });
    findings.push({
      id: ids.findingId, auditId, area: "performance", code: "PERF_MOBILE_HEALTHY", title: "Mobile lab performance is a strength", description: "The current mobile Lighthouse run is healthy across the measured performance signals. Preserve this during major frontend changes.",
      status: "strong", decision: "preserve", evidenceIds: [ids.evidenceId], scores: { impact: 0, confidence: 8, ease: 0, ice: 0, urgency: 1, unlock: 1, priority: 0 },
      affectedKpis: ["page_speed"], dependencies: [], expectedOutcome: "Preserve current mobile performance characteristics during future changes.", createdAt: result.fetchedAt
    });
  }

  return { result, checks, evidence, findings };
}

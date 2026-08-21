import { analyzeSiteWithAI, verifyAssessmentEvidence, type SiteIntelligence } from "@pryo/ai";
import { runSiteChecks } from "@pryo/audit-engine";
import { crawlMarketingSite, type PageSnapshot, type SiteSnapshot } from "@pryo/crawler";
import { AuditReportSchema, type AuditArea, type AuditCheck, type CategoryScore, type Evidence, type Finding, type ProjectContext, type RootCause } from "@pryo/domain";
import { runPerformanceAudit } from "@pryo/performance";
import { ice, priorityScore, weightedConfidence, weightedHealth } from "@pryo/scoring";

export type ProgressCallback = (stage: string, progress: number) => Promise<void> | void;

const dimensionLabels: Record<string, string> = {
  audience_clarity: "Audience clarity",
  offer_clarity: "Offer clarity",
  outcome_clarity: "Outcome clarity",
  differentiation: "Differentiation",
  proof: "Proof and trust"
};

const dimensionEffects: Record<string, string[]> = {
  audience_clarity: ["message_match", "conversion_rate"],
  offer_clarity: ["conversion_rate"],
  outcome_clarity: ["conversion_rate", "engagement"],
  differentiation: ["conversion_rate", "competitive_win_rate"],
  proof: ["conversion_rate", "trust"]
};

function assessmentScore(value: string) {
  return value === "strong" ? 90 : value === "mixed" ? 66 : value === "weak" ? 38 : 70;
}

function evidenceConfidence(strength: string, verifiedCount: number) {
  const base = strength === "high" ? 0.88 : strength === "medium" ? 0.7 : 0.52;
  if (verifiedCount >= 2) return Math.min(0.95, base + 0.06);
  if (verifiedCount === 1) return Math.min(0.82, base);
  return Math.min(0.42, base);
}

function impactForDimension(dimension: string, assessment: string) {
  if (assessment === "strong") return 0;
  if (dimension === "differentiation" || dimension === "offer_clarity") return 8;
  if (dimension === "proof" || dimension === "audience_clarity") return 7;
  return 6;
}

function easeForDimension(dimension: string) {
  if (dimension === "proof") return 6;
  if (dimension === "differentiation") return 7;
  return 8;
}

function statusForAssessment(assessment: string, confidence: number): Finding["status"] {
  if (assessment === "strong") return "strong";
  if (assessment === "unclear" || confidence < 0.55) return "insufficient_data";
  if (assessment === "weak" && confidence >= 0.75) return "important";
  return "improve";
}

function effectiveAssessment(site: SiteSnapshot, item: SiteIntelligence["positioning"][number]) {
  const verified = verifyAssessmentEvidence(site, item);
  const distinctPages = new Set(verified.map(({ page }) => page.url)).size;
  const strongGate = item.assessment === "strong" && item.evidenceStrength === "high" && verified.length >= 2 && (item.dimension !== "proof" || distinctPages >= 2);
  return { verified, value: item.assessment === "strong" && !strongGate ? "unclear" : item.assessment };
}

function aiArtifacts(auditId: string, site: SiteSnapshot, intelligence: SiteIntelligence) {
  const now = new Date().toISOString();
  const evidence: Evidence[] = [];
  const checks: AuditCheck[] = [];
  const findings: Finding[] = [];

  for (const item of intelligence.positioning) {
    const code = `POSITIONING_${item.dimension.toUpperCase()}`;
    const slug = item.dimension;
    const evaluated = effectiveAssessment(site, item);
    const verified = evaluated.verified;
    const assessment = evaluated.value;
    const confidence01 = evidenceConfidence(item.evidenceStrength, verified.length);
    const evidenceIds: string[] = [];

    if (verified.length) {
      verified.slice(0, 3).forEach(({ page, text }, index) => {
        const evidenceId = `${auditId}:${slug}:ai:evidence:${index + 1}`;
        evidenceIds.push(evidenceId);
        evidence.push({
          id: evidenceId, type: "observed", sourceProvider: "openai_positioning_verified", sourceUrl: page.url, observedAt: now,
          reliability: confidence01, excerpt: text, data: { dimension: item.dimension, assessment: item.assessment, effectiveAssessment: assessment, evidenceStrength: item.evidenceStrength, pageKind: page.kind, quoteVerified: true }
        });
      });
    } else {
      const evidenceId = `${auditId}:${slug}:ai:evidence:inference`;
      evidenceIds.push(evidenceId);
      evidence.push({
        id: evidenceId, type: "inferred", sourceProvider: "openai_positioning", sourceUrl: site.homepage.url, observedAt: now,
        reliability: confidence01, excerpt: `No exact supplied-page quote was validated for this assessment. ${item.rationale}`,
        data: { dimension: item.dimension, assessment: item.assessment, effectiveAssessment: assessment, evidenceStrength: item.evidenceStrength, quoteVerified: false }
      });
    }

    const checkId = `${auditId}:${slug}:ai:check`;
    const findingId = `${auditId}:${slug}:ai:finding`;
    const recommendationId = `${auditId}:${slug}:ai:recommendation`;
    const score = assessmentScore(assessment);
    checks.push({
      id: checkId, code, area: "positioning", label: dimensionLabels[item.dimension] || item.dimension,
      passed: assessment === "strong" ? true : assessment === "weak" ? false : null, score, confidence: confidence01,
      weight: assessment === "unclear" ? 0.25 : item.dimension === "offer_clarity" || item.dimension === "differentiation" ? 1.2 : 1,
      evidenceIds, metadata: { modelAssessment: item.assessment, effectiveAssessment: assessment, verifiedEvidenceCount: verified.length }
    });

    const isStrong = assessment === "strong";
    const confidence10 = Math.max(1, Math.round(confidence01 * 10));
    const impact = impactForDimension(item.dimension, assessment);
    const ease = isStrong ? 0 : easeForDimension(item.dimension);
    const iceScore = isStrong ? 0 : ice(impact, confidence10, ease);
    const decision: Finding["decision"] = isStrong
      ? "preserve"
      : assessment === "unclear" || verified.length === 0
        ? "validate"
        : assessment === "weak" && confidence01 >= 0.75
          ? "do_now"
          : "validate";

    findings.push({
      id: findingId, auditId, area: "positioning", code,
      title: isStrong ? `${dimensionLabels[item.dimension]} is a strength` : assessment === "unclear" ? `${dimensionLabels[item.dimension]} cannot be confirmed yet` : `${dimensionLabels[item.dimension]} needs attention`,
      description: item.rationale, status: statusForAssessment(assessment, confidence01), decision, evidenceIds,
      recommendation: isStrong ? undefined : {
        id: recommendationId, title: item.action, action: item.action, validation: item.validation, dependencies: [],
        affectedKpis: dimensionEffects[item.dimension] || ["conversion_rate"], estimatedEffort: ease >= 8 ? "s" : "m", timeToSignal: item.timeToSignal
      },
      scores: { impact, confidence: confidence10, ease, ice: iceScore, urgency: 1, unlock: 1, priority: isStrong ? 0 : priorityScore(iceScore) },
      affectedKpis: dimensionEffects[item.dimension] || ["conversion_rate"], dependencies: [],
      expectedOutcome: isStrong ? "Preserve the observed positioning strength while changing adjacent messaging." : "Improve decision clarity without claiming a guaranteed business uplift.",
      timeToSignal: isStrong ? undefined : item.timeToSignal,
      validationMethod: isStrong ? "Re-check this strength after major messaging or redesign changes." : item.validation,
      createdAt: now
    });
  }
  return { evidence, checks, findings };
}

function mergeCategories(checks: AuditCheck[]): CategoryScore[] {
  const areas = [...new Set(checks.map((check) => check.area))];
  return areas.map((area) => {
    const areaChecks = checks.filter((check) => check.area === area);
    return { area, score: weightedHealth(areaChecks), confidence: weightedConfidence(areaChecks), coverage: 100 };
  });
}

function contextFromAI(site: SiteSnapshot, intelligence: SiteIntelligence): ProjectContext {
  const context = intelligence.context;
  const page = site.homepage;
  const fallbackCompany = page.title?.split(/[|–—-]/)[0]?.trim() || new URL(page.url).hostname;
  const clean = (value: string) => value && value !== "Unknown" ? value.trim() : undefined;
  return {
    company: clean(context.company) || fallbackCompany,
    canonicalUrl: page.url,
    businessModel: clean(context.businessModel), category: clean(context.category), product: clean(context.product),
    targetAudience: context.targetAudience.filter((value) => value && value !== "Unknown").slice(0, 4),
    market: context.market.filter((value) => value && value !== "Unknown").slice(0, 4),
    primaryConversion: clean(context.primaryConversion), language: clean(context.language) || page.language,
    confidence: context.confidence
  };
}

const rootConfigs: Record<string, { area: AuditArea; title: string }> = {
  messaging_clarity: { area: "positioning", title: "Messaging clarity" },
  proof_trust: { area: "positioning", title: "Proof and trust" },
  search_foundations: { area: "seo", title: "Search foundations" },
  conversion_path: { area: "cro", title: "Conversion path clarity" },
  performance_experience: { area: "performance", title: "Mobile performance experience" }
};

function rootKey(finding: Finding) {
  if (finding.area === "positioning") return finding.code.includes("PROOF") ? "proof_trust" : "messaging_clarity";
  if (finding.area === "seo") return "search_foundations";
  if (finding.area === "cro") return "conversion_path";
  if (finding.area === "performance") return "performance_experience";
  return `${finding.area}_constraints`;
}

function buildRootCauses(auditId: string, findings: Finding[]) {
  const actionable = findings.filter((finding) => finding.recommendation && finding.status !== "insufficient_data" && ["do_now", "validate"].includes(finding.decision));
  const groups = new Map<string, Finding[]>();
  for (const finding of actionable) {
    const key = rootKey(finding);
    groups.set(key, [...(groups.get(key) || []), finding]);
  }

  const roots: RootCause[] = [];
  const rootIdByFinding = new Map<string, string>();
  for (const [key, group] of groups) {
    if (!group.length) continue;
    const sorted = [...group].sort((a, b) => b.scores.priority - a.scores.priority || b.scores.confidence - a.scores.confidence);
    const top = sorted[0];
    const config = rootConfigs[key] || { area: top.area, title: `${top.area} constraint` };
    const confidence = Math.round(group.reduce((sum, finding) => sum + finding.scores.confidence * 10, 0) / group.length);
    const priority = Math.min(100, Math.max(...group.map((finding) => finding.scores.priority)) + Math.min(12, (group.length - 1) * 4));
    const decision: RootCause["decision"] = group.some((finding) => finding.decision === "do_now") && confidence >= 75 ? "do_now" : "validate";
    const status: RootCause["status"] = group.some((finding) => finding.status === "critical") ? "critical" : group.some((finding) => finding.status === "important") ? "important" : "improve";
    const rootId = `${auditId}:root:${key}`;
    group.forEach((finding) => rootIdByFinding.set(finding.id, rootId));
    roots.push({
      id: rootId, area: config.area, title: config.title,
      description: group.length > 1 ? `${group.length} related findings point to the same underlying decision area. Fixing the root issue can resolve several downstream symptoms.` : top.description,
      findingIds: group.map((finding) => finding.id), evidenceIds: [...new Set(group.flatMap((finding) => finding.evidenceIds))],
      decision, status, confidence, priority, action: top.recommendation?.action || "Review this root cause.",
      validation: top.recommendation?.validation || top.validationMethod || "Re-run Pryo after changes.", timeToSignal: top.timeToSignal
    });
  }

  return {
    roots: roots.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence),
    findings: findings.map((finding) => rootIdByFinding.has(finding.id) ? { ...finding, rootCauseId: rootIdByFinding.get(finding.id) } : finding)
  };
}

function calculateCoverage(site: SiteSnapshot, performanceAvailable: boolean) {
  const structural = Math.min(20, 10 + Math.round((Math.min(site.pages.length, 6) / 6) * 10));
  const positioning = 25;
  const performance = performanceAvailable ? 15 : 0;
  return Math.min(60, structural + positioning + performance);
}

export async function runAuditPipeline(auditId: string, url: string, onProgress: ProgressCallback = () => {}) {
  await onProgress("crawling_homepage", 10);
  const site = await crawlMarketingSite(url, 6);

  await onProgress("crawling_site", 34);
  const deterministic = runSiteChecks(auditId, site);

  await onProgress("performance", 48);
  const performance = await runPerformanceAudit(auditId, site.homepage.url);

  await onProgress("understanding_business", 62);
  const intelligence = await analyzeSiteWithAI(site);

  await onProgress("analyzing_positioning", 74);
  const semantic = aiArtifacts(auditId, site, intelligence);

  await onProgress("building_root_causes", 86);
  const evidence = [...deterministic.evidence, ...performance.evidence, ...semantic.evidence];
  const checks = [...deterministic.checks, ...performance.checks, ...semantic.checks];
  const rawFindings = [...deterministic.findings, ...performance.findings, ...semantic.findings]
    .sort((a, b) => b.scores.priority - a.scores.priority || b.scores.confidence - a.scores.confidence);
  const rooted = buildRootCauses(auditId, rawFindings);
  const findings = rooted.findings;
  const actionable = findings.filter((finding) => finding.recommendation && finding.status !== "insufficient_data" && ["do_now", "validate"].includes(finding.decision));
  const categories = mergeCategories(checks);

  const report = AuditReportSchema.parse({
    audit: { id: auditId, completedAt: new Date().toISOString(), version: "0.4.0" },
    project: contextFromAI(site, intelligence),
    summary: {
      observedScore: weightedHealth(checks), confidence: weightedConfidence(checks),
      coverage: calculateCoverage(site, performance.result.available), growthPotential: "unknown"
    },
    scope: {
      pagesAnalyzed: site.pages.length,
      pages: site.pages.map((page) => ({ url: page.url, kind: page.kind, title: page.title })),
      performanceAvailable: performance.result.available,
      performanceSource: performance.result.available ? "pagespeed_lab" : "unavailable"
    },
    categories, checks, evidence, findings, rootCauses: rooted.roots,
    priorities: actionable.slice(0, 10).flatMap((finding) => finding.recommendation ? [finding.recommendation] : [])
  });

  await onProgress("finalizing", 95);
  return report;
}

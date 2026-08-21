import { analyzeHomepageWithAI, evidenceExistsOnPage, type HomepageIntelligence } from "@pryo/ai";
import { runHomepageChecks } from "@pryo/audit-engine";
import { crawlHomepage, type PageSnapshot } from "@pryo/crawler";
import { AuditReportSchema, type AuditCheck, type CategoryScore, type Evidence, type Finding, type ProjectContext } from "@pryo/domain";
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
  return value === "strong" ? 90 : value === "mixed" ? 65 : value === "weak" ? 38 : 55;
}

function evidenceConfidence(value: string, verified: boolean) {
  const base = value === "high" ? 0.9 : value === "medium" ? 0.72 : 0.55;
  return verified ? base : Math.min(base, 0.45);
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
  if (assessment === "unclear" || confidence < 0.6) return "improve";
  if (assessment === "weak" && confidence >= 0.8) return "important";
  return "improve";
}

function aiArtifacts(auditId: string, page: PageSnapshot, intelligence: HomepageIntelligence) {
  const now = new Date().toISOString();
  const evidence: Evidence[] = [];
  const checks: AuditCheck[] = [];
  const findings: Finding[] = [];

  for (const item of intelligence.positioning) {
    const code = `POSITIONING_${item.dimension.toUpperCase()}`;
    const slug = item.dimension;
    const verified = evidenceExistsOnPage(page, item.evidenceText);
    const confidence01 = evidenceConfidence(item.evidenceStrength, verified);
    const evidenceId = `${auditId}:${slug}:ai:evidence`;
    const checkId = `${auditId}:${slug}:ai:check`;
    const findingId = `${auditId}:${slug}:ai:finding`;
    const recommendationId = `${auditId}:${slug}:ai:recommendation`;
    const score = assessmentScore(item.assessment);

    evidence.push({
      id: evidenceId,
      type: verified ? "observed" : "inferred",
      sourceProvider: "openai_positioning",
      sourceUrl: page.url,
      observedAt: now,
      reliability: confidence01,
      excerpt: verified ? item.evidenceText : `No exact on-page quote was validated for this inference. ${item.rationale}`,
      data: { dimension: item.dimension, assessment: item.assessment, evidenceStrength: item.evidenceStrength, quoteVerified: verified }
    });

    checks.push({
      id: checkId,
      code,
      area: "positioning",
      label: dimensionLabels[item.dimension] || item.dimension,
      passed: item.assessment === "strong" ? true : item.assessment === "weak" ? false : null,
      score,
      confidence: confidence01,
      weight: item.dimension === "offer_clarity" || item.dimension === "differentiation" ? 1.2 : 1,
      evidenceIds: [evidenceId],
      metadata: { assessment: item.assessment, quoteVerified: verified }
    });

    const isStrong = item.assessment === "strong";
    const confidence10 = Math.round(confidence01 * 10);
    const impact = impactForDimension(item.dimension, item.assessment);
    const ease = isStrong ? 0 : easeForDimension(item.dimension);
    const iceScore = isStrong ? 0 : ice(impact, Math.max(1, confidence10), ease);
    const decision: Finding["decision"] = isStrong ? "preserve" : verified && confidence01 >= 0.72 && item.assessment === "weak" ? "do_now" : "validate";

    findings.push({
      id: findingId,
      auditId,
      area: "positioning",
      code,
      title: isStrong ? `${dimensionLabels[item.dimension]} is a strength` : `${dimensionLabels[item.dimension]} needs attention`,
      description: item.rationale,
      status: statusForAssessment(item.assessment, confidence01),
      decision,
      evidenceIds: [evidenceId],
      recommendation: isStrong ? undefined : {
        id: recommendationId,
        title: item.action,
        action: item.action,
        validation: item.validation,
        dependencies: [],
        affectedKpis: dimensionEffects[item.dimension] || ["conversion_rate"],
        estimatedEffort: ease >= 8 ? "s" : "m",
        timeToSignal: item.timeToSignal
      },
      scores: {
        impact,
        confidence: confidence10,
        ease,
        ice: iceScore,
        urgency: 1,
        unlock: 1,
        priority: isStrong ? 0 : priorityScore(iceScore)
      },
      affectedKpis: dimensionEffects[item.dimension] || ["conversion_rate"],
      dependencies: [],
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

function contextFromAI(page: PageSnapshot, intelligence: HomepageIntelligence): ProjectContext {
  const context = intelligence.context;
  const fallbackCompany = page.title?.split(/[|–—-]/)[0]?.trim() || new URL(page.url).hostname;
  return {
    company: context.company && context.company !== "Unknown" ? context.company : fallbackCompany,
    canonicalUrl: page.url,
    businessModel: context.businessModel === "Unknown" ? undefined : context.businessModel,
    category: context.category === "Unknown" ? undefined : context.category,
    product: context.product === "Unknown" ? undefined : context.product,
    targetAudience: context.targetAudience.filter((value) => value && value !== "Unknown"),
    market: context.market.filter((value) => value && value !== "Unknown"),
    primaryConversion: context.primaryConversion === "Unknown" ? undefined : context.primaryConversion,
    language: context.language === "Unknown" ? page.language : context.language || page.language,
    confidence: context.confidence
  };
}

export async function runAuditPipeline(auditId: string, url: string, onProgress: ProgressCallback = () => {}) {
  await onProgress("crawling", 12);
  const page = await crawlHomepage(url);

  await onProgress("deterministic_checks", 35);
  const deterministic = runHomepageChecks(auditId, page);

  await onProgress("understanding_business", 50);
  const intelligence = await analyzeHomepageWithAI(page);

  await onProgress("analyzing_positioning", 68);
  const semantic = aiArtifacts(auditId, page, intelligence);

  await onProgress("building_priorities", 82);
  const evidence = [...deterministic.evidence, ...semantic.evidence];
  const checks = [...deterministic.checks, ...semantic.checks];
  const findings = [...deterministic.findings, ...semantic.findings]
    .sort((a, b) => b.scores.priority - a.scores.priority || b.scores.confidence - a.scores.confidence);
  const actionable = findings.filter((finding) => finding.recommendation && !["preserve", "ignore"].includes(finding.decision));
  const categories = mergeCategories(checks);

  const report = AuditReportSchema.parse({
    audit: { id: auditId, completedAt: new Date().toISOString(), version: "0.3.0" },
    project: contextFromAI(page, intelligence),
    summary: {
      observedScore: weightedHealth(checks),
      confidence: weightedConfidence(checks),
      coverage: 45,
      growthPotential: "unknown"
    },
    categories,
    checks,
    evidence,
    findings,
    priorities: actionable.slice(0, 10).flatMap((finding) => finding.recommendation ? [finding.recommendation] : [])
  });

  await onProgress("finalizing", 94);
  return report;
}

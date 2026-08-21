import type { AuditArea, AuditCheck, CategoryScore, Evidence, Finding } from "@pryo/domain";
import { ice, priorityScore, weightedConfidence, weightedHealth } from "@pryo/scoring";
import type { PageSnapshot } from "@pryo/crawler";

interface CheckDefinition {
  code: string;
  area: AuditArea;
  label: string;
  passed: boolean;
  score: number;
  confidence: number;
  weight: number;
  evidence: string;
  evidenceType?: Evidence["type"];
  metadata?: Record<string, unknown>;
  finding?: {
    title: string;
    description: string;
    impact: number;
    ease: number;
    status: Finding["status"];
    decision: Finding["decision"];
    recommendation: string;
    validation: string;
    affectedKpis: string[];
    timeToSignal: string;
  };
}

function ids(auditId: string, code: string) {
  const slug = code.toLowerCase();
  return {
    checkId: `${auditId}:${slug}:check`,
    evidenceId: `${auditId}:${slug}:evidence`,
    findingId: `${auditId}:${slug}:finding`,
    recommendationId: `${auditId}:${slug}:recommendation`
  };
}

function buildDefinitions(page: PageSnapshot): CheckDefinition[] {
  const oneH1 = page.h1.length === 1;
  const hasTitle = Boolean(page.title);
  const hasDescription = Boolean(page.description);
  const hasCta = page.ctas.length > 0;
  const enoughCopy = page.wordCount >= 100;
  const htmlWeightOk = page.htmlBytes <= 750_000;
  const responseTimeOk = page.responseTimeMs <= 2_000;

  return [
    {
      code: "SEO_TITLE_PRESENT",
      area: "seo",
      label: "Homepage title",
      passed: hasTitle,
      score: hasTitle ? 100 : 25,
      confidence: 1,
      weight: 1,
      evidence: hasTitle ? `Title detected: ${page.title}` : "No <title> element with text was detected.",
      finding: hasTitle
        ? undefined
        : {
            title: "Homepage title is missing",
            description: "The homepage does not expose a usable document title for search results and browser context.",
            impact: 6,
            ease: 10,
            status: "important",
            decision: "do_now",
            recommendation: "Add a concise homepage title that states the product or company and its primary category.",
            validation: "Re-run Pryo and confirm the title is detected, then verify the rendered search snippet when indexed.",
            affectedKpis: ["organic_ctr", "search_visibility"],
            timeToSignal: "2–6 weeks"
          }
    },
    {
      code: "SEO_META_DESCRIPTION_PRESENT",
      area: "seo",
      label: "Meta description",
      passed: hasDescription,
      score: hasDescription ? 100 : 60,
      confidence: 1,
      weight: 0.6,
      evidence: hasDescription ? `Meta description detected: ${page.description}` : "No meta description was detected.",
      finding: hasDescription
        ? undefined
        : {
            title: "Meta description is missing",
            description: "The homepage does not provide a meta description that can help shape the search-result message.",
            impact: 4,
            ease: 10,
            status: "improve",
            decision: "do_now",
            recommendation: "Add a concise meta description aligned with the homepage intent and core value proposition.",
            validation: "Re-run Pryo and confirm the meta description is detected.",
            affectedKpis: ["organic_ctr"],
            timeToSignal: "2–6 weeks"
          }
    },
    {
      code: "SEO_SINGLE_H1",
      area: "seo",
      label: "Primary H1 structure",
      passed: oneH1,
      score: oneH1 ? 100 : page.h1.length === 0 ? 25 : 65,
      confidence: 1,
      weight: 1,
      evidence: page.h1.length === 0 ? "No H1 element was detected." : `${page.h1.length} H1 elements detected: ${page.h1.join(" | ")}`,
      finding: oneH1
        ? undefined
        : page.h1.length === 0
          ? {
              title: "Primary H1 is missing",
              description: "The homepage has no H1 heading, weakening page structure and making the primary message harder to identify programmatically.",
              impact: 6,
              ease: 9,
              status: "important",
              decision: "do_now",
              recommendation: "Add one descriptive H1 that clearly states the primary offer or outcome.",
              validation: "Re-run Pryo and confirm exactly one primary H1 is detected.",
              affectedKpis: ["message_clarity", "search_visibility"],
              timeToSignal: "1–4 weeks"
            }
          : {
              title: "Homepage uses multiple H1 headings",
              description: "Multiple primary headings can make the hierarchy of the page less explicit.",
              impact: 3,
              ease: 8,
              status: "improve",
              decision: "validate",
              recommendation: "Review the heading hierarchy and keep one H1 for the primary page message unless the current structure is intentionally justified.",
              validation: "Check the rendered page hierarchy and re-run Pryo after changes.",
              affectedKpis: ["message_clarity"],
              timeToSignal: "1–4 weeks"
            }
    },
    {
      code: "CRO_PRIMARY_CTA_PRESENT",
      area: "cro",
      label: "Action-oriented CTA",
      passed: hasCta,
      score: hasCta ? 100 : 20,
      confidence: 0.9,
      weight: 1.4,
      evidence: hasCta ? `${page.ctas.length} CTA candidate(s) detected. Examples: ${page.ctas.slice(0, 5).join(" | ")}` : "No action-oriented button or link was detected by the homepage CTA heuristic.",
      finding: hasCta
        ? undefined
        : {
            title: "No clear action-oriented CTA was detected",
            description: "The homepage does not expose an obvious next action through common CTA patterns. This should be visually validated before changing the page.",
            impact: 10,
            ease: 8,
            status: "critical",
            decision: "validate",
            recommendation: "Inspect the hero and primary conversion path. If no clear primary CTA exists, add one tied directly to the main conversion action.",
            validation: "Confirm the CTA visually, then compare click-through or conversion rate before and after any change.",
            affectedKpis: ["cta_click_rate", "conversion_rate"],
            timeToSignal: "1–3 weeks"
          }
    },
    {
      code: "CRO_EXPLANATORY_DEPTH",
      area: "cro",
      label: "Homepage explanatory depth",
      passed: enoughCopy,
      score: enoughCopy ? 100 : page.wordCount >= 60 ? 65 : 35,
      confidence: 0.75,
      weight: 0.8,
      evidence: `Visible body text: approximately ${page.wordCount} words.`,
      evidenceType: "measured",
      finding: enoughCopy
        ? undefined
        : {
            title: "Homepage may not explain enough before asking for action",
            description: "The visible homepage contains very little text. That can be appropriate for some brands, so this is a validation item rather than an automatic defect.",
            impact: 7,
            ease: 7,
            status: "important",
            decision: "validate",
            recommendation: "Review whether the page clearly explains the audience, value, proof and next step. Add content only where a specific decision question is currently unanswered.",
            validation: "Use session/behavior data or a controlled copy test; do not add copy solely to increase word count.",
            affectedKpis: ["conversion_rate", "engagement"],
            timeToSignal: "2–4 weeks"
          }
    },
    {
      code: "PERF_HTML_WEIGHT",
      area: "performance",
      label: "Homepage HTML weight",
      passed: htmlWeightOk,
      score: htmlWeightOk ? 100 : page.htmlBytes <= 1_500_000 ? 65 : 35,
      confidence: 1,
      weight: 0.7,
      evidence: `Downloaded HTML: ${Math.round(page.htmlBytes / 1024)} KB.`,
      evidenceType: "measured",
      finding: htmlWeightOk
        ? undefined
        : {
            title: "Homepage HTML payload is unusually large",
            description: "A heavy HTML document increases transfer and parsing work before images, scripts and other assets are considered.",
            impact: 5,
            ease: 5,
            status: "important",
            decision: "validate",
            recommendation: "Inspect server-rendered markup for duplicated content, oversized inline data or unnecessary generated HTML before optimizing assets.",
            validation: "Measure transferred HTML bytes and Core Web Vitals after remediation.",
            affectedKpis: ["page_speed", "conversion_rate"],
            timeToSignal: "Immediate"
          }
    },
    {
      code: "PERF_ORIGIN_RESPONSE",
      area: "performance",
      label: "Audit fetch response time",
      passed: responseTimeOk,
      score: responseTimeOk ? 100 : page.responseTimeMs <= 4_000 ? 60 : 30,
      confidence: 0.55,
      weight: 0.5,
      evidence: `Pryo's server received the homepage response after approximately ${page.responseTimeMs} ms including redirects and network distance.`,
      evidenceType: "measured",
      finding: responseTimeOk
        ? undefined
        : {
            title: "Homepage response was slow from the audit location",
            description: "The audit request took longer than expected, but this is not a substitute for real-user Core Web Vitals and should be validated with PageSpeed/CrUX.",
            impact: 6,
            ease: 5,
            status: "important",
            decision: "validate",
            recommendation: "Validate server and page performance with PageSpeed/CrUX before prioritizing infrastructure changes.",
            validation: "Run PageSpeed/CrUX and compare server response and Core Web Vitals across mobile and desktop.",
            affectedKpis: ["page_speed", "conversion_rate"],
            timeToSignal: "Immediate"
          }
    }
  ];
}

function makeFinding(auditId: string, definition: CheckDefinition, evidenceId: string, now: string): Finding | undefined {
  if (!definition.finding) return undefined;

  const { finding } = definition;
  const confidence = Math.max(1, Math.min(10, Math.round(definition.confidence * 10)));
  const iceScore = ice(finding.impact, confidence, finding.ease);
  const reference = ids(auditId, definition.code);

  return {
    id: reference.findingId,
    auditId,
    area: definition.area,
    code: definition.code,
    title: finding.title,
    description: finding.description,
    status: finding.status,
    decision: finding.decision,
    evidenceIds: [evidenceId],
    recommendation: {
      id: reference.recommendationId,
      title: finding.recommendation,
      action: finding.recommendation,
      validation: finding.validation,
      dependencies: [],
      affectedKpis: finding.affectedKpis,
      estimatedEffort: finding.ease >= 9 ? "xs" : finding.ease >= 7 ? "s" : finding.ease >= 5 ? "m" : "l",
      timeToSignal: finding.timeToSignal
    },
    scores: {
      impact: finding.impact,
      confidence,
      ease: finding.ease,
      ice: iceScore,
      urgency: 1,
      unlock: 1,
      priority: priorityScore(iceScore)
    },
    affectedKpis: finding.affectedKpis,
    dependencies: [],
    expectedOutcome: "Reduce a measured or observed constraint without introducing unverified business claims.",
    timeToSignal: finding.timeToSignal,
    validationMethod: finding.validation,
    createdAt: now
  };
}

function categoryScores(checks: AuditCheck[]): CategoryScore[] {
  const areas = [...new Set(checks.map((check) => check.area))];
  return areas.map((area) => {
    const areaChecks = checks.filter((check) => check.area === area);
    return {
      area,
      score: weightedHealth(areaChecks),
      confidence: weightedConfidence(areaChecks),
      coverage: 100
    };
  });
}

export function runHomepageChecks(auditId: string, page: PageSnapshot) {
  const now = new Date().toISOString();
  const definitions = buildDefinitions(page);
  const evidence: Evidence[] = [];
  const checks: AuditCheck[] = [];
  const findings: Finding[] = [];

  for (const definition of definitions) {
    const reference = ids(auditId, definition.code);

    evidence.push({
      id: reference.evidenceId,
      type: definition.evidenceType || "observed",
      sourceProvider: "pryo_crawler",
      sourceUrl: page.url,
      observedAt: now,
      reliability: definition.confidence,
      excerpt: definition.evidence,
      data: definition.metadata || {}
    });

    checks.push({
      id: reference.checkId,
      code: definition.code,
      area: definition.area,
      label: definition.label,
      passed: definition.passed,
      score: definition.score,
      confidence: definition.confidence,
      weight: definition.weight,
      evidenceIds: [reference.evidenceId],
      metadata: definition.metadata || {}
    });

    const finding = makeFinding(auditId, definition, reference.evidenceId, now);
    if (finding) findings.push(finding);
  }

  if (page.h1.length === 1 && page.ctas.length >= 1) {
    const code = "CRO_STRUCTURE_STRONG";
    const reference = ids(auditId, code);
    evidence.push({
      id: reference.evidenceId,
      type: "observed",
      sourceProvider: "pryo_crawler",
      sourceUrl: page.url,
      observedAt: now,
      reliability: 0.9,
      excerpt: `One H1 and ${page.ctas.length} action-oriented CTA candidate(s) detected.`,
      data: {}
    });
    findings.push({
      id: reference.findingId,
      auditId,
      area: "cro",
      code,
      title: "Homepage exposes a clear structural path to action",
      description: "The crawler detected one primary H1 and at least one action-oriented CTA. Preserve this structural clarity when changing the page.",
      status: "strong",
      decision: "preserve",
      evidenceIds: [reference.evidenceId],
      scores: { impact: 5, confidence: 9, ease: 10, ice: 450, urgency: 1, unlock: 1, priority: 45 },
      affectedKpis: ["conversion_rate"],
      dependencies: [],
      expectedOutcome: "Preserve structural clarity during future iterations.",
      createdAt: now
    });
  }

  return {
    checks,
    evidence,
    findings,
    categories: categoryScores(checks),
    health: weightedHealth(checks),
    confidence: weightedConfidence(checks)
  };
}

import type { AuditArea, AuditCheck, CategoryScore, Evidence, Finding } from "@pryo/domain";
import { ice, priorityScore, weightedConfidence, weightedHealth } from "@pryo/scoring";
import type { PageSnapshot, SiteSnapshot } from "@pryo/crawler";

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
  return { checkId: `${auditId}:${slug}:check`, evidenceId: `${auditId}:${slug}:evidence`, findingId: `${auditId}:${slug}:finding`, recommendationId: `${auditId}:${slug}:recommendation` };
}

function pageLabel(page: PageSnapshot) {
  try { return `${page.kind}: ${new URL(page.url).pathname || "/"}`; }
  catch { return `${page.kind}: ${page.url}`; }
}

function buildDefinitions(site: SiteSnapshot): CheckDefinition[] {
  const pages = site.pages;
  const missingTitles = pages.filter((page) => !page.title);
  const missingH1 = pages.filter((page) => page.h1.length === 0);
  const multipleH1 = pages.filter((page) => page.h1.length > 1);
  const missingDescriptions = pages.filter((page) => !page.description);
  const titles = pages.map((page) => page.title?.toLowerCase().trim()).filter(Boolean) as string[];
  const duplicateTitles = titles.filter((value, index) => titles.indexOf(value) !== index);
  const intentPages = pages.filter((page) => ["homepage", "pricing", "product", "features", "solutions"].includes(page.kind));
  const intentWithoutCta = intentPages.filter((page) => page.ctas.length === 0);

  const titleCoverage = Math.round(((pages.length - missingTitles.length) / pages.length) * 100);
  const h1Coverage = Math.round(((pages.length - missingH1.length) / pages.length) * 100);
  const descriptionCoverage = Math.round(((pages.length - missingDescriptions.length) / pages.length) * 100);
  const ctaCoverage = intentPages.length ? Math.round(((intentPages.length - intentWithoutCta.length) / intentPages.length) * 100) : 0;

  return [
    {
      code: "SEO_TITLE_COVERAGE", area: "seo", label: "Title coverage", passed: missingTitles.length === 0, score: titleCoverage,
      confidence: 1, weight: 1.1, evidenceType: "measured",
      evidence: missingTitles.length ? `${missingTitles.length}/${pages.length} crawled pages are missing a document title: ${missingTitles.map(pageLabel).join(" | ")}` : `All ${pages.length} crawled pages expose a document title.`,
      finding: missingTitles.length ? {
        title: "Some key pages are missing document titles", description: "Missing titles weaken search-result context and make page purpose less explicit to search systems.",
        impact: 6, ease: 9, status: "important", decision: "do_now", recommendation: "Add concise, page-specific titles to the affected crawled pages.",
        validation: "Re-run Pryo and confirm every crawled key page exposes a unique document title.", affectedKpis: ["organic_ctr", "search_visibility"], timeToSignal: "2–6 weeks"
      } : undefined
    },
    {
      code: "SEO_H1_COVERAGE", area: "seo", label: "Primary heading coverage", passed: missingH1.length === 0, score: h1Coverage,
      confidence: 1, weight: 1, evidenceType: "measured",
      evidence: missingH1.length ? `${missingH1.length}/${pages.length} crawled pages are missing an H1: ${missingH1.map(pageLabel).join(" | ")}` : `All ${pages.length} crawled pages expose at least one H1.`,
      finding: missingH1.length ? {
        title: "Some key pages have no primary H1", description: "The affected pages do not expose a primary heading that clearly anchors page meaning.",
        impact: 6, ease: 8, status: "important", decision: "do_now", recommendation: "Add one descriptive primary H1 to each affected key page.",
        validation: "Re-run Pryo and confirm the affected pages expose a primary H1.", affectedKpis: ["message_clarity", "search_visibility"], timeToSignal: "1–4 weeks"
      } : undefined
    },
    {
      code: "SEO_H1_HIERARCHY", area: "seo", label: "H1 hierarchy", passed: multipleH1.length === 0, score: multipleH1.length ? Math.max(55, 100 - multipleH1.length * 12) : 100,
      confidence: 0.92, weight: 0.6, evidenceType: "observed",
      evidence: multipleH1.length ? `${multipleH1.length} crawled page(s) use multiple H1 headings: ${multipleH1.map((page) => `${pageLabel(page)} (${page.h1.length})`).join(" | ")}` : "No crawled key page uses multiple H1 headings.",
      finding: multipleH1.length ? {
        title: "Some key pages use multiple H1 headings", description: "Multiple H1s are not automatically harmful, but the page hierarchy should be intentionally validated.",
        impact: 3, ease: 7, status: "improve", decision: "validate", recommendation: "Review the heading hierarchy on the affected pages and keep one primary H1 where that better reflects the information structure.",
        validation: "Validate the rendered hierarchy before changing markup, then re-run Pryo.", affectedKpis: ["message_clarity"], timeToSignal: "1–4 weeks"
      } : undefined
    },
    {
      code: "SEO_META_COVERAGE", area: "seo", label: "Meta description coverage", passed: missingDescriptions.length === 0, score: descriptionCoverage,
      confidence: 1, weight: 0.45, evidenceType: "measured",
      evidence: missingDescriptions.length ? `${missingDescriptions.length}/${pages.length} crawled pages have no meta description.` : `All ${pages.length} crawled pages expose a meta description.`,
      finding: missingDescriptions.length / pages.length >= 0.4 ? {
        title: "Meta descriptions are missing across several key pages", description: "Several crawled pages do not provide a suggested search-result description.",
        impact: 4, ease: 8, status: "improve", decision: "validate", recommendation: "Write distinct meta descriptions for high-intent pages where search snippets would benefit from a clearer message.",
        validation: "Re-run Pryo and later check rendered search snippets rather than assuming Google will use the supplied text.", affectedKpis: ["organic_ctr"], timeToSignal: "2–6 weeks"
      } : undefined
    },
    {
      code: "SEO_TITLE_UNIQUENESS", area: "seo", label: "Title uniqueness", passed: duplicateTitles.length === 0, score: duplicateTitles.length ? Math.max(45, 100 - duplicateTitles.length * 18) : 100,
      confidence: 1, weight: 0.8, evidenceType: "measured",
      evidence: duplicateTitles.length ? `Duplicate page titles were detected across the crawled set.` : "Crawled page titles are unique within the current sample.",
      finding: duplicateTitles.length ? {
        title: "Duplicate titles reduce page-level distinction", description: "Multiple key pages use the same title, making their individual purpose less explicit.",
        impact: 5, ease: 8, status: "improve", decision: "do_now", recommendation: "Differentiate titles so each key page states its specific intent and topic.",
        validation: "Re-run Pryo and confirm titles are unique across the crawled key pages.", affectedKpis: ["organic_ctr", "search_visibility"], timeToSignal: "2–6 weeks"
      } : undefined
    },
    {
      code: "CRO_ACTION_PATH_COVERAGE", area: "cro", label: "Action path coverage", passed: intentWithoutCta.length === 0, score: ctaCoverage,
      confidence: 0.88, weight: 1.2, evidenceType: "observed",
      evidence: intentWithoutCta.length ? `${intentWithoutCta.length}/${intentPages.length} high-intent crawled page(s) expose no CTA candidate: ${intentWithoutCta.map(pageLabel).join(" | ")}` : `All ${intentPages.length} crawled high-intent pages expose at least one CTA candidate.`,
      finding: intentWithoutCta.length ? {
        title: "Some high-intent pages may lack an obvious next step", description: "Pryo did not detect an action-oriented CTA on one or more high-intent pages. Visual confirmation is required before changing them.",
        impact: 8, ease: 7, status: "important", decision: "validate", recommendation: "Visually inspect the affected high-intent pages and add or clarify a primary next step only where the path is genuinely ambiguous.",
        validation: "Confirm the CTA visually and compare click-through or conversion behavior before and after any change.", affectedKpis: ["cta_click_rate", "conversion_rate"], timeToSignal: "1–3 weeks"
      } : undefined
    }
  ];
}

function makeFinding(auditId: string, definition: CheckDefinition, evidenceId: string, now: string): Finding | undefined {
  if (!definition.finding) return undefined;
  const { finding } = definition;
  const confidence = Math.max(1, Math.min(10, Math.round(definition.confidence * 10)));
  const nonAction = finding.decision === "preserve" || finding.decision === "ignore" || finding.decision === "monitor";
  const iceScore = nonAction ? 0 : ice(finding.impact, confidence, finding.ease);
  const reference = ids(auditId, definition.code);
  return {
    id: reference.findingId, auditId, area: definition.area, code: definition.code, title: finding.title, description: finding.description, status: finding.status, decision: finding.decision,
    evidenceIds: [evidenceId],
    recommendation: {
      id: reference.recommendationId, title: finding.recommendation, action: finding.recommendation, validation: finding.validation, dependencies: [], affectedKpis: finding.affectedKpis,
      estimatedEffort: finding.ease >= 9 ? "xs" : finding.ease >= 7 ? "s" : finding.ease >= 5 ? "m" : "l", timeToSignal: finding.timeToSignal
    },
    scores: { impact: nonAction ? 0 : finding.impact, confidence, ease: nonAction ? 0 : finding.ease, ice: iceScore, urgency: 1, unlock: 1, priority: nonAction ? 0 : priorityScore(iceScore) },
    affectedKpis: finding.affectedKpis, dependencies: [], expectedOutcome: "Reduce an observed constraint without introducing unverified business claims.",
    timeToSignal: finding.timeToSignal, validationMethod: finding.validation, createdAt: now
  };
}

function categoryScores(checks: AuditCheck[]): CategoryScore[] {
  const areas = [...new Set(checks.map((check) => check.area))];
  return areas.map((area) => {
    const areaChecks = checks.filter((check) => check.area === area);
    return { area, score: weightedHealth(areaChecks), confidence: weightedConfidence(areaChecks), coverage: 100 };
  });
}

export function runSiteChecks(auditId: string, site: SiteSnapshot) {
  const now = new Date().toISOString();
  const definitions = buildDefinitions(site);
  const evidence: Evidence[] = [];
  const checks: AuditCheck[] = [];
  const findings: Finding[] = [];

  for (const definition of definitions) {
    const reference = ids(auditId, definition.code);
    evidence.push({
      id: reference.evidenceId, type: definition.evidenceType || "observed", sourceProvider: "pryo_crawler", sourceUrl: site.homepage.url, observedAt: now,
      reliability: definition.confidence, excerpt: definition.evidence, data: definition.metadata || { pagesAnalyzed: site.pages.length }
    });
    checks.push({
      id: reference.checkId, code: definition.code, area: definition.area, label: definition.label, passed: definition.passed, score: definition.score,
      confidence: definition.confidence, weight: definition.weight, evidenceIds: [reference.evidenceId], metadata: definition.metadata || { pagesAnalyzed: site.pages.length }
    });
    const finding = makeFinding(auditId, definition, reference.evidenceId, now);
    if (finding) findings.push(finding);
  }

  const intentPages = site.pages.filter((page) => ["homepage", "pricing", "product", "features", "solutions"].includes(page.kind));
  const structurallyClear = intentPages.length >= 2 && intentPages.every((page) => page.h1.length >= 1 && page.ctas.length >= 1);
  if (structurallyClear) {
    const code = "CRO_STRUCTURE_STRONG";
    const reference = ids(auditId, code);
    evidence.push({ id: reference.evidenceId, type: "observed", sourceProvider: "pryo_crawler", sourceUrl: site.homepage.url, observedAt: now, reliability: 0.9, excerpt: `${intentPages.length} crawled high-intent pages expose both a primary heading and at least one CTA candidate.`, data: { pageKinds: intentPages.map((page) => page.kind) } });
    findings.push({
      id: reference.findingId, auditId, area: "cro", code, title: "Key pages preserve a clear structural path to action", description: "Across the crawled high-intent sample, Pryo consistently detected a primary heading and an action-oriented CTA. Preserve that structure during redesigns.",
      status: "strong", decision: "preserve", evidenceIds: [reference.evidenceId], scores: { impact: 0, confidence: 9, ease: 0, ice: 0, urgency: 1, unlock: 1, priority: 0 },
      affectedKpis: ["conversion_rate"], dependencies: [], expectedOutcome: "Preserve structural clarity across key conversion pages.", createdAt: now
    });
  }

  return { checks, evidence, findings, categories: categoryScores(checks), health: weightedHealth(checks), confidence: weightedConfidence(checks) };
}

export function runHomepageChecks(auditId: string, page: PageSnapshot) {
  const site: SiteSnapshot = { homepage: page, pages: [page], failedPages: [], discoveredCount: 0 };
  return runSiteChecks(auditId, site);
}

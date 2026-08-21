import type { Evidence, Finding } from "@pryo/domain";
import { ice, priorityScore } from "@pryo/scoring";
import type { PageSnapshot } from "@pryo/crawler";

export function runHomepageChecks(auditId: string, page: PageSnapshot) {
  const now = new Date().toISOString();
  const evidence: Evidence[] = [];
  const findings: Finding[] = [];

  const add = (code: string, title: string, description: string, observed: string, impact: number, ease: number, status: Finding["status"], decision: Finding["decision"], recommendation: string) => {
    const evidenceId = `${code.toLowerCase()}_evidence`;
    evidence.push({ id: evidenceId, type: "observed", sourceProvider: "pryo_crawler", sourceUrl: page.url, observedAt: now, reliability: 1, excerpt: observed, data: {} });
    const confidence = 9;
    const iceScore = ice(impact, confidence, ease);
    findings.push({
      id: code.toLowerCase(), auditId, area: code.startsWith("SEO_") ? "seo" : "cro", code, title, description, status, decision,
      evidenceIds: [evidenceId],
      recommendation: { id: `${code.toLowerCase()}_rec`, title: recommendation, action: recommendation, validation: "Re-run Pryo Snapshot and compare the affected KPI.", dependencies: [], affectedKpis: ["conversion_rate"], estimatedEffort: ease >= 8 ? "s" : "m", timeToSignal: "1–3 weeks" },
      scores: { impact, confidence, ease, ice: iceScore, urgency: 1, unlock: 1, priority: priorityScore(iceScore) },
      affectedKpis: ["conversion_rate"], dependencies: [], expectedOutcome: "Improved clarity and conversion readiness", timeToSignal: "1–3 weeks", validationMethod: "Before/after conversion comparison", createdAt: now
    });
  };

  if (page.h1.length === 0) add("SEO_H1_MISSING", "Primary H1 is missing", "The homepage has no H1 heading, reducing structural clarity for users and search engines.", "No H1 element detected on the homepage.", 6, 9, "important", "do_now", "Add one descriptive H1 that clearly states the primary offer.");
  if (!page.description) add("SEO_META_DESCRIPTION_MISSING", "Meta description is missing", "The homepage does not provide a meta description.", "No meta description detected.", 4, 10, "improve", "do_now", "Add a concise meta description aligned with the page intent.");
  if (page.ctas.length === 0) add("CRO_CTA_MISSING", "No clear CTA detected", "The crawler did not detect actionable links or buttons on the homepage.", "No button/link text detected as CTA candidates.", 10, 8, "critical", "do_now", "Add a clear primary CTA tied to the main conversion action.");
  if (page.wordCount < 100) add("CRO_THIN_HOMEPAGE", "Homepage provides very little explanatory content", "The homepage may not contain enough information for a visitor to understand the product, proof and next step.", `Visible body text: ${page.wordCount} words.`, 7, 7, "important", "validate", "Review the homepage narrative and add only the information needed to explain value, proof and next action.");

  if (page.h1.length === 1 && page.ctas.length >= 2) {
    const evidenceId = "homepage_structure_positive_evidence";
    evidence.push({ id: evidenceId, type: "observed", sourceProvider: "pryo_crawler", sourceUrl: page.url, observedAt: now, reliability: 1, excerpt: `One H1 and ${page.ctas.length} CTA candidates detected.`, data: {} });
    findings.push({ id: "homepage_structure_positive", auditId, area: "cro", code: "CRO_STRUCTURE_STRONG", title: "Homepage has a usable conversion structure", description: "The page exposes a single primary heading and multiple action opportunities.", status: "strong", decision: "preserve", evidenceIds: [evidenceId], scores: { impact: 5, confidence: 9, ease: 10, ice: 450, urgency: 1, unlock: 1, priority: 45 }, affectedKpis: ["conversion_rate"], dependencies: [], expectedOutcome: "Preserve this structural clarity during future changes.", createdAt: now });
  }

  return { evidence, findings };
}

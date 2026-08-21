import { NextResponse } from "next/server";
import { crawlHomepage, CrawlError } from "@pryo/crawler";
import { runHomepageChecks } from "@pryo/audit-engine";
import { AuditReportSchema } from "@pryo/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

function growthPotential(priority: number) {
  if (priority >= 65) return "high" as const;
  if (priority >= 35) return "medium" as const;
  return "low" as const;
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null);
    const url = payload?.url;
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "Enter a website URL.", code: "INVALID_URL" }, { status: 400 });
    }

    const page = await crawlHomepage(url);
    const auditId = crypto.randomUUID();
    const result = runHomepageChecks(auditId, page);
    const sortedFindings = [...result.findings].sort((a, b) => b.scores.priority - a.scores.priority);
    const actionable = sortedFindings.filter((finding) => finding.recommendation && finding.decision !== "preserve" && finding.decision !== "ignore");
    const topPriority = actionable[0]?.scores.priority || 0;

    const report = AuditReportSchema.parse({
      audit: {
        id: auditId,
        completedAt: new Date().toISOString(),
        version: "0.2.0"
      },
      project: {
        company: page.title || new URL(page.url).hostname,
        canonicalUrl: page.url,
        targetAudience: [],
        market: [],
        language: page.language,
        confidence: 0.45
      },
      summary: {
        health: result.health,
        confidence: result.confidence,
        coverage: 30,
        growthPotential: growthPotential(topPriority)
      },
      categories: result.categories,
      checks: result.checks,
      evidence: result.evidence,
      findings: sortedFindings,
      priorities: actionable.slice(0, 10).flatMap((finding) => finding.recommendation ? [finding.recommendation] : [])
    });

    return NextResponse.json(report, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    if (error instanceof CrawlError) {
      const status = ["INVALID_URL", "UNSAFE_URL", "DNS_LOOKUP_FAILED"].includes(error.code) ? 400 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error("audit_failed", error);
    return NextResponse.json({ error: "The audit could not be completed. Try another public website.", code: "AUDIT_FAILED" }, { status: 500 });
  }
}

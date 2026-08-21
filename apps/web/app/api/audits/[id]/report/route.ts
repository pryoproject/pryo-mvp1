import { NextResponse } from "next/server";
import { getAudit } from "@pryo/db";
import { AuditReportSchema } from "@pryo/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const audit = await getAudit(id);
    if (!audit) return NextResponse.json({ error: "Audit not found.", code: "NOT_FOUND" }, { status: 404 });
    if (audit.status === "failed") return NextResponse.json({ error: audit.errorMessage || "Audit failed.", code: audit.errorCode || "AUDIT_FAILED" }, { status: 422 });
    if (audit.status !== "completed" || !audit.report) return NextResponse.json({ error: "Report is not ready yet.", code: "NOT_READY" }, { status: 409 });

    const parsed = AuditReportSchema.safeParse(audit.report);
    if (!parsed.success) {
      console.error("audit_report_schema_invalid", id, parsed.error.flatten());
      return NextResponse.json(
        { error: "The audit completed, but the saved report could not be validated.", code: "REPORT_SCHEMA_INVALID" },
        { status: 500, headers: { "cache-control": "no-store" } }
      );
    }

    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("audit_report_failed", error);
    return NextResponse.json(
      { error: "The report is temporarily unavailable.", code: "REPORT_LOAD_FAILED" },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
}

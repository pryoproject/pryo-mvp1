import { NextResponse } from "next/server";
import { getAudit } from "@pryo/db";
import { AuditReportSchema } from "@pryo/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const audit = await getAudit(id);
  if (!audit) return NextResponse.json({ error: "Audit not found.", code: "NOT_FOUND" }, { status: 404 });
  if (audit.status === "failed") return NextResponse.json({ error: audit.errorMessage || "Audit failed.", code: audit.errorCode || "AUDIT_FAILED" }, { status: 422 });
  if (audit.status !== "completed" || !audit.report) return NextResponse.json({ error: "Report is not ready yet.", code: "NOT_READY" }, { status: 409 });
  return NextResponse.json(AuditReportSchema.parse(audit.report), { headers: { "cache-control": "no-store" } });
}

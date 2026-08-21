import { NextResponse } from "next/server";
import { getAudit } from "@pryo/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const audit = await getAudit(id);
  if (!audit) return NextResponse.json({ error: "Audit not found.", code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({
    id: audit.id,
    status: audit.status,
    stage: audit.stage,
    progress: audit.progress,
    errorCode: audit.errorCode,
    errorMessage: audit.errorMessage,
    reportReady: audit.status === "completed" && Boolean(audit.report)
  }, { headers: { "cache-control": "no-store" } });
}

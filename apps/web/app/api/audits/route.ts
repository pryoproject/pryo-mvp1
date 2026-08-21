import { NextResponse } from "next/server";
import { createAudit, failAudit } from "@pryo/db";
import { enqueueAudit } from "@pryo/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null);
    const url = payload?.url;
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "Enter a website URL.", code: "INVALID_URL" }, { status: 400 });
    }
    if (url.trim().length > 2048) {
      return NextResponse.json({ error: "URL is too long.", code: "INVALID_URL" }, { status: 400 });
    }

    const auditId = crypto.randomUUID();
    await createAudit(auditId, url.trim());
    try {
      await enqueueAudit({ auditId, url: url.trim() });
    } catch (error) {
      console.error("enqueue_audit_failed", error);
      await failAudit(auditId, "QUEUE_UNAVAILABLE", "The audit queue is temporarily unavailable.").catch(() => undefined);
      return NextResponse.json({ error: "The audit queue is temporarily unavailable.", code: "QUEUE_UNAVAILABLE" }, { status: 503 });
    }

    return NextResponse.json({ auditId, status: "queued" }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("create_audit_failed", error);
    return NextResponse.json({ error: "The audit could not be started.", code: "AUDIT_START_FAILED" }, { status: 500 });
  }
}

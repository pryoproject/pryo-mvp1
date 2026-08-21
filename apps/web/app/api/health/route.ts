import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "pryo-web",
    version: "0.2.0",
    timestamp: new Date().toISOString()
  });
}

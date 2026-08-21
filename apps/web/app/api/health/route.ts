import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "pryo-web",
    version: "0.4.0",
    dependencies: {
      database: Boolean(process.env.DATABASE_URL),
      redis: Boolean(process.env.REDIS_URL),
      openai: Boolean(process.env.OPENAI_API_KEY),
      pagespeedKey: Boolean(process.env.PAGESPEED_API_KEY)
    },
    timestamp: new Date().toISOString()
  });
}

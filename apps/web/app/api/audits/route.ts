import { NextResponse } from "next/server";
import { crawlHomepage } from "@pryo/crawler";
import { runHomepageChecks } from "@pryo/audit-engine";

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (typeof url !== "string" || !url) return NextResponse.json({ error: "URL is required" }, { status: 400 });
    const page = await crawlHomepage(url);
    const auditId = crypto.randomUUID();
    const { evidence, findings } = runHomepageChecks(auditId, page);
    const weighted = findings.length ? findings.reduce((s,f)=>s + (f.status === "strong" ? 85 : f.status === "improve" ? 70 : f.status === "important" ? 50 : f.status === "critical" ? 30 : 60),0)/findings.length : 70;
    return NextResponse.json({
      audit:{id:auditId,completedAt:new Date().toISOString(),version:"0.1.0"},
      project:{company:page.title||new URL(page.url).hostname,canonicalUrl:page.url,targetAudience:[],market:[],confidence:0.5},
      summary:{health:Math.round(weighted),confidence:90,coverage:25,growthPotential:"high"},
      evidence, findings,
      priorities:findings.filter(f=>f.recommendation&&f.decision==="do_now").sort((a,b)=>b.scores.priority-a.scores.priority).map(f=>f.recommendation)
    });
  } catch (e:any) { return NextResponse.json({ error: e?.message || "Audit failed" }, { status: 500 }); }
}

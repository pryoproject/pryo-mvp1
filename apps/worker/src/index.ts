import { Worker } from "bullmq";
import { AUDIT_QUEUE, createWorkerConnection, type AuditJobData } from "@pryo/queue";
import { completeAudit, failAudit, updateAuditProgress, closeDatabase } from "@pryo/db";
import { AuditReportSchema, type AuditReport } from "@pryo/domain";
import { runMarketIntelligence } from "./market.js";
import { runAuditPipeline } from "@pryo/pipeline";
import { CrawlError } from "@pryo/crawler";

const connection = createWorkerConnection();
const concurrency = Math.max(1, Math.min(4, Number(process.env.WORKER_CONCURRENCY || "2")));

function enrichWithMarket(base: AuditReport, market: Awaited<ReturnType<typeof runMarketIntelligence>>): AuditReport {
  const marketRecommendations = market.findings.flatMap((finding) => finding.recommendation ? [finding.recommendation] : []);
  const findings = [...base.findings, ...market.findings]
    .sort((a, b) => b.scores.priority - a.scores.priority || b.scores.confidence - a.scores.confidence);
  const rootCauses = [...base.rootCauses, ...market.rootCauses]
    .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);

  return AuditReportSchema.parse({
    ...base,
    audit: { ...base.audit, completedAt: new Date().toISOString(), version: "0.5.1" },
    summary: {
      ...base.summary,
      coverage: Math.min(80, base.summary.coverage + (market.result.available ? 20 : 0))
    },
    scope: base.scope ? {
      ...base.scope,
      marketAvailable: market.result.available,
      marketSource: market.result.provider
    } : undefined,
    market: market.result,
    evidence: [...base.evidence, ...market.evidence],
    findings,
    rootCauses,
    priorities: [...base.priorities, ...marketRecommendations]
  });
}

const worker = new Worker<AuditJobData>(
  AUDIT_QUEUE,
  async (job) => {
    const { auditId, url } = job.data;
    try {
      await updateAuditProgress(auditId, "starting", 5);
      const baseReport = await runAuditPipeline(auditId, url, async (stage, progress) => {
        await job.updateProgress(progress);
        await updateAuditProgress(auditId, stage, progress);
      });

      await job.updateProgress(97);
      await updateAuditProgress(auditId, "market_intelligence", 97);
      const market = await runMarketIntelligence(auditId, baseReport.project);
      const report = enrichWithMarket(baseReport, market);

      await completeAudit(auditId, report);
      return { auditId };
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
      const providerError = status === 401 || status === 403 || status === 429;
      const code = error instanceof CrawlError ? error.code : providerError ? "AI_PROVIDER_UNAVAILABLE" : error instanceof Error && /openai/i.test(`${error.name} ${error.message}`) ? "AI_ANALYSIS_FAILED" : "AUDIT_FAILED";
      const message = error instanceof CrawlError ? error.message : providerError ? "AI analysis is temporarily unavailable. Please retry later." : "The audit could not be completed. Please retry later.";
      await failAudit(auditId, code, message);
      throw error;
    }
  },
  { connection, concurrency }
);

worker.on("ready", () => console.log(`Pryo worker v0.5.1 ready (concurrency=${concurrency})`));
worker.on("completed", (job) => console.log("audit_completed", job.id));
worker.on("failed", (job, error) => console.error("audit_failed", job?.id, error));
worker.on("error", (error) => console.error("worker_error", error));

async function shutdown(signal: string) {
  console.log("worker_shutdown", signal);
  await worker.close();
  await connection.quit();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

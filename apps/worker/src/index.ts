import { Worker } from "bullmq";
import { AUDIT_QUEUE, createWorkerConnection, type AuditJobData } from "@pryo/queue";
import { completeAudit, failAudit, updateAuditProgress, closeDatabase } from "@pryo/db";
import { runAuditPipeline } from "@pryo/pipeline";
import { CrawlError } from "@pryo/crawler";

const connection = createWorkerConnection();
const concurrency = Math.max(1, Math.min(4, Number(process.env.WORKER_CONCURRENCY || "2")));

const worker = new Worker<AuditJobData>(
  AUDIT_QUEUE,
  async (job) => {
    const { auditId, url } = job.data;
    try {
      await updateAuditProgress(auditId, "starting", 5);
      const report = await runAuditPipeline(auditId, url, async (stage, progress) => {
        await job.updateProgress(progress);
        await updateAuditProgress(auditId, stage, progress);
      });
      await completeAudit(auditId, report);
      return { auditId };
    } catch (error) {
      const code = error instanceof CrawlError ? error.code : error instanceof Error && /OPENAI/i.test(error.message) ? "AI_ANALYSIS_FAILED" : "AUDIT_FAILED";
      const message = error instanceof CrawlError ? error.message : "The audit could not be completed. Please retry later.";
      await failAudit(auditId, code, message);
      throw error;
    }
  },
  { connection, concurrency }
);

worker.on("ready", () => console.log(`Pryo worker v0.3 ready (concurrency=${concurrency})`));
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

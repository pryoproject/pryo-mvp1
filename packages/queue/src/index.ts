import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

export const AUDIT_QUEUE = "pryo-audits";
export interface AuditJobData { auditId: string; url: string; }

let producerRedis: IORedis | undefined;
let auditQueue: Queue<AuditJobData> | undefined;

function redisUrl() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not configured");
  return url;
}

export function getProducerConnection() {
  if (!producerRedis) producerRedis = new IORedis(redisUrl(), { enableReadyCheck: true });
  return producerRedis;
}

export function createWorkerConnection() {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function getAuditQueue() {
  if (!auditQueue) auditQueue = new Queue<AuditJobData>(AUDIT_QUEUE, { connection: getProducerConnection() });
  return auditQueue;
}

export async function enqueueAudit(data: AuditJobData) {
  const options: JobsOptions = {
    jobId: data.auditId,
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: 100,
    removeOnFail: 200
  };
  await getAuditQueue().add("run-audit", data, options);
}

export async function pingRedis() {
  return (await getProducerConnection().ping()) === "PONG";
}

export async function closeQueue() {
  if (auditQueue) await auditQueue.close();
  auditQueue = undefined;
  if (producerRedis) await producerRedis.quit();
  producerRedis = undefined;
}

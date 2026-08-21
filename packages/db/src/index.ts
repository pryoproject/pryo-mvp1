import postgres, { type Sql } from "postgres";
import type { AuditReport, ProjectContext } from "@pryo/domain";

export type AuditStatus = "queued" | "processing" | "completed" | "failed";

export interface AuditRecord {
  id: string;
  inputUrl: string;
  canonicalUrl?: string;
  status: AuditStatus;
  stage: string;
  progress: number;
  errorCode?: string;
  errorMessage?: string;
  projectContext?: ProjectContext;
  report?: AuditReport;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

let sqlClient: Sql | undefined;
let schemaPromise: Promise<void> | undefined;

function serializeJson(value: unknown) {
  return JSON.stringify(value);
}

export function getSql() {
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  sqlClient = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  return sqlClient;
}

export async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const sql = getSql();
    await sql.unsafe(`
      create table if not exists audits (
        id uuid primary key,
        input_url text not null,
        canonical_url text,
        status text not null check (status in ('queued','processing','completed','failed')),
        stage text not null default 'queued',
        progress integer not null default 0 check (progress between 0 and 100),
        error_code text,
        error_message text,
        project_context jsonb,
        report jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        completed_at timestamptz
      );
      create index if not exists audits_created_at_idx on audits(created_at desc);

      create table if not exists audit_evidence (
        audit_id uuid not null references audits(id) on delete cascade,
        evidence_id text not null,
        payload jsonb not null,
        created_at timestamptz not null default now(),
        primary key (audit_id, evidence_id)
      );

      create table if not exists audit_findings (
        audit_id uuid not null references audits(id) on delete cascade,
        finding_id text not null,
        payload jsonb not null,
        created_at timestamptz not null default now(),
        primary key (audit_id, finding_id)
      );
    `);
  })().catch((error) => {
    schemaPromise = undefined;
    throw error;
  });
  return schemaPromise;
}

export async function createAudit(id: string, inputUrl: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`insert into audits (id, input_url, status, stage, progress) values (${id}, ${inputUrl}, 'queued', 'queued', 0)`;
}

export async function updateAuditProgress(id: string, stage: string, progress: number) {
  await ensureSchema();
  const sql = getSql();
  await sql`update audits set status = 'processing', stage = ${stage}, progress = ${Math.max(0, Math.min(99, Math.round(progress)))}, updated_at = now() where id = ${id}`;
}

export async function completeAudit(id: string, report: AuditReport) {
  await ensureSchema();
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`
      update audits set
        status = 'completed', stage = 'completed', progress = 100,
        canonical_url = ${report.project.canonicalUrl},
        project_context = ${serializeJson(report.project)}::jsonb,
        report = ${serializeJson(report)}::jsonb,
        updated_at = now(), completed_at = now(),
        error_code = null, error_message = null
      where id = ${id}
    `;
    await tx`delete from audit_evidence where audit_id = ${id}`;
    await tx`delete from audit_findings where audit_id = ${id}`;
    for (const evidence of report.evidence) {
      await tx`insert into audit_evidence (audit_id, evidence_id, payload) values (${id}, ${evidence.id}, ${serializeJson(evidence)}::jsonb)`;
    }
    for (const finding of report.findings) {
      await tx`insert into audit_findings (audit_id, finding_id, payload) values (${id}, ${finding.id}, ${serializeJson(finding)}::jsonb)`;
    }
  });
}

export async function failAudit(id: string, code: string, message: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    update audits set status = 'failed', stage = 'failed', error_code = ${code}, error_message = ${message}, updated_at = now(), completed_at = now()
    where id = ${id}
  `;
}

export async function getAudit(id: string): Promise<AuditRecord | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    select id, input_url, canonical_url, status, stage, progress, error_code, error_message,
           project_context, report, created_at, updated_at, completed_at
    from audits where id = ${id} limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    inputUrl: row.input_url,
    canonicalUrl: row.canonical_url || undefined,
    status: row.status as AuditStatus,
    stage: row.stage,
    progress: row.progress,
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
    projectContext: row.project_context as ProjectContext | undefined,
    report: row.report as AuditReport | undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined
  };
}

export async function pingDatabase() {
  await ensureSchema();
  const sql = getSql();
  await sql`select 1`;
  return true;
}

export async function closeDatabase() {
  if (!sqlClient) return;
  await sqlClient.end({ timeout: 5 });
  sqlClient = undefined;
  schemaPromise = undefined;
}

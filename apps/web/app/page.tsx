"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AuditReport, Finding, RootCause } from "@pryo/domain";

type ApiError = { error?: string; code?: string };
type StartResponse = { auditId: string; status: string };
type AuditState = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  progress: number;
  errorCode?: string;
  errorMessage?: string;
  reportReady: boolean;
};

const decisionLabels: Record<Finding["decision"], string> = {
  do_now: "Do now", validate: "Validate", preserve: "Preserve", monitor: "Monitor", ignore: "Ignore"
};

const stageLabels: Record<string, string> = {
  queued: "Waiting for an audit worker",
  starting: "Starting audit",
  crawling_homepage: "Opening the website",
  crawling_site: "Analyzing key marketing pages",
  deterministic_checks: "Running structural checks",
  performance: "Measuring mobile performance",
  understanding_business: "Understanding the business",
  analyzing_positioning: "Testing positioning against evidence",
  building_root_causes: "Grouping symptoms into root causes",
  finalizing: "Building your Deep Snapshot",
  completed: "Snapshot ready"
};

function statusClass(status: Finding["status"]) { return `status status-${status}`; }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(response.ok ? "Pryo returned an empty response." : `${fallback} (HTTP ${response.status}).`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${fallback} The server returned an invalid response (HTTP ${response.status}).`); }
}

function isTransientStatus(status: number) { return status === 502 || status === 503 || status === 504; }

function decisionBadge(decision: RootCause["decision"]) {
  return decision === "do_now" ? "Do now" : decision === "validate" ? "Validate" : decisionLabels[decision];
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState("");
  const [auditState, setAuditState] = useState<AuditState | null>(null);

  const topRoots = useMemo(() => report?.rootCauses?.filter((root) => ["do_now", "validate"].includes(root.decision)).slice(0, 3) || [], [report]);
  const strengths = useMemo(() => report?.findings.filter((finding) => finding.decision === "preserve") || [], [report]);

  async function pollAudit(auditId: string) {
    for (let attempt = 0; attempt < 220; attempt += 1) {
      let response: Response;
      try { response = await fetch(`/api/audits/${auditId}`, { cache: "no-store" }); }
      catch { await sleep(1_500); continue; }
      if (isTransientStatus(response.status)) { await sleep(1_500); continue; }

      const state = await readJsonResponse<AuditState | ApiError>(response, "Could not read audit status.");
      if (!response.ok) throw new Error("error" in state && state.error ? state.error : "Could not read audit status.");
      const current = state as AuditState;
      setAuditState(current);
      if (current.status === "failed") throw new Error(current.errorMessage || "Audit failed.");

      if (current.status === "completed" && current.reportReady) {
        let reportResponse: Response;
        try { reportResponse = await fetch(`/api/audits/${auditId}/report`, { cache: "no-store" }); }
        catch { await sleep(1_500); continue; }
        if (isTransientStatus(reportResponse.status) || reportResponse.status === 409) { await sleep(1_500); continue; }

        const reportData = await readJsonResponse<AuditReport | ApiError>(reportResponse, "Report could not be loaded.");
        if (!reportResponse.ok) throw new Error("error" in reportData && reportData.error ? reportData.error : "Report could not be loaded.");
        return reportData as AuditReport;
      }
      await sleep(1_250);
    }
    throw new Error("The audit is taking longer than expected. You can retry shortly.");
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setReport(null); setAuditState(null);
    try {
      const response = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await readJsonResponse<StartResponse | ApiError>(response, "Audit could not be started.");
      if (!response.ok) throw new Error("error" in data && data.error ? data.error : "Audit could not be started.");
      setReport(await pollAudit((data as StartResponse).auditId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Audit failed.");
    } finally { setLoading(false); }
  }

  return (
    <main>
      <header className="hero">
        <div className="brand">PRYO</div>
        <h1>Know what matters first.</h1>
        <p className="hero-copy">Turn a public website into an evidence-backed decision map: what to fix, what to validate and what not to break.</p>
      </header>

      <form className="card audit-form" onSubmit={run}>
        <label htmlFor="url">Website</label>
        <div className="input-row">
          <input id="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="example.com" autoComplete="url" />
          <button type="submit" disabled={!url.trim() || loading}>{loading ? "Analyzing…" : "Run Deep Snapshot"}</button>
        </div>
        <p className="hint">Pryo v0.4 scans key marketing pages, validates positioning evidence and checks mobile performance. No login or analytics access is required.</p>
        {error && <div className="error" role="alert">{error}</div>}
      </form>

      {loading && (
        <section className="progress card" aria-live="polite">
          <span className="spinner" />
          <div className="progress-copy">
            <strong>{stageLabels[auditState?.stage || "queued"] || "Analyzing website"}</strong>
            <p>{auditState?.progress || 0}% complete · evidence is saved as the audit runs.</p>
            <div className="progress-track"><span style={{ width: `${Math.max(3, auditState?.progress || 3)}%` }} /></div>
          </div>
        </section>
      )}

      {report && (
        <section className="report">
          <div className="report-heading">
            <div>
              <p className="eyebrow">Pryo Deep Snapshot</p>
              <h2>{report.project.company}</h2>
              <a href={report.project.canonicalUrl} target="_blank" rel="noreferrer">{report.project.canonicalUrl}</a>
              <div className="context-row">
                {report.project.businessModel && <span>{report.project.businessModel}</span>}
                {report.project.category && <span>{report.project.category}</span>}
                {report.project.product && <span>{report.project.product}</span>}
                {report.project.primaryConversion && <span>Goal: {report.project.primaryConversion}</span>}
              </div>
            </div>
            <div className="score"><strong>{report.summary.observedScore}</strong><span>Observed score / 100</span></div>
          </div>

          <div className="metrics">
            <div className="metric"><span>Confidence</span><strong>{report.summary.confidence}%</strong></div>
            <div className="metric"><span>Current coverage</span><strong>{report.summary.coverage}%</strong></div>
            <div className="metric"><span>Growth potential</span><strong className="capitalize">{report.summary.growthPotential === "unknown" ? "Not scored yet" : report.summary.growthPotential}</strong></div>
          </div>

          {report.scope && <div className="card scope-card">
            <div><p className="eyebrow">Evidence scope</p><h3>{report.scope.pagesAnalyzed} pages analyzed</h3></div>
            <div className="page-chips">{report.scope.pages.map((page) => <a key={page.url} href={page.url} target="_blank" rel="noreferrer"><strong>{page.kind}</strong><span>{page.title || new URL(page.url).pathname}</span></a>)}</div>
            <p className="scope-status">Mobile performance: <strong>{report.scope.performanceAvailable ? "PageSpeed lab data included" : "not available in this run"}</strong></p>
          </div>}

          <div className="card section-card">
            <div className="section-title"><div><p className="eyebrow">Decision layer</p><h3>Your highest-leverage root causes</h3></div><span className="muted">Symptoms are grouped before ranking</span></div>
            {topRoots.length ? <div className="moves">{topRoots.map((root, index) => (
              <article className="move" key={root.id}>
                <div className="rank">{index + 1}</div>
                <div className="move-content">
                  <div className="move-meta"><span className={statusClass(root.status)}>{decisionBadge(root.decision)}</span><span>{root.area}</span><span>{root.findingIds.length} linked finding{root.findingIds.length === 1 ? "" : "s"}</span></div>
                  <h4>{root.title}</h4><p>{root.action}</p>
                  <div className="move-stats"><span>Priority <strong>{root.priority}/100</strong></span><span>Confidence <strong>{root.confidence}%</strong></span><span>Signal <strong>{root.timeToSignal || "—"}</strong></span></div>
                </div>
              </article>
            ))}</div> : <p className="muted">No high-confidence root constraint was detected in the current scope.</p>}
          </div>

          {strengths.length > 0 && <div className="card section-card preserve-card">
            <div className="section-title"><div><p className="eyebrow">Don't break these</p><h3>Observed strengths</h3></div><span className="muted">Only evidence-gated strengths are shown</span></div>
            <div className="strength-list">{strengths.slice(0, 6).map((finding) => <div key={finding.id}><span className={statusClass("strong")}>Preserve</span><strong>{finding.title}</strong></div>)}</div>
          </div>}

          <div className="category-grid">{report.categories.map((category) => (
            <div className="card category" key={category.area}><span>{category.area.replace("_", " ")}</span><strong>{category.score}</strong><small>{category.confidence}% confidence</small></div>
          ))}</div>

          <div className="card section-card">
            <div className="section-title"><div><p className="eyebrow">Evidence-backed findings</p><h3>What Pryo observed</h3></div><span className="muted">{report.findings.length} findings</span></div>
            <div className="finding-list">{report.findings.map((finding) => {
              const evidence = report.evidence.filter((item) => finding.evidenceIds.includes(item.id));
              return <details className="finding" key={finding.id}>
                <summary><div><span className={statusClass(finding.status)}>{decisionLabels[finding.decision]}</span><strong>{finding.title}</strong></div><span className="finding-score">{finding.decision === "preserve" ? "Strength" : `ICE ${finding.scores.ice}`}</span></summary>
                <div className="finding-body">
                  <p>{finding.description}</p>
                  {finding.rootCauseId && <p className="root-link">Grouped into a root cause in the decision layer.</p>}
                  <h5>Evidence</h5>
                  {evidence.map((item) => <blockquote key={item.id}><span>{item.type}</span>{item.excerpt}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source page</a>}</blockquote>)}
                  {finding.recommendation && <><h5>Action</h5><p>{finding.recommendation.action}</p><h5>Validate</h5><p>{finding.recommendation.validation}</p></>}
                </div>
              </details>;
            })}</div>
          </div>
          <p className="scope-note">Pryo v0.4 covers key-page structure, evidence-gated positioning and optional mobile PageSpeed lab signals. Market demand, competitors, AI discoverability and first-party analytics are still outside this score, so global growth potential remains intentionally unscored.</p>
        </section>
      )}
    </main>
  );
}

"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AuditReport, Finding } from "@pryo/domain";

type ApiError = { error?: string };
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
  do_now: "Do now",
  validate: "Validate",
  preserve: "Preserve",
  monitor: "Monitor",
  ignore: "Ignore"
};

const stageLabels: Record<string, string> = {
  queued: "Waiting for an audit worker",
  starting: "Starting audit",
  crawling: "Collecting homepage evidence",
  deterministic_checks: "Running structural checks",
  understanding_business: "Understanding the business",
  analyzing_positioning: "Analyzing positioning",
  building_priorities: "Ranking decisions",
  finalizing: "Building your Snapshot",
  completed: "Snapshot ready"
};

function statusClass(status: Finding["status"]) { return `status status-${status}`; }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState("");
  const [auditState, setAuditState] = useState<AuditState | null>(null);

  const topMoves = useMemo(
    () => report?.findings.filter((finding) => finding.recommendation && !["preserve", "ignore"].includes(finding.decision)).slice(0, 3) || [],
    [report]
  );
  const strengths = useMemo(() => report?.findings.filter((finding) => finding.decision === "preserve") || [], [report]);

  async function pollAudit(auditId: string) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const response = await fetch(`/api/audits/${auditId}`, { cache: "no-store" });
      const state = (await response.json()) as AuditState | ApiError;
      if (!response.ok) throw new Error("error" in state && state.error ? state.error : "Could not read audit status.");
      const current = state as AuditState;
      setAuditState(current);
      if (current.status === "failed") throw new Error(current.errorMessage || "Audit failed.");
      if (current.status === "completed" && current.reportReady) {
        const reportResponse = await fetch(`/api/audits/${auditId}/report`, { cache: "no-store" });
        const reportData = (await reportResponse.json()) as AuditReport | ApiError;
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
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = (await response.json()) as StartResponse | ApiError;
      if (!response.ok) throw new Error("error" in data && data.error ? data.error : "Audit could not be started.");
      const result = await pollAudit((data as StartResponse).auditId);
      setReport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Audit failed.");
    } finally { setLoading(false); }
  }

  return (
    <main>
      <header className="hero">
        <div className="brand">PRYO</div>
        <h1>Know what matters first.</h1>
        <p className="hero-copy">Turn a public website into an evidence-backed list of what to fix, what to validate and what not to break.</p>
      </header>

      <form className="card audit-form" onSubmit={run}>
        <label htmlFor="url">Website</label>
        <div className="input-row">
          <input id="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="example.com" autoComplete="url" />
          <button type="submit" disabled={!url.trim() || loading}>{loading ? "Analyzing…" : "Run Snapshot"}</button>
        </div>
        <p className="hint">Pryo v0.3 combines structural evidence with AI positioning analysis. No login or analytics access is required.</p>
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
              <p className="eyebrow">Pryo Snapshot</p>
              <h2>{report.project.company}</h2>
              <a href={report.project.canonicalUrl} target="_blank" rel="noreferrer">{report.project.canonicalUrl}</a>
              <div className="context-row">
                {report.project.businessModel && <span>{report.project.businessModel}</span>}
                {report.project.category && <span>{report.project.category}</span>}
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

          <div className="card section-card">
            <div className="section-title"><div><p className="eyebrow">Decision layer</p><h3>Your highest-leverage moves</h3></div><span className="muted">Ranked by evidence × ICE</span></div>
            {topMoves.length ? <div className="moves">{topMoves.map((finding, index) => (
              <article className="move" key={finding.id}>
                <div className="rank">{index + 1}</div>
                <div className="move-content">
                  <div className="move-meta"><span className={statusClass(finding.status)}>{decisionLabels[finding.decision]}</span><span>{finding.area}</span></div>
                  <h4>{finding.title}</h4><p>{finding.recommendation?.action}</p>
                  <div className="move-stats"><span>ICE <strong>{finding.scores.ice}</strong></span><span>Confidence <strong>{finding.scores.confidence}/10</strong></span><span>Signal <strong>{finding.timeToSignal || "—"}</strong></span></div>
                </div>
              </article>
            ))}</div> : <p className="muted">No immediate action was detected in the current scope.</p>}
          </div>

          {strengths.length > 0 && <div className="card section-card preserve-card">
            <div className="section-title"><div><p className="eyebrow">Don't break these</p><h3>Observed strengths</h3></div><span className="muted">Preserve during changes</span></div>
            <div className="strength-list">{strengths.slice(0, 5).map((finding) => <div key={finding.id}><span className={statusClass("strong")}>Preserve</span><strong>{finding.title}</strong></div>)}</div>
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
                <div className="finding-body"><p>{finding.description}</p><h5>Evidence</h5>{evidence.map((item) => <blockquote key={item.id}><span>{item.type}</span>{item.excerpt}</blockquote>)}{finding.recommendation && <><h5>Action</h5><p>{finding.recommendation.action}</p><h5>Validate</h5><p>{finding.recommendation.validation}</p></>}</div>
              </details>;
            })}</div>
          </div>
          <p className="scope-note">Pryo v0.3 covers homepage structure and positioning. Market, competitor, full-site SEO, AI discoverability and first-party analytics are not yet included, so the global growth potential is intentionally not scored.</p>
        </section>
      )}
    </main>
  );
}

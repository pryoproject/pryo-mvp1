"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AuditReport, Finding } from "@pryo/domain";

type ApiError = { error?: string };

const decisionLabels: Record<Finding["decision"], string> = {
  do_now: "Do now",
  validate: "Validate",
  preserve: "Preserve",
  monitor: "Monitor",
  ignore: "Ignore"
};

function statusClass(status: Finding["status"]) {
  return `status status-${status}`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState("");

  const topMoves = useMemo(
    () => report?.findings.filter((finding) => finding.recommendation && !["preserve", "ignore"].includes(finding.decision)).slice(0, 3) || [],
    [report]
  );

  async function run(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setReport(null);

    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = (await response.json()) as AuditReport | ApiError;
      if (!response.ok) throw new Error("error" in data && data.error ? data.error : "Audit failed.");
      setReport(data as AuditReport);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Audit failed.");
    } finally {
      setLoading(false);
    }
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
        <p className="hint">Current vertical slice analyzes the public homepage only. No login or analytics access is required.</p>
        {error && <div className="error" role="alert">{error}</div>}
      </form>

      {loading && (
        <section className="progress card" aria-live="polite">
          <span className="spinner" />
          <div><strong>Building your Snapshot</strong><p>Resolving the site, collecting homepage evidence and ranking the first findings.</p></div>
        </section>
      )}

      {report && (
        <section className="report">
          <div className="report-heading">
            <div>
              <p className="eyebrow">Pryo Snapshot</p>
              <h2>{report.project.company}</h2>
              <a href={report.project.canonicalUrl} target="_blank" rel="noreferrer">{report.project.canonicalUrl}</a>
            </div>
            <div className="score"><strong>{report.summary.health}</strong><span>Health / 100</span></div>
          </div>

          <div className="metrics">
            <div className="metric"><span>Confidence</span><strong>{report.summary.confidence}%</strong></div>
            <div className="metric"><span>Current scope</span><strong>{report.summary.coverage}%</strong></div>
            <div className="metric"><span>Growth potential</span><strong className="capitalize">{report.summary.growthPotential}</strong></div>
          </div>

          <div className="card section-card">
            <div className="section-title"><div><p className="eyebrow">Decision layer</p><h3>Your highest-leverage moves</h3></div><span className="muted">Ranked by ICE</span></div>
            {topMoves.length ? (
              <div className="moves">
                {topMoves.map((finding, index) => (
                  <article className="move" key={finding.id}>
                    <div className="rank">{index + 1}</div>
                    <div className="move-content">
                      <div className="move-meta"><span className={statusClass(finding.status)}>{decisionLabels[finding.decision]}</span><span>{finding.area}</span></div>
                      <h4>{finding.title}</h4>
                      <p>{finding.recommendation?.action}</p>
                      <div className="move-stats"><span>ICE <strong>{finding.scores.ice}</strong></span><span>Confidence <strong>{finding.scores.confidence}/10</strong></span><span>Signal <strong>{finding.timeToSignal || "—"}</strong></span></div>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="muted">No immediate action was detected in the current homepage-only scope.</p>}
          </div>

          <div className="category-grid">
            {report.categories.map((category) => (
              <div className="card category" key={category.area}><span>{category.area.replace("_", " ")}</span><strong>{category.score}</strong><small>{category.confidence}% confidence</small></div>
            ))}
          </div>

          <div className="card section-card">
            <div className="section-title"><div><p className="eyebrow">Evidence-backed findings</p><h3>What Pryo observed</h3></div><span className="muted">{report.findings.length} findings</span></div>
            <div className="finding-list">
              {report.findings.map((finding) => {
                const evidence = report.evidence.filter((item) => finding.evidenceIds.includes(item.id));
                return (
                  <details className="finding" key={finding.id}>
                    <summary>
                      <div><span className={statusClass(finding.status)}>{decisionLabels[finding.decision]}</span><strong>{finding.title}</strong></div>
                      <span className="finding-score">ICE {finding.scores.ice}</span>
                    </summary>
                    <div className="finding-body">
                      <p>{finding.description}</p>
                      <h5>Evidence</h5>
                      {evidence.map((item) => <blockquote key={item.id}><span>{item.type}</span>{item.excerpt}</blockquote>)}
                      {finding.recommendation && <><h5>Action</h5><p>{finding.recommendation.action}</p><h5>Validate</h5><p>{finding.recommendation.validation}</p></>}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>

          <p className="scope-note">This is Pryo v0.2: a homepage-only deterministic Snapshot. Market, competitor, AI positioning and full-site modules are intentionally not represented in the current score yet.</p>
        </section>
      )}
    </main>
  );
}

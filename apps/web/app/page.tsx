"use client";
import { useState } from "react";
export default function Home() {
  const [url,setUrl]=useState(""); const [loading,setLoading]=useState(false); const [report,setReport]=useState<any>(null); const [error,setError]=useState("");
  async function run(){ setLoading(true); setError(""); setReport(null); try { const r=await fetch("/api/audits",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})}); const data=await r.json(); if(!r.ok) throw new Error(data.error||"Audit failed"); setReport(data); } catch(e:any){setError(e.message)} finally {setLoading(false)} }
  return <main>
    <h1 style={{fontSize:48,marginBottom:8}}>Pryo</h1><p className="muted" style={{fontSize:20}}>Know what matters first.</p>
    <div className="card" style={{marginTop:32}}><h2>Run a Snapshot</h2><p className="muted">Enter a public website URL. This first vertical slice audits the homepage structure and produces evidence-backed actions.</p><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com"/><button onClick={run} disabled={!url||loading}>{loading?"Analyzing…":"Analyze website"}</button>{error&&<p>{error}</p>}</div>
    {report&&<section style={{marginTop:32}}>
      <div className="card"><h2>Your highest-leverage moves</h2><p><strong>Health:</strong> {report.summary.health}/100 &nbsp; <strong>Confidence:</strong> {report.summary.confidence}% &nbsp; <strong>Coverage:</strong> {report.summary.coverage}%</p>
      <table><thead><tr><th>Priority</th><th>Decision</th><th>Finding</th><th>ICE</th><th>Time to signal</th></tr></thead><tbody>{report.findings.sort((a:any,b:any)=>b.scores.priority-a.scores.priority).map((f:any,i:number)=><tr key={f.id}><td>{i+1}</td><td><span className="badge">{f.decision.replace("_"," ")}</span></td><td><strong>{f.title}</strong><br/><small>{f.description}</small></td><td>{f.scores.ice}</td><td>{f.timeToSignal||"—"}</td></tr>)}</tbody></table></div>
    </section>}
  </main>
}

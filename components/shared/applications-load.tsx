"use client";

// One-time load of past website applications (backlog #121). Admin-only.
// Pick JotForm's CSV export of the Employee Application form → Check (dry
// run: what would happen to each submission, nothing written) → Load.
// Running it again is safe: anything already loaded shows as "already".

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { newestFirst, parseCsv, parseCsvRow, type Application } from "@/lib/jotform/application";
import type { ReportRow } from "@/lib/jotform/server";

// Rows per request on the real load, to stay inside Vercel's time limit.
const CHUNK = 100;

async function post(applications: Application[], apply: boolean) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/jotform/load", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ applications, apply }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
  return json.report as ReportRow[];
}

const LABEL: Record<ReportRow["outcome"], string> = {
  created: "New record", updated: "Filled blanks", matched: "Already there", older: "Older application",
  several: "Several records", skipped: "Skipped", already: "Already loaded", error: "Error",
};

export default function ApplicationsLoad() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<string>("");

  async function pick(file: File | undefined) {
    setReport(null); setApplied(false); setError(null); setApps(null);
    if (!file) return;
    setFileName(file.name);
    const rows = parseCsv(await file.text());
    if (!rows.length || !("Full Name" in rows[0]) || !("Email Address" in rows[0])) {
      setError("That isn't the Employee Application CSV export.");
      return;
    }
    setApps(newestFirst(rows.map(parseCsvRow)));
  }

  async function run(apply: boolean) {
    if (!apps) return;
    if (apply && !confirm(`Load ${apps.length} applications into the Employee list?`)) return;
    setBusy(apply ? "Loading…" : "Checking…"); setError(null);
    try {
      if (!apply) {
        setReport(await post(apps, false));
      } else {
        const all: ReportRow[] = [];
        for (let i = 0; i < apps.length; i += CHUNK) {
          setBusy(`Loading… ${i} of ${apps.length}`);
          all.push(...(await post(apps.slice(i, i + CHUNK), true)));
        }
        setReport(all);
        setApplied(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
    setBusy("");
  }

  const counts = new Map<string, number>();
  for (const r of report ?? []) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const shown = (report ?? []).filter((r) => !show || r.outcome === show);

  return (
    <div className="card">
      <div className="action-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} disabled={!!busy} />
        <button className="secondary" onClick={() => run(false)} disabled={!apps || !!busy} title="Show what would happen. Nothing is saved.">Check</button>
        <button onClick={() => run(true)} disabled={!apps || !report || applied || !!busy} title="Run Check first">Load</button>
        {busy && <span className="muted">{busy}</span>}
      </div>
      {apps && <div className="muted" style={{ marginTop: 8 }}>{fileName}: {apps.length} applications</div>}
      {error && <div style={{ color: "#b00", marginTop: 8 }}>{error}</div>}
      {report && (
        <>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {applied && <span className="pill pill-green">Loaded</span>}
            <button className={show ? "secondary" : ""} style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => setShow("")}>All {report.length}</button>
            {[...counts].map(([k, n]) => (
              <button key={k} className={show === k ? "" : "secondary"} style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => setShow(k)}>
                {LABEL[k as ReportRow["outcome"]] ?? k} {n}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table>
              <thead><tr><th>Applied</th><th>Name</th><th>Email</th><th>Result</th><th>Record</th><th>Notes</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.submissionId}-${r.email}`}>
                    <td>{r.submittedOn}</td>
                    <td>{r.name}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{r.email}</td>
                    <td>{LABEL[r.outcome]}{r.matchReason ? ` (${r.matchReason})` : ""}</td>
                    <td><small>{r.employeeKey ?? ""}</small></td>
                    <td style={{ fontSize: 12 }}>
                      {r.differences.length > 0 && <div>AOS has a different {r.differences.join(" and ")}</div>}
                      {r.notes.map((n) => <div key={n}>{n}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

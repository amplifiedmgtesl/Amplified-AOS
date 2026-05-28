"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getPayrollRun,
  getPayrollRunEntries,
  finalizePayrollRun,
  reopenPayrollRun,
  voidPayrollRun,
  removeEntryFromRun,
  updatePayrollRunMeta,
} from "@/lib/store/payroll";
import type { PayrollRun, PayrollRunEntry, PayrollRunStatus } from "@/lib/store/types";
import { loadJobRequests } from "@/lib/store/app-store";

function statusBadge(s: PayrollRunStatus) {
  const map: Record<PayrollRunStatus, { bg: string; fg: string; label: string }> = {
    draft:     { bg: "#fff4d6", fg: "#7a5a1a", label: "Draft" },
    finalized: { bg: "#e8f7e8", fg: "#1a5a1a", label: "Finalized" },
    exported:  { bg: "#eaf2fb", fg: "#1a4a7a", label: "Exported" },
    voided:    { bg: "#fbeaea", fg: "#8a1a1a", label: "Voided" },
  };
  const m = map[s];
  return <span className="badge" style={{ background: m.bg, color: m.fg }}>{m.label}</span>;
}

function fullName(e: PayrollRunEntry) {
  return `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.email || "—";
}

export default function PayrollRunDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [entries, setEntries] = useState<PayrollRunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Editable header fields (only used while status === 'draft').
  const [payDate, setPayDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    const [r, es] = await Promise.all([getPayrollRun(runId), getPayrollRunEntries(runId)]);
    setRun(r);
    setEntries(es);
    if (r) {
      setPayDate(r.payDate);
      setPeriodStart(r.periodStart ?? "");
      setPeriodEnd(r.periodEnd ?? "");
      setNotes(r.notes ?? "");
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [runId]);

  // job_no lookup for nicer entry rows.
  const jobNoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of loadJobRequests()) if (j.jobNo) m.set(j.id, j.jobNo);
    return m;
  }, [entries]);

  // Group entries by employee.
  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; rows: PayrollRunEntry[] }>();
    for (const e of entries) {
      const key = e.employeeKey ?? `__noemp__:${e.email ?? fullName(e)}`;
      let g = m.get(key);
      if (!g) { g = { label: fullName(e), rows: [] }; m.set(key, g); }
      g.rows.push(e);
    }
    return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [entries]);

  if (loading) return <div className="card"><div className="muted">Loading…</div></div>;
  if (!run) return <div className="card"><div className="muted">Run not found.</div><Link href="/payroll">← Back to payroll runs</Link></div>;

  const isDraft = run.status === "draft";
  const isFinalized = run.status === "finalized";
  const isVoided = run.status === "voided";

  async function handleSaveMeta() {
    if (!isDraft) return;
    setBusy("save");
    try {
      await updatePayrollRunMeta(runId, {
        payDate,
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined,
        notes: notes || undefined,
      });
      await load();
    } catch (e: any) {
      alert(`Save failed: ${e?.message ?? "unknown error"}`);
    } finally { setBusy(null); }
  }

  async function handleFinalize() {
    if (!confirm(`Finalize this payroll run? Once finalized, included entries are locked until the run is voided.`)) return;
    setBusy("finalize");
    try { await finalizePayrollRun(runId); await load(); }
    catch (e: any) { alert(`Finalize failed: ${e?.message ?? "unknown error"}`); }
    finally { setBusy(null); }
  }
  async function handleReopen() {
    if (!confirm(`Reopen this run as a draft? You'll be able to add/remove entries again.`)) return;
    setBusy("reopen");
    try { await reopenPayrollRun(runId); await load(); }
    catch (e: any) { alert(`Reopen failed: ${e?.message ?? "unknown error"}`); }
    finally { setBusy(null); }
  }
  async function handleVoid() {
    const reason = prompt(`Void this payroll run? Entries will be released back to the candidate pool.\n\nVoid reason (optional):`);
    if (reason === null) return;
    setBusy("void");
    try { await voidPayrollRun(runId, reason || undefined); await load(); }
    catch (e: any) { alert(`Void failed: ${e?.message ?? "unknown error"}`); }
    finally { setBusy(null); }
  }
  async function handleRemoveEntry(runEntryId: string) {
    if (!isDraft) return;
    if (!confirm("Remove this entry from the run?")) return;
    setBusy("remove:" + runEntryId);
    try { await removeEntryFromRun(runEntryId); await load(); }
    catch (e: any) { alert(`Remove failed: ${e?.message ?? "unknown error"}`); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Header */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link href="/payroll" className="muted" style={{ textDecoration: "none" }}>← All runs</Link>
            <h2 style={{ margin: 0 }}>Pay Date: {run.payDate}</h2>
            {statusBadge(run.status)}
            <span className="record-id" title="Payroll run id">{run.id}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {isDraft && (
              <>
                <button onClick={handleFinalize} disabled={!!busy || entries.length === 0}>
                  {busy === "finalize" ? "Finalizing…" : "Finalize"}
                </button>
                <button className="secondary" onClick={handleVoid} disabled={!!busy} style={{ color: "#a00", borderColor: "#e0a0a0" }}>
                  {busy === "void" ? "Voiding…" : "Void"}
                </button>
              </>
            )}
            {isFinalized && (
              <>
                <button className="secondary" onClick={handleReopen} disabled={!!busy}>
                  {busy === "reopen" ? "Reopening…" : "Reopen"}
                </button>
                <button className="secondary" onClick={handleVoid} disabled={!!busy} style={{ color: "#a00", borderColor: "#e0a0a0" }}>
                  {busy === "void" ? "Voiding…" : "Void"}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div>
            <small>Pay date</small>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} disabled={!isDraft} />
          </div>
          <div>
            <small>Period start</small>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={!isDraft} />
          </div>
          <div>
            <small>Period end</small>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={!isDraft} />
          </div>
          <div>
            <small>Notes</small>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!isDraft} />
          </div>
        </div>
        {isDraft && (
          <div className="action-row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="secondary" onClick={handleSaveMeta} disabled={!!busy}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}

        <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>
          <strong>{run.entryCount}</strong> entries ·{" "}
          <strong>{run.employeeCount}</strong> employees ·{" "}
          <strong>{run.totalHours.toFixed(1)}</strong> hrs ·{" "}
          <strong>${run.totalPay.toFixed(2)}</strong> total pay
        </div>

        {isVoided && (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#fbeaea", border: "1px solid #e0a0a0", borderRadius: 6 }}>
            <strong>Voided</strong> {run.voidedAt && <span className="muted">at {new Date(run.voidedAt).toLocaleString()}</span>}
            {run.voidReason ? <div style={{ marginTop: 4 }}>Reason: {run.voidReason}</div> : null}
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              Entries have been released and are available for inclusion in a new run.
            </div>
          </div>
        )}
      </div>

      {/* Entries */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Included entries</h3>
        {entries.length === 0 ? (
          <div className="muted" style={{ padding: "12px 0" }}>
            {isVoided ? "Run was voided — no entries remain." : "No entries on this run."}
          </div>
        ) : (
          grouped.map((g) => {
            const hrs = g.rows.reduce((s, r) => s + r.totalHours, 0);
            const pay = g.rows.reduce((s, r) => s + r.totalPay, 0);
            return (
              <div key={g.label} style={{ marginBottom: 14, border: "1px solid #eee", borderRadius: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f7f7f9", padding: "8px 12px" }}>
                  <strong>{g.label}</strong>
                  <div style={{ fontSize: 13 }}>
                    {g.rows.length} entr{g.rows.length === 1 ? "y" : "ies"} ·{" "}
                    <strong>{hrs.toFixed(1)}</strong> hrs ·{" "}
                    <strong>${pay.toFixed(2)}</strong>
                  </div>
                </div>
                <div className="table-scroll">
                  <table style={{ marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Job</th>
                        <th>Position</th>
                        <th style={{ textAlign: "right" }}>Std</th>
                        <th style={{ textAlign: "right" }}>OT</th>
                        <th style={{ textAlign: "right" }}>DT</th>
                        <th style={{ textAlign: "right" }}>Total</th>
                        <th style={{ textAlign: "right" }}>Pay</th>
                        {isDraft && <th style={{ width: 90 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.workDate || "—"}{r.isHoliday && <span className="badge" style={{ marginLeft: 6, background: "#ffe9c2", color: "#7a4a1a", fontSize: 11 }}>Holiday</span>}</td>
                          <td>{r.jobId ? (jobNoById.get(r.jobId) ?? r.jobId) : <span className="muted">Office / Remote</span>}</td>
                          <td>{r.position || "—"}</td>
                          <td style={{ textAlign: "right" }}>{r.stdHours.toFixed(1)}</td>
                          <td style={{ textAlign: "right" }}>{r.otHours > 0 ? r.otHours.toFixed(1) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{r.dtHours > 0 ? r.dtHours.toFixed(1) : "—"}</td>
                          <td style={{ textAlign: "right" }}><strong>{r.totalHours.toFixed(1)}</strong></td>
                          <td style={{ textAlign: "right" }}>${r.totalPay.toFixed(2)}</td>
                          {isDraft && (
                            <td style={{ textAlign: "right" }}>
                              <button
                                className="secondary"
                                onClick={() => handleRemoveEntry(r.id)}
                                disabled={!!busy}
                                style={{ padding: "2px 8px", fontSize: 12, color: "#a00", borderColor: "#e0a0a0" }}
                              >
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

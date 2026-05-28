"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getPayrollRun,
  getPayrollRunEntries,
  getPayrollRunPrintExtras,
  finalizePayrollRun,
  reopenPayrollRun,
  voidPayrollRun,
  removeEntryFromRun,
  updatePayrollRunMeta,
  updatePayrollRunEntryBaseRate,
  PAYROLL_OT_MULTIPLIER,
  PAYROLL_DT_MULTIPLIER,
  type PayrollRunPrintExtras,
} from "@/lib/store/payroll";
import type { PayrollRun, PayrollRunEntry, PayrollRunStatus } from "@/lib/store/types";
import { loadJobRequests } from "@/lib/store/app-store";
import { printWithTitle } from "@/lib/print-with-title";

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

/** Small inline editor for the per-entry base pay rate. Local state holds
 *  the typed value so users can type freely without firing a save per
 *  keystroke; commit happens on blur or Enter. */
function BaseRateInput({
  initial,
  disabled,
  busy,
  onCommit,
}: {
  initial: number;
  disabled: boolean;
  busy: boolean;
  onCommit: (value: number) => void;
}) {
  const [val, setVal] = useState<string>(initial.toFixed(2));
  // Keep local state in sync if the parent reloads with a new value.
  useEffect(() => { setVal(initial.toFixed(2)); }, [initial]);

  function commit() {
    const num = Number(val);
    if (!isFinite(num) || num < 0) {
      setVal(initial.toFixed(2));
      return;
    }
    if (Math.abs(num - initial) < 0.005) return;  // no-op if unchanged
    onCommit(num);
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <span>$</span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        disabled={disabled}
        style={{ width: 64, padding: "2px 4px", fontSize: 12, textAlign: "right" }}
        title="Base hourly pay rate. OT and DT auto-derive from this; holiday pay collapses to base × holiday multiplier."
      />
      {busy && <span className="muted" style={{ fontSize: 10 }}>…</span>}
    </span>
  );
}

export default function PayrollRunDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [entries, setEntries] = useState<PayrollRunEntry[]>([]);
  const [printExtras, setPrintExtras] = useState<Map<string, PayrollRunPrintExtras>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Editable header fields (only used while status === 'draft').
  const [payDate, setPayDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    const [r, es, ex] = await Promise.all([
      getPayrollRun(runId),
      getPayrollRunEntries(runId),
      getPayrollRunPrintExtras(runId),
    ]);
    setRun(r);
    setEntries(es);
    setPrintExtras(ex);
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
  async function handleSaveBaseRate(runEntryId: string, baseRate: number) {
    if (!isDraft) return;
    if (!isFinite(baseRate) || baseRate < 0) {
      alert("Base rate must be a non-negative number.");
      return;
    }
    setBusy("rate:" + runEntryId);
    try {
      await updatePayrollRunEntryBaseRate(runEntryId, baseRate);
      await load();
    } catch (e: any) {
      alert(`Rate update failed: ${e?.message ?? "unknown error"}`);
    } finally { setBusy(null); }
  }

  async function handleRemoveEntry(runEntryId: string) {
    if (!isDraft) return;
    if (!confirm("Remove this entry from the run?")) return;
    setBusy("remove:" + runEntryId);
    try { await removeEntryFromRun(runEntryId); await load(); }
    catch (e: any) { alert(`Remove failed: ${e?.message ?? "unknown error"}`); }
    finally { setBusy(null); }
  }

  // ─── Print payload (matches the production timekeeping payroll output) ────
  // Build a sorted, flat list of rows with the live time/meal fields merged
  // in. Then aggregate by employee for the summary table + grand total.
  type PrintRow = PayrollRunEntry & PayrollRunPrintExtras;
  const printRows: PrintRow[] = entries
    .map((e) => ({
      ...e,
      timeIn1:  printExtras.get(e.timesheetEntryId)?.timeIn1  ?? "",
      timeOut1: printExtras.get(e.timesheetEntryId)?.timeOut1 ?? "",
      timeIn2:  printExtras.get(e.timesheetEntryId)?.timeIn2  ?? "",
      timeOut2: printExtras.get(e.timesheetEntryId)?.timeOut2 ?? "",
      mealBreak1Minutes: printExtras.get(e.timesheetEntryId)?.mealBreak1Minutes ?? 0,
      mealBreak2Minutes: printExtras.get(e.timesheetEntryId)?.mealBreak2Minutes ?? 0,
    }))
    .sort((a, b) => {
      const da = a.workDate || ""; const db = b.workDate || "";
      if (da !== db) return da.localeCompare(db);
      const an = `${a.lastName ?? ""} ${a.firstName ?? ""}`;
      const bn = `${b.lastName ?? ""} ${b.firstName ?? ""}`;
      return an.localeCompare(bn);
    });

  type EmpAgg = { name: string; position: string; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; entries: number };
  const byEmp = new Map<string, EmpAgg>();
  for (const r of printRows) {
    const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email || "—";
    const cur = byEmp.get(name) ?? { name, position: r.position ?? "", stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, totalPay: 0, entries: 0 };
    cur.stdHours += r.stdHours;
    cur.otHours  += r.otHours;
    cur.dtHours  += r.dtHours;
    cur.totalHours += r.totalHours;
    cur.totalPay   += r.totalPay;
    cur.entries += 1;
    if (!cur.position && r.position) cur.position = r.position;
    byEmp.set(name, cur);
  }
  const empRows = Array.from(byEmp.values()).sort((a, b) => a.name.localeCompare(b.name));
  const grand = printRows.reduce(
    (acc, r) => ({
      stdHours: acc.stdHours + r.stdHours,
      otHours:  acc.otHours  + r.otHours,
      dtHours:  acc.dtHours  + r.dtHours,
      totalHours: acc.totalHours + r.totalHours,
      totalPay:   acc.totalPay   + r.totalPay,
    }),
    { stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, totalPay: 0 },
  );
  const fmtDay = (s: string) => {
    if (!s) return "";
    const d = new Date(s + "T00:00:00");
    return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${s}`;
  };

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
          <div style={{ display: "flex", gap: 8 }} className="hide-print">
            <button
              className="secondary"
              onClick={() => printWithTitle(["Payroll Report", run.payDate, run.notes || undefined])}
              disabled={!!busy || entries.length === 0}
              title={entries.length === 0 ? "No entries to print" : "Print / Download PDF of this payroll run"}
            >
              📄 Print Payroll Report
            </button>
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

      {/* Entries (on-screen view, hidden when printing) */}
      <div className="card hide-print">
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
                        <th
                          style={{ textAlign: "right" }}
                          title={`Base pay rate per hour. OT auto = base × ${PAYROLL_OT_MULTIPLIER}, DT auto = base × ${PAYROLL_DT_MULTIPLIER}. Holiday rows collapse to base × holiday multiplier.`}
                        >
                          Base $/hr
                        </th>
                        <th style={{ textAlign: "right" }}>Pay</th>
                        {isDraft && <th style={{ width: 90 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => {
                        const mult = r.holidayMultiplier ?? 2.0;
                        const rateTooltip = r.isHoliday
                          ? `Holiday — pay = ${r.totalHours.toFixed(2)} hrs × $${r.stdRate.toFixed(2)} × ${mult} (OT/DT premium does not stack)`
                          : `Pay = ${r.stdHours.toFixed(2)} × $${r.stdRate.toFixed(2)}` +
                            (r.otHours > 0 ? ` + ${r.otHours.toFixed(2)} × $${r.otRate.toFixed(2)} (OT)` : "") +
                            (r.dtHours > 0 ? ` + ${r.dtHours.toFixed(2)} × $${r.dtRate.toFixed(2)} (DT)` : "");
                        return (
                        <tr key={r.id}>
                          <td>{r.workDate || "—"}{r.isHoliday && <span className="badge" style={{ marginLeft: 6, background: "#ffe9c2", color: "#7a4a1a", fontSize: 11 }}>Holiday {mult}×</span>}</td>
                          <td>{r.jobId ? (jobNoById.get(r.jobId) ?? r.jobId) : <span className="muted">Office / Remote</span>}</td>
                          <td>{r.position || "—"}</td>
                          <td style={{ textAlign: "right" }}>{r.stdHours.toFixed(1)}</td>
                          <td style={{ textAlign: "right" }}>{r.otHours > 0 ? r.otHours.toFixed(1) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{r.dtHours > 0 ? r.dtHours.toFixed(1) : "—"}</td>
                          <td style={{ textAlign: "right" }}><strong>{r.totalHours.toFixed(1)}</strong></td>
                          <td style={{ textAlign: "right" }}>
                            {isDraft ? (
                              <BaseRateInput
                                key={`${r.id}:${r.stdRate}`}
                                initial={r.stdRate}
                                disabled={!!busy}
                                busy={busy === "rate:" + r.id}
                                onCommit={(v) => handleSaveBaseRate(r.id, v)}
                              />
                            ) : (
                              <span title={`OT $${r.otRate.toFixed(2)} · DT $${r.dtRate.toFixed(2)}`}>${r.stdRate.toFixed(2)}</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }} title={rateTooltip}>${r.totalPay.toFixed(2)}</td>
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
                      );})}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ─── Print-only payroll report ────────────────────────────────────
          Hidden on screen via .show-print; rendered into the print stream
          when "Print Payroll Report" is clicked. Modeled after the
          production timekeeping payroll output (one-row-per-entry detail
          + per-employee summary + grand total), with the new payroll-run
          header info on top (pay date, period, status, run id, notes). */}
      <div className="show-print">
        {/* Report header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 12, borderBottom: "2px solid #181410", paddingBottom: 8 }}>
          <img src="/branding/client-logo.png" alt="Logo" style={{ height: 48 }} />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Payroll Report</h2>
            <div style={{ fontSize: 11, marginTop: 4, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 2 }}>
              <strong>Pay Date:</strong><span>{run.payDate}</span>
              {(run.periodStart || run.periodEnd) && (
                <>
                  <strong>Period:</strong>
                  <span>{run.periodStart ?? "…"} → {run.periodEnd ?? "…"}</span>
                </>
              )}
              <strong>Status:</strong><span style={{ textTransform: "capitalize" }}>{run.status}</span>
              <strong>Run ID:</strong><span style={{ fontFamily: "monospace", fontSize: 10 }}>{run.id}</span>
              {run.notes && (<><strong>Notes:</strong><span>{run.notes}</span></>)}
              {run.finalizedAt && (<><strong>Finalized:</strong><span>{new Date(run.finalizedAt).toLocaleString()}</span></>)}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10 }}>
            <div className="muted">Generated {new Date().toLocaleString()}</div>
            <div style={{ marginTop: 4 }}>
              <strong>{run.entryCount}</strong> entries · <strong>{run.employeeCount}</strong> employees
            </div>
            <div>
              <strong>{run.totalHours.toFixed(1)}</strong> hrs · <strong>${run.totalPay.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        {/* Detail: one row per entry */}
        <h3 style={{ fontSize: 12, margin: "0 0 6px 0" }}>Payroll Detail</h3>
        <table style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f3e6cf" }}>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>Date</th>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>Employee</th>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>Position</th>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>Job</th>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>In 1</th>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>Out 1</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>M1</th>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>In 2</th>
              <th style={{ textAlign: "left",  padding: "3px 5px" }}>Out 2</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>M2</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>STD</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>OT</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>DT</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>Total</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>$/STD</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>$/OT</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>$/DT</th>
              <th style={{ textAlign: "right", padding: "3px 5px" }}>Pay</th>
            </tr>
          </thead>
          <tbody>
            {printRows.length === 0 ? (
              <tr><td colSpan={18} style={{ textAlign: "center", color: "#888", padding: 6 }}>No entries.</td></tr>
            ) : printRows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #ead7b8" }}>
                <td style={{ padding: "3px 5px" }}>{fmtDay(r.workDate || "")}{r.isHoliday && " 🎄"}</td>
                <td style={{ padding: "3px 5px" }}>{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email || "—"}</td>
                <td style={{ padding: "3px 5px" }}>{r.position || ""}</td>
                <td style={{ padding: "3px 5px" }}>{r.jobId ? (jobNoById.get(r.jobId) ?? "") : ""}</td>
                <td style={{ padding: "3px 5px" }}>{r.timeIn1}</td>
                <td style={{ padding: "3px 5px" }}>{r.timeOut1}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.mealBreak1Minutes || ""}</td>
                <td style={{ padding: "3px 5px" }}>{r.timeIn2}</td>
                <td style={{ padding: "3px 5px" }}>{r.timeOut2}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.mealBreak2Minutes || ""}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.stdHours.toFixed(2)}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.otHours.toFixed(2)}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.dtHours.toFixed(2)}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.totalHours.toFixed(2)}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>${r.stdRate.toFixed(2)}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>${r.otRate.toFixed(2)}</td>
                <td style={{ padding: "3px 5px", textAlign: "right" }}>${r.dtRate.toFixed(2)}</td>
                <td style={{ padding: "3px 5px", textAlign: "right", fontWeight: 600 }}>${r.totalPay.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Per-employee summary */}
        {empRows.length > 0 && (
          <div style={{ marginTop: 16, pageBreakInside: "avoid" }}>
            <h3 style={{ fontSize: 12, margin: "0 0 6px 0" }}>Payroll Summary by Employee</h3>
            <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f3e6cf" }}>
                  <th style={{ textAlign: "left",  padding: "3px 6px" }}>Employee</th>
                  <th style={{ textAlign: "left",  padding: "3px 6px" }}>Position</th>
                  <th style={{ textAlign: "right", padding: "3px 6px" }}>Entries</th>
                  <th style={{ textAlign: "right", padding: "3px 6px" }}>STD</th>
                  <th style={{ textAlign: "right", padding: "3px 6px" }}>OT</th>
                  <th style={{ textAlign: "right", padding: "3px 6px" }}>DT</th>
                  <th style={{ textAlign: "right", padding: "3px 6px" }}>Total Hrs</th>
                  <th style={{ textAlign: "right", padding: "3px 6px" }}>Total Pay</th>
                </tr>
              </thead>
              <tbody>
                {empRows.map((r) => (
                  <tr key={r.name} style={{ borderBottom: "1px solid #ead7b8" }}>
                    <td style={{ padding: "3px 6px" }}>{r.name}</td>
                    <td style={{ padding: "3px 6px" }}>{r.position}</td>
                    <td style={{ textAlign: "right", padding: "3px 6px" }}>{r.entries}</td>
                    <td style={{ textAlign: "right", padding: "3px 6px" }}>{r.stdHours.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "3px 6px" }}>{r.otHours.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "3px 6px" }}>{r.dtHours.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "3px 6px" }}>{r.totalHours.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "3px 6px" }}>${r.totalPay.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #181410", fontWeight: 700 }}>
                  <th colSpan={3} style={{ textAlign: "left", padding: "4px 6px" }}>Grand Total</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>{grand.stdHours.toFixed(2)}</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>{grand.otHours.toFixed(2)}</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>{grand.dtHours.toFixed(2)}</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>{grand.totalHours.toFixed(2)}</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>${grand.totalPay.toFixed(2)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

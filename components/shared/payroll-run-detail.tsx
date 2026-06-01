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
  removeZeroHourEntriesFromRun,
  recomputeDailyRulesForRun,
  updatePayrollRunMeta,
  updatePayrollRunEntryBaseRate,
  normalizePayrollRunRates,
  getPayrollCandidates,
  addEntriesToPayrollRun,
  previewWeeklyOT,
  PAYROLL_OT_MULTIPLIER,
  PAYROLL_DT_MULTIPLIER,
  PAYROLL_DAILY_MINIMUM_HOURS,
  PAYROLL_WEEKLY_OT_THRESHOLD,
  type PayrollCandidateRow,
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

/** Inline candidate picker for adding late-approved entries to an existing
 *  draft run. Same filters as the New Run wizard but scoped to "add to
 *  this run" — confirm pushes the selected rows into payroll_run_entries
 *  via addEntriesToPayrollRun.
 *
 *  existingTimesheetIds is passed so we can de-dup any candidate row that
 *  happens to already be on the run (shouldn't normally happen — the DB
 *  unique index would reject — but it's a friendlier UX to hide them). */
function AddEntriesPanel({
  runId,
  existingTimesheetIds,
  onAdded,
}: {
  runId: string;
  existingTimesheetIds: string[];
  onAdded: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [employmentType, setEmploymentType] = useState<"" | "staff" | "contractor">("");
  const [rows, setRows] = useState<PayrollCandidateRow[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const existingSet = useMemo(() => new Set(existingTimesheetIds), [existingTimesheetIds]);

  // Job options for the dropdown — same source as the New Run wizard.
  // Loaded from the in-memory job_requests cache.
  const jobOptions = useMemo(() => {
    return loadJobRequests()
      .filter((j) => j.id)
      .map((j) => ({
        id: j.id,
        // Job number is sufficient to identify the event — keep the
        // dropdown label compact. Fall back to client+event for jobs
        // that don't yet have a generated job_no.
        label: j.jobNo || [j.client, j.eventName].filter(Boolean).join(" — ") || "(untitled)",
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  async function runSearch() {
    setLoading(true);
    try {
      const data = await getPayrollCandidates({
        dateFrom: dateFrom || undefined,
        dateTo:   dateTo   || undefined,
        jobIds:   jobFilter ? [jobFilter] : undefined,
        employmentType: employmentType || undefined,
      });
      // Hide entries already on this run (belt-and-suspenders — the
      // candidate query already filters out anything in a payroll_run).
      const fresh = data.filter((r) => !existingSet.has(r.timesheetEntryId));
      setRows(fresh);
      setExcluded(new Set());
      setHasSearched(true);
    } finally { setLoading(false); }
  }

  const included = rows.filter((r) => !excluded.has(r.timesheetEntryId));
  const totals = {
    entries: included.length,
    hours: included.reduce((s, r) => s + r.totalHours, 0),
    // Pay totals come from the snapshot AFTER add — operator types rates
    // per row on the run detail page. Candidate rows carry hours only.
  };

  async function handleAdd() {
    if (included.length === 0) return;
    setSubmitting(true);
    try {
      const n = await addEntriesToPayrollRun(runId, included);
      setOpen(false);
      setRows([]);
      setExcluded(new Set());
      setHasSearched(false);
      await onAdded();
      // Tiny confirmation — non-blocking.
      console.log(`[payroll] added ${n} entries to run ${runId}`);
    } catch (e: any) {
      alert(`Add failed: ${e?.message ?? "unknown error"}`);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="card hide-print">
      <div className="action-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 14 }}>Add more entries</strong>
        <button
          className="secondary"
          onClick={() => setOpen((v) => !v)}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          {open ? "Hide" : "+ Pick more"}
        </button>
      </div>
      {open && (
        <>
          <div className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 8 }}>
            Pulls approved timesheet entries that aren't already on a payroll run.
            Use to grab anything approved after this run was created.
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            <div>
              <small>From date</small>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <small>To date</small>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <small>Job</small>
              <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
                <option value="">— Any job —</option>
                {jobOptions.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
              </select>
            </div>
            <div>
              <small>Employment type</small>
              <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as any)}>
                <option value="">Any (staff + contractor)</option>
                <option value="staff">Staff (W-2)</option>
                <option value="contractor">Contractor (1099)</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button onClick={runSearch} disabled={loading} style={{ width: "100%" }}>
                {loading ? "Searching…" : "Search candidates"}
              </button>
            </div>
          </div>

          {hasSearched && (
            <div style={{ marginTop: 12 }}>
              {rows.length === 0 ? (
                <div className="muted" style={{ padding: "8px 0" }}>
                  No new candidates match. (Already-on-this-run entries are filtered out automatically.)
                </div>
              ) : (
                <>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                    <strong>{totals.entries}</strong> selected ·{" "}
                    <strong>{totals.hours.toFixed(1)}</strong> hrs
                    {excluded.size > 0 && <span> ({excluded.size} excluded)</span>}
                    <span style={{ marginLeft: 8, fontStyle: "italic" }}>· pay rates set after add</span>
                  </div>
                  <div className="table-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
                    <table style={{ marginBottom: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}></th>
                          <th>Date</th>
                          <th>Employee</th>
                          <th>Job</th>
                          <th>Position</th>
                          <th>Specialty</th>
                          <th style={{ textAlign: "right" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const isExcluded = excluded.has(r.timesheetEntryId);
                          return (
                            <tr key={r.timesheetEntryId} style={isExcluded ? { opacity: 0.45 } : undefined}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={!isExcluded}
                                  onChange={() => setExcluded((p) => {
                                    const n = new Set(p);
                                    if (n.has(r.timesheetEntryId)) n.delete(r.timesheetEntryId);
                                    else n.add(r.timesheetEntryId);
                                    return n;
                                  })}
                                />
                              </td>
                              <td>{r.workDate || "—"}{r.isHoliday && <span className="badge" style={{ marginLeft: 6, background: "#ffe9c2", color: "#7a4a1a", fontSize: 11 }}>Holiday</span>}</td>
                              <td>{`${r.firstName} ${r.lastName}`.trim() || r.email || "—"}</td>
                              <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                                {r.jobId
                                  ? (r.jobNo ?? r.jobId)
                                  : <span className="muted" style={{ fontFamily: "inherit" }}>Office / Remote</span>}
                              </td>
                              <td>{r.position || "—"}</td>
                              <td title={!r.specialty ? "Missing — pay rate won't auto-resolve" : undefined}>
                                {r.specialty || <span style={{ color: "#c0392b", fontStyle: "italic" }}>— missing —</span>}
                              </td>
                              <td style={{ textAlign: "right" }}><strong>{r.totalHours.toFixed(1)}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="action-row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                    <button onClick={handleAdd} disabled={submitting || totals.entries === 0}>
                      {submitting ? "Adding…" : `Add ${totals.entries} entr${totals.entries === 1 ? "y" : "ies"} to run`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Editable header fields (only used while status === 'draft').
  const [payDate, setPayDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    const [r, es] = await Promise.all([
      getPayrollRun(runId),
      getPayrollRunEntries(runId),
    ]);
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

  // Job lookup for nicer entry rows. We surface jobNo as the primary
  // identifier (Connor uses it to confirm the event at a glance) plus
  // a short label "{client} — {eventName}" as secondary text.
  const jobInfoById = useMemo(() => {
    const m = new Map<string, { jobNo: string | null; client: string; eventName: string; label: string }>();
    for (const j of loadJobRequests()) {
      const label = [j.client, j.eventName].filter(Boolean).join(" — ");
      m.set(j.id, { jobNo: j.jobNo ?? null, client: j.client ?? "", eventName: j.eventName ?? "", label });
    }
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

  // Count entries with no pay rate set — derived locally from the loaded
  // entries. Used to surface the "needs rates" banner and disable Finalize.
  // Server-side guard in finalizePayrollRun() covers the race condition.
  const unratedCount = entries.filter((e) => (e.stdRate ?? 0) === 0).length;
  // Zero-hour entries — no-shows or placeholder rows that got included by
  // mistake. Operator must remove them before finalize.
  const zeroHourCount = entries.filter((e) => (e.payTotalHours ?? 0) === 0).length;
  const finalizeBlocked = unratedCount > 0 || zeroHourCount > 0;

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
    // Run the weekly-OT preview first. If it surfaces any spill, show
    // exactly what will move before locking the run. Operator can cancel
    // and re-review (e.g. remove an entry, change a rate, swap pay week
    // before they commit). Pure read-only — no writes happen until the
    // second confirm.
    setBusy("finalize");
    try {
      let previews: Awaited<ReturnType<typeof previewWeeklyOT>> = [];
      try {
        previews = await previewWeeklyOT(runId);
      } catch (e: any) {
        // If the preview itself fails, fall back to the simple confirm —
        // finalizePayrollRun re-runs the same calc server-side anyway.
        console.error("[payroll] finalize preview:", e);
      }

      let msg: string;
      if (previews.length > 0) {
        const byEmp = new Map<string, string[]>();
        for (const p of previews) {
          const row = entries.find((e) => e.id === p.rowId);
          if (!row) continue;
          const name = fullName(row);
          const list = byEmp.get(name) ?? [];
          list.push(
            `  ${row.workDate}: std ${p.payStdHoursBefore.toFixed(2)}→${p.payStdHoursAfter.toFixed(2)}, ` +
            `ot ${p.payOtHoursBefore.toFixed(2)}→${p.payOtHoursAfter.toFixed(2)}`
          );
          byEmp.set(name, list);
        }
        const detail = Array.from(byEmp.entries())
          .map(([name, lines]) => `${name}:\n${lines.join("\n")}`)
          .join("\n\n");
        msg =
          `Finalize this payroll run?\n\n` +
          `${previews.length} row${previews.length === 1 ? "" : "s"} will shift from std → ot ` +
          `to satisfy the ${PAYROLL_WEEKLY_OT_THRESHOLD}-hr weekly OT rule:\n\n` +
          `${detail}\n\n` +
          `Click OK to apply these adjustments and lock the run, or Cancel to re-review.`;
      } else {
        msg =
          `Finalize this payroll run?\n\n` +
          `No weekly OT spill applies (nobody crosses ${PAYROLL_WEEKLY_OT_THRESHOLD} hrs in a pay week ` +
          `across this run + already-finalized runs).\n\n` +
          `Once finalized, included entries are locked until the run is voided.`;
      }
      if (!confirm(msg)) {
        setBusy(null);
        return;
      }

      await finalizePayrollRun(runId);
      await load();
    } catch (e: any) {
      alert(`Finalize failed: ${e?.message ?? "unknown error"}`);
    } finally { setBusy(null); }
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
  async function handleNormalizeRates() {
    if (!isDraft) return;
    if (!confirm(
      `Recalculate every entry's OT and DT from the base rate?\n\n` +
      `OT = base × ${PAYROLL_OT_MULTIPLIER}\n` +
      `DT = base × ${PAYROLL_DT_MULTIPLIER}\n` +
      `Holiday rows: base × holiday multiplier (no OT/DT stack).\n\n` +
      `Total pay updates accordingly.`
    )) return;
    setBusy("normalize");
    try {
      const n = await normalizePayrollRunRates(runId);
      await load();
      alert(`Recalculated ${n} entr${n === 1 ? "y" : "ies"}.`);
    } catch (e: any) {
      alert(`Recalculate failed: ${e?.message ?? "unknown error"}`);
    } finally { setBusy(null); }
  }

  async function handleRecomputeDailyRules() {
    if (!isDraft) return;
    if (!confirm(
      `Re-apply Connor's daily payroll rules to every entry?\n\n` +
      `• ${PAYROLL_DAILY_MINIMUM_HOURS}-hour daily minimum per (employee, work date)\n` +
      `• Round up to next whole hour\n` +
      `• Extras land in pay_std (OT/DT classifications preserved)\n\n` +
      `Use this when entries were added before the rules were live or via a data fix. ` +
      `Total pay recomputes from the existing rates. The weekly OT calc resets.`
    )) return;
    setBusy("recompute-daily");
    try {
      const n = await recomputeDailyRulesForRun(runId);
      await load();
      alert(`Re-applied daily rules to ${n} entr${n === 1 ? "y" : "ies"}.`);
    } catch (e: any) {
      alert(`Recompute failed: ${e?.message ?? "unknown error"}`);
    } finally { setBusy(null); }
  }

  async function handlePreviewOT() {
    if (!isDraft) return;
    setBusy("preview-ot");
    try {
      const previews = await previewWeeklyOT(runId);
      if (previews.length === 0) {
        alert(
          `No weekly OT spill — nobody on this run exceeds ${PAYROLL_WEEKLY_OT_THRESHOLD} hrs in a pay week ` +
          `(counting this run + already-finalized runs).`
        );
        return;
      }
      // Build a row-by-row summary by employee.
      const byEmp = new Map<string, { name: string; lines: string[] }>();
      for (const p of previews) {
        const row = entries.find((e) => e.id === p.rowId);
        if (!row) continue;
        const name = fullName(row);
        const list = byEmp.get(name) ?? { name, lines: [] };
        list.lines.push(
          `  ${row.workDate}: std ${p.payStdHoursBefore.toFixed(2)} → ${p.payStdHoursAfter.toFixed(2)}, ` +
          `ot ${p.payOtHoursBefore.toFixed(2)} → ${p.payOtHoursAfter.toFixed(2)}`
        );
        byEmp.set(name, list);
      }
      const msg = Array.from(byEmp.values())
        .map((g) => `${g.name}:\n${g.lines.join("\n")}`)
        .join("\n\n");
      alert(
        `Weekly OT preview (would apply at finalize):\n\n` +
        `${previews.length} row${previews.length === 1 ? "" : "s"} would shift std → ot ` +
        `past ${PAYROLL_WEEKLY_OT_THRESHOLD} hrs/week.\n\n` +
        msg
      );
    } catch (e: any) {
      alert(`Preview failed: ${e?.message ?? "unknown error"}`);
    } finally { setBusy(null); }
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

  async function handleRemoveZeroHourEntries() {
    if (!isDraft) return;
    if (zeroHourCount === 0) return;
    if (!confirm(
      `Remove ${zeroHourCount} zero-hour entr${zeroHourCount === 1 ? "y" : "ies"} from this run?\n\n` +
      `These are no-shows or placeholder rows that contribute $0 to payroll. ` +
      `They'll be released back to the candidate pool so they can be re-added later if needed.`
    )) return;
    setBusy("remove-zero");
    try {
      const n = await removeZeroHourEntriesFromRun(runId);
      await load();
      alert(`Removed ${n} zero-hour entr${n === 1 ? "y" : "ies"}.`);
    } catch (e: any) {
      alert(`Remove failed: ${e?.message ?? "unknown error"}`);
    } finally { setBusy(null); }
  }

  // Printable report now lives at /payroll/[id]/pdf (separate route,
  // no AppShell chrome — same flow as /quotes/[id]/pdf and
  // /invoices/[id]/pdf). The button in the header opens that page in a
  // new tab; the operator hits "Print / Save as PDF" from there.

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Header — no longer needs hide-print since the print stream
          lives on a separate route. Kept as the on-screen view only. */}
      <div className="card">
        {/* Title row — matches the All Quotes / All Invoices convention:
            H2 fills the left, "← All Runs" badge anchors the right. */}
        <div className="action-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
          <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
            Pay Date: {run.payDate}
            <span style={{ marginLeft: 12 }}>{statusBadge(run.status)}</span>
            <span className="record-id" title="Payroll run id" style={{ marginLeft: 8 }}>{run.id}</span>
          </h2>
          <Link href="/payroll" className="badge">← All Runs</Link>
        </div>

        {/* Action buttons (separate row so the back link stays anchored) */}
        <div className="action-row hide-print" style={{ marginBottom: 12, justifyContent: "flex-end", gap: 8 }}>
          <button
            className="secondary"
            onClick={() => window.open(`/payroll/${run.id}/pdf`, "_blank")}
            disabled={!!busy || entries.length === 0}
            title={entries.length === 0 ? "No entries to print" : "Open printable payroll report"}
          >
            📄 Print / PDF
          </button>
          {isDraft && (
            <>
              <button
                className="secondary"
                onClick={handleRecomputeDailyRules}
                disabled={!!busy || entries.length === 0}
                title={`Re-apply the ${PAYROLL_DAILY_MINIMUM_HOURS}-hour daily minimum and whole-hour round-up to every entry. Use after data fixes or when entries were added before the rules were live.`}
              >
                {busy === "recompute-daily" ? "Applying…" : "📐 Apply daily rules"}
              </button>
              <button
                className="secondary"
                onClick={handlePreviewOT}
                disabled={!!busy || entries.length === 0}
                title={`Preview the weekly ${PAYROLL_WEEKLY_OT_THRESHOLD}-hr OT spill that will apply at finalize. Read-only — nothing is written until you finalize.`}
              >
                {busy === "preview-ot" ? "Calculating…" : "🕐 Preview weekly OT"}
              </button>
              <button
                className="secondary"
                onClick={handleNormalizeRates}
                disabled={!!busy || entries.length === 0}
                title={`Force OT = base × ${PAYROLL_OT_MULTIPLIER}, DT = base × ${PAYROLL_DT_MULTIPLIER} on every entry. Useful after bulk-typing base rates.`}
              >
                {busy === "normalize" ? "Recalculating…" : "🔁 Recalculate rates"}
              </button>
              <button
                onClick={handleFinalize}
                disabled={!!busy || entries.length === 0 || finalizeBlocked}
                title={
                  entries.length === 0
                    ? "No entries on this run"
                    : unratedCount > 0
                      ? `${unratedCount} entr${unratedCount === 1 ? "y has" : "ies have"} no base pay rate set. Fill in Base $/hr first.`
                      : zeroHourCount > 0
                        ? `${zeroHourCount} entr${zeroHourCount === 1 ? "y has" : "ies have"} zero pay hours. Remove them before finalize.`
                        : "Lock this run — included entries become read-only on the timesheet side."
                }
              >
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
          <strong>{run.totalHours.toFixed(1)}</strong> pay hrs ·{" "}
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

      {/* Add more entries — draft runs only. Lets the operator pull in
          late-approved entries without voiding + recreating the run. */}
      {isDraft && (
        <AddEntriesPanel
          runId={runId}
          existingTimesheetIds={entries.map((e) => e.timesheetEntryId)}
          onAdded={load}
        />
      )}

      {/* Banner: needs pay rates before finalize. Draft-only. */}
      {isDraft && unratedCount > 0 && (
        <div className="card" style={{ background: "#fff4d6", borderColor: "#e0c070" }}>
          <strong style={{ color: "#7a5a1a" }}>
            ⚠ {unratedCount} entr{unratedCount === 1 ? "y has" : "ies have"} no base pay rate set.
          </strong>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Fill in <strong>Base $/hr</strong> for every row before finalizing. OT and DT will derive
            automatically (OT = base × {PAYROLL_OT_MULTIPLIER}, DT = base × {PAYROLL_DT_MULTIPLIER}).
          </div>
        </div>
      )}

      {/* Banner: zero-hour entries. Draft-only. Offers a one-click cleanup. */}
      {isDraft && zeroHourCount > 0 && (
        <div className="card" style={{ background: "#fbeaea", borderColor: "#e0a0a0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <strong style={{ color: "#8a1a1a", flex: 1 }}>
              ⚠ {zeroHourCount} entr{zeroHourCount === 1 ? "y has" : "ies have"} zero pay hours.
            </strong>
            <button
              className="secondary"
              onClick={handleRemoveZeroHourEntries}
              disabled={!!busy}
              style={{ color: "#a00", borderColor: "#e0a0a0" }}
            >
              {busy === "remove-zero" ? "Removing…" : `Remove ${zeroHourCount} zero-hour entr${zeroHourCount === 1 ? "y" : "ies"}`}
            </button>
          </div>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            No-show or placeholder rows that contribute $0 to payroll. Remove them before finalize —
            they'll be released back to the candidate pool.
          </div>
        </div>
      )}

      {/* Entries (on-screen view, hidden when printing) */}
      <div className="card hide-print">
        <h3 style={{ marginTop: 0 }}>Included entries</h3>
        {entries.length === 0 ? (
          <div className="muted" style={{ padding: "12px 0" }}>
            {isVoided ? "Run was voided — no entries remain." : "No entries on this run."}
          </div>
        ) : (
          grouped.map((g) => {
            const hrs = g.rows.reduce((s, r) => s + r.payTotalHours, 0);
            const pay = g.rows.reduce((s, r) => s + r.totalPay, 0);
            return (
              <div key={g.label} style={{ marginBottom: 14, border: "1px solid #eee", borderRadius: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f7f7f9", padding: "8px 12px" }}>
                  <strong>{g.label}</strong>
                  <div style={{ fontSize: 13 }}>
                    {g.rows.length} entr{g.rows.length === 1 ? "y" : "ies"} ·{" "}
                    <strong>{hrs.toFixed(1)}</strong> pay hrs ·{" "}
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
                        <th>Specialty</th>
                        <th style={{ textAlign: "right" }} title={`Pay hours after Connor's rules: ${PAYROLL_DAILY_MINIMUM_HOURS}hr daily minimum, round up to next whole hour, weekly ${PAYROLL_WEEKLY_OT_THRESHOLD}hr OT spill (applied at finalize). Hover any cell to see the billed value if different.`}>Std</th>
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
                          ? `Holiday — pay = ${r.payTotalHours.toFixed(2)} hrs × $${r.stdRate.toFixed(2)} × ${mult} (OT/DT premium does not stack)`
                          : `Pay = ${r.payStdHours.toFixed(2)} × $${r.stdRate.toFixed(2)}` +
                            (r.payOtHours > 0 ? ` + ${r.payOtHours.toFixed(2)} × $${r.otRate.toFixed(2)} (OT)` : "") +
                            (r.payDtHours > 0 ? ` + ${r.payDtHours.toFixed(2)} × $${r.dtRate.toFixed(2)} (DT)` : "");
                        const adjusted = r.payAdjustmentReason ? r.payAdjustmentReason : null;
                        // Per-bucket "billed vs pay" tooltips — only emit when they differ.
                        const stdTip = Math.abs(r.payStdHours - r.stdHours) >= 0.005 ? `Billed: ${r.stdHours.toFixed(2)}` : undefined;
                        const otTip  = Math.abs(r.payOtHours  - r.otHours)  >= 0.005 ? `Billed: ${r.otHours.toFixed(2)}`  : undefined;
                        const dtTip  = Math.abs(r.payDtHours  - r.dtHours)  >= 0.005 ? `Billed: ${r.dtHours.toFixed(2)}`  : undefined;
                        const totTip = Math.abs(r.payTotalHours - r.totalHours) >= 0.005 ? `Billed total: ${r.totalHours.toFixed(2)}` : undefined;
                        return (
                        <tr key={r.id}>
                          <td>
                            {r.workDate || "—"}
                            {r.isHoliday && <span className="badge" style={{ marginLeft: 6, background: "#ffe9c2", color: "#7a4a1a", fontSize: 11 }}>Holiday {mult}×</span>}
                            {adjusted && <span className="badge" title={adjusted} style={{ marginLeft: 6, background: "#eaf2fb", color: "#1a4a7a", fontSize: 11 }}>adj</span>}
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                            {r.jobId
                              ? (jobInfoById.get(r.jobId)?.jobNo ?? r.jobId)
                              : <span className="muted" style={{ fontFamily: "inherit" }}>Office / Remote</span>}
                          </td>
                          <td>{r.position || "—"}</td>
                          <td title={!r.specialty ? "No specialty set — pay rate didn't auto-resolve from the rate card. Set the rate manually." : undefined}>
                            {r.specialty || <span style={{ color: "#c0392b", fontStyle: "italic" }}>— missing —</span>}
                          </td>
                          <td style={{ textAlign: "right" }} title={stdTip}>{r.payStdHours.toFixed(1)}</td>
                          <td style={{ textAlign: "right" }} title={otTip}>{r.payOtHours > 0 ? r.payOtHours.toFixed(1) : "—"}</td>
                          <td style={{ textAlign: "right" }} title={dtTip}>{r.payDtHours > 0 ? r.payDtHours.toFixed(1) : "—"}</td>
                          <td style={{ textAlign: "right" }} title={totTip}><strong>{r.payTotalHours.toFixed(1)}</strong></td>
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

    </div>
  );
}

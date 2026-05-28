"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getPayrollCandidates,
  createPayrollRun,
  type PayrollCandidateRow,
} from "@/lib/store/payroll";
import { loadJobRequests } from "@/lib/store/app-store";

function fullName(r: PayrollCandidateRow) {
  return `${r.firstName} ${r.lastName}`.trim() || r.email || "—";
}

function jobLabel(r: PayrollCandidateRow): string {
  if (!r.jobId) return "Office / Remote";
  // Job number alone is sufficient — encodes client + event + date.
  // Fall back to client/event only for legacy jobs without a code.
  return r.jobNo
    || [r.jobClient, r.jobEventName].filter(Boolean).join(" — ")
    || "(untitled job)";
}

export default function PayrollNewRun() {
  const router = useRouter();

  // ─── Filters ─────────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [jobFilter, setJobFilter] = useState<string>("");
  const [employeeFilter, setEmployeeFilter] = useState<string>("");
  const [employmentType, setEmploymentType] = useState<"" | "staff" | "contractor">("");

  // ─── Candidate data ─────────────────────────────────────────────────────
  const [rows, setRows] = useState<PayrollCandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Default: include every candidate row. Operator un-ticks to exclude.
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  // ─── Header form ─────────────────────────────────────────────────────────
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function runSearch() {
    setLoading(true);
    try {
      const data = await getPayrollCandidates({
        dateFrom: dateFrom || undefined,
        dateTo:   dateTo   || undefined,
        jobIds:   jobFilter ? [jobFilter] : undefined,
        employeeKeys: employeeFilter ? [employeeFilter] : undefined,
        employmentType: employmentType || undefined,
      });
      setRows(data);
      setExcludedIds(new Set());
      setHasSearched(true);
    } finally {
      setLoading(false);
    }
  }

  // Cache employees + jobs for the filter dropdowns from already-loaded
  // job_requests + any candidate set we have on screen. (We avoid a fresh
  // employees-table fetch here to stay light; the candidate query returns
  // enough to build a per-employee select.)
  const [jobOptions, setJobOptions] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    const jobs = loadJobRequests();
    setJobOptions(
      jobs
        .filter((j) => j.id)
        .map((j) => ({
          id: j.id,
          // job_no is enough — it encodes client + event + date. Fall
          // back to client/event for legacy jobs without a generated code.
          label: j.jobNo || [j.client, j.eventName].filter(Boolean).join(" — ") || "(untitled)",
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    );
  }, []);

  const employeeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (!r.employeeKey) continue;
      if (!m.has(r.employeeKey)) m.set(r.employeeKey, fullName(r));
    }
    return Array.from(m, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // ─── Grouped preview (by employee) ──────────────────────────────────────
  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; employeeKey: string | null; rows: PayrollCandidateRow[] }>();
    for (const r of rows) {
      const key = r.employeeKey ?? `__noemp__:${r.email || `${r.firstName}-${r.lastName}`}`;
      let g = m.get(key);
      if (!g) {
        g = { label: fullName(r), employeeKey: r.employeeKey, rows: [] };
        m.set(key, g);
      }
      g.rows.push(r);
    }
    return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const totals = useMemo(() => {
    let entries = 0, hours = 0;
    const employeeSet = new Set<string>();
    for (const r of rows) {
      if (excludedIds.has(r.timesheetEntryId)) continue;
      entries += 1;
      hours += r.totalHours;
      if (r.employeeKey) employeeSet.add(r.employeeKey);
    }
    // Pay totals are intentionally absent here — candidate rows carry hours
    // only. Pay rates get filled in per row on the run detail page after
    // creation; the run header recomputes totals via the DB trigger.
    return { entries, hours, employees: employeeSet.size };
  }, [rows, excludedIds]);

  function toggleRow(entryId: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId); else next.add(entryId);
      return next;
    });
  }
  function setGroupExcluded(group: PayrollCandidateRow[], excluded: boolean) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      for (const r of group) {
        if (excluded) next.add(r.timesheetEntryId);
        else next.delete(r.timesheetEntryId);
      }
      return next;
    });
  }

  async function handleCreate() {
    const included = rows.filter((r) => !excludedIds.has(r.timesheetEntryId));
    if (included.length === 0) {
      alert("Select at least one entry to include in the run.");
      return;
    }
    if (!payDate) {
      alert("Pay date is required.");
      return;
    }
    setSubmitting(true);
    try {
      const id = await createPayrollRun({
        payDate,
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined,
        notes: notes || undefined,
        entries: included,
      });
      router.push(`/payroll/${id}`);
    } catch (e: any) {
      console.error("[payroll] create run failed:", e);
      alert(`Could not create payroll run: ${e?.message ?? "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ─── Step 1: Filters ───────────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. Filter candidate entries</h3>
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
            <small>Employee</small>
            <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} disabled={employeeOptions.length === 0}>
              <option value="">— Any employee —</option>
              {employeeOptions.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
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
        </div>
        <div className="action-row" style={{ marginTop: 12, justifyContent: "space-between" }}>
          <small className="muted">
            Pulls approved timesheet entries that aren't already in a non-voided payroll run.
          </small>
          <button onClick={runSearch} disabled={loading}>
            {loading ? "Searching…" : "Search candidates"}
          </button>
        </div>
      </div>

      {/* ─── Step 2: Preview ──────────────────────────────────────────── */}
      {hasSearched && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>2. Review entries to include</h3>
          {rows.length === 0 ? (
            <div className="muted" style={{ padding: "12px 0" }}>
              No approved unpaid entries match these filters.
            </div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                <strong>{totals.entries}</strong> entr{totals.entries === 1 ? "y" : "ies"} ·{" "}
                <strong>{totals.employees}</strong> employees ·{" "}
                <strong>{totals.hours.toFixed(1)}</strong> hrs
                {excludedIds.size > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    ({excludedIds.size} excluded)
                  </span>
                )}
                <span style={{ marginLeft: 8, fontStyle: "italic" }}>
                  · pay rates assigned on the run detail page
                </span>
              </div>

              {grouped.map((g) => {
                const groupExcluded = g.rows.every((r) => excludedIds.has(r.timesheetEntryId));
                const groupPartial = !groupExcluded && g.rows.some((r) => excludedIds.has(r.timesheetEntryId));
                const groupTotalsHrs = g.rows.reduce((s, r) => s + (excludedIds.has(r.timesheetEntryId) ? 0 : r.totalHours), 0);
                return (
                  <div key={g.label + (g.employeeKey ?? "")} style={{ marginBottom: 14, border: "1px solid #eee", borderRadius: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f7f7f9", padding: "8px 12px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!groupExcluded}
                          ref={(el) => { if (el) el.indeterminate = groupPartial; }}
                          onChange={() => setGroupExcluded(g.rows, !groupExcluded)}
                        />
                        <strong>{g.label}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>({g.rows.length} entr{g.rows.length === 1 ? "y" : "ies"})</span>
                      </label>
                      <div style={{ fontSize: 13 }}>
                        <strong>{groupTotalsHrs.toFixed(1)}</strong> hrs
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table style={{ marginBottom: 0 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 28 }}></th>
                            <th>Date</th>
                            <th>Job</th>
                            <th>Position</th>
                            <th style={{ textAlign: "right" }}>Std</th>
                            <th style={{ textAlign: "right" }}>OT</th>
                            <th style={{ textAlign: "right" }}>DT</th>
                            <th style={{ textAlign: "right" }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r) => {
                            const excluded = excludedIds.has(r.timesheetEntryId);
                            return (
                              <tr key={r.timesheetEntryId} style={excluded ? { opacity: 0.45 } : undefined}>
                                <td>
                                  <input type="checkbox" checked={!excluded} onChange={() => toggleRow(r.timesheetEntryId)} />
                                </td>
                                <td>{r.workDate || "—"}{r.isHoliday && <span className="badge" style={{ marginLeft: 6, background: "#ffe9c2", color: "#7a4a1a", fontSize: 11 }}>Holiday</span>}</td>
                                <td>{jobLabel(r)}</td>
                                <td>{r.position || "—"}</td>
                                <td style={{ textAlign: "right" }}>{r.stdHours.toFixed(1)}</td>
                                <td style={{ textAlign: "right" }}>{r.otHours > 0 ? r.otHours.toFixed(1) : "—"}</td>
                                <td style={{ textAlign: "right" }}>{r.dtHours > 0 ? r.dtHours.toFixed(1) : "—"}</td>
                                <td style={{ textAlign: "right" }}><strong>{r.totalHours.toFixed(1)}</strong></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ─── Step 3: Confirm ─────────────────────────────────────────── */}
      {hasSearched && rows.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>3. Paydate &amp; create</h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <small>Pay date *</small>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div>
              <small>Period start (optional)</small>
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <small>Period end (optional)</small>
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <div>
              <small>Notes (optional)</small>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. PPE 5/24" />
            </div>
          </div>
          <div className="action-row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center" }}>
            <div className="muted" style={{ fontSize: 13 }}>
              Will create a <strong>draft</strong> run with <strong>{totals.entries}</strong> entr{totals.entries === 1 ? "y" : "ies"} ({totals.hours.toFixed(1)} hrs). Pay rates assigned per row on the run detail page.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/payroll" className="button secondary">Cancel</Link>
              <button onClick={handleCreate} disabled={submitting || totals.entries === 0}>
                {submitting ? "Creating…" : "Create draft run"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

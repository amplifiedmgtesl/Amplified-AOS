"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAllStaffReviewEntries,
  approveStaffEntry,
  rejectStaffEntry,
  setEntryApproved,
  ensureTimesheetForJob,
  ensureTimesheetForJobRequest,
  loadJobRequests,
} from "@/lib/store/app-store";
import type { StaffEntryReviewRow } from "@/lib/store/db";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

function fullName(r: StaffEntryReviewRow) {
  return `${r.firstName} ${r.lastName}`.trim() || r.email || "—";
}

function jobLabel(r: StaffEntryReviewRow, jobNoById: Map<string, string>): string {
  // Phase 1: prefer job_no when the entry is linked to a job_request.
  if (r.jobId) {
    const jobNo = jobNoById.get(r.jobId);
    const parts = [jobNo, r.jobClient, r.jobEventName].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
  }
  if (!r.jobSheetId && !r.jobId) return "Office / Remote";
  const parts = [r.jobClient, r.jobEventName].filter(Boolean);
  return parts.join(" — ") || "(untitled job)";
}

function isPending(r: StaffEntryReviewRow) {
  return r.status === "submitted" || r.status === null || r.status === "";
}

function statusBadge(r: StaffEntryReviewRow) {
  if (r.status === "approved")  return <span className="badge" style={{ background: "#e8f7e8", color: "#1a5a1a" }}>Approved</span>;
  if (r.status === "rejected")  return <span className="badge" style={{ background: "#fbeaea", color: "#8a1a1a" }}>Rejected</span>;
  if (r.status === "submitted") return <span className="badge" style={{ background: "#eaf2fb", color: "#1a4a7a" }}>Submitted</span>;
  return <span className="badge" style={{ background: "#fff4d6", color: "#7a5a1a" }}>Pending</span>;
}

export default function TimesheetReview() {
  const [rows, setRows] = useState<StaffEntryReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [employeeEmail, setEmployeeEmail] = useState<string>("");
  // Phase 1: filter key is either a jobId ("job:…"), a legacy jobSheetId
  // ("legacy:…"), "" (all), or "__none__" (office/remote, no job link).
  const [jobFilter, setJobFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  // Bulk selection: entry IDs the operator has ticked. Cleared whenever
  // filters change so we never act on a hidden row.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyBatch, setBusyBatch] = useState<null | "approve" | "reject">(null);

  // job_no lookup table — populated from the in-memory job_requests cache.
  const jobNoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of loadJobRequests()) {
      if (j.jobNo) m.set(j.id, j.jobNo);
    }
    return m;
  }, [rows]);

  async function load() {
    setLoading(true);
    const data = await getAllStaffReviewEntries();
    setRows(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const employees = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = r.email || `${r.firstName} ${r.lastName}`.trim();
      if (key && !map.has(key)) map.set(key, fullName(r));
    }
    return Array.from(map, ([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Group the unique jobs that show up in the review rows. Prefer the
  // canonical jobId; fall back to jobSheetId for legacy rows.
  const jobs = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = r.jobId ? `job:${r.jobId}` : (r.jobSheetId ? `legacy:${r.jobSheetId}` : null);
      if (!key) continue;
      if (!map.has(key)) map.set(key, jobLabel(r, jobNoById));
    }
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, jobNoById]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status === "pending"  && !isPending(r)) return false;
      if (status === "approved" && r.status !== "approved") return false;
      if (status === "rejected" && r.status !== "rejected") return false;
      if (employeeEmail && (r.email || "") !== employeeEmail) return false;
      if (jobFilter === "__none__" && (r.jobSheetId || r.jobId)) return false;
      if (jobFilter && jobFilter !== "__none__") {
        const rowKey = r.jobId ? `job:${r.jobId}` : (r.jobSheetId ? `legacy:${r.jobSheetId}` : "");
        if (rowKey !== jobFilter) return false;
      }
      if (dateFrom && (r.workDate ?? "") < dateFrom) return false;
      if (dateTo   && (r.workDate ?? "") > dateTo)   return false;
      return true;
    });
  }, [rows, status, employeeEmail, jobFilter, dateFrom, dateTo]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        entries: acc.entries + 1,
        hours: acc.hours + r.totalHours,
        pay: acc.pay + r.totalPay,
      }),
      { entries: 0, hours: 0, pay: 0 }
    );
  }, [filtered]);

  // ─── Bulk actions ─────────────────────────────────────────────────────────
  // Approve every selected row that isn't already approved. Each row runs the
  // same flow as the single-row Approve button (ensure-or-reuse a timesheet,
  // bind the entry to it, mark approved). Errors on individual rows are
  // surfaced but don't abort the batch.
  async function handleApproveSelected() {
    const targets = filtered.filter((r) => selectedIds.has(r.id) && r.status !== "approved");
    if (targets.length === 0) return;
    setBusyBatch("approve");
    try {
      for (const r of targets) {
        try {
          const label = jobLabel(r, jobNoById);
          let tsId = r.timesheetId;
          if (!tsId) {
            if (r.jobId) {
              tsId = await ensureTimesheetForJobRequest(r.jobId, { jobTitle: label, jobSheetId: r.jobSheetId });
            } else if (r.jobSheetId) {
              tsId = await ensureTimesheetForJob(r.jobSheetId, label);
            }
          }
          if (tsId) await approveStaffEntry(r.id, tsId);
          else      await setEntryApproved(r.id);
        } catch (e) {
          console.error("[review] batch approve row failed:", r.id, e);
        }
      }
      setSelectedIds(new Set());
      await load();
    } finally { setBusyBatch(null); }
  }

  async function handleRejectSelected() {
    const targets = filtered.filter((r) => selectedIds.has(r.id) && r.status !== "rejected");
    if (targets.length === 0) return;
    if (!confirm(`Reject ${targets.length} timesheet entr${targets.length === 1 ? "y" : "ies"}?`)) return;
    setBusyBatch("reject");
    try {
      for (const r of targets) {
        try { await rejectStaffEntry(r.id); }
        catch (e) { console.error("[review] batch reject row failed:", r.id, e); }
      }
      setSelectedIds(new Set());
      await load();
    } finally { setBusyBatch(null); }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const allSelected = filtered.length > 0 && filtered.every((r) => prev.has(r.id));
      if (allSelected) return new Set();
      const next = new Set(prev);
      for (const r of filtered) next.add(r.id);
      return next;
    });
  }
  const selectedVisibleCount = useMemo(
    () => filtered.reduce((n, r) => (selectedIds.has(r.id) ? n + 1 : n), 0),
    [filtered, selectedIds],
  );
  const allVisibleSelected = filtered.length > 0 && selectedVisibleCount === filtered.length;

  // Clear selection whenever filters change — otherwise an offscreen row
  // could end up acted on without the operator seeing it.
  useEffect(() => { setSelectedIds(new Set()); }, [status, employeeEmail, jobFilter, dateFrom, dateTo]);

  function clearFilters() {
    setStatus("pending");
    setEmployeeEmail("");
    setJobFilter("");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <div className="card">
      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <div>
          <small>Status</small>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="pending">Pending (needs approval)</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
        <div>
          <small>Employee</small>
          <select value={employeeEmail} onChange={(e) => setEmployeeEmail(e.target.value)}>
            <option value="">— All employees —</option>
            {employees.map((e) => <option key={e.email} value={e.email}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <small>Job</small>
          <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
            <option value="">— All jobs —</option>
            <option value="__none__">Office / Remote (no job)</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
        </div>
        <div>
          <small>From date</small>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <small>To date</small>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      <div className="action-row" style={{ marginBottom: 12, justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {loading ? "Loading…" : (
            <>
              <strong>{totals.entries}</strong> entr{totals.entries === 1 ? "y" : "ies"} ·{" "}
              <strong>{totals.hours.toFixed(1)}</strong> hrs ·{" "}
              <strong>${totals.pay.toFixed(2)}</strong> pay
            </>
          )}
        </div>
        {/* Batch action bar — appears when the operator has ticked one or more rows */}
        {selectedVisibleCount > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                        background: "#eaf2fb", border: "1px solid #b6c8e0", borderRadius: 8 }}>
            <strong style={{ fontSize: 13 }}>{selectedVisibleCount} selected</strong>
            <button
              onClick={handleApproveSelected}
              disabled={!!busyBatch}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {busyBatch === "approve" ? "Approving…" : `Approve ${selectedVisibleCount}`}
            </button>
            <button
              className="secondary"
              onClick={handleRejectSelected}
              disabled={!!busyBatch}
              style={{ padding: "4px 12px", fontSize: 12, color: "#a00", borderColor: "#e0a0a0" }}
            >
              {busyBatch === "reject" ? "Rejecting…" : `Reject ${selectedVisibleCount}`}
            </button>
            <button className="secondary" onClick={() => setSelectedIds(new Set())} disabled={!!busyBatch} style={{ padding: "4px 10px", fontSize: 12 }}>
              Clear
            </button>
          </div>
        ) : (
          <button className="secondary" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected; }}
                  onChange={toggleAllVisible}
                />
              </th>
              <th>Date</th>
              <th>Employee</th>
              <th>Job</th>
              <th>Position</th>
              <th>In / Out</th>
              <th>Std</th>
              <th>OT</th>
              <th>DT</th>
              <th>Total</th>
              <th>Pay</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={12} className="muted" style={{ textAlign: "center", padding: "24px 0" }}>No entries match these filters.</td></tr>
            )}
            {filtered.map((r) => {
              const checked = selectedIds.has(r.id);
              return (
              <tr key={r.id} style={checked ? { background: "#f4f8fd" } : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={checked}
                    onChange={() => toggleRow(r.id)}
                    disabled={!!busyBatch}
                  />
                </td>
                <td>{r.workDate || "—"}</td>
                <td>{fullName(r)}</td>
                <td>
                  {(r.jobId || r.jobSheetId)
                    ? jobLabel(r, jobNoById)
                    : <span className="muted" style={{ fontStyle: "italic" }}>Office / Remote</span>}
                </td>
                <td>{r.position || "—"}</td>
                <td style={{ fontSize: 12 }}>
                  {r.timeIn1 || "—"} – {r.timeOut1 || "—"}
                  {r.timeIn2 && <><br/>{r.timeIn2} – {r.timeOut2}</>}
                </td>
                <td>{r.stdHours.toFixed(1)}</td>
                <td>{r.otHours > 0 ? r.otHours.toFixed(1) : "—"}</td>
                <td>{r.dtHours > 0 ? r.dtHours.toFixed(1) : "—"}</td>
                <td><strong>{r.totalHours.toFixed(1)}</strong></td>
                <td>${r.totalPay.toFixed(2)}</td>
                <td>{statusBadge(r)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

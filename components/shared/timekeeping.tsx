
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { printWithTitle } from "@/lib/print-with-title";
import {
  getActiveJob, setActiveJob,
  loadJobRequests, loadJobSheets, loadTimesheets,
  getTimesheetByJobId, getTimesheetByJobSheetId,
  ensureTimesheetForJobRequest,
  upsertTimesheet, positionNames, loadEmployees,
  getPendingStaffEntriesByJobId,
  approveStaffEntry, rejectStaffEntry, setEntryApproved,
} from "@/lib/store/app-store";
import { blankTimeEntry, computeTimeEntry, mealBreakOptions, rateOptions, summarizeTimesheet, timeOptions } from "@/lib/store/timekeeping";
import { parseMinutes } from "@/lib/time-utils";
import type { EmployeeRecord, JobRequest, JobSheet, TimeEntry, Timesheet } from "@/lib/store/types";

// Phase 1: picker selection encodes which world we're in.
//   "job:<jobId>"        — canonical, anchored on job_requests
//   "legacy:<jobSheetId>" — pre-rewrite timesheet whose job_id couldn't be backfilled
type PickerValue = "" | `job:${string}` | `legacy:${string}`;

function parsePicker(v: PickerValue): { kind: "none" | "job" | "legacy"; key: string } {
  if (!v) return { kind: "none", key: "" };
  if (v.startsWith("job:")) return { kind: "job", key: v.slice(4) };
  return { kind: "legacy", key: v.slice(7) };
}

const TIMES = timeOptions();
const RATES = rateOptions();
// POSITIONS is loaded from the store at render time so it stays live

function splitName(fullName: string) {
  const parts = fullName.trim().split(" ");
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

function EmployeeAutoFill({
  employeeKey,
  employees,
  onSelect,
  fallbackName,
}: {
  employeeKey?: string | null;
  employees: EmployeeRecord[];
  onSelect: (emp: EmployeeRecord) => void;
  fallbackName?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const linked = employeeKey ? employees.find((e) => e.employeeKey === employeeKey) : null;

  const results = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    return employees
      .filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          (e.email?.toLowerCase() || "").includes(q) ||
          e.employeeKey.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, employees]);

  return (
    <div style={{ position: "relative", minWidth: 170 }}>
      {linked && !query && (
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, whiteSpace: "nowrap" }}>
          {linked.fullName}
        </div>
      )}
      {!linked && fallbackName && !query && (
        <div style={{ fontSize: 13, fontWeight: 600, color: "#a05a00", marginBottom: 2, whiteSpace: "nowrap" }} title="No employee linked — pick one from the list">
          {fallbackName} <span style={{ fontWeight: 400, fontStyle: "italic", fontSize: 11, color: "#a05a00" }}>(unlinked)</span>
        </div>
      )}
      <input
        className="input-tight hide-print"
        style={{ minWidth: 160 }}
        placeholder={linked ? "Change employee…" : (fallbackName ? `Link "${fallbackName}"…` : "Search employee…")}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          zIndex: 200,
          background: "#fff",
          border: "1px solid #d7c6aa",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.13)",
          minWidth: 270,
          maxHeight: 240,
          overflowY: "auto",
        }}>
          {results.map((emp) => (
            <div
              key={emp.employeeKey}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f0e9e0" }}
              onMouseDown={() => { onSelect(emp); setQuery(""); setOpen(false); }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.fullName}</div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {emp.employeeKey}{emp.email ? ` · ${emp.email}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Timekeeping({ hidePayAlways = false }: { hidePayAlways?: boolean }) {
  const POSITIONS = positionNames();
  const [refreshKey, setRefreshKey] = useState(0);
  const sheets = useMemo(() => loadJobSheets(), [refreshKey]);
  const jobRequests = useMemo(() => loadJobRequests(), [refreshKey]);
  const timesheets = useMemo(() => loadTimesheets(), [refreshKey]);
  const employees = useMemo(() => loadEmployees(), [refreshKey]);
  const [pendingEntries, setPendingEntries] = useState<import("@/lib/store/types").TimeEntry[]>([]);

  // Picker state — encodes both kinds of selection (canonical job vs. legacy job_sheet).
  // Initial value: prefer the last picked job (Phase 1 sticky state). If none, default
  // to the most recent job_request that already has a timesheet linked to it.
  const initialPicker: PickerValue = (() => {
    const lastJobId = getActiveJob();
    if (lastJobId && jobRequests.some((j) => j.id === lastJobId)) return `job:${lastJobId}`;
    const firstLinked = timesheets.find((t) => t.jobId);
    if (firstLinked?.jobId) return `job:${firstLinked.jobId}`;
    const firstLegacy = timesheets.find((t) => !t.jobId);
    if (firstLegacy?.jobSheetId) return `legacy:${firstLegacy.jobSheetId}`;
    return "";
  })();
  const [picker, setPicker] = useState<PickerValue>(initialPicker);
  const { kind: pickerKind, key: pickerKey } = parsePicker(picker);

  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [dayFilter, setDayFilter] = useState<string>("all");
  // Bulk selection (admin only — gated on !hidePayAlways at render time).
  // Cleared whenever the picker switches timesheets so we never act on
  // entries from a different job.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyBatch, setBusyBatch] = useState<null | "approve" | "reject" | "delete">(null);
  // Clear selection on timesheet swap.
  useEffect(() => { setSelectedIds(new Set()); }, [timesheet?.id]);
  // Per-day collapse state on the editing view. Print mode forces all expanded
  // (via @media print) and hides the day-separator header rows.
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  // Convenience alias for the in-memory rows of the active timesheet.
  const allRows = useMemo(() => timesheet?.rows ?? [], [timesheet]);

  useEffect(() => {
    if (pickerKind === "none") { setTimesheet(null); return; }

    if (pickerKind === "job") {
      const jobId = pickerKey;
      const jr = jobRequests.find((j) => j.id === jobId);
      if (!jr) return;
      // Remember the user's last-picked job for next visit
      setActiveJob(jobId);

      const linked = getTimesheetByJobId(jobId);
      if (linked) {
        setTimesheet(linked);
      } else {
        // Lazily create a timesheet in the DB so staff approval has somewhere
        // to land. The DB call de-dupes if a row already exists.
        const title = `${jr.jobNo ? jr.jobNo + " — " : ""}${jr.eventName || "Job"}`;
        ensureTimesheetForJobRequest(jobId, { jobTitle: title }).then((id) => {
          setTimesheet({
            id, jobId, jobSheetId: "", title,
            hidePayColumns: false, rows: [],
          });
        }).catch((e) => console.error("[timekeeping] ensure failed:", e));
      }
    } else if (pickerKind === "legacy") {
      const jobSheetId = pickerKey;
      const linked = getTimesheetByJobSheetId(jobSheetId);
      const sheet = sheets.find((s) => s.id === jobSheetId);
      if (linked) {
        setTimesheet(linked);
      } else if (sheet) {
        setTimesheet({
          id: `timesheet-${sheet.id}`,
          jobSheetId: sheet.id,
          jobId: null,
          title: sheet.title,
          hidePayColumns: false,
          rows: [],
        });
      }
    }
    setDayFilter("all");
  }, [picker, refreshKey]);

  // Group rows by workDate (with a "no-date" bucket for blank ones), days
  // sorted ascending. The editing UI renders one collapsible card per day.
  const dayGroups = useMemo(() => {
    const map = new Map<string, typeof allRows>();
    for (const r of allRows) {
      const k = r.workDate || "no-date";
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "no-date") return 1;
      if (b === "no-date") return -1;
      return a.localeCompare(b);
    });
  }, [allRows]);

  // Default-collapse all days if multi-day; expand the only day if single-day.
  useEffect(() => {
    if (dayGroups.length > 1) {
      setCollapsedDays(new Set(dayGroups.map(([d]) => d)));
    } else {
      setCollapsedDays(new Set());
    }
  }, [timesheet?.id, dayGroups.length]);

  function toggleDay(day: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  }
  function expandAll()   { setCollapsedDays(new Set()); }
  function collapseAll() { setCollapsedDays(new Set(dayGroups.map(([d]) => d))); }

  useEffect(() => {
    if (pickerKind === "job") {
      getPendingStaffEntriesByJobId(pickerKey).then(setPendingEntries);
    } else if (pickerKind === "legacy") {
      // Legacy job_sheets: staff entries still keyed on job_sheet_id today.
      // Phase 2 retires this branch entirely.
      import("@/lib/store/app-store").then(({ getPendingStaffEntries }) =>
        getPendingStaffEntries(pickerKey).then(setPendingEntries)
      );
    } else {
      setPendingEntries([]);
    }
  }, [picker, refreshKey]);

  // The selected job_request (canonical) — drives header display in "job" mode.
  const currentJob: JobRequest | null = useMemo(
    () => (pickerKind === "job" ? jobRequests.find((j) => j.id === pickerKey) || null : null),
    [picker, jobRequests],
  );
  // The job_sheet for legacy mode (and an auxiliary lookup for "Add Crew from
  // Job Sheet" when a canonical job happens to also have a matching sheet).
  const currentSheet: JobSheet | null = useMemo(() => {
    if (pickerKind === "legacy") return sheets.find((s) => s.id === pickerKey) || null;
    if (pickerKind === "job" && timesheet?.jobSheetId) {
      return sheets.find((s) => s.id === timesheet.jobSheetId) || null;
    }
    return null;
  }, [picker, sheets, timesheet?.jobSheetId]);
  const headerTitle = currentJob
    ? `${currentJob.jobNo ? currentJob.jobNo + " — " : ""}${currentJob.eventName || ""} — ${currentJob.client || ""}`.replace(/ — $/, "")
    : (currentSheet?.title || "No job selected");
  const headerClient = currentJob?.client || currentSheet?.client || "";
  const summary = useMemo(() => summarizeTimesheet(timesheet), [timesheet]);
  const approvedSummary = useMemo(
    () => summarizeTimesheet(timesheet, (r) => r.status === "approved"),
    [timesheet]
  );

  function persist(next: Timesheet) {
    setTimesheet(next);
    upsertTimesheet(next);
    // NOTE: do NOT setRefreshKey here — that would trigger a useEffect that
    // reloads the timesheet from cache, potentially racing with the state update.
    // refreshKey is only incremented by explicit user actions (job sheet change).
  }

  function updateRow(id: string, patch: Partial<TimeEntry>) {
    if (!timesheet) return;
    const nextRows = timesheet.rows.map((r) => r.id === id ? computeTimeEntry({ ...r, ...patch }) : r);
    persist({ ...timesheet, rows: nextRows });
  }

  function addBlankRow() {
    if (!timesheet) return;
    persist({ ...timesheet, rows: [...timesheet.rows, blankTimeEntry(`row-${Date.now()}`)] });
  }

  function addWorkersFromJobSheet() {
    if (!timesheet || !currentSheet) return;
    const existingEmails = new Set(timesheet.rows.map((r) => r.email));
    const nextRows = [...timesheet.rows];
    currentSheet.workers.forEach((w, idx) => {
      if (existingEmails.has(w.email)) return;
      const parts = splitName(w.fullName);
      nextRows.push(computeTimeEntry({
        ...blankTimeEntry(`worker-${Date.now()}-${idx}`),
        position: w.role || "Stagehand",
        firstName: parts.firstName,
        lastName: parts.lastName,
        phone: w.phone || "",
        email: w.email || "",
        employeeKey: w.employeeKey || null,
        status: "submitted",
      }));
    });
    persist({ ...timesheet, rows: nextRows });
  }

  function addManualCrew() {
    if (!timesheet) return;
    persist({ ...timesheet, rows: [...timesheet.rows, blankTimeEntry(`manual-${Date.now()}`)] });
  }

  function removeRow(id: string) {
    if (!timesheet) return;
    // Confirm — the entry is removed from the timesheet and persisted away on
    // the next save. If the entry has already been billed onto an invoice
    // line, the invoice_line_id pointer will go stale and the entry will
    // re-appear available on a future "Overwrite from Timesheets" run.
    if (!confirm("Delete this timesheet row? This removes the entry from the timesheet on save.")) return;
    persist({ ...timesheet, rows: timesheet.rows.filter((r) => r.id !== id) });
  }

  async function handleApprove(entry: import("@/lib/store/types").TimeEntry) {
    if (!timesheet) return;
    await approveStaffEntry(entry.id, timesheet.id);
    setPendingEntries((prev) => prev.filter((e) => e.id !== entry.id));
    // Also add to in-memory timesheet so it appears in the grid immediately
    persist({ ...timesheet, rows: [...timesheet.rows, { ...entry, status: "approved" }] });
  }

  async function handleReject(entryId: string) {
    // Used by the "Staff Submissions Pending Review" panel below the grid
    // (separate from the bulk-select flow on the grid itself).
    await rejectStaffEntry(entryId);
    setPendingEntries((prev) => prev.filter((e) => e.id !== entryId));
  }

  // ─── Bulk row actions (admin only) ─────────────────────────────────────────
  // All three operate on the in-memory timesheet rows whose id is in
  // selectedIds. Approve/Reject mirror the single-row handlers; Delete is
  // a single in-memory filter call followed by persist.
  function toggleRowSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllRowsSelected() {
    if (!timesheet) return;
    const all = new Set(timesheet.rows.map((r) => r.id));
    const allSelected = timesheet.rows.length > 0 && timesheet.rows.every((r) => selectedIds.has(r.id));
    setSelectedIds(allSelected ? new Set() : all);
  }
  async function handleApproveSelected() {
    if (!timesheet) return;
    const targets = timesheet.rows.filter((r) => selectedIds.has(r.id) && r.status !== "approved" && r.employeeKey);
    if (targets.length === 0) return;
    setBusyBatch("approve");
    try {
      for (const r of targets) {
        try { await setEntryApproved(r.id); }
        catch (e) { console.error("[timekeeping] batch approve row failed:", r.id, e); }
      }
      const ids = new Set(targets.map((r) => r.id));
      persist({ ...timesheet, rows: timesheet.rows.map((r) => ids.has(r.id) ? { ...r, status: "approved" } : r) });
      setSelectedIds(new Set());
    } finally { setBusyBatch(null); }
  }
  async function handleRejectSelected() {
    if (!timesheet) return;
    const targets = timesheet.rows.filter((r) => selectedIds.has(r.id) && r.status !== "rejected" && r.employeeKey);
    if (targets.length === 0) return;
    if (!confirm(`Reject ${targets.length} timesheet ${targets.length === 1 ? "entry" : "entries"}?`)) return;
    setBusyBatch("reject");
    try {
      for (const r of targets) {
        try { await rejectStaffEntry(r.id); }
        catch (e) { console.error("[timekeeping] batch reject row failed:", r.id, e); }
      }
      const ids = new Set(targets.map((r) => r.id));
      persist({ ...timesheet, rows: timesheet.rows.map((r) => ids.has(r.id) ? { ...r, status: "rejected" } : r) });
      setSelectedIds(new Set());
    } finally { setBusyBatch(null); }
  }
  function handleDeleteSelected() {
    if (!timesheet) return;
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} timesheet row${count === 1 ? "" : "s"}? This removes them from the timesheet on save.`)) return;
    persist({ ...timesheet, rows: timesheet.rows.filter((r) => !selectedIds.has(r.id)) });
    setSelectedIds(new Set());
  }

  const totals = useMemo(() => {
    const rows = timesheet?.rows || [];
    return rows.reduce((acc, r) => {
      acc.stdHours += r.stdHours; acc.otHours += r.otHours; acc.dtHours += r.dtHours;
      acc.totalHours += r.totalHours; acc.totalPay += r.totalPay;
      return acc;
    }, { stdHours:0, otHours:0, dtHours:0, totalHours:0, totalPay:0 });
  }, [timesheet]);

  // Unique dates touched by any row (workDate + endDate covers cross-midnight
   // shifts), oldest first. Used by the day filter.
  const availableDays = useMemo(() => {
    const set = new Set<string>();
    for (const r of timesheet?.rows ?? []) {
      if (r.workDate) set.add(r.workDate);
      if (r.endDate)  set.add(r.endDate);
    }
    return Array.from(set).sort();
  }, [timesheet]);

  // (allRows is declared earlier — used by both day grouping and the table render.)

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">Timekeeping Control Center</h2>
        <div className="grid4">
          <div>
            <small>Job</small>
            <select value={picker} onChange={(e) => setPicker(e.target.value as PickerValue)}>
              <option value="">Select a job</option>
              <optgroup label="Jobs">
                {jobRequests
                  .slice()
                  .sort((a, b) => (b.requestDate || "").localeCompare(a.requestDate || ""))
                  .map((j) => (
                    <option key={j.id} value={`job:${j.id}`}>
                      {j.jobNo || j.eventName || "(untitled)"}
                    </option>
                  ))}
              </optgroup>
              {timesheets.some((t) => !t.jobId) && (
                <optgroup label="Legacy (no Job linked)">
                  {timesheets
                    .filter((t) => !t.jobId && t.jobSheetId)
                    .map((t) => {
                      const sheet = sheets.find((s) => s.id === t.jobSheetId);
                      const label = sheet
                        ? `${sheet.client || ""} — ${sheet.eventName || sheet.title || ""} — ${sheet.date || ""}`
                        : t.title;
                      return (
                        <option key={t.id} value={`legacy:${t.jobSheetId}`}>{label}</option>
                      );
                    })}
                </optgroup>
              )}
            </select>
          </div>
          {!hidePayAlways && (
            <div className="list-card">
              <strong>Linked Invoice / Quote Detail</strong>
              <div className="muted">Use this page to generate time-based labor breakdowns that feed quote and invoice detail.</div>
            </div>
          )}
          {!hidePayAlways && (
            <div className="list-card">
              <strong>Hide Pay Columns</strong>
              <div className="action-row" style={{ marginTop: 8 }}>
                <button className="secondary" onClick={() => timesheet && persist({ ...timesheet, hidePayColumns: !hidePayAlways && !timesheet.hidePayColumns })}>
                  {timesheet?.hidePayColumns ? "Show Pay Columns" : "Hide Pay Columns"}
                </button>
              </div>
            </div>
          )}
          <div style={{
            border: "1px solid var(--line, #d7c6aa)",
            borderRadius: 12,
            padding: "10px 14px",
            background: "var(--cream, #fbf6ee)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            <strong style={{ fontSize: 12, opacity: 0.75 }}>📄 Print / Export</strong>
            {availableDays.length > 0 && (
              <div>
                <small>Print which day?</small>
                <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
                  <option value="all">All days{availableDays.length > 1 ? ` (${availableDays.length})` : ""}</option>
                  {availableDays.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => printWithTitle([
              "Timesheet",
              headerTitle,
              headerClient,
              dayFilter !== "all" ? dayFilter : undefined,
            ])}>Download / Print PDF</button>
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button onClick={addWorkersFromJobSheet} disabled={!currentSheet}>Add Crew from Job Sheet</button>
          <button className="secondary" onClick={addManualCrew} disabled={!timesheet}>Add Manual Crew</button>
          <button className="secondary" onClick={addBlankRow} disabled={!timesheet}>Add Blank Row</button>
          {timesheet && timesheet.rows.length > 0 && (
            <>
              <span style={{ flex: 1 }} />
              <button className="secondary" onClick={expandAll} style={{ fontSize: 12, padding: "4px 10px" }}>Expand all</button>
              <button className="secondary" onClick={collapseAll} style={{ fontSize: 12, padding: "4px 10px" }}>Collapse all</button>
            </>
          )}
        </div>
        {/* Batch action bar — appears when one or more rows are ticked (admin only). */}
        {!hidePayAlways && selectedIds.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "6px 12px",
                        background: "#eaf2fb", border: "1px solid #b6c8e0", borderRadius: 8 }}>
            <strong style={{ fontSize: 13 }}>{selectedIds.size} selected</strong>
            <button
              onClick={handleApproveSelected}
              disabled={!!busyBatch}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {busyBatch === "approve" ? "Approving…" : `Approve ${selectedIds.size}`}
            </button>
            <button
              className="secondary"
              onClick={handleRejectSelected}
              disabled={!!busyBatch}
              style={{ padding: "4px 12px", fontSize: 12, color: "#a00", borderColor: "#e0a0a0" }}
            >
              {busyBatch === "reject" ? "Rejecting…" : `Reject ${selectedIds.size}`}
            </button>
            <button
              className="danger"
              onClick={handleDeleteSelected}
              disabled={!!busyBatch}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {busyBatch === "delete" ? "Deleting…" : `Delete ${selectedIds.size}`}
            </button>
            <button className="secondary" onClick={() => setSelectedIds(new Set())} disabled={!!busyBatch} style={{ padding: "4px 10px", fontSize: 12 }}>
              Clear
            </button>
          </div>
        )}
      </div>

      {dayFilter !== "all" && (
        <style>{`
          @media print {
            .timesheet-grid tbody.line-employee[data-day]:not([data-day="${dayFilter}"]) {
              display: none !important;
            }
          }
        `}</style>
      )}

      <div className="invoice-shell">
        <div className="timesheet-pdf-header">
          <div className="pdf-logo-wrap pdf-logo-wrap--small">
            <img src="/branding/client-logo.png" alt="Logo" className="pdf-logo pdf-logo--small" />
          </div>
          <div className="pdf-title-wrap pdf-title-wrap--left">
            <h2 className="pdf-title pdf-title--compact">Timekeeping Sheet</h2>
            <div className="pdf-subtitle pdf-subtitle--event">
              {headerTitle}
            </div>
          </div>
        </div>

        {!timesheet ? (
          <div className="muted">Select a job to begin timekeeping.</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              {(() => {
                const showPay = !hidePayAlways && !timesheet.hidePayColumns;
                // Row-1 layout: Position | Name | Start | End | (phantom for
                // hidden hour/rate cols). Each visible row-1 label spans exactly
                // 2 row-2 cells so the right edge of End Date aligns with the
                // right edge of Meal 2 in print (where hour cols are hidden).
                // Row 2 has 12 cells without pay (Sig+3 times)x2 + 4 hidden hours,
                // or 16 with pay (+ 4 hidden rate cells).
                const r1Spans = { pos: 2, emp: 2, start: 2, end: 2 };
                const phantomSpan = showPay ? 8 : 4;
                // Total table column count for the per-employee summary
                // row's colSpan: 12 visible + 4 hidden hours + 4 hidden rate
                // (if pay) + 1 action = 13 (no pay) or 17 (with pay).
                const totalCols = (showPay ? 16 : 12) + 1;
                return (
              <table className="timesheet-grid line-table">
                <colgroup>
                  <col style={{ width: "18%" }} />{/* Sign IN 1 */}
                  <col style={{ width: "9%"  }} />{/* Time IN 1 */}
                  <col style={{ width: "9%"  }} />{/* Time OUT 1 */}
                  <col style={{ width: "7%"  }} />{/* Meal 1 */}
                  <col style={{ width: "18%" }} />{/* Sign IN 2 */}
                  <col style={{ width: "9%"  }} />{/* Time IN 2 */}
                  <col style={{ width: "9%"  }} />{/* Time OUT 2 */}
                  <col style={{ width: "21%" }} />{/* Meal 2 (absorbs remaining) */}
                  <col className="col-hidden" />{/* STD HRS */}
                  <col className="col-hidden" />{/* OT HRS */}
                  <col className="col-hidden" />{/* DT HRS */}
                  <col className="col-hidden" />{/* TOTAL HRS */}
                  {showPay && <>
                    <col className="col-hidden" />{/* STD RATE */}
                    <col className="col-hidden" />{/* OT RATE */}
                    <col className="col-hidden" />{/* DT RATE */}
                    <col className="col-hidden" />{/* TOTAL PAY */}
                  </>}
                  <col className="col-hidden" />{/* Action */}
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={r1Spans.emp}>Name</th>
                    <th colSpan={r1Spans.pos}>Position</th>
                    <th colSpan={r1Spans.start}>Start Date</th>
                    <th colSpan={r1Spans.end}>End Date</th>
                    <th colSpan={phantomSpan} className="hide-print"></th>
                    <th rowSpan={2} className="hide-print" style={{ minWidth: 90 }}>
                      {!hidePayAlways && timesheet.rows.length > 0 && (() => {
                        const allSel = timesheet.rows.every((r) => selectedIds.has(r.id));
                        const someSel = !allSel && timesheet.rows.some((r) => selectedIds.has(r.id));
                        return (
                          <input
                            type="checkbox"
                            aria-label="Select all rows"
                            checked={allSel}
                            ref={(el) => { if (el) el.indeterminate = someSel; }}
                            onChange={toggleAllRowsSelected}
                            style={{ marginRight: 6 }}
                          />
                        );
                      })()}
                      Status
                    </th>
                  </tr>
                  <tr>
                    <th className="sig-box-th">Sign IN 1</th>
                    <th>Time IN 1</th><th>Time OUT 1</th><th>Meal 1</th>
                    <th className="sig-box-th">Sign IN 2</th>
                    <th>Time IN 2</th><th>Time OUT 2</th><th>Meal 2</th>
                    <th className="hide-print">STD HRS</th>
                    <th className="hide-print">OT HRS</th>
                    <th className="hide-print">DT HRS</th>
                    <th className="hide-print">TOTAL HRS</th>
                    {showPay ? <>
                      <th className="hide-print">STD RATE</th>
                      <th className="hide-print">OT RATE</th>
                      <th className="hide-print">DT RATE</th>
                      <th className="hide-print">TOTAL PAY</th>
                    </> : null}
                  </tr>
                </thead>
                {dayGroups.map(([day, dayRows]) => {
                  const isCollapsed = collapsedDays.has(day);
                  const dayLabel = day === "no-date"
                    ? "(no date)"
                    : (() => {
                        const d = new Date(day + "T00:00:00");
                        const wd = d.toLocaleDateString(undefined, { weekday: "short" });
                        return `${wd} ${day}`;
                      })();
                  const statusMix = dayRows.reduce((acc, r) => {
                    acc[r.status] = (acc[r.status] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>);
                  return (
                  <Fragment key={day}>
                    <tbody className="day-separator">
                      <tr onClick={() => toggleDay(day)} style={{ cursor: "pointer" }}>
                        <td colSpan={totalCols} style={{
                          padding: "10px 14px",
                          background: isCollapsed ? "#f7f4ee" : "var(--accent, #2563eb)",
                          color: isCollapsed ? "inherit" : "#fff",
                          borderBottom: "2px solid #333",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <span style={{ fontSize: 14, width: 14 }}>{isCollapsed ? "▸" : "▾"}</span>
                            <strong style={{ fontSize: 14 }}>{dayLabel}</strong>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              · {dayRows.length} crew member{dayRows.length === 1 ? "" : "s"}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {statusMix.approved ? `· ${statusMix.approved} approved ` : ""}
                              {statusMix.submitted ? `· ${statusMix.submitted} pending ` : ""}
                              {statusMix.rejected ? `· ${statusMix.rejected} rejected ` : ""}
                            </span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                    {dayRows.map((row, dayIdx) => {
                    const idx = allRows.indexOf(row);
                    const band = `line-band-${idx % 4}`;
                    const unlinked = !row.employeeKey;
                    return (
                    <tbody key={row.id} className={`line-employee ${isCollapsed ? "is-collapsed-day" : ""}`} data-day={row.workDate || "no-date"}>
                    <tr className={`line-row ${band}${unlinked ? " line-unlinked" : ""}`}>
                      <td colSpan={r1Spans.emp}>
                        <EmployeeAutoFill
                          employeeKey={row.employeeKey}
                          employees={employees}
                          fallbackName={[row.firstName, row.lastName].filter(Boolean).join(" ")}
                          onSelect={(emp) => updateRow(row.id, {
                            employeeKey: emp.employeeKey,
                            firstName: emp.firstName || emp.fullName.split(" ")[0] || "",
                            lastName: emp.lastName || emp.fullName.split(" ").slice(1).join(" ") || "",
                            phone: emp.phone || "",
                            email: emp.email || "",
                            status: row.status === "approved" ? "approved" : "submitted",
                          })}
                        />
                        {unlinked ? <div className="unlinked-hint">⚠ Link an employee to enable this row</div> : null}
                      </td>
                      <td colSpan={r1Spans.pos}><select className="input-tight" value={row.position} onChange={(e)=>updateRow(row.id, { position:e.target.value })}>{POSITIONS.map((p)=><option key={p} value={p}>{p}</option>)}</select><span className="print-time">{row.position || ""}</span></td>
                      <td colSpan={r1Spans.start}>
                        <input type="date" className="input-tight" value={row.workDate ?? ""} onChange={(e)=>updateRow(row.id, { workDate: e.target.value, endDate: row.endDate || e.target.value })} />
                        <span className="print-time">{row.workDate || ""}</span>
                      </td>
                      <td colSpan={r1Spans.end}>
                        <input type="date" className="input-tight" value={row.endDate ?? ""} onChange={(e)=>updateRow(row.id, { endDate: e.target.value })} />
                        <span className="print-time">{row.endDate || ""}</span>
                        {(() => {
                          const in1 = parseMinutes(row.timeIn1 ?? "");
                          const out1 = parseMinutes(row.timeOut1 ?? "");
                          const in2 = parseMinutes(row.timeIn2 ?? "");
                          const out2 = parseMinutes(row.timeOut2 ?? "");
                          const pair1Crosses = in1 != null && out1 != null && out1 < in1;
                          const pair2Crosses = in2 != null && out2 != null && out2 < in2;
                          const sameDay = row.workDate && row.endDate && row.workDate === row.endDate;
                          if (sameDay && (pair1Crosses || pair2Crosses)) {
                            return <div style={{ fontSize: 10, color: "#c2410c", marginTop: 2 }}>shift crosses midnight — advance End Date?</div>;
                          }
                          return null;
                        })()}
                      </td>
                      <td colSpan={phantomSpan} className="hide-print"></td>
                      <td rowSpan={2} className="hide-print" style={{ verticalAlign: "middle" }}>
                        <div className="action-row" style={{ flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                          {!hidePayAlways && (
                            <input
                              type="checkbox"
                              aria-label="Select row"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleRowSelected(row.id)}
                              disabled={!!busyBatch}
                            />
                          )}
                          {row.employeeKey && row.status === "approved" && (
                            <span className="badge pill-green" style={{ fontSize: 11 }}>Approved</span>
                          )}
                          {row.employeeKey && row.status === "rejected" && (
                            <span className="badge" style={{ fontSize: 11, background: "#fde8e8", color: "#c0392b" }}>Rejected</span>
                          )}
                          {row.employeeKey && row.status === "submitted" && (
                            <span className="badge" style={{ fontSize: 11, background: "#e8f0fe", color: "#1a56c4" }}>Pending</span>
                          )}
                          {/* Per-row Delete kept as a tiny escape hatch (one-off cleanup
                              during editing). Bulk Delete is in the batch action bar. */}
                          <button className="secondary" onClick={() => removeRow(row.id)} style={{ padding: "2px 8px", fontSize: 11 }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                    <tr className={`line-row line-row-end ${band}`}>
                      <td className="sig-box"></td>
                      <td><select className="input-tight" value={row.timeIn1} onChange={(e)=>updateRow(row.id, { timeIn1:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select><span className="print-time">{row.timeIn1 || ""}</span></td>
                      <td><select className="input-tight" value={row.timeOut1} onChange={(e)=>updateRow(row.id, { timeOut1:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select><span className="print-time">{row.timeOut1 || ""}</span></td>
                      <td><select className="input-tight" value={row.mealBreak1Minutes ?? row.lunchMinutes ?? 0} onChange={(e)=>updateRow(row.id, { mealBreak1Minutes:Number(e.target.value) })}>{mealBreakOptions().map((t)=><option key={t} value={t}>{t}</option>)}</select><span className="print-time">{row.mealBreak1Minutes ?? row.lunchMinutes ?? 0}</span></td>
                      <td className="sig-box"></td>
                      <td><select className="input-tight" value={row.timeIn2} onChange={(e)=>updateRow(row.id, { timeIn2:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select><span className="print-time">{row.timeIn2 || ""}</span></td>
                      <td><select className="input-tight" value={row.timeOut2} onChange={(e)=>updateRow(row.id, { timeOut2:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select><span className="print-time">{row.timeOut2 || ""}</span></td>
                      <td><select className="input-tight" value={row.mealBreak2Minutes ?? 0} onChange={(e)=>updateRow(row.id, { mealBreak2Minutes:Number(e.target.value) })}>{mealBreakOptions().map((t)=><option key={t} value={t}>{t}</option>)}</select><span className="print-time">{row.mealBreak2Minutes ?? 0}</span></td>
                      <td className="hide-print">{row.stdHours.toFixed(2)}</td>
                      <td className="hide-print">{row.otHours.toFixed(2)}</td>
                      <td className="hide-print">{row.dtHours.toFixed(2)}</td>
                      <td className="hide-print">{row.totalHours.toFixed(2)}</td>
                      {showPay ? (
                        <>
                          <td className="hide-print"><select className="input-tight" value={row.stdRate} onChange={(e)=>updateRow(row.id, { stdRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td className="hide-print"><select className="input-tight" value={row.otRate} onChange={(e)=>updateRow(row.id, { otRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td className="hide-print"><select className="input-tight" value={row.dtRate} onChange={(e)=>updateRow(row.id, { dtRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td className="hide-print">${row.totalPay.toFixed(2)}</td>
                        </>
                      ) : null}
                    </tr>
                    </tbody>
                    );
                    })}
                  </Fragment>
                  );
                })}
                <tfoot className="hide-print">
                  <tr>
                    <th colSpan={8}>Totals</th>
                    <th>{totals.stdHours.toFixed(2)}</th>
                    <th>{totals.otHours.toFixed(2)}</th>
                    <th>{totals.dtHours.toFixed(2)}</th>
                    <th>{totals.totalHours.toFixed(2)}</th>
                    {showPay ? <><th></th><th></th><th></th><th>${totals.totalPay.toFixed(2)}</th></> : null}
                    <th></th>
                  </tr>
                </tfoot>
              </table>
                );
              })()}
            </div>

            <div className="hide-print" style={{ marginTop: 16 }}>
              <h3 className="section-title">Labor Summary for Quotes</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 8 }}>
                All entries on this job, regardless of approval status — useful for validating actuals vs. the quote.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th>{!hidePayAlways && <th>Total Pay</th>}</tr></thead>
                  <tbody>
                    {summary.length === 0 ? (
                      <tr><td colSpan={hidePayAlways ? 6 : 7} className="muted" style={{ textAlign: "center" }}>No entries.</td></tr>
                    ) : summary.map((r) => (
                      <tr key={r.position}>
                        <td>{r.position}</td>
                        <td>{r.workers}</td>
                        <td>{r.stdHours.toFixed(2)}</td>
                        <td>{r.otHours.toFixed(2)}</td>
                        <td>{r.dtHours.toFixed(2)}</td>
                        <td>{r.totalHours.toFixed(2)}</td>
                        {!hidePayAlways && <td>${r.totalPay.toFixed(2)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="hide-print" style={{ marginTop: 16 }}>
              <h3 className="section-title">Labor Summary for Invoices</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 8 }}>
                Approved entries only — this is what "Pull labor actuals from timesheets" uses on the invoice.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th>{!hidePayAlways && <th>Total Pay</th>}</tr></thead>
                  <tbody>
                    {approvedSummary.length === 0 ? (
                      <tr><td colSpan={hidePayAlways ? 6 : 7} className="muted" style={{ textAlign: "center" }}>No approved entries yet.</td></tr>
                    ) : approvedSummary.map((r) => (
                      <tr key={r.position}>
                        <td>{r.position}</td>
                        <td>{r.workers}</td>
                        <td>{r.stdHours.toFixed(2)}</td>
                        <td>{r.otHours.toFixed(2)}</td>
                        <td>{r.dtHours.toFixed(2)}</td>
                        <td>{r.totalHours.toFixed(2)}</td>
                        {!hidePayAlways && <td>${r.totalPay.toFixed(2)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {!hidePayAlways && pendingEntries.length > 0 && (
        <div className="card hide-print">
          <h3 className="section-title">⏳ Staff Submissions Pending Review ({pendingEntries.length})</h3>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Position</th><th>Start Date</th><th>Time In</th><th>Time Out</th>
                  <th>Meal Break</th><th>STD</th><th>OT</th><th>DT</th><th>Total Hrs</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.firstName} {entry.lastName}</td>
                    <td>{entry.position}</td>
                    <td>{(entry as any).workDate || "—"}</td>
                    <td>{entry.timeIn1 || "—"}</td>
                    <td>{entry.timeOut1 || "—"}</td>
                    <td>{((entry.mealBreak1Minutes ?? entry.lunchMinutes ?? 0) + (entry.mealBreak2Minutes ?? 0))}m</td>
                    <td>{entry.stdHours.toFixed(2)}</td>
                    <td>{entry.otHours.toFixed(2)}</td>
                    <td>{entry.dtHours.toFixed(2)}</td>
                    <td><strong>{entry.totalHours.toFixed(2)}</strong></td>
                    <td>
                      <div className="action-row">
                        <button onClick={() => handleApprove(entry)}>✓ Approve</button>
                        <button className="secondary" onClick={() => handleReject(entry.id)}>✗ Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

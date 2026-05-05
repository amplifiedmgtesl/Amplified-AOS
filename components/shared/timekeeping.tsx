
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { printWithTitle } from "@/lib/print-with-title";
import { getActiveJobSheet, loadJobSheets, getTimesheetByJobSheetId, upsertTimesheet, positionNames, loadEmployees, getPendingStaffEntries, approveStaffEntry, rejectStaffEntry, setEntryApproved } from "@/lib/store/app-store";
import { blankTimeEntry, computeTimeEntry, mealBreakOptions, rateOptions, summarizeTimesheet, timeOptions } from "@/lib/store/timekeeping";
import { parseMinutes } from "@/lib/time-utils";
import type { EmployeeRecord, TimeEntry, Timesheet } from "@/lib/store/types";

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
  const employees = useMemo(() => loadEmployees(), [refreshKey]);
  const [pendingEntries, setPendingEntries] = useState<import("@/lib/store/types").TimeEntry[]>([]);
  const activeSheetId = getActiveJobSheet() || sheets[0]?.id || "";
  const [jobSheetId, setJobSheetId] = useState(activeSheetId);
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [dayFilter, setDayFilter] = useState<string>("all");
  // Per-day collapse state on the editing view. Print mode forces all expanded
  // (via @media print) and hides the day-separator header rows.
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  // When true, the next print includes the rate/pay columns + a payroll
  // summary at the bottom. Admin only — gated by !hidePayAlways. Set briefly
  // around window.print() then reset.
  const [printPayroll, setPrintPayroll] = useState(false);

  function printWithPayroll(title: (string | undefined)[]) {
    setPrintPayroll(true);
    // Wait one paint so the conditional render takes effect, then print, then
    // reset. Reset on the afterprint event when the dialog closes.
    setTimeout(() => {
      const reset = () => {
        setPrintPayroll(false);
        window.removeEventListener("afterprint", reset);
      };
      window.addEventListener("afterprint", reset);
      printWithTitle(title);
      // Safety reset in case afterprint never fires (rare).
      setTimeout(reset, 5000);
    }, 50);
  }
  // Convenience alias for the in-memory rows of the active timesheet.
  const allRows = useMemo(() => timesheet?.rows ?? [], [timesheet]);

  useEffect(() => {
    if (!jobSheetId) return;
    const linked = getTimesheetByJobSheetId(jobSheetId);
    const sheet = sheets.find((s) => s.id === jobSheetId);
    if (linked) {
      setTimesheet(linked);
    } else if (sheet) {
      setTimesheet({ id: `timesheet-${sheet.id}`, jobSheetId: sheet.id, title: sheet.title, hidePayColumns: false, rows: [] });
    }
    setDayFilter("all");
  }, [jobSheetId, refreshKey]);

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
    if (!jobSheetId) { setPendingEntries([]); return; }
    getPendingStaffEntries(jobSheetId).then(setPendingEntries);
  }, [jobSheetId, refreshKey]);

  const currentSheet = sheets.find((s) => s.id === jobSheetId) || null;
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
    persist({ ...timesheet, rows: timesheet.rows.filter((r) => r.id !== id) });
  }

  async function handleApprove(entry: import("@/lib/store/types").TimeEntry) {
    if (!timesheet) return;
    await approveStaffEntry(entry.id, timesheet.id);
    setPendingEntries((prev) => prev.filter((e) => e.id !== entry.id));
    // Also add to in-memory timesheet so it appears in the grid immediately
    persist({ ...timesheet, rows: [...timesheet.rows, { ...entry, status: "approved" }] });
  }

  async function handleApproveRow(row: import("@/lib/store/types").TimeEntry) {
    if (!timesheet) return;
    await setEntryApproved(row.id);
    // Update in-memory status so the badge reflects immediately
    persist({ ...timesheet, rows: timesheet.rows.map((r) => r.id === row.id ? { ...r, status: "approved" } : r) });
  }

  async function handleReject(entryId: string) {
    await rejectStaffEntry(entryId);
    setPendingEntries((prev) => prev.filter((e) => e.id !== entryId));
  }

  async function handleRejectRow(entryId: string) {
    if (!timesheet) return;
    await rejectStaffEntry(entryId);
    // Update in-memory status so the badge reflects immediately
    persist({ ...timesheet, rows: timesheet.rows.map((r) => r.id === entryId ? { ...r, status: "rejected" } : r) });
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
            <small>Job Sheet</small>
            <select value={jobSheetId} onChange={(e) => setJobSheetId(e.target.value)}>
              <option value="">Select job sheet</option>
              {sheets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
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
              currentSheet?.title,
              currentSheet?.client,
              dayFilter !== "all" ? dayFilter : undefined,
            ])}>Download / Print PDF</button>
            {!hidePayAlways && (
              <button
                className="secondary"
                onClick={() => printWithPayroll([
                  "Timesheet (Payroll)",
                  currentSheet?.title,
                  currentSheet?.client,
                  dayFilter !== "all" ? dayFilter : undefined,
                ])}
                title="Same timesheet layout, but the printed copy includes per-line hours/rates/pay and a payroll summary at the bottom."
              >
                Print with Payroll
              </button>
            )}
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
              {currentSheet ? currentSheet.title : "No job sheet selected"}
            </div>
          </div>
        </div>

        {!timesheet ? (
          <div className="muted">Select a job sheet to begin timekeeping.</div>
        ) : (
          <>
            {/* Field-signature view (the original print path). Hidden when the
                user invokes "Print with Payroll" — that path shows the compact
                payroll table further down instead. */}
            <div
              style={{ overflowX: "auto" }}
              className={printPayroll ? "hide-print" : undefined}
            >
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
                    <th rowSpan={2} className="hide-print">Action</th>
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
                        <div className="action-row" style={{ flexDirection: "column", gap: 6 }}>
                          {row.employeeKey && row.status === "submitted" && !hidePayAlways && (
                            <>
                              <button onClick={() => handleApproveRow(row)}>✓ Approve</button>
                              <button className="danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => handleRejectRow(row.id)}>✗ Reject</button>
                            </>
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
                          <button className="secondary" onClick={() => removeRow(row.id)}>Delete</button>
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

            {/* ─── Payroll print view ──────────────────────────────────────
                Renders only when "Print with Payroll" is invoked. Two parts:
                  1. A compact one-row-per-entry detail table with all the
                     hours/rates/pay info.
                  2. A per-employee summary with grand total.
                Both use show-print so they're invisible on screen.
            */}
            {printPayroll && !hidePayAlways && (() => {
              const showPay = !hidePayAlways && !timesheet.hidePayColumns;
              const filteredRows = (dayFilter === "all"
                ? allRows
                : allRows.filter((r) => (r.workDate || "no-date") === dayFilter)
              ).slice().sort((a, b) => {
                const da = a.workDate || "";
                const db = b.workDate || "";
                if (da !== db) return da.localeCompare(db);
                const an = `${a.lastName || ""} ${a.firstName || ""}`;
                const bn = `${b.lastName || ""} ${b.firstName || ""}`;
                return an.localeCompare(bn);
              });

              // Aggregate by employee for the summary table.
              type EmpAgg = { name: string; position: string; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; entries: number };
              const byEmp = new Map<string, EmpAgg>();
              for (const r of filteredRows) {
                const key = r.employeeKey || `${r.firstName || ""} ${r.lastName || ""}`.trim() || "(unassigned)";
                const name = r.employeeKey
                  ? (employees.find((e) => e.employeeKey === r.employeeKey)?.fullName ?? `${r.firstName} ${r.lastName}`.trim())
                  : `${r.firstName} ${r.lastName}`.trim();
                const agg = byEmp.get(key) ?? { name: name || "(no name)", position: r.position || "", stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, totalPay: 0, entries: 0 };
                agg.stdHours += r.stdHours || 0;
                agg.otHours += r.otHours || 0;
                agg.dtHours += r.dtHours || 0;
                agg.totalHours += r.totalHours || 0;
                agg.totalPay += r.totalPay || 0;
                agg.entries += 1;
                byEmp.set(key, agg);
              }
              const empRows = Array.from(byEmp.values()).sort((a, b) => a.name.localeCompare(b.name));
              const grand = empRows.reduce((acc, r) => ({
                stdHours: acc.stdHours + r.stdHours,
                otHours: acc.otHours + r.otHours,
                dtHours: acc.dtHours + r.dtHours,
                totalHours: acc.totalHours + r.totalHours,
                totalPay: acc.totalPay + r.totalPay,
              }), { stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, totalPay: 0 });

              const fmtDay = (s: string) => {
                if (!s) return "";
                const d = new Date(s + "T00:00:00");
                return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${s}`;
              };
              const empName = (r: typeof filteredRows[number]) => r.employeeKey
                ? (employees.find((e) => e.employeeKey === r.employeeKey)?.fullName ?? `${r.firstName} ${r.lastName}`.trim())
                : `${r.firstName} ${r.lastName}`.trim();

              return (
                <div className="show-print" style={{ marginTop: 8 }}>
                  {/* Detail: one row per entry */}
                  <h3 style={{ fontSize: 12, margin: "0 0 6px 0" }}>
                    Payroll Detail {dayFilter !== "all" ? `— ${dayFilter}` : "— All Days"}
                  </h3>
                  <table style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f3e6cf" }}>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>Date</th>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>Employee</th>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>Position</th>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>In 1</th>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>Out 1</th>
                        <th style={{ textAlign: "right", padding: "3px 5px" }}>M1</th>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>In 2</th>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>Out 2</th>
                        <th style={{ textAlign: "right", padding: "3px 5px" }}>M2</th>
                        <th style={{ textAlign: "right", padding: "3px 5px" }}>STD</th>
                        <th style={{ textAlign: "right", padding: "3px 5px" }}>OT</th>
                        <th style={{ textAlign: "right", padding: "3px 5px" }}>DT</th>
                        <th style={{ textAlign: "right", padding: "3px 5px" }}>Total</th>
                        {showPay ? <>
                          <th style={{ textAlign: "right", padding: "3px 5px" }}>$/STD</th>
                          <th style={{ textAlign: "right", padding: "3px 5px" }}>$/OT</th>
                          <th style={{ textAlign: "right", padding: "3px 5px" }}>$/DT</th>
                          <th style={{ textAlign: "right", padding: "3px 5px" }}>Pay</th>
                        </> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.length === 0 ? (
                        <tr><td colSpan={showPay ? 17 : 13} style={{ textAlign: "center", color: "#888", padding: 6 }}>No entries.</td></tr>
                      ) : filteredRows.map((r) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #ead7b8" }}>
                          <td style={{ padding: "3px 5px" }}>{fmtDay(r.workDate || "")}</td>
                          <td style={{ padding: "3px 5px" }}>{empName(r)}</td>
                          <td style={{ padding: "3px 5px" }}>{r.position}</td>
                          <td style={{ padding: "3px 5px" }}>{r.timeIn1 || ""}</td>
                          <td style={{ padding: "3px 5px" }}>{r.timeOut1 || ""}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.mealBreak1Minutes ?? r.lunchMinutes ?? 0}</td>
                          <td style={{ padding: "3px 5px" }}>{r.timeIn2 || ""}</td>
                          <td style={{ padding: "3px 5px" }}>{r.timeOut2 || ""}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.mealBreak2Minutes ?? 0}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.stdHours.toFixed(2)}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.otHours.toFixed(2)}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.dtHours.toFixed(2)}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{r.totalHours.toFixed(2)}</td>
                          {showPay ? <>
                            <td style={{ padding: "3px 5px", textAlign: "right" }}>${r.stdRate.toFixed(2)}</td>
                            <td style={{ padding: "3px 5px", textAlign: "right" }}>${r.otRate.toFixed(2)}</td>
                            <td style={{ padding: "3px 5px", textAlign: "right" }}>${r.dtRate.toFixed(2)}</td>
                            <td style={{ padding: "3px 5px", textAlign: "right", fontWeight: 600 }}>${r.totalPay.toFixed(2)}</td>
                          </> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Per-employee summary */}
                  {empRows.length > 0 ? (
                    <div style={{ marginTop: 16, pageBreakInside: "avoid" }}>
                      <h3 style={{ fontSize: 12, margin: "0 0 6px 0" }}>
                        Payroll Summary by Employee
                      </h3>
                      <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f3e6cf" }}>
                            <th style={{ textAlign: "left", padding: "3px 6px" }}>Employee</th>
                            <th style={{ textAlign: "left", padding: "3px 6px" }}>Position</th>
                            <th style={{ textAlign: "right", padding: "3px 6px" }}>Entries</th>
                            <th style={{ textAlign: "right", padding: "3px 6px" }}>STD</th>
                            <th style={{ textAlign: "right", padding: "3px 6px" }}>OT</th>
                            <th style={{ textAlign: "right", padding: "3px 6px" }}>DT</th>
                            <th style={{ textAlign: "right", padding: "3px 6px" }}>Total Hrs</th>
                            {showPay ? <th style={{ textAlign: "right", padding: "3px 6px" }}>Total Pay</th> : null}
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
                              {showPay ? <td style={{ textAlign: "right", padding: "3px 6px" }}>${r.totalPay.toFixed(2)}</td> : null}
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
                            {showPay ? <th style={{ textAlign: "right", padding: "4px 6px" }}>${grand.totalPay.toFixed(2)}</th> : null}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })()}

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

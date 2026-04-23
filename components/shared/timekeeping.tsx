
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
}: {
  employeeKey?: string | null;
  employees: EmployeeRecord[];
  onSelect: (emp: EmployeeRecord) => void;
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
        <div style={{ fontSize: 11, color: "#2a5a31", marginBottom: 2, whiteSpace: "nowrap" }}>
          ✓ {linked.employeeKey}
        </div>
      )}
      <input
        className="input-tight"
        style={{ minWidth: 160 }}
        placeholder={linked ? linked.fullName : "Search employee…"}
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

  useEffect(() => {
    if (!jobSheetId) return;
    const linked = getTimesheetByJobSheetId(jobSheetId);
    const sheet = sheets.find((s) => s.id === jobSheetId);
    if (linked) {
      setTimesheet(linked);
    } else if (sheet) {
      setTimesheet({ id: `timesheet-${sheet.id}`, jobSheetId: sheet.id, title: sheet.title, hidePayColumns: false, rows: [] });
    }
  }, [jobSheetId, refreshKey]);

  useEffect(() => {
    if (!jobSheetId) { setPendingEntries([]); return; }
    getPendingStaffEntries(jobSheetId).then(setPendingEntries);
  }, [jobSheetId, refreshKey]);

  const currentSheet = sheets.find((s) => s.id === jobSheetId) || null;
  const summary = useMemo(() => summarizeTimesheet(timesheet), [timesheet]);

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
        status: w.employeeKey ? "submitted" : null,
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
          <div className="action-row" style={{ alignItems: "end" }}>
            <button onClick={() => printWithTitle([
              "Timesheet",
              currentSheet?.title,
              currentSheet?.client,
            ])}>Download / Print PDF</button>
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button onClick={addWorkersFromJobSheet} disabled={!currentSheet}>Add Crew from Job Sheet</button>
          <button className="secondary" onClick={addManualCrew} disabled={!timesheet}>Add Manual Crew</button>
          <button className="secondary" onClick={addBlankRow} disabled={!timesheet}>Add Blank Row</button>
        </div>
      </div>

      <div className="invoice-shell">
        <div className="pdf-header">
          <div></div>
          <div className="pdf-title-wrap">
            <div className="pdf-logo-wrap"><img src="/branding/client-logo.png" alt="Logo" className="pdf-logo" /></div>
            <h2 className="pdf-title">Timekeeping Sheet</h2>
            <div className="pdf-subtitle">{currentSheet ? currentSheet.title : "No job sheet selected"}</div>
          </div>
          <div></div>
        </div>

        {!timesheet ? (
          <div className="muted">Select a job sheet to begin timekeeping.</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              {(() => {
                const showPay = !hidePayAlways && !timesheet.hidePayColumns;
                // Row-1 colSpans sum to N where N = row-2 cell count.
                // Without pay (N=10): [1,2,1,1,1,2,1,1]  |  With pay (N=14): [2,2,2,2,1,2,1,2]
                const r1Spans = showPay
                  ? { pos: 2, emp: 2, fn: 2, ln: 2, phone: 1, email: 2, start: 1, end: 2 }
                  : { pos: 1, emp: 2, fn: 1, ln: 1, phone: 1, email: 2, start: 1, end: 1 };
                return (
              <table className="timesheet-grid line-table">
                <thead>
                  <tr>
                    <th colSpan={r1Spans.pos}>Position</th>
                    <th colSpan={r1Spans.emp}>Employee</th>
                    <th colSpan={r1Spans.fn}>First Name</th>
                    <th colSpan={r1Spans.ln}>Last Name</th>
                    <th colSpan={r1Spans.phone}>Phone</th>
                    <th colSpan={r1Spans.email}>Email</th>
                    <th colSpan={r1Spans.start}>Start Date</th>
                    <th colSpan={r1Spans.end}>End Date</th>
                    <th rowSpan={2} className="hide-print">Action</th>
                  </tr>
                  <tr>
                    <th>Time IN 1</th><th>Time OUT 1</th><th>Meal 1</th>
                    <th>Time IN 2</th><th>Time OUT 2</th><th>Meal 2</th>
                    <th>STD HRS</th><th>OT HRS</th><th>DT HRS</th><th>TOTAL HRS</th>
                    {showPay ? <><th>STD RATE</th><th>OT RATE</th><th>DT RATE</th><th>TOTAL PAY</th></> : null}
                  </tr>
                </thead>
                <tbody>
                  {timesheet.rows.map((row, idx) => {
                    const band = `line-band-${idx % 4}`;
                    const unlinked = !row.employeeKey;
                    return (
                    <Fragment key={row.id}>
                    <tr className={`line-row ${band}${unlinked ? " line-unlinked" : ""}`}>
                      <td colSpan={r1Spans.pos}><select className="input-tight" value={row.position} onChange={(e)=>updateRow(row.id, { position:e.target.value })}>{POSITIONS.map((p)=><option key={p} value={p}>{p}</option>)}</select></td>
                      <td colSpan={r1Spans.emp}>
                        <EmployeeAutoFill
                          employeeKey={row.employeeKey}
                          employees={employees}
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
                      <td colSpan={r1Spans.fn}><input className="input-tight" value={row.firstName} disabled readOnly title="Pulled from employee record" /></td>
                      <td colSpan={r1Spans.ln}><input className="input-tight" value={row.lastName} disabled readOnly title="Pulled from employee record" /></td>
                      <td colSpan={r1Spans.phone}><input className="input-tight" value={row.phone} disabled readOnly title="Pulled from employee record" /></td>
                      <td colSpan={r1Spans.email}><input className="input-tight" value={row.email} disabled readOnly title="Pulled from employee record" /></td>
                      <td colSpan={r1Spans.start}><input type="date" className="input-tight" value={row.workDate ?? ""} onChange={(e)=>updateRow(row.id, { workDate: e.target.value, endDate: row.endDate || e.target.value })} /></td>
                      <td colSpan={r1Spans.end}>
                        <input type="date" className="input-tight" value={row.endDate ?? ""} onChange={(e)=>updateRow(row.id, { endDate: e.target.value })} />
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
                      <td><select className="input-tight" value={row.timeIn1} onChange={(e)=>updateRow(row.id, { timeIn1:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select></td>
                      <td><select className="input-tight" value={row.timeOut1} onChange={(e)=>updateRow(row.id, { timeOut1:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select></td>
                      <td><select className="input-tight" value={row.mealBreak1Minutes ?? row.lunchMinutes ?? 0} onChange={(e)=>updateRow(row.id, { mealBreak1Minutes:Number(e.target.value) })}>{mealBreakOptions().map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                      <td><select className="input-tight" value={row.timeIn2} onChange={(e)=>updateRow(row.id, { timeIn2:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select></td>
                      <td><select className="input-tight" value={row.timeOut2} onChange={(e)=>updateRow(row.id, { timeOut2:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}</select></td>
                      <td><select className="input-tight" value={row.mealBreak2Minutes ?? 0} onChange={(e)=>updateRow(row.id, { mealBreak2Minutes:Number(e.target.value) })}>{mealBreakOptions().map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                      <td>{row.stdHours.toFixed(2)}</td>
                      <td>{row.otHours.toFixed(2)}</td>
                      <td>{row.dtHours.toFixed(2)}</td>
                      <td>{row.totalHours.toFixed(2)}</td>
                      {showPay ? (
                        <>
                          <td><select className="input-tight" value={row.stdRate} onChange={(e)=>updateRow(row.id, { stdRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td><select className="input-tight" value={row.otRate} onChange={(e)=>updateRow(row.id, { otRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td><select className="input-tight" value={row.dtRate} onChange={(e)=>updateRow(row.id, { dtRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td>${row.totalPay.toFixed(2)}</td>
                        </>
                      ) : null}
                    </tr>
                    <tr className={`sig-row ${band}`}>
                      <td className="sig-cell">Signature (Time IN 1):</td>
                      <td className="sig-blank" colSpan={2}></td>
                      <td className="sig-cell">Signature (Time IN 2):</td>
                      <td className="sig-blank" colSpan={showPay ? 10 : 6}></td>
                    </tr>
                    </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={6}>Totals</th>
                    <th>{totals.stdHours.toFixed(2)}</th>
                    <th>{totals.otHours.toFixed(2)}</th>
                    <th>{totals.dtHours.toFixed(2)}</th>
                    <th>{totals.totalHours.toFixed(2)}</th>
                    {showPay ? <><th></th><th></th><th></th><th>${totals.totalPay.toFixed(2)}</th></> : null}
                    <th className="hide-print"></th>
                  </tr>
                </tfoot>
              </table>
                );
              })()}
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 className="section-title">Labor Summary for Quotes / Invoices</h3>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th>{!hidePayAlways && <th>Total Pay</th>}</tr></thead>
                  <tbody>
                    {summary.map((r) => (
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

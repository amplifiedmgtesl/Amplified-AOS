
"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveJobSheet, loadJobSheets, getTimesheetByJobSheetId, upsertTimesheet } from "@/lib/store/app-store";
import { POSITIONS, blankTimeEntry, computeTimeEntry, lunchOptions, rateOptions, summarizeTimesheet, timeOptions } from "@/lib/store/timekeeping";
import type { TimeEntry, Timesheet } from "@/lib/store/types";

const TIMES = timeOptions();
const RATES = rateOptions();

function splitName(fullName: string) {
  const parts = fullName.trim().split(" ");
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

export default function Timekeeping() {
  const [refreshKey, setRefreshKey] = useState(0);
  const sheets = useMemo(() => loadJobSheets(), [refreshKey]);
  const activeSheetId = getActiveJobSheet() || sheets[0]?.id || "";
  const [jobSheetId, setJobSheetId] = useState(activeSheetId);
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);

  useEffect(() => {
    if (!jobSheetId) return;
    const linked = getTimesheetByJobSheetId(jobSheetId);
    const sheet = sheets.find((s) => s.id === jobSheetId);
    if (linked) setTimesheet(linked);
    else if (sheet) {
      setTimesheet({ id: `timesheet-${sheet.id}`, jobSheetId: sheet.id, title: sheet.title, hidePayColumns: false, rows: [] });
    }
  }, [jobSheetId, refreshKey]);

  const currentSheet = sheets.find((s) => s.id === jobSheetId) || null;
  const summary = useMemo(() => summarizeTimesheet(timesheet), [timesheet]);

  function persist(next: Timesheet) {
    setTimesheet(next);
    upsertTimesheet(next);
    setRefreshKey((x) => x + 1);
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
          <div className="list-card">
            <strong>Linked Invoice / Quote Detail</strong>
            <div className="muted">Use this page to generate time-based labor breakdowns that feed quote and invoice detail.</div>
          </div>
          <div className="list-card">
            <strong>Hide Pay Columns</strong>
            <div className="action-row" style={{ marginTop: 8 }}>
              <button className="secondary" onClick={() => timesheet && persist({ ...timesheet, hidePayColumns: !timesheet.hidePayColumns })}>
                {timesheet?.hidePayColumns ? "Show Pay Columns" : "Hide Pay Columns"}
              </button>
            </div>
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button onClick={() => window.print()}>Download / Print PDF</button>
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
              <table className="timesheet-grid">
                <thead>
                  <tr>
                    <th>Position</th><th>First Name</th><th>Last Name</th><th>Phone</th><th>Email</th>
                    <th>Time IN</th><th>Time OUT</th><th>Lunch</th><th>Time IN</th><th>Time OUT</th>
                    <th>STD HOURS</th><th>OT HOURS</th><th>DT HOURS</th><th>TOTAL HOURS</th>
                    {!timesheet.hidePayColumns ? <><th>STD RATE</th><th>OT RATE</th><th>DT RATE</th><th>TOTAL PAY</th></> : null}
                    <th className="hide-print">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {timesheet.rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ minWidth: 150 }}><select className="input-tight" style={{ minWidth: 140 }} value={row.position} onChange={(e)=>updateRow(row.id, { position:e.target.value })}>{POSITIONS.map((p)=><option key={p} value={p}>{p}</option>)}</select></td>
                      <td style={{ minWidth: 140 }}><input className="input-tight" style={{ minWidth: 130 }} value={row.firstName} onChange={(e)=>updateRow(row.id, { firstName:e.target.value })} /></td>
                      <td style={{ minWidth: 160 }}><input className="input-tight" style={{ minWidth: 150 }} value={row.lastName} onChange={(e)=>updateRow(row.id, { lastName:e.target.value })} /></td>
                      <td><input className="input-tight" value={row.phone} onChange={(e)=>updateRow(row.id, { phone:e.target.value })} /></td>
                      <td style={{ minWidth: 240 }}><input className="input-tight" style={{ minWidth: 230 }} value={row.email} onChange={(e)=>updateRow(row.id, { email:e.target.value })} /></td>
                      <td style={{ minWidth: 115 }}><select className="input-tight" style={{ minWidth: 105 }} value={row.timeIn1} onChange={(e)=>updateRow(row.id, { timeIn1:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                      <td style={{ minWidth: 115 }}><select className="input-tight" style={{ minWidth: 105 }} value={row.timeOut1} onChange={(e)=>updateRow(row.id, { timeOut1:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                      <td><select className="input-tight" value={row.lunchMinutes} onChange={(e)=>updateRow(row.id, { lunchMinutes:Number(e.target.value) })}>{lunchOptions().map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                      <td style={{ minWidth: 115 }}><select className="input-tight" style={{ minWidth: 105 }} value={row.timeIn2} onChange={(e)=>updateRow(row.id, { timeIn2:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                      <td style={{ minWidth: 115 }}><select className="input-tight" style={{ minWidth: 105 }} value={row.timeOut2} onChange={(e)=>updateRow(row.id, { timeOut2:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                      <td>{row.stdHours.toFixed(2)}</td>
                      <td>{row.otHours.toFixed(2)}</td>
                      <td>{row.dtHours.toFixed(2)}</td>
                      <td>{row.totalHours.toFixed(2)}</td>
                      {!timesheet.hidePayColumns ? (
                        <>
                          <td style={{ minWidth: 110 }}><select className="input-tight" style={{ minWidth: 100 }} value={row.stdRate} onChange={(e)=>updateRow(row.id, { stdRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td style={{ minWidth: 110 }}><select className="input-tight" style={{ minWidth: 100 }} value={row.otRate} onChange={(e)=>updateRow(row.id, { otRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td style={{ minWidth: 110 }}><select className="input-tight" style={{ minWidth: 100 }} value={row.dtRate} onChange={(e)=>updateRow(row.id, { dtRate:Number(e.target.value) })}>{RATES.map((r)=><option key={r} value={r}>{r}</option>)}</select></td>
                          <td>${row.totalPay.toFixed(2)}</td>
                        </>
                      ) : null}
                      <td className="hide-print"><button className="secondary" onClick={() => removeRow(row.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={10}>Totals</th>
                    <th>{totals.stdHours.toFixed(2)}</th>
                    <th>{totals.otHours.toFixed(2)}</th>
                    <th>{totals.dtHours.toFixed(2)}</th>
                    <th>{totals.totalHours.toFixed(2)}</th>
                    {!timesheet.hidePayColumns ? <><th></th><th></th><th></th><th>${totals.totalPay.toFixed(2)}</th></> : null}
                    <th className="hide-print"></th>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 className="section-title">Labor Summary for Quotes / Invoices</h3>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th><th>Total Pay</th></tr></thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.position}>
                        <td>{r.position}</td>
                        <td>{r.workers}</td>
                        <td>{r.stdHours.toFixed(2)}</td>
                        <td>{r.otHours.toFixed(2)}</td>
                        <td>{r.dtHours.toFixed(2)}</td>
                        <td>{r.totalHours.toFixed(2)}</td>
                        <td>${r.totalPay.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

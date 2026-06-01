/**
 * Print-ready payroll report view at /payroll/[id]/pdf.
 *
 * Mirrors the invoice-pdf-view / quote-pdf-view preview flow: renders
 * without the AppShell chrome, with a top-of-page "Print / Save as PDF"
 * button that the operator clicks to invoke the browser print dialog.
 *
 * Two sections:
 *   1. Payroll Detail — one row per timesheet entry (date / employee /
 *      position / job_no / in-out / meals / hours / rates / pay).
 *   2. Payroll Summary by Employee with Grand Total.
 *
 * Time-in/out + meal-break fields aren't on the payroll_run_entries
 * snapshot — they're fetched live from timesheet_entries (which are
 * frozen once approved, so the values are stable for the life of an
 * active run).
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getPayrollRun,
  getPayrollRunEntries,
  getPayrollRunPrintExtras,
  type PayrollRunPrintExtras,
} from "@/lib/store/payroll";
import type { PayrollRun, PayrollRunEntry, PayrollRunStatus } from "@/lib/store/types";
import { loadJobRequests } from "@/lib/store/app-store";
import { printWithTitle } from "@/lib/print-with-title";

function fmtDay(s: string) {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${s}`;
}

function statusLabel(s: PayrollRunStatus): string {
  switch (s) {
    case "draft":     return "Draft";
    case "finalized": return "Finalized";
    case "exported":  return "Exported";
    case "voided":    return "Voided";
  }
}

export default function PayrollPdfView({ id }: { id: string }) {
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [entries, setEntries] = useState<PayrollRunEntry[]>([]);
  const [extras, setExtras] = useState<Map<string, PayrollRunPrintExtras>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [r, es, ex] = await Promise.all([
          getPayrollRun(id),
          getPayrollRunEntries(id),
          getPayrollRunPrintExtras(id),
        ]);
        if (cancelled) return;
        if (!r) { setError(`Payroll run not found: ${id}`); setLoading(false); return; }
        setRun(r);
        setEntries(es);
        setExtras(ex);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load run.");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Job_no lookup — same source as the detail page.
  const jobNoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of loadJobRequests()) if (j.jobNo) m.set(j.id, j.jobNo);
    return m;
  }, [entries]);

  // Sorted detail rows (date → employee).
  const rows = useMemo(() => {
    return entries
      .map((e) => ({
        ...e,
        timeIn1:  extras.get(e.timesheetEntryId)?.timeIn1  ?? "",
        timeOut1: extras.get(e.timesheetEntryId)?.timeOut1 ?? "",
        timeIn2:  extras.get(e.timesheetEntryId)?.timeIn2  ?? "",
        timeOut2: extras.get(e.timesheetEntryId)?.timeOut2 ?? "",
        mealBreak1Minutes: extras.get(e.timesheetEntryId)?.mealBreak1Minutes ?? 0,
        mealBreak2Minutes: extras.get(e.timesheetEntryId)?.mealBreak2Minutes ?? 0,
      }))
      .sort((a, b) => {
        const da = a.workDate || ""; const db = b.workDate || "";
        if (da !== db) return da.localeCompare(db);
        const an = `${a.lastName ?? ""} ${a.firstName ?? ""}`;
        const bn = `${b.lastName ?? ""} ${b.firstName ?? ""}`;
        return an.localeCompare(bn);
      });
  }, [entries, extras]);

  // Per-employee aggregate + grand total.
  const empRows = useMemo(() => {
    type EmpAgg = { name: string; position: string; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; entries: number };
    const m = new Map<string, EmpAgg>();
    for (const r of rows) {
      const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email || "—";
      const cur = m.get(name) ?? { name, position: r.position ?? "", stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, totalPay: 0, entries: 0 };
      cur.stdHours += r.payStdHours;
      cur.otHours  += r.payOtHours;
      cur.dtHours  += r.payDtHours;
      cur.totalHours += r.payTotalHours;
      cur.totalPay   += r.totalPay;
      cur.entries += 1;
      if (!cur.position && r.position) cur.position = r.position;
      m.set(name, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const grand = useMemo(() => rows.reduce(
    (acc, r) => ({
      stdHours: acc.stdHours + r.payStdHours,
      otHours:  acc.otHours  + r.payOtHours,
      dtHours:  acc.dtHours  + r.payDtHours,
      totalHours: acc.totalHours + r.payTotalHours,
      totalPay:   acc.totalPay   + r.totalPay,
    }),
    { stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, totalPay: 0 },
  ), [rows]);

  if (loading) return <div style={{ padding: 24, color: "#555" }}>Loading…</div>;
  if (error || !run) return <div style={{ padding: 24, color: "#c0392b" }}>{error ?? "Run not found."}</div>;

  return (
    <div className="payroll-pdf">
      {/* Print button + tip — hidden on print */}
      <div className="print-actions hide-print">
        <button
          onClick={() => printWithTitle(["Payroll Report", run.payDate, run.notes || undefined])}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          Print / Save as PDF
        </button>
        <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
          Tip: in the print dialog, choose "Save as PDF" as the destination, and uncheck "Headers and footers" for clean output.
        </span>
      </div>

      {/* Letterhead-style header */}
      <header className="letterhead">
        <div className="letterhead-logo">
          <img src="/branding/client-logo.png" alt="Logo" />
        </div>
        <div className="letterhead-doctitle">
          <h1>PAYROLL REPORT</h1>
          <table className="meta-table">
            <tbody>
              <tr><td>Pay Date</td><td><strong>{run.payDate}</strong></td></tr>
              {(run.periodStart || run.periodEnd) ? (
                <tr><td>Period</td><td>{run.periodStart ?? "…"} → {run.periodEnd ?? "…"}</td></tr>
              ) : null}
              <tr><td>Status</td><td>{statusLabel(run.status)}</td></tr>
              <tr><td>Run ID</td><td style={{ fontFamily: "monospace", fontSize: "0.9em" }}>{run.id}</td></tr>
              {run.notes ? <tr><td>Notes</td><td>{run.notes}</td></tr> : null}
              {run.finalizedAt ? <tr><td>Finalized</td><td>{new Date(run.finalizedAt).toLocaleString()}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </header>

      {/* Top-level totals */}
      <div className="totals-strip">
        <div><strong>{run.entryCount}</strong> entries</div>
        <div><strong>{run.employeeCount}</strong> employees</div>
        <div><strong>{run.totalHours.toFixed(2)}</strong> hrs</div>
        <div><strong>${run.totalPay.toFixed(2)}</strong> total pay</div>
      </div>

      {/* Detail — one row per entry */}
      <h3 className="section-h">Payroll Detail</h3>
      <table className="detail-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Employee</th>
            <th>Position</th>
            <th>Job</th>
            <th>In 1</th>
            <th>Out 1</th>
            <th className="r">M1</th>
            <th>In 2</th>
            <th>Out 2</th>
            <th className="r">M2</th>
            <th className="r">STD</th>
            <th className="r">OT</th>
            <th className="r">DT</th>
            <th className="r">Total</th>
            <th className="r">$/STD</th>
            <th className="r">$/OT</th>
            <th className="r">$/DT</th>
            <th className="r">Pay</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={18} style={{ textAlign: "center", color: "#888", padding: 8 }}>No entries.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDay(r.workDate || "")}{r.isHoliday && " 🎄"}</td>
              <td>{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email || "—"}</td>
              <td>{r.position || ""}</td>
              <td style={{ fontFamily: "monospace" }}>{r.jobId ? (jobNoById.get(r.jobId) ?? "") : ""}</td>
              <td>{r.timeIn1}</td>
              <td>{r.timeOut1}</td>
              <td className="r">{r.mealBreak1Minutes || ""}</td>
              <td>{r.timeIn2}</td>
              <td>{r.timeOut2}</td>
              <td className="r">{r.mealBreak2Minutes || ""}</td>
              <td className="r">{r.payStdHours.toFixed(2)}</td>
              <td className="r">{r.payOtHours.toFixed(2)}</td>
              <td className="r">{r.payDtHours.toFixed(2)}</td>
              <td className="r">{r.payTotalHours.toFixed(2)}</td>
              <td className="r">${r.stdRate.toFixed(2)}</td>
              <td className="r">${r.otRate.toFixed(2)}</td>
              <td className="r">${r.dtRate.toFixed(2)}</td>
              <td className="r pay">${r.totalPay.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Per-employee summary */}
      {empRows.length > 0 && (
        <div className="summary-block">
          <h3 className="section-h">Payroll Summary by Employee</h3>
          <table className="summary-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Position</th>
                <th className="r">Entries</th>
                <th className="r">STD</th>
                <th className="r">OT</th>
                <th className="r">DT</th>
                <th className="r">Total Hrs</th>
                <th className="r">Total Pay</th>
              </tr>
            </thead>
            <tbody>
              {empRows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.position}</td>
                  <td className="r">{r.entries}</td>
                  <td className="r">{r.stdHours.toFixed(2)}</td>
                  <td className="r">{r.otHours.toFixed(2)}</td>
                  <td className="r">{r.dtHours.toFixed(2)}</td>
                  <td className="r">{r.totalHours.toFixed(2)}</td>
                  <td className="r">${r.totalPay.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="grand-total">
                <th colSpan={3}>Grand Total</th>
                <th className="r">{grand.stdHours.toFixed(2)}</th>
                <th className="r">{grand.otHours.toFixed(2)}</th>
                <th className="r">{grand.dtHours.toFixed(2)}</th>
                <th className="r">{grand.totalHours.toFixed(2)}</th>
                <th className="r">${grand.totalPay.toFixed(2)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Component-scoped styles — mirrors the invoice/quote PDF view shape. */}
      <style jsx>{`
        .payroll-pdf {
          background: #fff;
          color: #181410;
          /* Landscape sheet is the natural fit for the wide detail table. */
          max-width: 11in;
          margin: 24px auto;
          padding: 0.4in 0.5in 0.6in;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 10.5pt;
          line-height: 1.4;
        }
        .payroll-pdf h1, .payroll-pdf h3 { color: #15110d; }
        .print-actions {
          max-width: 11in;
          margin: 12px auto;
          padding: 0 0.5in;
        }
        .letterhead {
          display: flex;
          align-items: flex-start;
          gap: 24px;
          border-bottom: 2px solid #181410;
          padding-bottom: 12px;
          margin-bottom: 12px;
        }
        .letterhead-logo img { height: 56px; }
        .letterhead-doctitle { flex: 1; text-align: right; }
        .letterhead-doctitle h1 { margin: 0 0 6px; font-size: 22pt; letter-spacing: 0.02em; }
        .meta-table { margin-left: auto; font-size: 10pt; }
        .meta-table td { padding: 1px 6px; }
        .meta-table td:first-child { color: #555; text-align: right; }
        .totals-strip {
          display: flex;
          gap: 24px;
          padding: 8px 0;
          margin-bottom: 12px;
          border-bottom: 1px solid #ddd;
          font-size: 11pt;
        }
        .section-h { font-size: 12pt; margin: 0 0 6px; }
        .detail-table, .summary-table {
          width: 100%;
          border-collapse: collapse;
        }
        .detail-table { font-size: 9.5pt; }
        .summary-table { font-size: 10pt; }
        .detail-table thead tr, .summary-table thead tr { background: #f3e6cf; }
        .detail-table th, .detail-table td,
        .summary-table th, .summary-table td {
          padding: 3px 6px;
          text-align: left;
          border-bottom: 1px solid #ead7b8;
        }
        .detail-table th.r, .detail-table td.r,
        .summary-table th.r, .summary-table td.r { text-align: right; }
        .detail-table td.pay { font-weight: 600; }
        .summary-block { margin-top: 18px; page-break-inside: avoid; }
        .grand-total { border-top: 2px solid #181410; font-weight: 700; }
        .grand-total th { padding: 4px 6px; }
        .hide-print {}
        @media print {
          @page { size: landscape; margin: 0.3in; }
          .hide-print { display: none !important; }
          .payroll-pdf {
            margin: 0;
            padding: 0;
            max-width: none;
          }
        }
      `}</style>
    </div>
  );
}

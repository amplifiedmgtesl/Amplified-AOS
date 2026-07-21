/**
 * Print-ready Pre-Invoice Summary at /job-requests/[id]/pre-invoice-report.
 *
 * Client-facing preview of what the invoice will charge, built straight from
 * timekeeping (ALL statuses — lines containing not-yet-approved time carry a
 * footnote marker). Mirrors invoice-pdf-view.tsx letterhead/styling so it
 * reads like the invoice it previews, with two deliberate differences:
 *   - lines are split by identical worked times (both in/out pairs + meal
 *     breaks), so the client sees "12 Stagehands 8:00 AM–5:00 PM" and
 *     "3 Stagehands 3:00 PM–5:00 PM" as separate lines
 *   - each day prints on its own page
 *
 * Data + pricing: lib/reports/pre-invoice-report.ts (same rate engine as the
 * invoice pull). This view is read-only and never writes anything.
 */

"use client";

import React, { useEffect, useState } from "react";
import { buildPreInvoiceReport, type PreInvoiceReport } from "@/lib/reports/pre-invoice-report";
import { loadCompanySettings, type CompanySettings } from "@/lib/store/company-settings";
import { loadShifts } from "@/lib/storage/job-request-shifts";
import type { JobRequestShift } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";
import { isDayModeLine } from "@/lib/rates/line-calc";
import { parseMinutes } from "@/lib/time-utils";

type LoadedJob = {
  id: string;
  job_no?: string | null;
  client_id?: string | null;
  client?: string | null;
  event_name?: string | null;
  venue?: string | null;
  venue_address?: string | null;
  venue_address_2?: string | null;
  city?: string | null;
  state?: string | null;
  venue_zip?: string | null;
  request_date?: string | null;
  end_date?: string | null;
};

type LoadedClient = {
  id: string;
  name: string;
  contact_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
};

function hasCents(n: number | null | undefined): boolean {
  const v = n ?? 0;
  return Math.abs(v - Math.round(v)) >= 0.005;
}

/** Format an hours value for display: no trailing zeros ("7", "7.5", "1.17"),
 *  blank for zero so empty buckets stay clean. */
function fmtHrs(n: number): string {
  if (!n) return "";
  return String(+n.toFixed(2));
}

/** Per-crew-member hours. Because every worker on a report line worked the
 *  identical time block (the line grouping requires it), the aggregate
 *  person-hours divide evenly by crew — so this reads as each person's own
 *  hours, which is what a client verifying the report expects to see. */
function perEa(total: number, crew: number): string {
  if (!crew) return fmtHrs(total);
  return fmtHrs(total / crew);
}

/** Billing rates are whole dollars, so cents print only when a computed
 *  total actually has them (day-rate overflow like 1.17hr × $33 = $368.61).
 *  Pass `forceCents` to keep a whole COLUMN consistent: when any value in
 *  the column has real cents, every value in it shows .XX so the numbers
 *  line up (mixed $34,264 / $33,776.61 reads worse than all-cents).
 *  Thousands separators throughout — client-facing document. */
function fmtMoney(n: number | null | undefined, forceCents?: boolean): string {
  const v = n ?? 0;
  const showCents = forceCents ?? hasCents(v);
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  })}`;
}
function fmtDate(s: string | undefined | null): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "17:30" → "5:30 PM". Falls through unparseable values unchanged. */
function fmtClock(t: string): string {
  const mins = parseMinutes(t);
  if (mins == null) return t;
  const h24 = Math.floor(mins / 60) % 24;
  const mm = String(mins % 60).padStart(2, "0");
  const mer = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${mer}`;
}

/** Display segments, one per time pair: "8:00 AM – 5:00 PM · 30m break".
 *  Rendered stacked (one line per pair) so split shifts don't blow out the
 *  Time column width. */
function fmtTimeSegs(l: {
  timeIn1: string; timeOut1: string; timeIn2: string; timeOut2: string;
  mealBreak1Minutes: number; mealBreak2Minutes: number;
}): string[] {
  // Non-breaking spaces inside the range so a segment only ever wraps at
  // the "· Nm break" suffix, never mid-range ("8:00 AM –" / "6:00 PM").
  const nb = (s: string) => s.replace(/ /g, " ");
  const seg = (tin: string, tout: string, breakMins: number): string => {
    let s = nb(`${fmtClock(tin) || "—"} – ${fmtClock(tout) || "—"}`);
    if (breakMins > 0) s += ` · ${nb(`${breakMins}m break`)}`;
    return s;
  };
  const segs: string[] = [];
  if (l.timeIn1 || l.timeOut1) segs.push(seg(l.timeIn1, l.timeOut1, l.mealBreak1Minutes));
  if (l.timeIn2 || l.timeOut2) segs.push(seg(l.timeIn2, l.timeOut2, l.mealBreak2Minutes));
  return segs.length > 0 ? segs : ["—"];
}

export default function PreInvoiceReportView({ jobId }: { jobId: string }) {
  const [report, setReport] = useState<PreInvoiceReport | null>(null);
  const [job, setJob] = useState<LoadedJob | null>(null);
  const [client, setClient] = useState<LoadedClient | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [positionsById, setPositionsById] = useState<Map<string, string>>(new Map());
  const [specialtiesById, setSpecialtiesById] = useState<Map<string, { name: string; positionId: string }>>(new Map());
  const [shiftsById, setShiftsById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [rpt, jobRes, posRes, spcRes, companySettings, shifts] = await Promise.all([
          buildPreInvoiceReport(jobId),
          supabase.from("job_requests").select("*").eq("id", jobId).maybeSingle(),
          supabase.from("positions").select("id, name"),
          supabase.from("specialties").select("id, name, position_id"),
          loadCompanySettings(),
          loadShifts(jobId, { includeInactive: true }),
        ]);
        if (cancelled) return;

        setReport(rpt);
        const jobRow = jobRes.data as LoadedJob | null;
        setJob(jobRow);
        setPositionsById(new Map((posRes.data ?? []).map((p: any) => [p.id, p.name])));
        setSpecialtiesById(new Map((spcRes.data ?? []).map((s: any) => [s.id, { name: s.name, positionId: s.position_id }])));
        setCompany(companySettings);
        setShiftsById(new Map(shifts.map((row: JobRequestShift) => [row.id, row.label])));

        if (jobRow?.client_id) {
          const cRes = await supabase.from("clients").select("*").eq("id", jobRow.client_id).maybeSingle();
          if (!cancelled) setClient(cRes.data as LoadedClient | null);
        }
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[pre-invoice-report-view] load failed:", err);
        setError(err.message || "Failed to build report");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <div style={{ padding: 40 }} className="muted">Building report…</div>;
  if (error) return <div style={{ padding: 40 }} className="muted">{error}</div>;
  if (!report) return null;

  const anyPending = report.days.some((d) => d.lines.some((l) => l.hasPendingTime));
  const dateRange =
    job?.request_date && job?.end_date && job.end_date !== job.request_date
      ? `${fmtDate(job.request_date)} → ${fmtDate(job.end_date)}`
      : fmtDate(job?.request_date ?? "");
  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const anyShift = report.days.some((d) => d.lines.some((l) => !!l.line.shiftId));
  const anyOt = report.days.some((d) => d.lines.some((l) => (l.line.otHours || 0) > 0));
  const anyDt = report.days.some((d) => d.lines.some((l) => (l.line.dtHours || 0) > 0));

  // Column-consistent cents (John 2026-07-21): if any value in a money
  // column has real cents, EVERY value in that column shows .XX so the
  // figures line up; all-whole columns stay cent-free. Line totals and
  // the day/grand-total figures are evaluated as separate columns.
  const centsLineTotals = report.days.some((d) => d.lines.some((l) => hasCents(l.line.total)));
  const centsDayTotals = report.days.some((d) => hasCents(d.subtotal)) || hasCents(report.grandTotal);

  // One shared column layout for EVERY day's table (table-layout: fixed +
  // this colgroup), so columns line up identically across days instead of
  // each table auto-sizing to its own content. Order must match the
  // thead/tbody cell order below.
  const colWidths: string[] = [
    "22%",                       // Position / Specialty (combined)
    ...(anyShift ? ["7%"] : []), // Shift
    "23%",                       // Time
    "6%",                        // Crew
    "6%",                        // ST Hrs
    ...(anyOt ? ["6%"] : []),    // OT Hrs
    ...(anyDt ? ["6%"] : []),    // DT Hrs
    "9%",                        // Rate
    ...(anyOt ? ["6%"] : []),    // $/OT
    ...(anyDt ? ["6%"] : []),    // $/DT
    "10%",                       // Total
  ];
  const colCount = colWidths.length;

  const unpricedCount = report.days.reduce(
    (n, d) => n + d.lines.filter((l) => l.missingRate).length, 0,
  );
  const anyMultiCrew = report.days.some((d) => d.lines.some((l) => (l.line.crewCount ?? 0) > 1));

  const hasWarnings =
    report.warnings.noRateCard ||
    report.warnings.missingRates.length > 0 ||
    report.warnings.skippedNoPosition.length > 0 ||
    report.warnings.zeroHourExcluded > 0;

  return (
    <div className="preinv-pdf">
      {/* On-screen-only warnings — never printed */}
      {hasWarnings ? (
        <div className="report-warnings hide-print">
          <strong>Check before sending:</strong>
          <ul>
            {report.warnings.noRateCard ? (
              <li>No rate card resolved for this job — every line is priced at $0.</li>
            ) : null}
            {report.warnings.missingRates.map((w, i) => <li key={`mr-${i}`}>{w}</li>)}
            {report.warnings.skippedNoPosition.map((w, i) => (
              <li key={`np-${i}`}>Entry excluded (no position set): {w.detail}</li>
            ))}
            {report.warnings.zeroHourExcluded > 0 ? (
              <li>{report.warnings.zeroHourExcluded} zero-hour timekeeping {report.warnings.zeroHourExcluded === 1 ? "entry" : "entries"} excluded (blank rows — nothing to bill).</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {/* Letterhead */}
      <header className="letterhead">
        <div className="letterhead-logo">
          <img src="/branding/client-logo.png" alt={company?.companyName || "Logo"} />
        </div>
        <div className="letterhead-company">
          <div className="company-name">{company?.companyName || ""}</div>
          {company?.addressLine1 ? <div>{company.addressLine1}</div> : null}
          {company?.addressLine2 ? <div>{company.addressLine2}</div> : null}
          <div>{[company?.city, company?.state, company?.zip].filter(Boolean).join(", ")}</div>
          <div className="company-contact">{[company?.phone, company?.email].filter(Boolean).join(" · ")}</div>
          {company?.website ? <div className="company-contact">{company.website}</div> : null}
        </div>
        <div className="letterhead-doctitle">
          <h1>PRE-INVOICE SUMMARY</h1>
          <div className="not-invoice">For review — this is not an invoice</div>
          <table className="meta-table">
            <tbody>
              <tr><td>Job #</td><td><strong>{job?.job_no || "—"}</strong></td></tr>
              <tr><td>Prepared</td><td>{today}</td></tr>
              {dateRange ? <tr><td>Event dates</td><td>{dateRange}</td></tr> : null}
              <tr><td>Estimated total</td><td><strong>{fmtMoney(report.grandTotal, centsDayTotals)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </header>

      {/* Bill To + Event */}
      <section className="bill-event">
        <div className="bill-to">
          <h3>Prepared For</h3>
          <div className="party-name">{client?.name || job?.client || "—"}</div>
          {client?.contact_name ? <div>{client.contact_name}</div> : null}
          {client?.address ? <div>{client.address}</div> : null}
          <div>{[client?.city, client?.state, client?.zip].filter(Boolean).join(", ")}</div>
          {client?.email ? <div>{client.email}</div> : null}
        </div>
        <div className="event-details">
          <h3>Event</h3>
          <div className="party-name">{job?.event_name || "—"}</div>
          {job?.venue ? <div>{job.venue}</div> : null}
          {job?.venue_address ? <div>{job.venue_address}</div> : null}
          {job?.venue_address_2 ? <div>{job.venue_address_2}</div> : null}
          <div>{[job?.city, job?.state, job?.venue_zip].filter(Boolean).join(", ")}</div>
          {dateRange ? <div className="event-dates"><strong>{dateRange}</strong></div> : null}
        </div>
      </section>

      {anyMultiCrew ? (
        <div className="hours-legend">
          Hours are shown <strong>per crew member</strong>. Line total = crew × hours × rate.
        </div>
      ) : null}

      {/* Day-by-day summary — one printed page per day */}
      {report.days.length === 0 ? (
        <div className="no-lines">No timekeeping records for this job yet.</div>
      ) : report.days.map((day, dayIdx) => {
        const dayHasPending = day.lines.some((l) => l.hasPendingTime);
        const isLast = dayIdx === report.days.length - 1;
        return (
          <section key={day.date} className={`day-page${isLast ? " last" : ""}`}>
            <div className="day-header">
              <span className="day-label">
                {fmtDate(day.date) || day.date}
                <span className="day-count">Day {dayIdx + 1} of {report.days.length}</span>
                {day.isHoliday && (
                  <span className="holiday-badge">
                    Holiday · {report.holidayMultiplier}× rate
                  </span>
                )}
              </span>
              <span className="day-subtotal">{fmtMoney(day.subtotal, centsDayTotals)}</span>
            </div>
            <table className="lines-table">
              <colgroup>
                {colWidths.map((w, ci) => <col key={ci} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th>Position / Specialty</th>
                  {anyShift ? <th>Shift</th> : null}
                  <th>Time</th>
                  <th className="num">Crew</th>
                  <th className="num">ST Hrs</th>
                  {anyOt ? <th className="num">OT Hrs</th> : null}
                  {anyDt ? <th className="num">DT Hrs</th> : null}
                  <th className="num">Rate</th>
                  {anyOt ? <th className="num">$/OT</th> : null}
                  {anyDt ? <th className="num">$/DT</th> : null}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {day.lines.map((rl, i) => {
                  const line = rl.line;
                  const spc = line.specialtyId ? specialtiesById.get(line.specialtyId) : undefined;
                  const positionName = (spc ? positionsById.get(spc.positionId) : undefined)
                    ?? line.serviceKey ?? "—";
                  const specialtyName = spc?.name ?? line.specialty ?? "";
                  // Combined label; skip the specialty when it's missing or
                  // just repeats the position (legacy fallback rows).
                  const posSpecLabel = specialtyName && specialtyName !== positionName
                    ? `${positionName} / ${specialtyName}`
                    : positionName;
                  const dayMode = isDayModeLine(line);
                  const crew = line.crewCount ?? 0;
                  const rateDisplay = rl.missingRate
                    ? "Rate TBD"
                    : dayMode
                      ? `${fmtMoney(line.baseDay)}/day`
                      : `${fmtMoney(line.baseHourly)}/hr`;
                  return (
                    <tr key={i} className={rl.missingRate ? "line-tbd" : undefined}>
                      <td>{posSpecLabel}{rl.hasPendingTime ? <span className="pending-mark">*</span> : null}</td>
                      {anyShift ? <td>{(line.shiftId ? shiftsById.get(line.shiftId) : "") || ""}</td> : null}
                      <td className="time-cell">
                        {fmtTimeSegs(rl).map((s, si) => <div key={si}>{s}</div>)}
                      </td>
                      <td className="num">{crew}</td>
                      <td className="num">{dayMode ? "—" : perEa(line.hours || 0, crew)}</td>
                      {anyOt ? <td className="num">{perEa(line.otHours || 0, crew)}</td> : null}
                      {anyDt ? <td className="num">{perEa(line.dtHours || 0, crew)}</td> : null}
                      <td className="num">{rateDisplay}</td>
                      {anyOt ? <td className="num">{(line.otRate || 0) > 0 && (line.otHours || 0) > 0 ? fmtMoney(line.otRate) : ""}</td> : null}
                      {anyDt ? <td className="num">{(line.dtRate || 0) > 0 && (line.dtHours || 0) > 0 ? fmtMoney(line.dtRate) : ""}</td> : null}
                      <td className="num">{rl.missingRate ? "TBD" : fmtMoney(line.total, centsLineTotals)}</td>
                    </tr>
                  );
                })}
                <tr className="day-total-row">
                  <td colSpan={colCount - 1}>Day total</td>
                  <td className="num">{fmtMoney(day.subtotal, centsDayTotals)}</td>
                </tr>
              </tbody>
            </table>
            {dayHasPending ? (
              <div className="pending-note">* Includes time pending approval — amounts may change on the final invoice.</div>
            ) : null}
            {isLast ? (
              <div className="grand-total">
                <div className="labor-summary">
                  <span>{report.laborSummary.crewShifts} crew {report.laborSummary.crewShifts === 1 ? "shift" : "shifts"}</span>
                  <span className="dot">·</span>
                  <span>{fmtHrs(report.laborSummary.totalHours) || "0"} total hours worked</span>
                </div>
                <table>
                  <tbody>
                    {report.days.length > 1 ? report.days.map((d, i) => (
                      <tr key={d.date}><td>Day {i + 1} — {fmtDate(d.date) || d.date}</td><td>{fmtMoney(d.subtotal, centsDayTotals)}</td></tr>
                    )) : null}
                    <tr className="balance-row">
                      <td>Estimated total{anyPending ? " *" : ""}</td>
                      <td>{fmtMoney(report.grandTotal, centsDayTotals)}</td>
                    </tr>
                  </tbody>
                </table>
                {unpricedCount > 0 ? (
                  <div className="unpriced-note">
                    ⚠ Excludes {unpricedCount} line{unpricedCount === 1 ? "" : "s"} with no rate set (shown as “TBD”).
                    The final total will be higher once {unpricedCount === 1 ? "it is" : "they are"} priced — add the missing
                    rate{unpricedCount === 1 ? "" : "s"} to the rate card before sending this to a client.
                  </div>
                ) : null}
                <div className="disclaimer">
                  This summary is provided for review prior to invoicing and is not an invoice.
                  Totals are estimates based on recorded time{anyPending ? ", including time pending approval," : ""} and
                  may differ on the final invoice.
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      {/* Print button (hidden on print) */}
      <div className="print-actions hide-print">
        <button onClick={() => window.print()} style={{ padding: "8px 16px", fontSize: 14 }}>
          Print / Save as PDF
        </button>
        <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
          Tip: in the print dialog, choose "Save as PDF" as the destination, and uncheck "Headers and footers" for clean output.
        </span>
      </div>

      {/* Component-scoped styles — mirrors invoice-pdf-view.tsx */}
      <style jsx>{`
        .preinv-pdf {
          background: #fff;
          color: #181410;
          max-width: 8.5in;
          margin: 24px auto;
          padding: 0.5in 0.6in 0.7in;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.4;
          position: relative;
          /* Opt into the named portrait page so it beats the app-wide
             landscape @page in globals.css by specificity, not source order. */
          page: preinv-portrait;
        }
        .preinv-pdf h1, .preinv-pdf h3 { color: #15110d; }

        .report-warnings {
          background: #fdecea;
          border: 1px solid #e5b4ae;
          border-radius: 6px;
          padding: 10px 14px;
          margin-bottom: 16px;
          font-size: 10pt;
        }
        .report-warnings ul { margin: 6px 0 0 18px; padding: 0; }

        .letterhead {
          display: grid;
          grid-template-columns: 1.2in 1fr 2.4in;
          gap: 18px;
          align-items: flex-start;
          padding-bottom: 14px;
          border-bottom: 2px solid #87652a;
        }
        .letterhead-logo img { width: 1.2in; height: auto; object-fit: contain; }
        .letterhead-company { font-size: 10pt; line-height: 1.35; }
        .letterhead-company .company-name { font-size: 13pt; font-weight: 700; margin-bottom: 4px; }
        .letterhead-company .company-contact { font-size: 9.5pt; color: #555; }
        .letterhead-doctitle h1 {
          margin: 0 0 2px 0;
          font-size: 17pt;
          font-weight: 800;
          letter-spacing: 0.05em;
          color: #87652a;
          text-align: right;
        }
        .not-invoice {
          text-align: right;
          font-size: 9pt;
          font-style: italic;
          color: #a33;
          margin-bottom: 8px;
        }
        .meta-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        .meta-table td { padding: 2px 4px; vertical-align: top; }
        .meta-table td:first-child { color: #555; width: 45%; }
        .meta-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; }

        .bill-event {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-top: 18px;
          margin-bottom: 6px;
        }
        .bill-event h3 {
          margin: 0 0 6px 0;
          font-size: 9.5pt;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6c6358;
          border-bottom: 1px solid #d7c6aa;
          padding-bottom: 3px;
        }
        .party-name { font-weight: 700; font-size: 11.5pt; margin-bottom: 4px; }
        .event-dates { margin-top: 6px; color: #87652a; }

        .day-page { margin-top: 18px; }
        .day-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          background: #f3e6cf;
          padding: 4px 10px;
          font-weight: 700;
          font-size: 10.5pt;
          border-radius: 3px;
        }
        .day-header .day-subtotal { font-variant-numeric: tabular-nums; }
        .day-count {
          margin-left: 10px;
          font-weight: 400;
          font-size: 9pt;
          color: #6c6358;
        }
        .holiday-badge {
          margin-left: 8px;
          padding: 1px 8px;
          border-radius: 10px;
          background: #c0392b;
          color: #fff;
          font-size: 0.8em;
          font-weight: 600;
        }

        .lines-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5pt;
          margin-top: 4px;
          /* Fixed layout + the shared colgroup = identical column positions
             on every day's table, instead of each table auto-sizing. */
          table-layout: fixed;
        }
        .lines-table th, .lines-table td {
          padding: 3px 5px;
          border-bottom: 1px solid #ead7b8;
          vertical-align: top;
        }
        /* Only DATA cells may break inside a long token (position/time text).
           Headers must NOT — break-word here split single-word labels like
           "Crew" into "Cre"/"w" in their narrow columns. */
        .lines-table td { overflow-wrap: break-word; }
        .lines-table th {
          text-align: left;
          font-weight: 600;
          color: #6c6358;
          background: #fff;
          /* Wrap only at real spaces: two-word labels ("ST Hrs") stack onto
             two lines; single-word labels ("Crew") stay whole. */
          white-space: normal;
          overflow-wrap: normal;
          word-break: keep-all;
        }
        .lines-table th.num, .lines-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        /* Money and hour VALUES must never wrap mid-number. */
        .lines-table td.num { white-space: nowrap; }
        .time-cell { font-variant-numeric: tabular-nums; }
        .pending-mark { color: #a33; font-weight: 700; margin-left: 2px; }
        /* Unpriced (rate-TBD) lines: subtle amber tint so they read as
           "needs attention" without looking like an error on print. */
        .lines-table tr.line-tbd td { background: #fdf6e9; color: #8a6d1f; }
        .hours-legend {
          margin: 10px 0 0;
          font-size: 9pt;
          font-style: italic;
          color: #6c6358;
        }
        .lines-table tr.day-total-row td {
          border-top: 2px solid #15110d;
          border-bottom: none;
          font-weight: 700;
          padding-top: 5px;
        }
        .pending-note {
          margin-top: 6px;
          font-size: 8.5pt;
          font-style: italic;
          color: #6c6358;
        }
        .no-lines { padding: 10px; color: #6c6358; font-style: italic; }

        .grand-total { margin-top: 22px; }
        .labor-summary {
          text-align: right;
          font-size: 9.5pt;
          color: #6c6358;
          margin-bottom: 8px;
          font-variant-numeric: tabular-nums;
        }
        .labor-summary .dot { margin: 0 6px; }
        .unpriced-note {
          margin-top: 10px;
          margin-left: auto;
          width: 55%;
          font-size: 8.5pt;
          color: #8a6d1f;
          background: #fdf6e9;
          border: 1px solid #e6d3a3;
          border-radius: 4px;
          padding: 6px 8px;
        }
        .grand-total table {
          margin-left: auto;
          width: 55%;
          border-collapse: collapse;
          font-size: 11pt;
          font-variant-numeric: tabular-nums;
        }
        .grand-total td { padding: 4px 8px; }
        .grand-total td:last-child { text-align: right; width: 35%; }
        .grand-total tr.balance-row td {
          border-top: 2px solid #15110d;
          font-weight: 700;
          padding-top: 6px;
        }
        .disclaimer {
          margin-top: 16px;
          font-size: 8.5pt;
          font-style: italic;
          color: #6c6358;
        }

        .print-actions { margin-top: 28px; }

        @media print {
          .preinv-pdf {
            margin: 0;
            max-width: none;
            padding: 0.4in 0.5in;
          }
          .day-page { page-break-after: always; }
          .day-page.last { page-break-after: auto; }
          .day-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .holiday-badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .lines-table tr.line-tbd td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .unpriced-note { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {/* @page can't live inside styled-jsx, so it goes in a plain <style>.
          globals.css sets an app-wide `@page { size: landscape }`; a bare
          `@page` override only wins on source order, which bundling/hoisting
          makes unreliable (that's why the first attempt didn't take). A NAMED
          page has higher cascade specificity and wins regardless of order —
          `.preinv-pdf` opts into it via `page: preinv-portrait`. The bare
          rule is kept too as a belt-and-suspenders fallback; both say
          portrait, so there's no conflict. */}
      <style>{`
        @page { size: portrait; }
        @page preinv-portrait {
          size: portrait;
          margin: 0.4in 0.5in;
        }
      `}</style>
    </div>
  );
}

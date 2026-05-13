/**
 * Print-ready invoice view at /invoices/[id]/pdf.
 *
 * Mirrors quote-pdf-view.tsx layout and styling. Differences:
 *   - Title: INVOICE / DEPOSIT INVOICE / FINAL INVOICE
 *   - Source quote reference in metadata block
 *   - Pricing summary shows Subtotal / Deposit Applied / Credits / Paid / Balance
 *   - Deposit invoices: synthesized "Deposit for {quote_no}" line, no day groups
 *   - Final invoices: same daily-grouped lines as quote PDF
 *   - Customer signature only (no AES counter-signature on invoices)
 *
 * Live-reads client (billing address) and job (venue) like the quote PDF.
 */

"use client";

import React, { useEffect, useState } from "react";
import { loadInvoice, balanceDue } from "@/lib/store/invoices";
import { loadCompanySettings, type CompanySettings } from "@/lib/store/company-settings";
import type { InvoiceDraft, JobRequestShift } from "@/lib/store/types";
import { loadShifts } from "@/lib/storage/job-request-shifts";
import { supabase } from "@/lib/supabase/client";
import { isDayModeLine } from "@/lib/rates/line-calc";

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
  city_state?: string | null;
  venue_zip?: string | null;
  request_date?: string | null;
  end_date?: string | null;
};

type LoadedClient = {
  id: string;
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

type DayGroup = {
  date: string;
  label: string;
  lines: Array<{ line: any; positionName: string; specialtyName: string }>;
  subtotal: number;
};

function fmtMoney(n: number | null | undefined): string {
  return `$${(n ?? 0).toFixed(2)}`;
}
function fmtDate(s: string | undefined | null): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default function InvoicePdfView({ id }: { id: string }) {
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
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
        const inv = await loadInvoice(id);
        if (cancelled) return;
        if (!inv) { setError(`Invoice not found: ${id}`); setLoading(false); return; }
        setInvoice(inv);

        const [jobRes, posRes, spcRes, companySettings] = await Promise.all([
          inv.jobRequestId
            ? supabase.from("job_requests").select("*").eq("id", inv.jobRequestId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase.from("positions").select("id, name"),
          supabase.from("specialties").select("id, name, position_id"),
          loadCompanySettings(),
        ]);
        if (cancelled) return;

        const jobRow = jobRes.data as LoadedJob | null;
        setJob(jobRow);
        setPositionsById(new Map((posRes.data ?? []).map((p: any) => [p.id, p.name])));
        setSpecialtiesById(new Map((spcRes.data ?? []).map((s: any) => [s.id, { name: s.name, positionId: s.position_id }])));
        setCompany(companySettings);

        const clientId = jobRow?.client_id ?? inv.clientId;
        if (clientId) {
          const cRes = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
          if (!cancelled) setClient(cRes.data as LoadedClient | null);
        }

        // Shift label lookup for printed lines.
        if (inv.jobRequestId) {
          const s = await loadShifts(inv.jobRequestId, { includeInactive: true });
          if (!cancelled) setShiftsById(new Map(s.map((row: JobRequestShift) => [row.id, row.label])));
        }

        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[invoice-pdf-view] load failed:", err);
        setError(err.message || "Failed to load invoice");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div style={{ padding: 40 }} className="muted">Loading…</div>;
  if (error) return <div style={{ padding: 40 }} className="muted">{error}</div>;
  if (!invoice) return null;

  const isDeposit = invoice.invoiceType === "deposit";

  // For final invoices: group lines by quoteDate
  const dayGroups: DayGroup[] = (() => {
    if (isDeposit) return [];
    const dayMap = new Map<string, DayGroup>();
    for (const line of invoice.lines) {
      const key = line.quoteDate || "(no date)";
      if (!dayMap.has(key)) dayMap.set(key, { date: key, label: fmtDate(key) || key, lines: [], subtotal: 0 });
      const spc = line.specialtyId ? specialtiesById.get(line.specialtyId) : undefined;
      const positionName = (spc ? positionsById.get(spc.positionId) : undefined)
        ?? line.department
        ?? "—";
      const specialtyName = spc?.name ?? line.specialty ?? "—";
      const group = dayMap.get(key)!;
      group.lines.push({ line, positionName, specialtyName });
      group.subtotal += line.total || 0;
    }
    return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  })();

  const dateRange =
    job?.request_date && job?.end_date && job.end_date !== job.request_date
      ? `${fmtDate(job.request_date)} → ${fmtDate(job.end_date)}`
      : fmtDate(job?.request_date ?? "");

  const docTitle = isDeposit
    ? "DEPOSIT INVOICE"
    : invoice.coveredDates && invoice.coveredDates.length > 0
      ? "FINAL INVOICE"
      : "INVOICE";

  const displayInvoiceNo = invoice.invoiceNo
    ?? (job?.job_no ? `${job.job_no}${isDeposit ? "_DEP" : "_INV"}${invoice.parentInvoiceId ? `_REV${invoice.revisionNo - 1}` : ""} (DRAFT)` : "(DRAFT)");

  const balance     = balanceDue(invoice);
  const anyHoliday  = invoice.lines.some((l) => (l.holidayHours || 0) > 0);
  const anyTravel   = invoice.lines.some((l) => (l.travel       || 0) > 0);
  const anyShift    = invoice.lines.some((l) => !!l.shiftId);
  // OT/DT columns only show when at least one line actually uses them.
  // Explicit fields, no rule parsing.
  const anyOt = invoice.lines.some((l) => (l.otHours || 0) > 0);
  const anyDt = invoice.lines.some((l) => (l.dtHours || 0) > 0);
  const anyCrewGt1 = invoice.lines.some((l) => (l.crewCount ?? l.qty ?? 1) > 1);

  return (
    <div className="invoice-pdf">
      {invoice.isDraft ? <div className="draft-watermark">DRAFT</div> : null}

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
          {company?.taxId ? <div className="company-contact">Tax ID: {company.taxId}</div> : null}
        </div>
        <div className="letterhead-doctitle">
          <h1>{docTitle}</h1>
          <table className="meta-table">
            <tbody>
              <tr><td>Invoice #</td><td><strong>{displayInvoiceNo}</strong></td></tr>
              {invoice.sourceQuoteCode ? (
                <tr><td>Source quote</td><td>{invoice.sourceQuoteCode}</td></tr>
              ) : null}
              <tr><td>Job #</td><td>{job?.job_no || "—"}</td></tr>
              <tr><td>Issue date</td><td>{invoice.issueDate || (invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : "—")}</td></tr>
              {invoice.dueDate ? <tr><td>Due date</td><td>{invoice.dueDate}</td></tr> : null}
              {invoice.poNo ? <tr><td>PO #</td><td>{invoice.poNo}</td></tr> : null}
              <tr><td>Status</td><td>{invoice.isDraft ? "Draft" : (invoice.status ?? "issued")}</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      {/* Bill To + Event */}
      <section className="bill-event">
        <div className="bill-to">
          <h3>Bill To</h3>
          <div className="party-name">{client?.name || invoice.billTo || invoice.client || "—"}</div>
          {client?.contact_name ? <div>{client.contact_name}</div> : null}
          {client?.address ? <div>{client.address}</div> : null}
          <div>{[client?.city, client?.state, client?.zip].filter(Boolean).join(", ")}</div>
          {client?.phone ? <div>{client.phone}</div> : null}
          {client?.email ? <div>{client.email}</div> : null}
        </div>
        <div className="event-details">
          <h3>Event</h3>
          <div className="party-name">{job?.event_name || invoice.eventName || "—"}</div>
          {job?.venue ? <div>{job.venue}</div> : null}
          {job?.venue_address ? <div>{job.venue_address}</div> : null}
          {job?.venue_address_2 ? <div>{job.venue_address_2}</div> : null}
          <div>{[job?.city, job?.state, job?.venue_zip].filter(Boolean).join(", ")}</div>
          {dateRange ? <div className="event-dates"><strong>{dateRange}</strong></div> : null}
          {invoice.coveredDates && invoice.coveredDates.length > 0 ? (
            <div className="event-dates"><span className="muted">Covers: </span>{invoice.coveredDates.join(", ")}</div>
          ) : null}
        </div>
      </section>

      {/* Pricing summary at top */}
      <section className="pricing-summary top">
        <table>
          <tbody>
            <tr><td>Subtotal</td><td>{fmtMoney(invoice.subtotal)}</td></tr>
            {invoice.depositApplied > 0 ? (
              <tr><td>Deposit applied</td><td>−{fmtMoney(invoice.depositApplied)}</td></tr>
            ) : null}
            {invoice.creditsApplied > 0 ? (
              <tr><td>Credits applied</td><td>−{fmtMoney(invoice.creditsApplied)}</td></tr>
            ) : null}
            {invoice.paidAmount > 0 ? (
              <tr><td>Amount paid</td><td>−{fmtMoney(invoice.paidAmount)}</td></tr>
            ) : null}
            <tr className="balance-row">
              <td>Balance due</td>
              <td>{fmtMoney(balance)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Charges section — branches on invoice type */}
      {isDeposit ? (
        <section className="lines">
          <h3>Charges</h3>
          <table className="lines-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Description</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Deposit
                  {invoice.sourceQuoteCode ? (
                    <span className="muted"> · for {invoice.sourceQuoteCode}</span>
                  ) : null}
                </td>
                <td className="num">{fmtMoney(invoice.subtotal)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : (
        <section className="lines">
          <h3>Crew &amp; Services</h3>
          {dayGroups.length === 0 ? (
            <div className="no-lines">No line items.</div>
          ) : dayGroups.map((g) => (
            <div key={g.date} className="day-group">
              <div className="day-header">
                <span className="day-label">{g.label}</span>
                <span className="day-subtotal">{fmtMoney(g.subtotal)}</span>
              </div>
              <table className="lines-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Specialty</th>
                    {anyShift    ? <th>Shift</th>                  : null}
                    {anyCrewGt1  ? <th className="num">Crew</th>   : null}
                    <th className="num">ST Hrs</th>
                    {anyOt       ? <th className="num">OT Hrs</th> : null}
                    {anyDt       ? <th className="num">DT Hrs</th> : null}
                    {anyHoliday  ? <th className="num">Hol Hrs</th>: null}
                    <th className="num">Rate</th>
                    {anyOt       ? <th className="num">$/OT</th>   : null}
                    {anyDt || anyHoliday ? <th className="num">$/DT</th> : null}
                    {anyTravel   ? <th className="num">Travel</th> : null}
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map(({ line, positionName, specialtyName }, i) => {
                    const isDayMode    = isDayModeLine(line);
                    const crewCount    = Number(line.crewCount ?? line.qty ?? 1);
                    const hours        = Number(line.hours        || 0);
                    const otHours      = Number(line.otHours      || 0);
                    const dtHours      = Number(line.dtHours      || 0);
                    const holidayHours = Number(line.holidayHours || 0);
                    const travel       = Number(line.travel       || 0);
                    const otRate       = Number(line.otRate       || 0);
                    const dtRate       = Number(line.dtRate       || 0);
                    const rateDisplay  = isDayMode
                      ? `${fmtMoney(line.baseDay)} / day`
                      : `${fmtMoney(line.baseHourly)} / hr`;

                    return (
                      <React.Fragment key={i}>
                        <tr>
                          <td>{positionName}</td>
                          <td>{specialtyName}</td>
                          {anyShift    ? <td>{(line.shiftId ? shiftsById.get(line.shiftId) : "") || ""}</td> : null}
                          {anyCrewGt1  ? <td className="num">{crewCount}</td> : null}
                          <td className="num">{isDayMode ? "—" : (hours || "")}</td>
                          {anyOt       ? <td className="num">{otHours      || ""}</td> : null}
                          {anyDt       ? <td className="num">{dtHours      || ""}</td> : null}
                          {anyHoliday  ? <td className="num">{holidayHours || ""}</td> : null}
                          <td className="num">{rateDisplay}</td>
                          {anyOt       ? <td className="num">{otRate > 0 ? fmtMoney(otRate) : ""}</td> : null}
                          {anyDt || anyHoliday
                            ? <td className="num">{dtRate > 0 ? fmtMoney(dtRate) : ""}</td>
                            : null}
                          {anyTravel   ? <td className="num">{travel > 0 ? fmtMoney(travel) : ""}</td> : null}
                          <td className="num">{fmtMoney(line.total)}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {/* Pricing summary at bottom */}
      <section className="pricing-summary bottom">
        <table>
          <tbody>
            <tr><td>Subtotal</td><td>{fmtMoney(invoice.subtotal)}</td></tr>
            {invoice.depositApplied > 0 ? (
              <tr><td>Deposit applied</td><td>−{fmtMoney(invoice.depositApplied)}</td></tr>
            ) : null}
            {invoice.creditsApplied > 0 ? (
              <tr><td>Credits applied</td><td>−{fmtMoney(invoice.creditsApplied)}</td></tr>
            ) : null}
            {invoice.paidAmount > 0 ? (
              <tr><td>Amount paid</td><td>−{fmtMoney(invoice.paidAmount)}</td></tr>
            ) : null}
            <tr className="balance-row">
              <td>Balance due</td>
              <td>{fmtMoney(balance)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Pay To block — only when company has remit-to info */}
      {company?.companyName && (company?.addressLine1 || company?.email) ? (
        <section className="pay-to">
          <h3>Remit Payment To</h3>
          <div>{company.companyName}</div>
          {company.addressLine1 ? <div>{company.addressLine1}</div> : null}
          {company.addressLine2 ? <div>{company.addressLine2}</div> : null}
          <div>{[company.city, company.state, company.zip].filter(Boolean).join(", ")}</div>
          {company.email ? <div>{company.email}</div> : null}
          {company.phone ? <div>{company.phone}</div> : null}
        </section>
      ) : null}

      {/* Terms — last block on the page so they can flow into multiple
          pages if long. Full width, no break-inside:avoid. Invoices don't
          carry a signature section (acknowledgment isn't required like on
          a quote). */}
      {invoice.terms ? (
        <section className="terms">
          <h3>Terms &amp; Conditions</h3>
          <div className="terms-body">{invoice.terms}</div>
        </section>
      ) : null}

      {/* Print button (hidden on print) */}
      <div className="print-actions hide-print">
        <button onClick={() => window.print()} style={{ padding: "8px 16px", fontSize: 14 }}>
          Print / Save as PDF
        </button>
        <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
          Tip: in the print dialog, choose "Save as PDF" as the destination, and uncheck "Headers and footers" for clean output.
        </span>
      </div>

      {/* Component-scoped styles — mirrors quote-pdf-view.tsx */}
      <style jsx>{`
        .invoice-pdf {
          background: #fff;
          color: #181410;
          max-width: 8.5in;
          margin: 24px auto;
          padding: 0.5in 0.6in 0.7in;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.4;
          position: relative;
        }
        .invoice-pdf h1, .invoice-pdf h3 { color: #15110d; }
        .draft-watermark {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-size: 220px;
          font-weight: 900;
          color: rgba(180, 50, 50, 0.13);
          pointer-events: none;
          z-index: 10;
          letter-spacing: 0.1em;
        }

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
          margin: 0 0 8px 0;
          font-size: 22pt;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #87652a;
          text-align: right;
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

        .pricing-summary { margin: 18px 0; }
        .pricing-summary table {
          margin-left: auto;
          width: 50%;
          border-collapse: collapse;
          font-size: 11pt;
          font-variant-numeric: tabular-nums;
        }
        .pricing-summary td { padding: 4px 8px; }
        .pricing-summary td:last-child { text-align: right; width: 35%; }
        .pricing-summary tr.balance-row td {
          border-top: 2px solid #15110d;
          font-weight: 700;
          padding-top: 6px;
        }
        .pricing-summary.top {
          background: #fbf4e8;
          padding: 10px 16px;
          border-radius: 6px;
        }
        .pricing-summary.top table { width: 100%; }
        .pricing-summary.top td:first-child { color: #181410; }

        .lines h3 {
          margin: 18px 0 8px 0;
          font-size: 11pt;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6c6358;
          border-bottom: 1px solid #d7c6aa;
          padding-bottom: 3px;
        }
        .day-group { margin-bottom: 14px; }
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
        .lines-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5pt;
          margin-top: 4px;
          table-layout: auto;
        }
        .lines-table th, .lines-table td {
          padding: 3px 5px;
          border-bottom: 1px solid #ead7b8;
          vertical-align: top;
        }
        .lines-table th {
          text-align: left;
          font-weight: 600;
          color: #6c6358;
          background: #fff;
        }
        .lines-table th.num, .lines-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        /* Per-line caption row: explicit math + context so the customer can
           verify the total from the printed numbers. Indented under the
           line, small, no top border so it visually attaches to the line. */
        .lines-table tr.line-caption td {
          padding: 1px 6px 4px 18px;
          border-bottom: 1px solid #ead7b8;
          font-size: 8.5pt;
          color: #6c6358;
        }
        .lines-table tr.line-caption .math {
          font-variant-numeric: tabular-nums;
        }
        .lines-table tr.line-caption .ctx {
          font-style: italic;
        }
        .no-lines { padding: 10px; color: #6c6358; font-style: italic; }

        .pay-to {
          margin-top: 18px;
          padding: 10px 14px;
          background: #f3e6cf;
          border-radius: 6px;
          break-inside: avoid;
        }
        .pay-to h3 {
          margin: 0 0 6px 0;
          font-size: 9.5pt;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6c6358;
        }

        /* Terms: full-width, allowed to break across pages so long T&Cs
           flow naturally instead of forcing a single-page block. */
        .terms {
          margin-top: 22px;
          width: 100%;
        }
        .terms h3 {
          margin: 0 0 6px 0;
          font-size: 9.5pt;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6c6358;
          border-bottom: 1px solid #d7c6aa;
          padding-bottom: 3px;
        }
        .terms-body {
          white-space: pre-wrap;
          font-size: 9pt;
          line-height: 1.45;
          color: #181410;
          /* Allow heading to stay with first lines; otherwise let it flow. */
          orphans: 3;
          widows: 3;
        }

        .print-actions {
          margin-top: 22px;
          padding-top: 14px;
          border-top: 1px dashed #d7c6aa;
        }

        @media print {
          .invoice-pdf {
            margin: 0;
            padding: 0.4in 0.55in 0.5in;
            max-width: none;
          }
          .hide-print { display: none !important; }
          .day-group, .pay-to { break-inside: avoid; }
          /* terms intentionally NOT in the avoid list — long T&Cs should flow */
        }
      `}</style>
    </div>
  );
}

/**
 * Print-ready quote view. Reaches the user via /quotes/[id]/pdf.
 *
 * Layout follows generic quote-document conventions (not the on-screen forms):
 *   - Letterhead row: AES logo + company info
 *   - Bill To (left) + Quote metadata (right)
 *   - Event details block
 *   - Pricing summary at the top
 *   - Lines grouped by day with a daily subtotal per group
 *   - Pricing summary at the bottom (above terms)
 *   - Terms & Conditions
 *   - Signature blocks (customer + AES authorized)
 *
 * Live-reads the client (for billing address) and job (for venue) so any
 * post-issue edits to those upstream records show on a fresh print —
 * matches the user's stated preference.
 *
 * Drafts get a diagonal "DRAFT" watermark so a printed draft can't be
 * confused with the issued document.
 */

"use client";

import { useEffect, useState } from "react";
import { loadQuote } from "@/lib/store/quotes";
import { loadCompanySettings, type CompanySettings } from "@/lib/store/company-settings";
import type { QuoteDraft } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";

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
  start_time?: string | null;
  end_time?: string | null;
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
  // start_date columns are text in YYYY-MM-DD form
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default function QuotePdfView({ id }: { id: string }) {
  const [quote, setQuote] = useState<QuoteDraft | null>(null);
  const [job, setJob] = useState<LoadedJob | null>(null);
  const [client, setClient] = useState<LoadedClient | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [positionsById, setPositionsById] = useState<Map<string, string>>(new Map());
  const [specialtiesById, setSpecialtiesById] = useState<Map<string, { name: string; positionId: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const q = await loadQuote(id);
        if (cancelled) return;
        if (!q) { setError(`Quote not found: ${id}`); setLoading(false); return; }
        setQuote(q);

        const [jobRes, posRes, spcRes, companySettings] = await Promise.all([
          q.jobRequestId
            ? supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle()
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

        // Live-read client for billing address.
        const clientId = jobRow?.client_id ?? q.clientId;
        if (clientId) {
          const cRes = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
          if (!cancelled) setClient(cRes.data as LoadedClient | null);
        }

        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[quote-pdf-view] load failed:", err);
        setError(err.message || "Failed to load quote");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div style={{ padding: 40 }} className="muted">Loading…</div>;
  if (error) return <div style={{ padding: 40 }} className="muted">{error}</div>;
  if (!quote) return null;

  // Group lines by quoteDate.
  const dayMap = new Map<string, DayGroup>();
  for (const line of quote.lines) {
    const key = line.quoteDate || "(no date)";
    if (!dayMap.has(key)) dayMap.set(key, { date: key, label: fmtDate(key) || key, lines: [], subtotal: 0 });
    const spc = line.specialtyId ? specialtiesById.get(line.specialtyId) : undefined;
    const positionName = (spc ? positionsById.get(spc.positionId) : undefined)
      ?? (line.positionId ? positionsById.get(line.positionId) : undefined)
      ?? line.department
      ?? "—";
    const specialtyName = spc?.name ?? line.specialty ?? "—";
    const group = dayMap.get(key)!;
    group.lines.push({ line, positionName, specialtyName });
    group.subtotal += line.total || 0;
  }
  const dayGroups = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const dateRange =
    job?.request_date && job?.end_date && job.end_date !== job.request_date
      ? `${fmtDate(job.request_date)} → ${fmtDate(job.end_date)}`
      : fmtDate(job?.request_date ?? quote.startDate);

  const balanceDue = Math.round(((quote.total ?? 0) - (quote.deposit ?? 0)) * 100) / 100;

  // Display value for the top-of-document quote number. Drafts show a
  // projected number based on the parent job_no for clarity even though
  // the actual quote_no is only stamped at issue.
  const displayQuoteNo = quote.quoteNo
    ?? (job?.job_no ? `${job.job_no}_EST${quote.parentQuoteId ? `_REV${quote.revisionNo - 1}` : ""} (DRAFT)` : "(DRAFT)");

  return (
    <div className="quote-pdf">
      {/* Print-only watermark for drafts. CSS in component-level <style>. */}
      {quote.isDraft ? <div className="draft-watermark">DRAFT</div> : null}

      {/* ─── Letterhead ────────────────────────────────────────────────────── */}
      <header className="letterhead">
        <div className="letterhead-logo">
          <img src="/branding/client-logo.png" alt={company?.companyName || "Logo"} />
        </div>
        <div className="letterhead-company">
          <div className="company-name">{company?.companyName || ""}</div>
          {company?.addressLine1 ? <div>{company.addressLine1}</div> : null}
          {company?.addressLine2 ? <div>{company.addressLine2}</div> : null}
          <div>
            {[company?.city, company?.state, company?.zip].filter(Boolean).join(", ")}
          </div>
          <div className="company-contact">
            {[company?.phone, company?.email].filter(Boolean).join(" · ")}
          </div>
          {company?.website ? <div className="company-contact">{company.website}</div> : null}
        </div>
        <div className="letterhead-doctitle">
          <h1>QUOTE</h1>
          <table className="meta-table">
            <tbody>
              <tr><td>Quote #</td><td><strong>{displayQuoteNo}</strong></td></tr>
              <tr><td>Job #</td><td>{job?.job_no || "—"}</td></tr>
              <tr><td>Issue date</td><td>{quote.issuedAt ? new Date(quote.issuedAt).toLocaleDateString() : "—"}</td></tr>
              <tr><td>Status</td><td>{quote.isDraft ? "Draft" : (quote.status ?? "issued")}</td></tr>
              {quote.preparedByName || quote.preparedByTitle ? (
                <tr>
                  <td>Prepared by</td>
                  <td>{quote.preparedByName}{quote.preparedByTitle ? ` — ${quote.preparedByTitle}` : ""}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </header>

      {/* ─── Bill To + Event details ──────────────────────────────────────── */}
      <section className="bill-event">
        <div className="bill-to">
          <h3>Bill To</h3>
          <div className="party-name">{client?.name || job?.client || "—"}</div>
          {client?.contact_name ? <div>{client.contact_name}</div> : null}
          {client?.address ? <div>{client.address}</div> : null}
          <div>
            {[client?.city, client?.state, client?.zip].filter(Boolean).join(", ")}
          </div>
          {client?.phone ? <div>{client.phone}</div> : null}
          {client?.email ? <div>{client.email}</div> : null}
        </div>
        <div className="event-details">
          <h3>Event</h3>
          <div className="party-name">{job?.event_name || quote.eventName || "—"}</div>
          {job?.venue ? <div>{job.venue}</div> : null}
          {job?.venue_address ? <div>{job.venue_address}</div> : null}
          {job?.venue_address_2 ? <div>{job.venue_address_2}</div> : null}
          <div>
            {[job?.city, job?.state, job?.venue_zip].filter(Boolean).join(", ")}
          </div>
          <div className="event-dates"><strong>{dateRange}</strong></div>
        </div>
      </section>

      {/* ─── Pricing summary at top ───────────────────────────────────────── */}
      <section className="pricing-summary top">
        <table>
          <tbody>
            <tr><td>Subtotal</td><td>{fmtMoney(quote.total)}</td></tr>
            <tr>
              <td>Deposit ({quote.depositPct ?? 0}%)</td>
              <td>{fmtMoney(quote.deposit)}</td>
            </tr>
            <tr className="balance-row">
              <td>Balance due upon completion</td>
              <td>{fmtMoney(balanceDue)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ─── Lines, grouped by day ────────────────────────────────────────── */}
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
                  <th>Shift</th>
                  <th className="num">Qty</th>
                  <th className="num">Hrs</th>
                  <th className="num">Rate</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map(({ line, positionName, specialtyName }, i) => {
                  const rateDisplay = line.rateMode === "day" || (line.baseDay > 0 && !line.hours)
                    ? `${fmtMoney(line.baseDay)} / day`
                    : `${fmtMoney(line.baseHourly)} / hr`;
                  return (
                    <tr key={i}>
                      <td>{positionName}</td>
                      <td>{specialtyName}</td>
                      <td>{line.shiftLabel || ""}</td>
                      <td className="num">{line.qty}</td>
                      <td className="num">{line.rateMode === "day" || !line.hours ? "—" : line.hours}</td>
                      <td className="num">{rateDisplay}</td>
                      <td className="num">{fmtMoney(line.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {/* ─── Pricing summary at bottom ────────────────────────────────────── */}
      <section className="pricing-summary bottom">
        <table>
          <tbody>
            <tr><td>Subtotal</td><td>{fmtMoney(quote.total)}</td></tr>
            <tr>
              <td>Deposit ({quote.depositPct ?? 0}%)</td>
              <td>{fmtMoney(quote.deposit)}</td>
            </tr>
            <tr className="balance-row">
              <td>Balance due upon completion</td>
              <td>{fmtMoney(balanceDue)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ─── Terms ────────────────────────────────────────────────────────── */}
      {quote.terms ? (
        <section className="terms">
          <h3>Terms &amp; Conditions</h3>
          <div className="terms-body">{quote.terms}</div>
        </section>
      ) : null}

      {/* ─── Signature blocks ─────────────────────────────────────────────── */}
      <section className="signatures">
        <div className="sig-block">
          <div className="sig-line"></div>
          <div className="sig-meta">
            <div>Customer signature</div>
            <div className="sig-fields">
              <span>Printed name: ___________________________</span>
              <span>Date: _____________</span>
            </div>
          </div>
        </div>
        <div className="sig-block">
          <div className="sig-line"></div>
          <div className="sig-meta">
            <div>{company?.companyName || "Company"} authorized signature</div>
            <div className="sig-fields">
              <span>Printed name: ___________________________</span>
              <span>Date: _____________</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Print button (hidden on print) ───────────────────────────────── */}
      <div className="print-actions hide-print">
        <button onClick={() => window.print()} style={{ padding: "8px 16px", fontSize: 14 }}>
          Print / Save as PDF
        </button>
        <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
          Tip: in the print dialog, choose "Save as PDF" as the destination, and uncheck "Headers and footers" for a clean output.
        </span>
      </div>

      {/* ─── Component-scoped styles ──────────────────────────────────────── */}
      <style jsx>{`
        .quote-pdf {
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
        .quote-pdf h1, .quote-pdf h3 {
          color: #15110d;
        }
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

        /* ─── Letterhead ──────────────────────────────────────────────── */
        .letterhead {
          display: grid;
          grid-template-columns: 1.2in 1fr 2.2in;
          gap: 18px;
          align-items: flex-start;
          padding-bottom: 14px;
          border-bottom: 2px solid #87652a;
        }
        .letterhead-logo img {
          width: 1.2in;
          height: auto;
          object-fit: contain;
        }
        .letterhead-company {
          font-size: 10pt;
          line-height: 1.35;
        }
        .letterhead-company .company-name {
          font-size: 13pt;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .letterhead-company .company-contact {
          font-size: 9.5pt;
          color: #555;
        }
        .letterhead-doctitle h1 {
          margin: 0 0 8px 0;
          font-size: 24pt;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: #87652a;
          text-align: right;
        }
        .meta-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5pt;
        }
        .meta-table td {
          padding: 2px 4px;
          vertical-align: top;
        }
        .meta-table td:first-child {
          color: #555;
          width: 45%;
        }
        .meta-table td:last-child {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        /* ─── Bill To + Event ─────────────────────────────────────────── */
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
        .party-name {
          font-weight: 700;
          font-size: 11.5pt;
          margin-bottom: 4px;
        }
        .event-dates {
          margin-top: 6px;
          color: #87652a;
        }

        /* ─── Pricing summary boxes ───────────────────────────────────── */
        .pricing-summary {
          margin: 18px 0;
        }
        .pricing-summary table {
          margin-left: auto;
          width: 50%;
          border-collapse: collapse;
          font-size: 11pt;
          font-variant-numeric: tabular-nums;
        }
        .pricing-summary td {
          padding: 4px 8px;
        }
        .pricing-summary td:last-child {
          text-align: right;
          width: 35%;
        }
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
        .pricing-summary.top table {
          width: 100%;
        }
        .pricing-summary.top td:first-child { color: #181410; }

        /* ─── Lines ───────────────────────────────────────────────────── */
        .lines h3 {
          margin: 18px 0 8px 0;
          font-size: 11pt;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6c6358;
          border-bottom: 1px solid #d7c6aa;
          padding-bottom: 3px;
        }
        .day-group {
          margin-bottom: 14px;
        }
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
        .day-header .day-subtotal {
          font-variant-numeric: tabular-nums;
        }
        .lines-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10pt;
          margin-top: 4px;
        }
        .lines-table th, .lines-table td {
          padding: 4px 6px;
          border-bottom: 1px solid #ead7b8;
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
        .no-lines {
          padding: 10px;
          color: #6c6358;
          font-style: italic;
        }

        /* ─── Terms ───────────────────────────────────────────────────── */
        .terms {
          margin-top: 22px;
          break-inside: avoid;
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
        }

        /* ─── Signatures ──────────────────────────────────────────────── */
        .signatures {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          margin-top: 32px;
          break-inside: avoid;
        }
        .sig-block {
          font-size: 10pt;
        }
        .sig-line {
          border-bottom: 1px solid #181410;
          height: 36px;
        }
        .sig-meta {
          margin-top: 4px;
          color: #6c6358;
          font-size: 9pt;
        }
        .sig-fields {
          display: flex;
          gap: 14px;
          margin-top: 6px;
          flex-wrap: wrap;
        }

        .print-actions {
          margin-top: 22px;
          padding-top: 14px;
          border-top: 1px dashed #d7c6aa;
        }

        /* ─── Print rules ─────────────────────────────────────────────── */
        @media print {
          .quote-pdf {
            margin: 0;
            padding: 0.4in 0.55in 0.5in;
            max-width: none;
          }
          .hide-print {
            display: none !important;
          }
          .day-group {
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}

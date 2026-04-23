"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadInvoiceDrafts, loadQuotes, loadJobSheets, loadTimesheets } from "@/lib/store/app-store";
import type { InvoiceDraft, JobSheet, QuoteDraft, Timesheet } from "@/lib/store/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function addMonths(ymd: string, months: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMoneyShort(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function isDepositOnlyInvoice(inv: InvoiceDraft): boolean {
  // Deposit-only invoices are created with empty lines / subtotal = 0 and
  // amountDue === deposit. See createDepositInvoiceDraft in invoice-builder.
  return (!inv.lines || inv.lines.length === 0) && Number(inv.subtotal || 0) === 0 && Number(inv.deposit || 0) > 0;
}

// ─── Info tooltip badge ─────────────────────────────────────────────────────

function Info({ text }: { text: string }) {
  return (
    <span className="info-badge" tabIndex={0} aria-label={text}>
      i
      <span className="info-tip">{text}</span>
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  // Trigger a re-render when caches populate (initStore may not be done on first paint)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 500);
    const stop = setTimeout(() => clearInterval(t), 3000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, []);

  const invoices = useMemo<InvoiceDraft[]>(() => loadInvoiceDrafts(), [tick]);
  const quotes = useMemo<QuoteDraft[]>(() => loadQuotes(), [tick]);
  const jobSheets = useMemo<JobSheet[]>(() => loadJobSheets(), [tick]);
  const timesheets = useMemo<Timesheet[]>(() => loadTimesheets(), [tick]);

  const today = todayYmd();
  const in7 = addDays(today, 7);
  const in14 = addDays(today, 14);
  const in30 = addDays(today, 30);
  const monthStart = startOfMonth(today);
  const lastMonthStart = addMonths(monthStart, -1);
  const lastMonthEnd = addDays(monthStart, -1);

  // ─── Invoices ──────────────────────────────────────────────────────────────
  const outstandingInvoices = invoices
    .filter((i) => (i.status === "sent" || i.status === "partial") && (Number(i.amountDue || 0) - Number(i.paidAmount || 0)) > 0)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  const outstandingTotal = outstandingInvoices.reduce((s, i) => s + (Number(i.amountDue || 0) - Number(i.paidAmount || 0)), 0);

  // Aging buckets (based on days past dueDate; current if not yet due)
  function agingBucket(due: string): "current" | "1-30" | "31-60" | "61-90" | "90+" {
    if (!due || due >= today) return "current";
    const d = Math.round((new Date(today + "T00:00:00").getTime() - new Date(due + "T00:00:00").getTime()) / 86400000);
    if (d <= 30) return "1-30";
    if (d <= 60) return "31-60";
    if (d <= 90) return "61-90";
    return "90+";
  }
  const aging = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>;
  for (const i of outstandingInvoices) {
    const bal = Number(i.amountDue || 0) - Number(i.paidAmount || 0);
    aging[agingBucket(i.dueDate)] += bal;
  }

  // Revenue MTD — all non-draft invoices issued this month. Deposit invoices
  // are shown separately so user can see "net" (full-invoice $ minus deposits
  // already billed) alongside the gross figure.
  const thisMonthInvoices = invoices.filter((i) => i.status !== "draft" && i.issueDate >= monthStart && i.issueDate <= today);
  const thisMonthTotal = thisMonthInvoices.reduce((s, i) => s + Number(i.amountDue || 0), 0);
  const thisMonthDeposits = thisMonthInvoices.filter(isDepositOnlyInvoice).reduce((s, i) => s + Number(i.deposit || 0), 0);
  const thisMonthNet = thisMonthTotal - thisMonthDeposits;
  const lastMonthInvoices = invoices.filter((i) => i.status !== "draft" && i.issueDate >= lastMonthStart && i.issueDate <= lastMonthEnd);
  const lastMonthTotal = lastMonthInvoices.reduce((s, i) => s + Number(i.amountDue || 0), 0);
  const lastMonthDeposits = lastMonthInvoices.filter(isDepositOnlyInvoice).reduce((s, i) => s + Number(i.deposit || 0), 0);
  const lastMonthNet = lastMonthTotal - lastMonthDeposits;

  // ─── Quotes ──────────────────────────────────────────────────────────────
  const invoicedQuoteIds = new Set(invoices.map((i) => i.quoteId).filter(Boolean));
  const openQuotes = quotes
    .filter((q) => q.status === "quoted" && !invoicedQuoteIds.has(q.id))
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  const openQuotesValue = openQuotes.reduce((s, q) => s + Number(q.total || 0), 0);

  // ─── Job sheets ──────────────────────────────────────────────────────────
  const upcoming7 = jobSheets
    .filter((j) => j.date >= today && j.date <= in7)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const upcoming30 = jobSheets
    .filter((j) => j.date >= today && j.date <= in30)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const understaffed = jobSheets
    .filter((j) => j.date >= today && j.date <= in14 && (j.workers || []).some((w) => !w.confirmed))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // ─── Timesheets awaiting approval ──────────────────────────────────────────
  const pendingRows: Array<{ ts: Timesheet; row: Timesheet["rows"][number] }> = [];
  for (const ts of timesheets) {
    for (const row of ts.rows || []) {
      if (row.status === "submitted") pendingRows.push({ ts, row });
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* Quick actions */}
      <div className="action-row" style={{ flexWrap: "wrap", gap: 8 }}>
        <Link href="/quote-builder"><button type="button">+ New Quote</button></Link>
        <Link href="/invoices"><button type="button">+ New Invoice</button></Link>
        <Link href="/timekeeping"><button type="button" className="secondary">
          Approve Timesheets{pendingRows.length > 0 ? ` (${pendingRows.length})` : ""}
        </button></Link>
        <Link href="/job-sheets"><button type="button" className="secondary">Today&apos;s Job Sheet</button></Link>
        <Link href="/master-calendar"><button type="button" className="secondary">Open Calendar</button></Link>
      </div>

      {/* Top metric row */}
      <div className="grid4">
        <div className="metric-card">
          <div className="metric-label">
            Revenue MTD
            <Info text={`Sum of amountDue on non-draft invoices issued ${monthStart} through ${today}. Net figure excludes deposit-only invoices (which will be re-billed on the final invoice) to avoid double counting.`} />
          </div>
          <div className="metric-value">{fmtMoneyShort(thisMonthNet)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Gross {fmtMoneyShort(thisMonthTotal)} · Deposits {fmtMoneyShort(thisMonthDeposits)}<br />
            Last month net {fmtMoneyShort(lastMonthNet)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">
            Outstanding
            <Info text={"Total balance (amountDue − paidAmount) on invoices with status 'sent' or 'partial' where balance > 0. Drafts and fully paid invoices are excluded."} />
          </div>
          <div className="metric-value">{fmtMoneyShort(outstandingTotal)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {outstandingInvoices.length} invoice{outstandingInvoices.length === 1 ? "" : "s"} across {Object.values(aging).filter((v) => v > 0).length} aging buckets
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">
            Awaiting Approval
            <Info text={"Timesheet rows with status = 'submitted' across every timesheet in the system. Counts both admin-entered and staff-portal entries."} />
          </div>
          <div className="metric-value">{pendingRows.length}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {pendingRows.length === 0 ? "All caught up" : "Timesheet rows pending"}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">
            Events Next 7 Days
            <Info text={`All scheduled job sheets with date between ${today} and ${in7}. No status filter; there's no cancel/tentative flag on job sheets.`} />
          </div>
          <div className="metric-value">{upcoming7.length}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {upcoming30.length} in next 30 days
          </div>
        </div>
      </div>

      {/* Main split: 2/3 + 1/3 */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18 }}>
        {/* Left column */}
        <div className="grid" style={{ gap: 18 }}>
          {/* Upcoming events */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>
                Upcoming Events
                <Info text={"All scheduled job sheets with date ≥ today. Sorted by date ascending. There is no cancel/tentative status — everything on the calendar is shown."} />
              </h3>
              <Link href="/master-calendar" style={{ fontSize: 13, color: "var(--gold-dark)", fontWeight: 600 }}>View calendar →</Link>
            </div>
            {upcoming30.length === 0 ? (
              <div className="muted">No events scheduled in the next 30 days.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Date</th><th>Client</th><th>Event</th><th>Venue</th><th>Crew</th></tr></thead>
                  <tbody>
                    {upcoming30.slice(0, 12).map((j) => {
                      const unconfirmed = (j.workers || []).filter((w) => !w.confirmed).length;
                      return (
                        <tr key={j.id}>
                          <td><strong>{j.date}</strong></td>
                          <td>{j.client || "-"}</td>
                          <td>{j.eventName || "-"}</td>
                          <td>{j.venue || "-"}{j.cityState ? `, ${j.cityState}` : ""}</td>
                          <td>
                            {(j.workers || []).length}
                            {unconfirmed > 0 ? <span className="badge" style={{ marginLeft: 6, background: "#fde8e8", color: "#c0392b", borderColor: "#f5b4b4", padding: "2px 8px" }}>{unconfirmed} unconfirmed</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                    {upcoming30.length > 12 ? (
                      <tr><td colSpan={5} className="muted">…and {upcoming30.length - 12} more</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Unpaid invoices */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>
                Unpaid Invoices
                <Info text={"Invoices with status 'sent' or 'partial' whose balance (amountDue − paidAmount) is greater than zero. Drafts and paid invoices are excluded. Sorted by due date ascending."} />
              </h3>
              <Link href="/invoices" style={{ fontSize: 13, color: "var(--gold-dark)", fontWeight: 600 }}>Open invoices →</Link>
            </div>
            <div className="grid4" style={{ marginBottom: 12 }}>
              <div className="list-card" style={{ borderLeftColor: "#6aa84f" }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>Current</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fmtMoneyShort(aging.current)}</div>
              </div>
              <div className="list-card" style={{ borderLeftColor: "#e8c960" }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>1–30 days</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fmtMoneyShort(aging["1-30"])}</div>
              </div>
              <div className="list-card" style={{ borderLeftColor: "#dc7e3a" }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>31–60 days</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fmtMoneyShort(aging["31-60"])}</div>
              </div>
              <div className="list-card" style={{ borderLeftColor: "#c0392b" }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>61+ days</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fmtMoneyShort(aging["61-90"] + aging["90+"])}</div>
              </div>
            </div>
            {outstandingInvoices.length === 0 ? (
              <div className="muted">No unpaid invoices 🎉</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Invoice #</th><th>Client</th><th>Due</th><th>Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {outstandingInvoices.slice(0, 10).map((i) => {
                      const bal = Number(i.amountDue || 0) - Number(i.paidAmount || 0);
                      const overdue = i.dueDate && i.dueDate < today;
                      return (
                        <tr key={i.id}>
                          <td><strong>{i.invoiceNo || "-"}</strong></td>
                          <td>{i.client || "-"}</td>
                          <td style={{ color: overdue ? "#c0392b" : undefined }}>{i.dueDate || "-"}</td>
                          <td><strong>{fmtMoney(bal)}</strong></td>
                          <td><span className="badge">{i.status}</span></td>
                        </tr>
                      );
                    })}
                    {outstandingInvoices.length > 10 ? (
                      <tr><td colSpan={5} className="muted">…and {outstandingInvoices.length - 10} more</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="grid" style={{ gap: 18 }}>
          {/* Awaiting approval */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>
                Awaiting Approval
                <Info text={"Timesheet rows with status = 'submitted'. Includes both staff-portal submissions and admin-entered rows linked to an employee."} />
              </h3>
              <Link href="/timekeeping" style={{ fontSize: 13, color: "var(--gold-dark)", fontWeight: 600 }}>Review →</Link>
            </div>
            {pendingRows.length === 0 ? (
              <div className="muted">Nothing waiting.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingRows.slice(0, 8).map(({ ts, row }) => (
                  <div key={row.id} className="list-card" style={{ borderLeftColor: "var(--blue)" }}>
                    <div style={{ fontWeight: 700 }}>{row.firstName} {row.lastName}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {row.position || "—"} · {row.workDate || "no date"}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{ts.title}</div>
                  </div>
                ))}
                {pendingRows.length > 8 ? (
                  <div className="muted" style={{ fontSize: 12 }}>…and {pendingRows.length - 8} more</div>
                ) : null}
              </div>
            )}
          </div>

          {/* Open quotes */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>
                Open Quotes
                <Info text={"Quotes with status = 'quoted' that have NOT yet been converted to an invoice (no invoice references the quote's id). Value column sums each quote's stored total."} />
              </h3>
              <Link href="/quote-builder" style={{ fontSize: 13, color: "var(--gold-dark)", fontWeight: 600 }}>Quote builder →</Link>
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              {openQuotes.length} open · Pipeline value <strong>{fmtMoneyShort(openQuotesValue)}</strong>
            </div>
            {openQuotes.length === 0 ? (
              <div className="muted">No open quotes.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {openQuotes.slice(0, 6).map((q) => (
                  <div key={q.id} className="list-card">
                    <div style={{ fontWeight: 700 }}>{q.client || "-"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{q.eventName || "-"}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>{q.startDate || "-"} · {fmtMoney(Number(q.total || 0))}</div>
                  </div>
                ))}
                {openQuotes.length > 6 ? (
                  <div className="muted" style={{ fontSize: 12 }}>…and {openQuotes.length - 6} more</div>
                ) : null}
              </div>
            )}
          </div>

          {/* Understaffed */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>
                Understaffed (14 days)
                <Info text={"Upcoming job sheets in the next 14 days where at least one assigned worker has confirmed = false. Does not yet account for the quoted crew-size target — see the follow-up todo for that."} />
              </h3>
              <Link href="/job-sheets" style={{ fontSize: 13, color: "var(--gold-dark)", fontWeight: 600 }}>Job sheets →</Link>
            </div>
            {understaffed.length === 0 ? (
              <div className="muted">All upcoming crews confirmed.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {understaffed.slice(0, 6).map((j) => {
                  const unconfirmed = (j.workers || []).filter((w) => !w.confirmed).length;
                  return (
                    <div key={j.id} className="list-card" style={{ borderLeftColor: "#dc7e3a" }}>
                      <div style={{ fontWeight: 700 }}>{j.client || "-"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{j.eventName || "-"}</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{j.date} · {unconfirmed} of {(j.workers || []).length} unconfirmed</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

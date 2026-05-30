"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadInvoiceDrafts, loadQuotes, loadJobSheets, loadTimesheets } from "@/lib/store/app-store";
import { supabase } from "@/lib/supabase/client";
import type { InvoiceDraft, JobSheet, QuoteDraft, Timesheet } from "@/lib/store/types";

// Per-job aggregate of crew_needs vs assignments across upcoming days.
type UnderstaffedJob = {
  jobRequestId: string;
  jobNo: string | null;
  eventName: string;
  status: string;
  needCount: number;        // sum of quantity across all upcoming-day crew_needs
  assignedCount: number;    // total assignments (any status) on those days
  confirmedCount: number;   // assignments where confirmed=true
  deficit: number;          // max(0, needCount - confirmedCount)
  nextDay: string;          // earliest upcoming day on this job
  positionGaps: { positionName: string; need: number; confirmed: number }[];
};

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
  // Legacy understaffed (kept as a fallback signal until all jobs migrate
   // to the new model — used only when no per-day data is available).
  const legacyUnderstaffed = jobSheets
    .filter((j) => j.date >= today && j.date <= in14 && (j.workers || []).some((w) => !w.confirmed))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // ─── Understaffed (new model) ──────────────────────────────────────────────
  // Walks job_request_days in the next 14 days, sums crew_needs.quantity per
  // (day, position) as the target, and assignments-with-confirmed=true as
  // the actual. Jobs with positive deficit show in the widget.
  const [understaffed, setUnderstaffed] = useState<UnderstaffedJob[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Upcoming days (next 14) on jobs that aren't already finished.
      const { data: dayRows, error: dayErr } = await supabase
        .from("job_request_days")
        .select("id, job_request_id, event_date, job_requests!inner(id, job_no, event_name, status)")
        .gte("event_date", today)
        .lte("event_date", in14);
      if (cancelled || dayErr || !dayRows) { if (!cancelled) setUnderstaffed([]); return; }

      // PostgREST returns the joined parent as a single object for FK
      // relationships, but the auto-typed result is an array. Cast and
      // pull the first element defensively.
      const liveDays = (dayRows as any[]).map((d) => ({
        ...d,
        job_request: Array.isArray(d.job_requests) ? d.job_requests[0] : d.job_requests,
      })).filter((d) => {
        const s = d.job_request?.status;
        return s !== "completed" && s !== "lost";
      });
      if (liveDays.length === 0) { if (!cancelled) setUnderstaffed([]); return; }
      const dayIds = liveDays.map((d) => d.id);

      // 2. Crew_needs for those days (the targets) and their position names.
      const [needRes, asgRes, posRes] = await Promise.all([
        supabase.from("job_request_crew_needs")
          .select("job_request_day_id, position_id, quantity").in("job_request_day_id", dayIds),
        supabase.from("job_request_assignments")
          .select("job_request_day_id, position_id, confirmed").in("job_request_day_id", dayIds),
        supabase.from("positions").select("id, name").eq("is_active", true),
      ]);
      if (cancelled) return;
      const positionsByid = new Map<string, string>();
      for (const p of (posRes.data ?? []) as any[]) positionsByid.set(p.id, p.name);

      // 3. Roll up per (job, position): need vs confirmed assignments.
      // jobs[jobRequestId] = { meta, perPosition }
      type Bucket = { need: number; confirmed: number; assigned: number };
      const jobs = new Map<string, {
        meta: { jobNo: string | null; eventName: string; status: string };
        perPosition: Map<string, Bucket>;   // key: positionId or "(none)"
        nextDay: string;
      }>();
      const dayToJob = new Map<string, string>();
      for (const d of liveDays) {
        const jrId = d.job_request_id;
        dayToJob.set(d.id, jrId);
        if (!jobs.has(jrId)) {
          jobs.set(jrId, {
            meta: {
              jobNo: d.job_request?.job_no ?? null,
              eventName: d.job_request?.event_name ?? "(no event name)",
              status: d.job_request?.status ?? "",
            },
            perPosition: new Map(),
            nextDay: d.event_date,
          });
        } else {
          const cur = jobs.get(jrId)!;
          if (d.event_date < cur.nextDay) cur.nextDay = d.event_date;
        }
      }
      for (const n of (needRes.data ?? []) as any[]) {
        const jrId = dayToJob.get(n.job_request_day_id); if (!jrId) continue;
        const job = jobs.get(jrId)!;
        const k = n.position_id || "(none)";
        const b = job.perPosition.get(k) ?? { need: 0, confirmed: 0, assigned: 0 };
        b.need += Number(n.quantity || 0);
        job.perPosition.set(k, b);
      }
      for (const a of (asgRes.data ?? []) as any[]) {
        const jrId = dayToJob.get(a.job_request_day_id); if (!jrId) continue;
        const job = jobs.get(jrId)!;
        const k = a.position_id || "(none)";
        const b = job.perPosition.get(k) ?? { need: 0, confirmed: 0, assigned: 0 };
        b.assigned += 1;
        if (a.confirmed) b.confirmed += 1;
        job.perPosition.set(k, b);
      }

      // 4. Project to UnderstaffedJob list, keep only ones with deficit.
      const out: UnderstaffedJob[] = [];
      for (const [jrId, j] of jobs.entries()) {
        let need = 0, assigned = 0, confirmed = 0;
        const positionGaps: { positionName: string; need: number; confirmed: number }[] = [];
        for (const [posId, b] of j.perPosition.entries()) {
          need += b.need; assigned += b.assigned; confirmed += b.confirmed;
          if (b.need > b.confirmed) {
            positionGaps.push({
              positionName: positionsByid.get(posId) || "(unspecified)",
              need: b.need,
              confirmed: b.confirmed,
            });
          }
        }
        const deficit = Math.max(0, need - confirmed);
        if (deficit > 0) {
          out.push({
            jobRequestId: jrId,
            jobNo: j.meta.jobNo,
            eventName: j.meta.eventName,
            status: j.meta.status,
            needCount: need,
            assignedCount: assigned,
            confirmedCount: confirmed,
            deficit,
            nextDay: j.nextDay,
            positionGaps: positionGaps.sort((a, b) => (b.need - b.confirmed) - (a.need - a.confirmed)),
          });
        }
      }
      out.sort((a, b) => a.nextDay.localeCompare(b.nextDay));
      if (!cancelled) setUnderstaffed(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, in14, tick]);

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
                <Info text={"Upcoming jobs in the next 14 days where the confirmed crew assignments fall short of the daily requirements. Sums per position across all upcoming days; falls back to 'unconfirmed workers on a job sheet' for legacy jobs that don't yet have day-level requirements."} />
              </h3>
              <Link href="/job-requests" style={{ fontSize: 13, color: "var(--gold-dark)", fontWeight: 600 }}>Jobs →</Link>
            </div>
            {understaffed === null ? (
              <div className="muted">Loading…</div>
            ) : understaffed.length === 0 && legacyUnderstaffed.length === 0 ? (
              <div className="muted">All upcoming crews fully assigned and confirmed.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {understaffed.slice(0, 6).map((j) => (
                  <Link
                    key={j.jobRequestId}
                    href={`/job-requests?id=${encodeURIComponent(j.jobRequestId)}`}
                    className="list-card"
                    style={{
                      borderLeftColor: "#dc7e3a",
                      textDecoration: "none",
                      color: "inherit",
                      display: "block",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div>
                        <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "var(--accent, #2563eb)" }}>
                          {j.jobNo ?? "(no job #)"}
                        </div>
                        <div style={{ fontWeight: 700, marginTop: 2 }}>{j.eventName}</div>
                      </div>
                      <span style={{
                        background: "#fef3e8", color: "#9a3412",
                        borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 700,
                      }}>
                        −{j.deficit}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      next: {j.nextDay} · {j.confirmedCount}/{j.needCount} confirmed{j.assignedCount > j.confirmedCount ? ` (${j.assignedCount - j.confirmedCount} pending)` : ""}
                    </div>
                    {j.positionGaps.length > 0 && (
                      <div style={{ fontSize: 11, color: "#9a3412", marginTop: 4 }}>
                        {j.positionGaps.slice(0, 3).map((g) =>
                          `${g.need - g.confirmed} more ${g.positionName}`
                        ).join(", ")}
                      </div>
                    )}
                  </Link>
                ))}
                {/* Legacy fallback when there's no new-model data at all */}
                {understaffed.length === 0 && legacyUnderstaffed.slice(0, 6).map((j) => {
                  const unconfirmed = (j.workers || []).filter((w) => !w.confirmed).length;
                  return (
                    <div key={j.id} className="list-card" style={{ borderLeftColor: "#dc7e3a" }}>
                      <div style={{ fontWeight: 700 }}>{j.client || "-"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{j.eventName || "-"}</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{j.date} · {unconfirmed} of {(j.workers || []).length} unconfirmed (legacy job sheet)</div>
                    </div>
                  );
                })}
                {understaffed.length > 6 && (
                  <div className="muted" style={{ fontSize: 12 }}>…and {understaffed.length - 6} more</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

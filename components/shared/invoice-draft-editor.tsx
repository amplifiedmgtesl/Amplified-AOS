/**
 * Minimal invoice draft editor. Mirrors quote-draft-editor structure but
 * simpler since invoices have a fixed lines-from-quote shape.
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadInvoice,
  saveDraft,
  issueDraft,
  deleteDraft,
  balanceDue,
  overwriteFromTimesheets,
} from "@/lib/store/invoices";
import type { InvoiceDraft, QuoteLine, Position, Specialty, JobRequestShift } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";
import { computeLineTotal, isDayModeLine } from "@/lib/rates/line-calc";
import { loadShifts } from "@/lib/storage/job-request-shifts";
import {
  loadInvoiceDays,
  setInvoiceDayHoliday,
  invoiceHolidayLookup,
  type InvoiceDay,
} from "@/lib/storage/invoice-days";

export default function InvoiceDraftEditor({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
  const [job, setJob] = useState<any | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [shifts, setShifts] = useState<JobRequestShift[]>([]);
  const [invoiceDays, setInvoiceDays] = useState<InvoiceDay[]>([]);
  const [rateCardName, setRateCardName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  // Local string state for the deposit amount input so the user can type
  // freely (decimals, partial values) without the parent state's number
  // truncating "100.50" → "100.5" and preventing trailing-zero display.
  const [depositAmountStr, setDepositAmountStr] = useState<string>("");
  // Linked deposit invoice info for the final-invoice draft summary panel.
  const [linkedDeposit, setLinkedDeposit] = useState<{
    invoiceNo: string;
    subtotal: number;
    paidAmount: number;
    status: string;
    isDraft: boolean;
  } | null>(null);
  // Read-only comparison: timesheet entries aggregated by position. Two
  // panels rendered below the line items:
  //   * Approved Timesheet Actuals — what's billable today
  //   * Pending Timesheet Entries  — submitted/unapproved (heads-up that
  //     this invoice may understate actuals until those entries are reviewed)
  // Hours only — pay belongs to the future payroll project, not the bill side.
  type SummaryRow = {
    position: string;
    workers: number;
    stdHours: number;
    otHours: number;
    dtHours: number;
    totalHours: number;
  };
  const [timesheetSummary, setTimesheetSummary] = useState<SummaryRow[]>([]);
  const [pendingTimesheetSummary, setPendingTimesheetSummary] = useState<SummaryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadInvoice(id)
      .then(async (q) => {
        if (cancelled) return;
        if (!q) { setError(`Invoice not found: ${id}`); setLoading(false); return; }
        if (!q.isDraft) { router.replace(`/invoices/${id}`); return; }
        // Backfill sourceQuoteCode at load time if missing — earlier drafts
        // were saved before invoiceToDraftRow persisted this column, so the
        // row has source_quote_id set but source_quote_code NULL. Look up
        // the quote's current quote_no so the editor shows it; the next
        // save round-trips the value to the row.
        if (!q.sourceQuoteCode && q.sourceQuoteId) {
          const sq = await supabase
            .from("quotes")
            .select("quote_no")
            .eq("id", q.sourceQuoteId)
            .maybeSingle();
          if (!cancelled && sq.data?.quote_no) {
            q.sourceQuoteCode = sq.data.quote_no;
          }
        }
        setInvoice(q);
        setDepositAmountStr((q.subtotal ?? 0).toFixed(2));

        // Load invoice_days (holiday flags per date). Seeded at draft creation
        // by snapshotInvoiceDaysFromQuote / FromParent.
        const ids = await loadInvoiceDays(q.id);
        if (!cancelled) setInvoiceDays(ids);

        // Heal stale line totals (display only — do NOT persist here).
        // See quote-draft-editor heal pass for the why. PDF view also
        // recomputes live as belt-and-braces.
        const healMap = new Map<string, boolean>();
        for (const d of ids) healMap.set(d.invoiceDate, d.isHoliday);
        const healedLines = q.lines.map((l) => {
          const dayIsHoliday = !!(l.quoteDate && healMap.get(l.quoteDate));
          const liveTotal = computeLineTotal(l, {
            dayIsHoliday,
            holidayMultiplier: q.holidayMultiplier,
          });
          return Math.abs(liveTotal - (l.total || 0)) > 0.005
            ? { ...l, total: liveTotal }
            : l;
        });
        const driftFound = healedLines.some((l, i) => l !== q.lines[i]);
        if (driftFound && !cancelled) {
          const newSubtotal = Math.round(healedLines.reduce((s, l) => s + (l.total || 0), 0) * 100) / 100;
          const newAmountDue = +(newSubtotal - (q.depositApplied ?? 0) - (q.creditsApplied ?? 0)).toFixed(2);
          setInvoice({ ...q, lines: healedLines, subtotal: newSubtotal, amountDue: newAmountDue });
        }

        // Load positions + specialties for cascading dropdowns on line rows.
        // Mirrors the quote-draft-editor pattern: position picks filter the
        // available specialties; specialty_id is authoritative for the FK
        // (department/specialty text columns kept in sync as display fallback).
        const [posRes, spcRes] = await Promise.all([
          supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
        ]);
        if (!cancelled) {
          setPositions((posRes.data ?? []).map((r: any) => ({
            id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
          })));
          setSpecialties((spcRes.data ?? []).map((r: any) => ({
            id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
          })));
        }

        // Resolve the rate card profile name (data-entry context, never
        // printed on the customer-facing invoice). The invoice carries
        // rateCardProfileId snapshotted at create time; show its name so
        // the operator can verify the right card was applied before issue.
        if (q.rateCardProfileId) {
          const rc = await supabase
            .from("rate_card_profiles")
            .select("name")
            .eq("id", q.rateCardProfileId)
            .maybeSingle();
          if (!cancelled) setRateCardName(rc.data?.name ?? q.rateCardProfileId);
        }

        if (q.jobRequestId) {
          const j = await supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle();
          if (!cancelled) setJob(j.data ?? null);
          // Load this job's shift list for the line dropdowns. Include inactive
          // so historical line refs still resolve in the dropdown (selected
          // but flagged), preserving the line's existing shift if it points
          // at one the operator since deactivated.
          const s = await loadShifts(q.jobRequestId, { includeInactive: true });
          if (!cancelled) setShifts(s);

          // Timesheet aggregate for the comparison panels — fetch every
          // status (rejected is skipped during bucketing). One round-trip,
          // two panels: approved (billable today) + pending (heads-up).
          const tsRes = await supabase
            .from("timesheet_entries")
            .select("position, employee_key, std_hours, ot_hours, dt_hours, total_hours, status")
            .eq("job_id", q.jobRequestId);
          if (!cancelled && !tsRes.error) {
            type Bucket = { workers: Set<string>; stdHours: number; otHours: number; dtHours: number; totalHours: number; unlinked: number };
            const approvedMap = new Map<string, Bucket>();
            const pendingMap  = new Map<string, Bucket>();
            for (const r of tsRes.data ?? []) {
              const status = (r as any).status ?? null;
              if (status === "rejected") continue;
              // Pending = anything not yet approved (admin-typed null, or
              // staff-submitted awaiting review). Approved = approved.
              const target = status === "approved" ? approvedMap : pendingMap;
              const pos = (r.position as string) || "Unknown";
              let bucket = target.get(pos);
              if (!bucket) {
                bucket = { workers: new Set(), stdHours: 0, otHours: 0, dtHours: 0, totalHours: 0, unlinked: 0 };
                target.set(pos, bucket);
              }
              if (r.employee_key) bucket.workers.add(r.employee_key as string);
              else bucket.unlinked++;
              bucket.stdHours   += Number(r.std_hours   ?? 0);
              bucket.otHours    += Number(r.ot_hours    ?? 0);
              bucket.dtHours    += Number(r.dt_hours    ?? 0);
              bucket.totalHours += Number(r.total_hours ?? 0);
            }
            const toRows = (m: Map<string, Bucket>): SummaryRow[] =>
              Array.from(m.entries()).map(([position, v]) => ({
                position,
                workers: v.workers.size + v.unlinked,
                stdHours:   +v.stdHours.toFixed(2),
                otHours:    +v.otHours.toFixed(2),
                dtHours:    +v.dtHours.toFixed(2),
                totalHours: +v.totalHours.toFixed(2),
              }));
            setTimesheetSummary(toRows(approvedMap));
            setPendingTimesheetSummary(toRows(pendingMap));
          }
          // For final drafts, surface the linked deposit invoice so the
          // user can see what's being applied (or warn if none exists).
          if (q.invoiceType === "final") {
            const dep = await supabase
              .from("invoices")
              .select("invoice_no, subtotal, paid_amount, status, is_draft")
              .eq("job_request_id", q.jobRequestId)
              .eq("invoice_type", "deposit")
              .or("status.is.null,and(status.neq.superseded,status.neq.void)")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (!cancelled && dep.data) {
              setLinkedDeposit({
                invoiceNo: dep.data.invoice_no ?? "(draft)",
                subtotal: Number(dep.data.subtotal ?? 0),
                paidAmount: Number(dep.data.paid_amount ?? 0),
                status: dep.data.status ?? (dep.data.is_draft ? "draft" : "issued"),
                isDraft: !!dep.data.is_draft,
              });
            }
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[invoice-draft-editor] load failed:", err);
        setError(err.message || "Failed to load draft");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, router]);

  function money(n: number): number {
    return Math.round(n * 100) / 100;
  }

  // Per-date holiday lookup. Map<YYYY-MM-DD, isHoliday>. Seeded from
  // invoice_days; toggling a day in the Days panel mutates both this map
  // and the underlying row.
  const holidayByDate = useMemo(() => invoiceHolidayLookup(invoiceDays), [invoiceDays]);

  // Defers to the shared formula in lib/rates/line-calc.ts. As of 2026-05-25
  // calc honors day-level is_holiday + per-document holiday multiplier
  // (snapshotted from the source quote's holiday_multiplier).
  function recomputeLineTotal(l: QuoteLine): number {
    const dayIsHoliday = !!(l.quoteDate && holidayByDate.get(l.quoteDate));
    return computeLineTotal(l, { dayIsHoliday, holidayMultiplier: invoice?.holidayMultiplier });
  }

  function recomputeTotals(lines: QuoteLine[]): number {
    return lines.reduce((s, l) => s + (l.total || 0), 0);
  }

  /** Toggle the holiday flag for a date on this invoice. Persists to
   *  invoice_days, then recomputes every line on that date so totals stay
   *  in step. Blocked by freeze trigger on frozen invoices (UI shouldn't
   *  reach here — the editor only runs on drafts). */
  async function toggleDayHoliday(date: string, next: boolean) {
    if (!invoice) return;
    const prevDays = invoiceDays;
    const newDays: InvoiceDay[] = prevDays.some((d) => d.invoiceDate === date)
      ? prevDays.map((d) => d.invoiceDate === date ? { ...d, isHoliday: next } : d)
      : [...prevDays, { id: "(pending)", invoiceId: invoice.id, invoiceDate: date, isHoliday: next }];
    setInvoiceDays(newDays);

    // Recompute line totals for that date with the new flag.
    // Do NOT touch otHours/dtHours — they stay as entered so toggling holiday
    // off restores the original math. Calc engine ignores OT/DT when
    // dayIsHoliday=true (everything bills flat at 2× base).
    const H = invoice.holidayMultiplier;
    const newLines = invoice.lines.map((l) => {
      if (l.quoteDate !== date) return l;
      const merged = { ...l };
      merged.total = computeLineTotal(merged, { dayIsHoliday: next, holidayMultiplier: H });
      return merged;
    });
    const newSubtotal = money(
      newLines.reduce((s, l) => {
        if (l.quoteDate === date) return s + computeLineTotal(l, { dayIsHoliday: next, holidayMultiplier: H });
        const flag = !!(l.quoteDate && holidayByDate.get(l.quoteDate));
        return s + computeLineTotal(l, { dayIsHoliday: flag, holidayMultiplier: H });
      }, 0),
    );
    setInvoice({
      ...invoice,
      lines: newLines,
      subtotal: newSubtotal,
      amountDue: money(newSubtotal - invoice.depositApplied - invoice.creditsApplied),
    });

    try {
      const persisted = await setInvoiceDayHoliday(invoice.id, date, next);
      setInvoiceDays((cur) => cur.map((d) => d.invoiceDate === date ? persisted : d));
    } catch (err: any) {
      console.error("[invoice-draft-editor] toggle holiday failed:", err);
      setInvoiceDays(prevDays);
      alert(`Couldn't update holiday flag: ${err?.message ?? err}`);
    }
  }

  /** Build the sorted list of distinct dates present on this invoice's
   *  lines. Drives the per-day Holiday panel. Deposits have no lines so
   *  this is empty for them — the panel hides. */
  const invoiceDates = useMemo(() => {
    if (!invoice) return [];
    const s = new Set<string>();
    for (const l of invoice.lines) {
      if (l.quoteDate) s.add(l.quoteDate);
    }
    return Array.from(s).sort();
  }, [invoice]);

  function updateInvoice(patch: Partial<InvoiceDraft>) {
    if (!invoice) return;
    setInvoice({ ...invoice, ...patch });
  }

  function updateLine(index: number, patch: Partial<QuoteLine>) {
    if (!invoice) return;
    const newLines = invoice.lines.map((l, i) => {
      if (i !== index) return l;
      const merged = { ...l, ...patch };
      merged.total = recomputeLineTotal(merged);
      return merged;
    });
    const newSubtotal = money(recomputeTotals(newLines));
    setInvoice({
      ...invoice,
      lines: newLines,
      subtotal: newSubtotal,
      // amountDue auto-recomputes via balanceDue; also store for legacy column
      amountDue: money(newSubtotal - invoice.depositApplied - invoice.creditsApplied),
    });
  }

  function deleteLine(index: number) {
    if (!invoice) return;
    const newLines = invoice.lines.filter((_, i) => i !== index);
    const newSubtotal = money(recomputeTotals(newLines));
    setInvoice({
      ...invoice,
      lines: newLines,
      subtotal: newSubtotal,
      amountDue: money(newSubtotal - invoice.depositApplied - invoice.creditsApplied),
    });
  }

  /** Append an empty manual line. source_kind='manual_override' so it
   *  survives a subsequent Overwrite from Timesheets pull. Defaults the
   *  date to the earliest existing line's date, or the invoice's first
   *  coveredDate, or today as a last resort. Operator fills in
   *  position/specialty/hours/rates from the inline inputs. */
  function addManualLine() {
    if (!invoice) return;
    const existingDates = invoice.lines
      .map((l) => l.quoteDate)
      .filter((d): d is string => !!d)
      .sort();
    const defaultDate =
      existingDates[0]
      ?? invoice.coveredDates?.[0]
      ?? new Date().toISOString().slice(0, 10);
    const newLine: QuoteLine = {
      serviceKey: "",
      qty: 1,
      crewCount: 1,
      hours: 0,
      otHours: 0,
      dtHours: 0,
      travel: 0,
      baseHourly: 0,
      baseDay: 0,
      otRate: 0,
      dtRate: 0,
      rule: "Manual line",
      total: 0,
      quoteDate: defaultDate,
      rateMode: "hourly",
      sourceKind: "manual_override",
    };
    const newLines = [...invoice.lines, newLine];
    const newSubtotal = money(recomputeTotals(newLines));
    setInvoice({
      ...invoice,
      lines: newLines,
      subtotal: newSubtotal,
      amountDue: money(newSubtotal - invoice.depositApplied - invoice.creditsApplied),
    });
  }

  async function onSave() {
    if (!invoice) return;
    setSaving("saving");
    try {
      await saveDraft(invoice);
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);
    } catch (err: any) {
      setSaving("idle");
      alert(`Save failed: ${err.message || err}`);
    }
  }

  async function onIssue() {
    if (!invoice) return;
    if (!confirm("Issue this invoice? Once issued it becomes read-only and a permanent invoice_no is assigned.")) return;
    try {
      await saveDraft(invoice);
      await issueDraft(invoice.id);
      router.push(`/invoices/${invoice.id}`);
    } catch (err: any) {
      alert(`Issue failed: ${err.message || err}`);
    }
  }

  async function onOverwriteFromTimesheets() {
    if (!invoice) return;
    if (!confirm(
      "Replace timesheet-sourced line items with aggregated approved timesheet entries?\n\n" +
      "• Manual lines you typed in (source = 'manual') are preserved.\n" +
      "• Quote-sourced and prior timesheet-sourced lines are rebuilt.\n" +
      "• Entries already billed on a non-superseded invoice are skipped.\n" +
      "• Each contributing entry gets linked to its new line so it won't double-bill."
    )) return;
    setSaving("saving");
    try {
      // Persist any unsaved header edits first.
      await saveDraft(invoice);
      const result = await overwriteFromTimesheets(invoice.id, {
        coveredDates: invoice.coveredDates,
      });
      setInvoice(result.invoice);
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);

      // Surface what just happened. Counts always show; skipped reasons
      // shown verbosely so the operator can fix data and re-pull.
      const lines: string[] = [
        `${result.newLineCount} new line${result.newLineCount === 1 ? "" : "s"} from ${result.consumedEntries} of ${result.totalEntries} approved entries.`,
        `${result.keptManualLineCount} manual line${result.keptManualLineCount === 1 ? "" : "s"} preserved.`,
      ];
      if (result.skipped.length > 0) {
        const byKind = new Map<string, number>();
        for (const s of result.skipped) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
        if (byKind.get("no_position_id")) {
          lines.push(`\n⚠ ${byKind.get("no_position_id")} entr${byKind.get("no_position_id") === 1 ? "y" : "ies"} skipped — missing position_id (fix in Timekeeping and re-pull).`);
        }
        if (byKind.get("no_rate_card_row")) {
          lines.push(`\n⚠ ${byKind.get("no_rate_card_row")} line${byKind.get("no_rate_card_row") === 1 ? "" : "s"} landed at $0 — specialty has no rate-card row. Edit rates manually before issuing.`);
        }
        lines.push("\nDetails:");
        for (const s of result.skipped) lines.push(`  • ${s.detail}`);
      }
      alert(lines.join("\n"));
    } catch (err: any) {
      setSaving("idle");
      alert(`Overwrite failed: ${err.message || err}`);
    }
  }

  async function onDelete() {
    if (!invoice) return;
    if (!confirm("Delete this draft invoice?")) return;
    try {
      await deleteDraft(invoice.id);
      router.push("/invoices");
    } catch (err: any) {
      alert(`Delete failed: ${err.message || err}`);
    }
  }

  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!invoice) return null;

  const projectedInvoiceNo = job?.job_no
    ? `${job.job_no}${invoice.invoiceType === "deposit" ? "_DEP" : "_INV"}${
        invoice.coveredDates && invoice.coveredDates.length > 0
          ? "_" + invoice.coveredDates[0].replace(/-/g, "")
          : ""
      }`
    : null;

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          {projectedInvoiceNo ? <code>{projectedInvoiceNo}</code> : "Draft Invoice"}
          <span className="badge" style={{ marginLeft: 12 }}>Draft</span>
          {invoice.invoiceType ? <span className="muted" style={{ marginLeft: 8 }}>{invoice.invoiceType}</span> : null}
        </h2>
        <span className="muted">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : ""}</span>
        <Link href="/invoices" className="badge">← All Invoices</Link>
      </div>

      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Projected invoice # — finalized on Issue. {!job?.job_no ? "Job has no job_no yet." : null}
      </div>

      {/* Totals strip up top */}
      <div style={{
        marginBottom: 16, padding: "10px 14px", background: "#fbf4e8",
        border: "1px solid #d7c6aa", borderRadius: 8,
        display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline",
        fontVariantNumeric: "tabular-nums",
      }}>
        <div>
          <div className="muted" style={{ fontSize: 11 }}>Subtotal</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>${invoice.subtotal.toFixed(2)}</div>
        </div>
        {invoice.depositApplied > 0 ? (
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Deposit applied</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>−${invoice.depositApplied.toFixed(2)}</div>
          </div>
        ) : null}
        <div>
          <div className="muted" style={{ fontSize: 11 }}>Balance due</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>${balanceDue(invoice).toFixed(2)}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <div className="muted" style={{ fontSize: 11 }}>Lines</div>
          <div style={{ fontSize: 16 }}>{invoice.lines.length}</div>
        </div>
      </div>

      {/* Read-only event panel */}
      <div className="card" style={{ marginBottom: 16, background: "rgba(0,0,0,0.02)" }}>
        <div className="action-row" style={{ alignItems: "baseline", marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Event details</h3>
          {job?.id ? <Link className="badge" href={`/job-requests?id=${job.id}`}>Edit on Job →</Link> : null}
          {invoice.sourceQuoteId ? <Link className="badge" href={`/quotes/${invoice.sourceQuoteId}`}>View Source Quote →</Link> : null}
        </div>
        {job ? (
          <div className="grid2">
            <div>
              <div className="muted">Client</div><div>{job.client}</div>
              <div className="muted" style={{ marginTop: 8 }}>Event</div><div>{job.event_name}</div>
              <div className="muted" style={{ marginTop: 8 }}>Venue</div>
              <div>{job.venue} {job.city_state ? <span className="muted">— {job.city_state}</span> : null}</div>
            </div>
            <div>
              <div className="muted">Source quote</div>
              <div>{invoice.sourceQuoteCode || "—"}</div>
              <div className="muted" style={{ marginTop: 8 }}>Job #</div>
              <div>{job.job_no || "—"}</div>
              <div className="muted" style={{ marginTop: 8 }}>
                Rate card{" "}
                <span style={{ fontSize: 10, opacity: 0.7 }}>(not printed)</span>
              </div>
              <div>
                {rateCardName ? (
                  <code style={{ fontSize: 12 }}>{rateCardName}</code>
                ) : (
                  <span className="muted">— none —</span>
                )}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                Holiday Multiplier{" "}
                <span style={{ fontSize: 10, opacity: 0.7 }}>(applied on flagged days)</span>
              </div>
              <input
                type="number"
                min={1.0}
                step={0.1}
                value={invoice.holidayMultiplier ?? 2.0}
                onChange={(e) => {
                  const H = Number(e.target.value) || 2.0;
                  // Recompute every line — holiday-flagged days bill at the
                  // new multiplier × base. Non-holiday lines unchanged.
                  const newLines = invoice.lines.map((l) => {
                    const dayIsHoliday = !!(l.quoteDate && holidayByDate.get(l.quoteDate));
                    if (!dayIsHoliday) return l;
                    return { ...l, total: computeLineTotal(l, { dayIsHoliday: true, holidayMultiplier: H }) };
                  });
                  const newSubtotal = money(newLines.reduce((s, l) => s + (l.total || 0), 0));
                  setInvoice({
                    ...invoice,
                    holidayMultiplier: H,
                    lines: newLines,
                    subtotal: newSubtotal,
                    amountDue: money(newSubtotal - invoice.depositApplied - invoice.creditsApplied),
                  });
                }}
                style={{ width: 80, fontSize: 13 }}
                title="Snapshotted from the source quote. Override per-invoice for one-off contract terms. Frozen on issue."
              />
            </div>
          </div>
        ) : <div className="muted">No job linked.</div>}
      </div>

      {/* Linked deposit panel — finals only */}
      {invoice.invoiceType === "final" && linkedDeposit ? (
        <div className="card" style={{ marginBottom: 16, background: "#eef6ff", border: "1px solid #b8d4f0" }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Linked deposit invoice</h3>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline", fontVariantNumeric: "tabular-nums" }}>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Deposit invoice</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}><code>{linkedDeposit.invoiceNo}</code></div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Status</div>
              <div style={{ fontSize: 14 }}>{linkedDeposit.status}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Deposit amount</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>${linkedDeposit.subtotal.toFixed(2)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Paid so far</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>${linkedDeposit.paidAmount.toFixed(2)}</div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <div className="muted" style={{ fontSize: 11 }}>Applied to this invoice</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>${invoice.depositApplied.toFixed(2)}</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            The deposit is applied as a credit on the final invoice regardless of paid status —
            the customer is on the hook for both invoices either way. Edit "Deposit applied" below to override.
          </div>
        </div>
      ) : null}
      {invoice.invoiceType === "final" && !linkedDeposit ? (
        <div className="card" style={{ marginBottom: 16, background: "#fff7e6", border: "1px solid #e8c46c" }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>No deposit invoice</h3>
          <div className="muted" style={{ fontSize: 13 }}>
            No deposit invoice was found for this job. If a deposit should be billed, generate it from the source quote first;
            otherwise this final stands alone.
          </div>
        </div>
      ) : null}

      {/* Invoice fields */}
      {invoice.invoiceType === "deposit" ? (
        // Deposits are header-amount only. No line items.
        <div className="card" style={{ marginBottom: 16, background: "#fbf4e8" }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Deposit Amount</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Deposits are a lump-sum amount tied to the source quote — no line items.
            The printed invoice will show it as: <code>Deposit for {invoice.sourceQuoteCode || "(quote)"}: ${invoice.subtotal.toFixed(2)}</code>
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={depositAmountStr}
            onChange={(e) => {
              // Accept any keystroke; parse into the model.
              const raw = e.target.value;
              setDepositAmountStr(raw);
              const amt = Math.round((parseFloat(raw) || 0) * 100) / 100;
              updateInvoice({ subtotal: amt, deposit: amt, amountDue: amt });
            }}
            onBlur={() => {
              // On blur, normalize the displayed string to two decimals.
              const amt = Math.round((parseFloat(depositAmountStr) || 0) * 100) / 100;
              setDepositAmountStr(amt.toFixed(2));
            }}
            style={{ fontSize: 18, width: 200, fontVariantNumeric: "tabular-nums" }}
          />
        </div>
      ) : null}

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div>
          <label>
            <div className="muted">Issue date</div>
            <input type="date" value={invoice.issueDate || ""} onChange={(e) => updateInvoice({ issueDate: e.target.value })} />
          </label>
          <label style={{ marginTop: 8, display: "block" }}>
            <div className="muted">Due date</div>
            <input type="date" value={invoice.dueDate || ""} onChange={(e) => updateInvoice({ dueDate: e.target.value })} />
          </label>
          <label style={{ marginTop: 8, display: "block" }}>
            <div className="muted">PO #</div>
            <input type="text" value={invoice.poNo || ""} onChange={(e) => updateInvoice({ poNo: e.target.value })} placeholder="(optional)" />
          </label>
          <label style={{ marginTop: 8, display: "block" }}>
            <div className="muted">Notes</div>
            <textarea value={invoice.notes} onChange={(e) => updateInvoice({ notes: e.target.value })} rows={3} />
          </label>
        </div>
        <div>
          <label>
            <div className="muted">Bill to</div>
            <textarea value={invoice.billTo} onChange={(e) => updateInvoice({ billTo: e.target.value })} rows={2} />
          </label>
          <label style={{ marginTop: 8, display: "block" }}>
            <div className="muted">Deposit applied ($)</div>
            <input type="number" min={0} step={0.01} value={invoice.depositApplied}
              onChange={(e) => {
                const dep = parseFloat(e.target.value) || 0;
                updateInvoice({ depositApplied: dep, amountDue: money(invoice.subtotal - dep - invoice.creditsApplied) });
              }}
              title="How much of the job's deposit credit applies to this invoice." />
          </label>
          <label style={{ marginTop: 8, display: "block" }}>
            <div className="muted">Terms</div>
            <textarea value={invoice.terms} onChange={(e) => updateInvoice({ terms: e.target.value })} rows={6} />
          </label>
        </div>
      </div>

      {/* Lines — only for finals; deposits use the header amount above */}
      {invoice.invoiceType === "final" ? (
      <>
      {/* Per-day holiday panel — toggling a date here applies a 2× multiplier
          to base + OT + DT for every line on that date. Snapshotted from the
          source quote's quote_days at draft creation. */}
      {invoiceDates.length > 0 && (
        <div className="card" style={{ marginBottom: 12, background: "rgba(0,0,0,0.015)" }}>
          <h3 className="section-title" style={{ margin: 0, marginBottom: 8 }}>🎄 Holiday days</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Flag any date as a holiday to bill base, OT, and DT for every line on that date at 2× rate.
            Travel is not multiplied. On holiday days, every billable hour (ST + OT + DT) bills at base × 2 — OT/DT premium rates are ignored but the hours still count. Toggle holiday off to restore OT/DT premium math.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {invoiceDates.map((date) => {
              const isHoliday = !!holidayByDate.get(date);
              const lineCount = invoice.lines.filter((l) => l.quoteDate === date).length;
              return (
                <label
                  key={date}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13,
                    padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    background: isHoliday ? "#c0392b" : "#fff",
                    color: isHoliday ? "#fff" : "inherit",
                    border: `1px solid ${isHoliday ? "#c0392b" : "#d7c6aa"}`,
                  }}
                  title={`${lineCount} line${lineCount === 1 ? "" : "s"} on ${date}`}
                >
                  <input
                    type="checkbox"
                    checked={isHoliday}
                    onChange={(e) => toggleDayHoliday(date, e.target.checked)}
                  />
                  <span style={{ fontWeight: isHoliday ? 600 : 400 }}>
                    {isHoliday ? "🎄 " : ""}{date}
                  </span>
                  <span style={{ opacity: 0.75, fontSize: 11 }}>· {lineCount}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      <div className="action-row" style={{ alignItems: "baseline", marginBottom: 8 }}>
        <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Line items</h3>
        <button
          className="secondary"
          onClick={addManualLine}
          title="Append a manual line (equipment, misc charge, etc.). Survives a future Overwrite from Timesheets."
        >
          + Add Line
        </button>
        <button
          className="secondary"
          onClick={onOverwriteFromTimesheets}
          title="Replace lines with aggregated approved timesheet entries (excludes already-billed entries)"
        >
          Overwrite from Timesheets
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        How the total is computed:{" "}
        <strong>Hourly</strong>: hrs × $/hr + OT × $/OT + DT × $/DT + hol × $/DT + travel.{" "}
        <strong>Day</strong>: crew × $/day + OT × $/OT + DT × $/DT + hol × $/DT + travel.{" "}
        ST/OT/DT hours are explicit person-hour totals — no rule splitting at calc time.
      </div>
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Position</th>
              <th>Specialty</th>
              <th>Shift</th>
              <th>Mode</th>
              <th title="Worker count — multiplies day rate; informational on hourly">Crew</th>
              <th title="Total ST person-hours (0 on day-rate lines)">ST Hrs</th>
              <th title="Total OT person-hours across crew">OT Hrs</th>
              <th title="Total DT person-hours across crew">DT Hrs</th>
              <th>$/hr</th>
              <th>$/day</th>
              <th>$/OT</th>
              <th>$/DT</th>
              <th>Travel</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.length === 0 ? (
              <tr><td colSpan={16} className="muted">No line items.</td></tr>
            ) : invoice.lines.map((l, i) => {
              const isDayMode = isDayModeLine(l);
              // Day-level holiday → OT/DT inputs disabled, 2× supersedes premiums.
              const lineDayIsHoliday = !!(l.quoteDate && holidayByDate.get(l.quoteDate));
              // Specialty is authoritative — derive position from
              // specialty.position_id when set. Falls back to the line's
              // positionId, then best-effort matches the legacy
              // department/specialty text against the master list so old
              // drafts populate the dropdown rather than appearing blank.
              const lineSpecialty = l.specialtyId
                ? specialties.find((s) => s.id === l.specialtyId)
                : (l.specialty
                    ? specialties.find((s) => s.name.toLowerCase() === (l.specialty || "").toLowerCase())
                    : undefined);
              const legacyPositionMatch = !lineSpecialty && l.department
                ? positions.find((p) => p.name.toLowerCase() === (l.department || "").toLowerCase())
                : undefined;
              const effectivePositionId =
                lineSpecialty?.positionId ?? l.positionId ?? legacyPositionMatch?.id ?? "";
              const lineSpecialties = effectivePositionId
                ? specialties.filter((s) => s.positionId === effectivePositionId)
                : [];
              return (
                <React.Fragment key={i}>
                  <tr>
                    <td><input type="date" value={l.quoteDate || ""} onChange={(e) => updateLine(i, { quoteDate: e.target.value })} /></td>
                    <td>
                      <select
                        value={effectivePositionId}
                        onChange={(e) => {
                          const posId = e.target.value;
                          const posName = positions.find((p) => p.id === posId)?.name ?? "";
                          updateLine(i, {
                            positionId: posId || undefined,
                            specialtyId: undefined,
                            department: posName,
                            specialty: "",
                          });
                        }}
                        style={{ minWidth: 130 }}
                      >
                        <option value="">— Select —</option>
                        {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={lineSpecialty?.id || ""}
                        onChange={(e) => {
                          const spc = specialties.find((s) => s.id === e.target.value);
                          const posName = spc ? positions.find((p) => p.id === spc.positionId)?.name ?? "" : "";
                          updateLine(i, {
                            specialtyId: spc?.id ?? undefined,
                            positionId: spc?.positionId ?? l.positionId,
                            department: posName || l.department,
                            specialty: spc?.name ?? "",
                          });
                        }}
                        disabled={!effectivePositionId}
                        style={{ minWidth: 130 }}
                      >
                        <option value="">— Select —</option>
                        {lineSpecialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td>
                      {shifts.length === 0 ? (
                        <span className="muted" style={{ fontSize: 11 }} title="No shifts defined on the parent job. Add shifts on the Job Request screen.">—</span>
                      ) : (
                        <select
                          value={l.shiftId || ""}
                          onChange={(e) => updateLine(i, { shiftId: e.target.value || undefined })}
                          style={{ width: 110 }}
                        >
                          <option value="">— None —</option>
                          {shifts.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}{!s.isActive ? " (inactive)" : ""}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <select
                        value={isDayMode ? "day" : "hourly"}
                        onChange={(e) => updateLine(i, { rateMode: e.target.value as "day" | "hourly" })}
                        style={{ width: 80 }}
                        title="Toggling resets the calc to use the chosen rate basis"
                      >
                        <option value="hourly">Hourly</option>
                        <option value="day">Day</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.crewCount ?? l.qty ?? 1}
                        onChange={(e) => {
                          const c = parseInt(e.target.value, 10) || 0;
                          updateLine(i, { crewCount: c, qty: c });
                        }}
                        step="1"
                        min="0"
                        style={{ width: 50 }}
                        title="Worker count. Multiplies day rate on day-mode lines; informational on hourly."
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.hours}
                        onChange={(e) => updateLine(i, { hours: parseFloat(e.target.value) || 0 })}
                        step="0.5"
                        style={{ width: 60, opacity: isDayMode ? 0.5 : 1 }}
                        disabled={isDayMode}
                        title={isDayMode ? "Day-rate line — ST is covered by day rate" : "Total ST person-hours"}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.otHours || 0}
                        onChange={(e) => updateLine(i, { otHours: parseFloat(e.target.value) || 0 })}
                        step="0.5"
                        style={{ width: 60, opacity: lineDayIsHoliday ? 0.7 : 1 }}
                        title={lineDayIsHoliday ? "Holiday active — these hours bill at base × 2 (OT premium not applied). Stays editable so you can adjust the breakdown without moving data between buckets." : "Total OT person-hours billed at $/OT"}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.dtHours || 0}
                        onChange={(e) => updateLine(i, { dtHours: parseFloat(e.target.value) || 0 })}
                        step="0.5"
                        style={{ width: 60, opacity: lineDayIsHoliday ? 0.7 : 1 }}
                        title={lineDayIsHoliday ? "Holiday active — these hours bill at base × 2 (DT premium not applied). Stays editable so you can adjust the breakdown without moving data between buckets." : "Total DT person-hours billed at $/DT"}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.baseHourly}
                        onChange={(e) => {
                          const h = parseFloat(e.target.value) || 0;
                          // Mirror rate-card-editor / quote-draft-editor auto-derive:
                          // Day = h × 10, OT = h × 1.5, DT = h × 2.
                          updateLine(i, {
                            baseHourly: h,
                            baseDay:    Number((h * 10).toFixed(2)),
                            otRate:     Number((h * 1.5).toFixed(2)),
                            dtRate:     Number((h * 2).toFixed(2)),
                          });
                        }}
                        step="0.01"
                        style={{ width: 70, opacity: isDayMode ? 0.5 : 1 }}
                        title="Hourly rate. Changing this auto-derives Day (×10), OT (×1.5), and DT (×2). Override any of those manually after if needed."
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.baseDay}
                        onChange={(e) => updateLine(i, { baseDay: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ width: 70, opacity: isDayMode ? 1 : 0.5 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.otRate}
                        onChange={(e) => updateLine(i, { otRate: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ width: 65, opacity: lineDayIsHoliday ? 0.7 : 1 }}
                        title={lineDayIsHoliday ? "Holiday active — OT rate not used. All hours bill at base × 2." : undefined}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.dtRate}
                        onChange={(e) => updateLine(i, { dtRate: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ width: 65, opacity: lineDayIsHoliday ? 0.7 : 1 }}
                        title={lineDayIsHoliday ? "Holiday active — DT rate not used. All hours bill at base × 2." : undefined}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.travel || 0}
                        onChange={(e) => updateLine(i, { travel: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ width: 65 }}
                        title="Flat travel surcharge per line ($)"
                      />
                    </td>
                    <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>${l.total.toFixed(2)}</td>
                    <td><button className="secondary" onClick={() => deleteLine(i)} style={{ fontSize: 12 }}>×</button></td>
                  </tr>
                  {/* Context row: rule (informational only since 2026-05-12)
                       and source. All math drivers are now in the columns. */}
                  <tr style={{ background: "rgba(0,0,0,0.025)", borderBottom: "1px solid #e7dcc4" }}>
                    <td colSpan={17} style={{ fontSize: 11, color: "#6c6358", padding: "4px 6px" }}>
                      {l.rule ? (
                        <span style={{ marginRight: 14 }}>
                          <strong>Rule:</strong> {l.rule}{" "}
                          <span className="muted">(printed for the customer; calc uses explicit OT/DT hour columns)</span>
                        </span>
                      ) : null}
                      <span style={{ marginRight: 14 }}>
                        <strong>Source:</strong> {l.sourceKind === "timesheet_entry" ? "Timesheet" : l.sourceKind === "quote_line" ? "Quote" : l.sourceKind ?? "manual"}
                      </span>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      ) : null}

      {timesheetSummary.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3 className="section-title" style={{ marginBottom: 4 }}>Approved Timesheet Actuals (comparison)</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Read-only roll-up of approved timesheet entries for this job — cross-check the line items above
            reflect what the field worked. Rates and totals are intentionally bill-side concerns; payroll lives elsewhere.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Workers</th>
                  <th>ST Hrs</th>
                  <th>OT Hrs</th>
                  <th>DT Hrs</th>
                  <th>Total Hrs</th>
                </tr>
              </thead>
              <tbody>
                {timesheetSummary.map((r) => (
                  <tr key={r.position}>
                    <td>{r.position}</td>
                    <td>{r.workers}</td>
                    <td>{r.stdHours.toFixed(2)}</td>
                    <td>{r.otHours.toFixed(2)}</td>
                    <td>{r.dtHours.toFixed(2)}</td>
                    <td>{r.totalHours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {pendingTimesheetSummary.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3 className="section-title" style={{ marginBottom: 4, color: "#7a5a1a" }}>
            ⚠ Pending Timesheet Entries (not yet approved)
          </h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            These hours are <strong>not</strong> reflected in the approved actuals above and won't be pulled by
            Overwrite from Timesheets until they're approved on the Timekeeping screen. Heads-up that this
            invoice may understate actual labor until that happens.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ background: "#fff8e1", borderLeft: "3px solid #d8a800" }}>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Workers</th>
                  <th>ST Hrs</th>
                  <th>OT Hrs</th>
                  <th>DT Hrs</th>
                  <th>Total Hrs</th>
                </tr>
              </thead>
              <tbody>
                {pendingTimesheetSummary.map((r) => (
                  <tr key={r.position}>
                    <td>{r.position}</td>
                    <td>{r.workers}</td>
                    <td>{r.stdHours.toFixed(2)}</td>
                    <td>{r.otHours.toFixed(2)}</td>
                    <td>{r.dtHours.toFixed(2)}</td>
                    <td>{r.totalHours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="action-row">
        <button onClick={onSave} disabled={saving === "saving"}>
          {saving === "saving" ? "Saving…" : "Save Draft"}
        </button>
        <button onClick={onIssue}>Issue Invoice</button>
        <button className="secondary" onClick={() => window.open(`/invoices/${invoice.id}/pdf`, "_blank")}>Preview PDF</button>
        <button className="secondary" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

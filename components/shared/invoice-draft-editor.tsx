/**
 * Minimal invoice draft editor. Mirrors quote-draft-editor structure but
 * simpler since invoices have a fixed lines-from-quote shape.
 */

"use client";

import React, { useEffect, useState } from "react";
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
import type { InvoiceDraft, QuoteLine, Position, Specialty } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";
import { parseOtTriggerRule, computeDayHourSplit } from "@/lib/rates/ot-trigger";

export default function InvoiceDraftEditor({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
  const [job, setJob] = useState<any | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
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

  // Mirrors lib/store/invoices.ts and the legacy invoice-builder calc.
  // Hourly mode:
  //   total = qty * hours * baseHourly + holidayHours * dtRate + travel
  // Day mode:
  //   split hours into st/ot/dt via the rule (e.g. "OT after 12 / DT after 15")
  //   perWorker = baseDay + ot*otRate + dt*dtRate
  //   total = qty * perWorker + holidayHours * dtRate + travel
  // Travel is flat per line (NOT per-qty); holiday hours bill at dtRate
  // (treating holiday as double-time, which on standard cards equals 2×hourly).
  function recomputeLineTotal(l: QuoteLine): number {
    const qty          = Number(l.qty || 0);
    const hours        = Number(l.hours || 0);
    const holidayHours = Number(l.holidayHours || 0);
    const travel       = Number(l.travel || 0);
    const baseHourly   = Number(l.baseHourly || 0);
    const baseDay      = Number(l.baseDay || 0);
    const otRate       = Number(l.otRate || 0);
    const dtRate       = Number(l.dtRate || 0);
    const isDayMode    = l.rateMode === "day" || (baseDay > 0 && !hours && l.rateMode !== "hourly");

    if (isDayMode) {
      const split = computeDayHourSplit(hours, parseOtTriggerRule(l.rule || ""));
      const perWorker = baseDay + (split.ot * otRate) + (split.dt * dtRate);
      return money((qty * perWorker) + (holidayHours * dtRate) + travel);
    }
    return money((qty * hours * baseHourly) + (holidayHours * dtRate) + travel);
  }

  function recomputeTotals(lines: QuoteLine[]): number {
    return lines.reduce((s, l) => s + (l.total || 0), 0);
  }

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
      "Replace this draft's line items with aggregated approved timesheet entries?\n\n" +
      "Entries already billed on a non-superseded / non-void invoice will be skipped. " +
      "Each contributing entry gets linked to the new invoice line so it won't be re-billed."
    )) return;
    setSaving("saving");
    try {
      // Persist any unsaved header edits first.
      await saveDraft(invoice);
      const refreshed = await overwriteFromTimesheets(invoice.id, {
        coveredDates: invoice.coveredDates,
      });
      setInvoice(refreshed);
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);
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
      <div className="action-row" style={{ alignItems: "baseline", marginBottom: 8 }}>
        <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Line items</h3>
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
        <strong>Hourly</strong>: qty × hrs × $/hr + holiday × $/dt + travel.{" "}
        <strong>Day</strong>: qty × ($/day + ot × $/ot + dt × $/dt) + holiday × $/dt + travel,
        where hrs are split by the rule (e.g. "OT after 12"). The grey row under each line is
        read-only context — edit fields in the main row to change the total.
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
              <th>Qty</th>
              <th>Hrs</th>
              <th>Hol&nbsp;Hrs</th>
              <th>$/hr</th>
              <th>$/day</th>
              <th>Travel</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.length === 0 ? (
              <tr><td colSpan={13} className="muted">No line items.</td></tr>
            ) : invoice.lines.map((l, i) => {
              const isDayMode = l.rateMode === "day" || (l.baseDay > 0 && !l.hours);
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
                    <td><input type="text" value={l.shiftLabel || ""} onChange={(e) => updateLine(i, { shiftLabel: e.target.value })} placeholder="Shift" style={{ width: 90 }} /></td>
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
                    <td><input type="number" value={l.qty} onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} /></td>
                    <td>
                      <input
                        type="number"
                        value={l.hours}
                        onChange={(e) => updateLine(i, { hours: parseFloat(e.target.value) || 0 })}
                        step="0.5"
                        style={{ width: 70, opacity: isDayMode ? 0.5 : 1 }}
                        disabled={isDayMode}
                        title={isDayMode ? "Day-rate line — hours not used in calc" : ""}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.holidayHours || 0}
                        onChange={(e) => updateLine(i, { holidayHours: parseFloat(e.target.value) || 0 })}
                        step="0.5"
                        style={{ width: 70, opacity: isDayMode ? 0.5 : 1 }}
                        disabled={isDayMode}
                        title={isDayMode ? "Day-rate line — holiday hours not used in calc" : "Holiday hours bill at 2× base hourly"}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.baseHourly}
                        onChange={(e) => updateLine(i, { baseHourly: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ width: 80, opacity: isDayMode ? 0.5 : 1 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.baseDay}
                        onChange={(e) => updateLine(i, { baseDay: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ width: 80, opacity: isDayMode ? 1 : 0.5 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.travel || 0}
                        onChange={(e) => updateLine(i, { travel: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        style={{ width: 70 }}
                        title="Per-qty travel surcharge ($)"
                      />
                    </td>
                    <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>${l.total.toFixed(2)}</td>
                    <td><button className="secondary" onClick={() => deleteLine(i)} style={{ fontSize: 12 }}>×</button></td>
                  </tr>
                  {/* Context row: only shows fields that actually drive this
                       line's total. Rule is relevant in day mode (splits hours
                       into ST/OT/DT tiers); OT rate is only used in day mode;
                       DT rate is used in both modes (via holiday pay) and in
                       day mode for the DT tier. Source kind always shown. */}
                  <tr style={{ background: "rgba(0,0,0,0.025)", borderBottom: "1px solid #e7dcc4" }}>
                    <td colSpan={13} style={{ fontSize: 11, color: "#6c6358", padding: "4px 6px" }}>
                      {isDayMode && l.rule ? (
                        <span style={{ marginRight: 14 }}>
                          <strong>Rule:</strong> {l.rule}
                        </span>
                      ) : null}
                      {isDayMode && (l.otRate || 0) > 0 ? (
                        <span style={{ marginRight: 14 }}>
                          <strong>OT:</strong> ${(l.otRate || 0).toFixed(2)}/hr
                        </span>
                      ) : null}
                      {(l.dtRate || 0) > 0 && (isDayMode || (l.holidayHours || 0) > 0) ? (
                        <span style={{ marginRight: 14 }}>
                          <strong>DT:</strong> ${(l.dtRate || 0).toFixed(2)}/hr
                          {!isDayMode ? <span className="muted"> (holiday pay)</span> : null}
                        </span>
                      ) : null}
                      {isDayMode ? (() => {
                        // Show the actual hour split so the operator can verify
                        // OT/DT contribution to the per-worker total.
                        const split = computeDayHourSplit(l.hours || 0, parseOtTriggerRule(l.rule || ""));
                        if (split.ot === 0 && split.dt === 0) return null;
                        return (
                          <span style={{ marginRight: 14 }}>
                            <strong>Hours split:</strong> {split.st} ST · {split.ot} OT · {split.dt} DT
                          </span>
                        );
                      })() : null}
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

/**
 * Minimal invoice draft editor. Mirrors quote-draft-editor structure but
 * simpler since invoices have a fixed lines-from-quote shape.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadInvoice,
  saveDraft,
  issueDraft,
  deleteDraft,
  balanceDue,
} from "@/lib/store/invoices";
import type { InvoiceDraft, QuoteLine } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";

export default function InvoiceDraftEditor({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
  const [job, setJob] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadInvoice(id)
      .then(async (q) => {
        if (cancelled) return;
        if (!q) { setError(`Invoice not found: ${id}`); setLoading(false); return; }
        if (!q.isDraft) { router.replace(`/invoices/${id}`); return; }
        setInvoice(q);
        if (q.jobRequestId) {
          const j = await supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle();
          if (!cancelled) setJob(j.data ?? null);
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

  function recomputeLineTotal(l: QuoteLine): number {
    const qty = l.qty || 0;
    const travel = (l.travel || 0) * qty;
    if (l.rateMode === "day" || (l.baseDay > 0 && !l.hours)) {
      return money(qty * (l.baseDay || 0) + travel);
    }
    const regular = qty * (l.hours || 0) * (l.baseHourly || 0);
    const holiday = qty * (l.holidayHours || 0) * (l.baseHourly || 0) * 2;
    return money(regular + holiday + travel);
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
            </div>
          </div>
        ) : <div className="muted">No job linked.</div>}
      </div>

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
            type="number"
            min={0}
            step={0.01}
            value={invoice.subtotal}
            onChange={(e) => {
              const amt = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
              updateInvoice({ subtotal: amt, deposit: amt, amountDue: amt });
            }}
            style={{ fontSize: 18, width: 200 }}
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
      <h3 className="section-title">Line items</h3>
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Position</th><th>Specialty</th><th>Shift</th>
              <th>Qty</th><th>Hrs</th><th>$/hr</th><th>$/day</th><th>Total</th><th></th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.length === 0 ? (
              <tr><td colSpan={10} className="muted">No line items.</td></tr>
            ) : invoice.lines.map((l, i) => (
              <tr key={i}>
                <td><input type="date" value={l.quoteDate || ""} onChange={(e) => updateLine(i, { quoteDate: e.target.value })} /></td>
                <td><input type="text" value={l.department || ""} onChange={(e) => updateLine(i, { department: e.target.value })} placeholder="Position" /></td>
                <td><input type="text" value={l.specialty || ""} onChange={(e) => updateLine(i, { specialty: e.target.value })} placeholder="Specialty" /></td>
                <td><input type="text" value={l.shiftLabel || ""} onChange={(e) => updateLine(i, { shiftLabel: e.target.value })} placeholder="Shift" style={{ width: 90 }} /></td>
                <td><input type="number" value={l.qty} onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} /></td>
                <td><input type="number" value={l.hours} onChange={(e) => updateLine(i, { hours: parseFloat(e.target.value) || 0 })} step="0.5" style={{ width: 70 }} /></td>
                <td><input type="number" value={l.baseHourly} onChange={(e) => updateLine(i, { baseHourly: parseFloat(e.target.value) || 0 })} step="0.01" style={{ width: 80 }} /></td>
                <td><input type="number" value={l.baseDay} onChange={(e) => updateLine(i, { baseDay: parseFloat(e.target.value) || 0 })} step="0.01" style={{ width: 80 }} /></td>
                <td>${l.total.toFixed(2)}</td>
                <td><button className="secondary" onClick={() => deleteLine(i)} style={{ fontSize: 12 }}>×</button></td>
              </tr>
            ))}
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

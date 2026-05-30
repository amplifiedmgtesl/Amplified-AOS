/**
 * Read-only display for a frozen invoice. Mirrors quote-detail.tsx.
 *
 * Actions:
 *   - Print/PDF
 *   - Mark Sent / Mark Paid (lifecycle transitions)
 *   - Revise (spawn revision draft → editor)
 *   - Void (with reason)
 *   - Apply Customer Credit (when client has credit balance)
 *   - Link to Job/Quote (when orphan)
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadInvoice,
  reviseInvoice,
  markSent,
  voidInvoice,
  displayStatus,
  balanceDue,
  linkOrphanInvoice,
} from "@/lib/store/invoices";
import { getAvailableCredit, applyCreditToInvoice } from "@/lib/store/customer-credits";
import {
  recordInvoicePayment,
  loadInvoicePayments,
  deactivateInvoicePayment,
} from "@/lib/store/invoice-payments";
import { loadShifts } from "@/lib/storage/job-request-shifts";
import { supabase } from "@/lib/supabase/client";
import type { InvoiceDraft, JobRequestShift, InvoicePayment, PaymentMethod } from "@/lib/store/types";

export default function InvoiceDetail({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
  const [job, setJob] = useState<any | null>(null);
  const [shifts, setShifts] = useState<JobRequestShift[]>([]);
  const [supersededBy, setSupersededBy] = useState<{ id: string; invoiceNo: string | null } | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Payments applied to this invoice. invoices.paid_amount is kept in sync
  // by the refresh_invoice_paid_amount trigger; this just loads them for
  // the panel.
  const [payments, setPayments] = useState<InvoicePayment[]>([]);

  // Modal states
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<PaymentMethod>("check");
  const [payAmount, setPayAmount] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payMemo, setPayMemo] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkJobs, setLinkJobs] = useState<Array<{ id: string; job_no: string; client: string; event_name: string; request_date: string }>>([]);
  const [linkQuotes, setLinkQuotes] = useState<Array<{ id: string; quote_no: string; client: string; event_name: string }>>([]);
  const [linkPickedJobId, setLinkPickedJobId] = useState("");
  const [linkPickedQuoteId, setLinkPickedQuoteId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadInvoice(id)
      .then(async (q) => {
        if (cancelled) return;
        if (!q) { setError(`Invoice not found: ${id}`); setLoading(false); return; }
        if (q.isDraft) { router.replace(`/invoices/${encodeURIComponent(id)}/edit`); return; }
        setInvoice(q);

        if (q.jobRequestId) {
          const j = await supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle();
          if (!cancelled) setJob(j.data ?? null);
          // Load shifts (include inactive so historical line refs still resolve)
          const s = await loadShifts(q.jobRequestId, { includeInactive: true });
          if (!cancelled) setShifts(s);
        }
        const child = await supabase
          .from("invoices")
          .select("id, invoice_no")
          .eq("parent_invoice_id", q.id)
          .eq("is_draft", false)
          .order("revision_no", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && child.data) {
          setSupersededBy({ id: child.data.id, invoiceNo: child.data.invoice_no });
        }
        if (q.clientId) {
          const bal = await getAvailableCredit(q.clientId);
          if (!cancelled) setCreditBalance(bal);
        }
        const pays = await loadInvoicePayments(q.id);
        if (!cancelled) setPayments(pays);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[invoice-detail] load failed:", err);
        setError(err.message || "Failed to load invoice");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, router]);

  async function refresh() {
    const q = await loadInvoice(id);
    setInvoice(q);
    if (q?.clientId) {
      setCreditBalance(await getAvailableCredit(q.clientId));
    }
    if (q) {
      const pays = await loadInvoicePayments(q.id);
      setPayments(pays);
    }
  }

  async function onMarkSent() {
    if (!invoice) return;
    try { await markSent(invoice.id); await refresh(); }
    catch (err: any) { alert(`Mark Sent failed: ${err.message || err}`); }
  }

  function openRecordPayment() {
    if (!invoice) return;
    // Pre-fill amount with the remaining balance so the common case
    // (customer paid exactly what they owed) is one click.
    setPayAmount(balanceDue(invoice).toFixed(2));
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod("check");
    setPayReference("");
    setPayMemo("");
    setPayNotes("");
    setPayOpen(true);
  }

  async function onConfirmRecordPayment() {
    if (!invoice) return;
    if (!invoice.clientId) { alert("Invoice has no client_id — can't record payment."); return; }
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { alert("Payment amount must be greater than zero."); return; }
    const balance = balanceDue(invoice);
    if (amt > balance + 0.005) {
      if (!confirm(`Payment ($${amt.toFixed(2)}) is greater than the balance due ($${balance.toFixed(2)}). Save anyway?`)) return;
    }
    setPaySaving(true);
    try {
      await recordInvoicePayment({
        invoiceId: invoice.id,
        paymentDate: payDate,
        paymentMethod: payMethod,
        amount: amt,
        referenceNumber: payReference || undefined,
        memo: payMemo || undefined,
        notes: payNotes || undefined,
      });
      setPayOpen(false);
      await refresh();
    } catch (err: any) {
      alert(`Record payment failed: ${err.message || err}`);
    } finally {
      setPaySaving(false);
    }
  }

  async function onVoidPayment(paymentId: string) {
    if (!confirm("Void this payment? The invoice's paid amount + status will recompute automatically.")) return;
    try {
      await deactivateInvoicePayment(paymentId);
      await refresh();
    } catch (err: any) {
      alert(`Void payment failed: ${err.message || err}`);
    }
  }

  async function onRevise() {
    if (!invoice) return;
    if (invoice.status === "paid" && !confirm("This invoice has been paid. Revising creates a new revision and supersedes this one. Continue?")) return;
    try {
      const newDraft = await reviseInvoice(invoice.id);
      router.push(`/invoices/${encodeURIComponent(newDraft.id)}/edit`);
    } catch (err: any) {
      alert(`Revise failed: ${err.message || err}`);
    }
  }

  async function onConfirmVoid() {
    if (!invoice || !voidReason.trim()) return;
    try {
      await voidInvoice(invoice.id, voidReason.trim());
      setVoidOpen(false);
      setVoidReason("");
      await refresh();
    } catch (err: any) {
      alert(`Void failed: ${err.message || err}`);
    }
  }

  async function onConfirmCredit() {
    if (!invoice || !invoice.clientId) return;
    const amt = parseFloat(creditAmount);
    if (!amt || amt <= 0) return;
    try {
      await applyCreditToInvoice(invoice.clientId, invoice.id, amt);
      setCreditOpen(false);
      setCreditAmount("");
      await refresh();
    } catch (err: any) {
      alert(`Apply credit failed: ${err.message || err}`);
    }
  }

  async function onOpenLink() {
    if (!invoice) return;
    const [jobsRes, quotesRes] = await Promise.all([
      supabase.from("job_requests").select("id, job_no, client, event_name, request_date").not("job_no", "is", null).order("request_date", { ascending: false }),
      supabase.from("quotes").select("id, quote_no, client, event_name").eq("is_draft", false).not("quote_no", "is", null).order("issued_at", { ascending: false }),
    ]);
    setLinkJobs(jobsRes.data ?? []);
    setLinkQuotes(quotesRes.data ?? []);
    setLinkPickedJobId("");
    setLinkPickedQuoteId("");
    setLinkOpen(true);
  }

  async function onConfirmLink() {
    if (!invoice || !linkPickedQuoteId || !linkPickedJobId) return;
    try {
      await linkOrphanInvoice(invoice.id, linkPickedQuoteId, linkPickedJobId);
      setLinkOpen(false);
      await refresh();
      // Reload job header
      const q = await loadInvoice(invoice.id);
      if (q?.jobRequestId) {
        const j = await supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle();
        setJob(j.data ?? null);
      }
    } catch (err: any) {
      alert(`Link failed: ${err.message || err}`);
    }
  }

  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!invoice) return null;

  const statusLabel = displayStatus(invoice);
  const isVoid = invoice.status === "void";
  const isSuperseded = invoice.status === "superseded";
  const isPaid = invoice.status === "paid";
  const isFinalAndDone = isVoid || isSuperseded;

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          {invoice.invoiceNo || `Invoice ${invoice.id.slice(0, 12)}`}
          <span className="badge" style={{ marginLeft: 12 }}>{statusLabel}</span>
          {invoice.invoiceType ? <span className="muted" style={{ marginLeft: 8 }}>{invoice.invoiceType}</span> : null}
        </h2>
        <Link href="/invoices" className="badge">← All Invoices</Link>
      </div>

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div>
          <div className="muted">Bill To</div>
          <div><strong>{invoice.billTo || invoice.client || "—"}</strong></div>
          <div className="muted" style={{ marginTop: 8 }}>Event</div>
          <div>{invoice.eventName || "—"}</div>
          <div className="muted" style={{ marginTop: 8 }}>Venue</div>
          <div>{invoice.venue || "—"} {invoice.cityState ? <span className="muted">— {invoice.cityState}</span> : null}</div>
        </div>
        <div>
          <div className="muted">Issue date</div>
          <div>{invoice.issueDate || (invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : "—")}</div>
          <div className="muted" style={{ marginTop: 8 }}>Due date</div>
          <div>{invoice.dueDate || "—"}</div>
          {invoice.poNo ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>PO #</div>
              <div>{invoice.poNo}</div>
            </>
          ) : null}
          {invoice.sourceQuoteId ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Source quote</div>
              <div>
                <Link className="badge" href={`/quotes/${encodeURIComponent(invoice.sourceQuoteId)}`}>
                  {invoice.sourceQuoteCode || invoice.sourceQuoteId.slice(0, 12)}
                </Link>
              </div>
            </>
          ) : null}
          {job?.id ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Source job</div>
              <div><Link className="badge" href={`/job-requests?id=${job.id}`}>{job.job_no || job.id}</Link></div>
            </>
          ) : null}
          {invoice.parentInvoiceId ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Revises</div>
              <div><Link className="badge" href={`/invoices/${invoice.parentInvoiceId}`}>Previous revision</Link></div>
            </>
          ) : null}
          {supersededBy ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Superseded by</div>
              <div><Link className="badge" href={`/invoices/${supersededBy.id}`}>{supersededBy.invoiceNo || "Newer →"}</Link></div>
            </>
          ) : null}
          {invoice.coveredDates && invoice.coveredDates.length > 0 ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Covers dates</div>
              <div>{invoice.coveredDates.join(", ")}</div>
            </>
          ) : null}
        </div>
      </div>

      {/* Lines — finals show the table; deposits show a synthesized line */}
      {invoice.invoiceType === "deposit" ? (
        <>
        <h3 className="section-title">Charges</h3>
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Deposit
                  {invoice.sourceQuoteCode ? <> for <code>{invoice.sourceQuoteCode}</code></> : null}
                </td>
                <td style={{ textAlign: "right" }}>${invoice.subtotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <>
        <h3 className="section-title">Line items</h3>
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Position</th><th>Specialty</th><th>Shift</th>
                <th>Qty</th><th>Hrs</th><th>Rate</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.length === 0 ? (
                <tr><td colSpan={8} className="muted">No line items.</td></tr>
              ) : invoice.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.quoteDate || "—"}</td>
                  <td>{l.department || "—"}</td>
                  <td>{l.specialty || "—"}</td>
                  <td>{(l.shiftId ? shifts.find((s) => s.id === l.shiftId)?.label : null) || "—"}</td>
                  <td>{l.qty}</td>
                  <td>{l.hours}</td>
                  <td>${(l.baseHourly || l.baseDay || 0).toFixed(2)}</td>
                  <td>${l.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Pricing */}
      <div className="grid2" style={{ marginBottom: 16 }}>
        <div></div>
        <div style={{ fontVariantNumeric: "tabular-nums" }}>
          <div className="action-row"><div className="muted" style={{ flex: 1 }}>Subtotal</div><div>${invoice.subtotal.toFixed(2)}</div></div>
          {invoice.depositApplied > 0 ? <div className="action-row"><div className="muted" style={{ flex: 1 }}>Deposit applied</div><div>−${invoice.depositApplied.toFixed(2)}</div></div> : null}
          {invoice.creditsApplied > 0 ? <div className="action-row"><div className="muted" style={{ flex: 1 }}>Credits applied</div><div>−${invoice.creditsApplied.toFixed(2)}</div></div> : null}
          {invoice.paidAmount > 0 ? <div className="action-row"><div className="muted" style={{ flex: 1 }}>Paid</div><div>−${invoice.paidAmount.toFixed(2)}</div></div> : null}
          <div className="action-row" style={{ borderTop: "2px solid #181410", paddingTop: 4, marginTop: 4, fontWeight: 700 }}>
            <div style={{ flex: 1 }}>Balance due</div>
            <div>${balanceDue(invoice).toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Payments applied to this invoice */}
      {payments.length > 0 ? (
        <>
          <h3 className="section-title">Payments</h3>
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Memo</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paymentDate}</td>
                    <td>{p.paymentMethod}</td>
                    <td>{p.referenceNumber || "—"}</td>
                    <td>{p.memo || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      ${p.amount.toFixed(2)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        style={{ fontSize: 11, padding: "2px 8px", color: "#a00" }}
                        onClick={() => onVoidPayment(p.id)}
                        title="Void this payment — invoice's paid amount + status will recompute"
                      >
                        Void
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>Total paid:</td>
                  <td style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    ${payments.reduce((s, p) => s + p.amount, 0).toFixed(2)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {invoice.notes ? <><h3 className="section-title">Notes</h3><div style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{invoice.notes}</div></> : null}
      {invoice.terms ? <><h3 className="section-title">Terms</h3><div style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{invoice.terms}</div></> : null}

      {/* Actions */}
      <div className="action-row" style={{ marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={() => window.open(`/invoices/${invoice.id}/pdf`, "_blank")}>Print / PDF</button>
        {!isFinalAndDone && invoice.status !== "sent" && invoice.status !== "paid" ? (
          <button className="secondary" onClick={onMarkSent}>Mark Sent</button>
        ) : null}
        {!isFinalAndDone && balanceDue(invoice) > 0 ? (
          <button onClick={openRecordPayment}>Record Payment</button>
        ) : null}
        {!isFinalAndDone ? (
          <button className="secondary" onClick={onRevise}>Revise</button>
        ) : null}
        {!isFinalAndDone && balanceDue(invoice) > 0 && creditBalance > 0 ? (
          <button className="secondary" onClick={() => setCreditOpen(true)}>
            Apply Credit (${creditBalance.toFixed(2)} avail)
          </button>
        ) : null}
        {!isFinalAndDone ? (
          <button className="secondary" onClick={() => setVoidOpen(true)} style={{ color: "#a00" }}>Void</button>
        ) : null}
        {!invoice.jobRequestId || !invoice.sourceQuoteId ? (
          <button className="secondary" onClick={onOpenLink}>Link to Job/Quote…</button>
        ) : null}
      </div>

      {voidOpen ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">Void invoice</h3>
          <div className="muted" style={{ marginBottom: 8 }}>Required: provide a reason. Voided invoices stay in the DB but are excluded from billing reports.</div>
          <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3} placeholder="Why is this invoice being voided?" />
          <div className="action-row" style={{ marginTop: 8 }}>
            <button onClick={onConfirmVoid} disabled={!voidReason.trim()}>Confirm Void</button>
            <button className="secondary" onClick={() => { setVoidOpen(false); setVoidReason(""); }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {payOpen ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">Record payment</h3>
          <div className="muted" style={{ marginBottom: 8 }}>
            Balance due: ${balanceDue(invoice).toFixed(2)} · Already paid: ${invoice.paidAmount.toFixed(2)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
            <label>
              <div className="muted">Payment date</div>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </label>
            <label>
              <div className="muted">Method</div>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                <option value="check">Check</option>
                <option value="ach">ACH</option>
                <option value="wire">Wire</option>
                <option value="credit_card">Credit card</option>
                <option value="cash">Cash</option>
                <option value="zelle">Zelle</option>
                <option value="venmo">Venmo</option>
                <option value="money_order">Money order</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              <div className="muted">Amount</div>
              <input
                type="number"
                step={0.01}
                min={0}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label>
              <div className="muted">Reference # (check #, txn id, etc.)</div>
              <input type="text" value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="optional" />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <div className="muted">Customer memo (memo line, Venmo note, etc.)</div>
              <input type="text" value={payMemo} onChange={(e) => setPayMemo(e.target.value)} placeholder="optional" />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <div className="muted">Internal notes</div>
              <textarea rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="optional" />
            </label>
          </div>
          <div className="action-row">
            <button onClick={onConfirmRecordPayment} disabled={paySaving || !payAmount || parseFloat(payAmount) <= 0}>
              {paySaving ? "Saving…" : "Save Payment"}
            </button>
            <button className="secondary" onClick={() => setPayOpen(false)} disabled={paySaving}>Cancel</button>
          </div>
        </div>
      ) : null}

      {creditOpen ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">Apply customer credit</h3>
          <div className="muted" style={{ marginBottom: 8 }}>
            Available credit: ${creditBalance.toFixed(2)} · Balance due: ${balanceDue(invoice).toFixed(2)}
          </div>
          <input type="number" min={0} max={Math.min(creditBalance, balanceDue(invoice))} step={0.01}
            value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="Apply how much?" />
          <div className="action-row" style={{ marginTop: 8 }}>
            <button onClick={onConfirmCredit} disabled={!creditAmount || parseFloat(creditAmount) <= 0}>Apply</button>
            <button className="secondary" onClick={() => { setCreditOpen(false); setCreditAmount(""); }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {linkOpen ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">Link to a Quote and Job</h3>
          <div className="muted" style={{ marginBottom: 8 }}>
            Both required. The invoice number will recompute as <code>{`{job_no}_INV`}</code> (or <code>_DEP</code>).
          </div>
          <label>
            <div className="muted">Quote</div>
            <select value={linkPickedQuoteId} onChange={(e) => setLinkPickedQuoteId(e.target.value)} style={{ minWidth: 360, marginBottom: 8 }}>
              <option value="">— Select a quote —</option>
              {linkQuotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.quote_no} — {q.client} — {q.event_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="muted">Job</div>
            <select value={linkPickedJobId} onChange={(e) => setLinkPickedJobId(e.target.value)} style={{ minWidth: 360, marginBottom: 8 }}>
              <option value="">— Select a job —</option>
              {linkJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_no} — {j.client} — {j.event_name} ({j.request_date})
                </option>
              ))}
            </select>
          </label>
          <div className="action-row">
            <button onClick={onConfirmLink} disabled={!linkPickedJobId || !linkPickedQuoteId}>Link</button>
            <button className="secondary" onClick={() => setLinkOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

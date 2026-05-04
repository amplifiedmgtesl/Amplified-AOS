/**
 * Minimal viable draft editor that uses lib/store/quotes.ts.
 *
 * This is a thin first cut — enough to demonstrate the new round-trip end to
 * end (create → edit → issue → revise). The full-featured editor with the
 * day grouping, "Copy from Day N-1", rate-card-change recalculation, and
 * holiday/travel breakouts comes in a later pass that can either extend this
 * or migrate the existing quote-builder.tsx to use lib/store/quotes.ts as its
 * backing store.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadQuote,
  saveDraft,
  issueDraft,
  deleteDraft,
} from "@/lib/store/quotes";
import type { QuoteDraft, QuoteLine } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";

export default function QuoteDraftEditor({ id }: { id: string }) {
  const router = useRouter();
  const [quote, setQuote] = useState<QuoteDraft | null>(null);
  const [job, setJob] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadQuote(id)
      .then(async (q) => {
        if (cancelled) return;
        if (!q) {
          setError(`Quote not found: ${id}`);
          setLoading(false);
          return;
        }
        if (!q.isDraft) {
          // Wrong route — frozen quotes use the read-only detail page.
          router.replace(`/quotes/${id}`);
          return;
        }
        setQuote(q);
        if (q.jobRequestId) {
          const j = await supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle();
          if (!cancelled) setJob(j.data ?? null);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[quote-draft-editor] load failed:", err);
        setError(err.message || "Failed to load draft");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, router]);

  function recomputeTotals(lines: QuoteLine[]): number {
    return lines.reduce((s, l) => s + (l.total || 0), 0);
  }

  function recomputeLineTotal(l: QuoteLine): number {
    if (l.rateMode === "day" || l.baseDay > 0) {
      return (l.qty || 0) * (l.baseDay || 0);
    }
    return (l.qty || 0) * (l.hours || 0) * (l.baseHourly || 0);
  }

  function updateLine(index: number, patch: Partial<QuoteLine>) {
    if (!quote) return;
    const newLines = quote.lines.map((l, i) => {
      if (i !== index) return l;
      const merged = { ...l, ...patch };
      merged.total = recomputeLineTotal(merged);
      return merged;
    });
    setQuote({ ...quote, lines: newLines, total: recomputeTotals(newLines) });
  }

  function deleteLine(index: number) {
    if (!quote) return;
    const newLines = quote.lines.filter((_, i) => i !== index);
    setQuote({ ...quote, lines: newLines, total: recomputeTotals(newLines) });
  }

  async function onSave() {
    if (!quote) return;
    setSaving("saving");
    try {
      await saveDraft(quote);
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);
    } catch (err: any) {
      setSaving("idle");
      alert(`Save failed: ${err.message || err}`);
    }
  }

  async function onIssue() {
    if (!quote) return;
    if (!confirm("Issue this quote? Once issued it becomes read-only and a permanent quote_no is assigned.")) return;
    try {
      // Save first to make sure latest edits are persisted
      await saveDraft(quote);
      await issueDraft(quote.id);
      router.push(`/quotes/${quote.id}`);
    } catch (err: any) {
      alert(`Issue failed: ${err.message || err}`);
    }
  }

  async function onDelete() {
    if (!quote) return;
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    try {
      await deleteDraft(quote.id);
      router.push("/quotes");
    } catch (err: any) {
      alert(`Delete failed: ${err.message || err}`);
    }
  }

  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!quote) return null;

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          Draft Quote {job?.job_no ? <>for <code>{job.job_no}</code></> : null}
          <span className="badge" style={{ marginLeft: 12 }}>Draft</span>
          {quote.parentQuoteId ? (
            <span className="muted" style={{ marginLeft: 8 }}>Revision of <Link href={`/quotes/${quote.parentQuoteId}`}>parent</Link></span>
          ) : null}
        </h2>
        <span className="muted">
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : ""}
        </span>
        <Link href="/quotes" className="badge">← All Quotes</Link>
      </div>
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        On issue, this draft becomes <code>{job?.job_no ? `${job.job_no}_EST` : "(job_no)_EST"}</code>{quote.parentQuoteId ? ` (or _EST_REV${quote.revisionNo})` : ""}.
      </div>

      {/* Read-only event panel — pulled from joined job_request */}
      <div className="card" style={{ marginBottom: 16, background: "rgba(0,0,0,0.02)" }}>
        <div className="action-row" style={{ alignItems: "baseline", marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Event details</h3>
          {job?.id ? <Link className="badge" href="/job-requests">Edit on Job →</Link> : null}
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
              <div className="muted">Dates</div>
              <div>{job.request_date}{job.end_date && job.end_date !== job.request_date ? ` → ${job.end_date}` : ""}</div>
              <div className="muted" style={{ marginTop: 8 }}>Job #</div>
              <div>{job.job_no || "—"}</div>
              <div className="muted" style={{ marginTop: 8 }}>Status</div>
              <div>{job.status}</div>
            </div>
          </div>
        ) : (
          <div className="muted">No job_request linked.</div>
        )}
      </div>

      {/* Quote-specific fields */}
      <div className="grid2" style={{ marginBottom: 16 }}>
        <div>
          <label>
            <div className="muted">Notes</div>
            <textarea
              value={quote.notes}
              onChange={(e) => setQuote({ ...quote, notes: e.target.value })}
              rows={3}
            />
          </label>
        </div>
        <div>
          <label>
            <div className="muted">Terms</div>
            <textarea
              value={quote.terms}
              onChange={(e) => setQuote({ ...quote, terms: e.target.value })}
              rows={3}
            />
          </label>
          <label>
            <div className="muted" style={{ marginTop: 8 }}>Deposit ($)</div>
            <input
              type="number"
              value={quote.deposit}
              onChange={(e) => setQuote({ ...quote, deposit: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
      </div>

      {/* Lines */}
      <h3 className="section-title">Line items</h3>
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Department</th><th>Specialty</th><th>Shift</th>
              <th>Qty</th><th>Hours</th><th>Rate</th><th>Total</th><th></th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.length === 0 ? (
              <tr><td colSpan={9} className="muted">No line items. Add lines via the legacy quote builder for now, or seed from job crew_needs by recreating the draft.</td></tr>
            ) : quote.lines.map((l, i) => (
              <tr key={i}>
                <td><input type="date" value={l.quoteDate || ""} onChange={(e) => updateLine(i, { quoteDate: e.target.value })} /></td>
                <td><input type="text" value={l.department || ""} onChange={(e) => updateLine(i, { department: e.target.value })} placeholder="Position" /></td>
                <td><input type="text" value={l.specialty || ""} onChange={(e) => updateLine(i, { specialty: e.target.value })} placeholder="Specialty" /></td>
                <td><input type="text" value={l.shiftLabel || ""} onChange={(e) => updateLine(i, { shiftLabel: e.target.value })} placeholder="Shift" /></td>
                <td><input type="number" value={l.qty} onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} /></td>
                <td><input type="number" value={l.hours} onChange={(e) => updateLine(i, { hours: parseFloat(e.target.value) || 0 })} style={{ width: 70 }} /></td>
                <td><input type="number" value={l.baseHourly} onChange={(e) => updateLine(i, { baseHourly: parseFloat(e.target.value) || 0 })} style={{ width: 80 }} step="0.01" /></td>
                <td>${l.total.toFixed(2)}</td>
                <td><button className="secondary" onClick={() => deleteLine(i)} style={{ fontSize: 12 }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div></div>
        <div>
          <div className="action-row">
            <div className="muted" style={{ flex: 1 }}>Subtotal</div>
            <div>${quote.total.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="action-row">
        <button onClick={onSave} disabled={saving === "saving"}>
          {saving === "saving" ? "Saving…" : "Save Draft"}
        </button>
        <button onClick={onIssue}>Issue Quote</button>
        <button className="secondary" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

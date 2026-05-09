/**
 * Read-only display for a frozen quote (is_draft=false).
 *
 * Used by /quotes/[id] page. Drafts redirect from this route to the editor.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadQuote,
  createDraftFromRevision,
  markSigned,
  displayStatus,
  linkOrphanQuote,
} from "@/lib/store/quotes";
import {
  createDepositDraftFromQuote,
  createFinalDraftFromQuote,
  loadInvoices,
} from "@/lib/store/invoices";
import type { QuoteDraft } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";

export default function QuoteDetail({ id }: { id: string }) {
  const router = useRouter();
  const [quote, setQuote] = useState<QuoteDraft | null>(null);
  const [job, setJob] = useState<any | null>(null);
  const [supersededBy, setSupersededBy] = useState<{ id: string; quoteNo: string | null } | null>(null);
  const [positionsById, setPositionsById] = useState<Map<string, string>>(new Map());
  const [specialtiesById, setSpecialtiesById] = useState<Map<string, { name: string; positionId: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState("");
  /** Existing invoices for this quote — drives Generate Deposit/Final
   *  button visibility (hide when an active one already exists). */
  const [hasActiveDeposit, setHasActiveDeposit] = useState(false);
  const [hasActiveFinal, setHasActiveFinal] = useState(false);
  const [activeDepositId, setActiveDepositId] = useState<string | null>(null);
  const [activeFinalId, setActiveFinalId] = useState<string | null>(null);

  /** Orphan-quote linker state. Open when user clicks "Link to Job". */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkJobs, setLinkJobs] = useState<Array<{ id: string; job_no: string | null; client: string | null; event_name: string | null; request_date: string | null; client_id: string | null }>>([]);
  const [linkPickedJobId, setLinkPickedJobId] = useState<string>("");

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
        if (q.isDraft) {
          // Wrong route — redirect to editor.
          router.replace(`/quotes/${id}/edit`);
          return;
        }
        setQuote(q);
        // Load positions + specialties so line display can resolve FK -> name
        // without depending on the legacy denormalized text columns.
        const [posRes, spcRes] = await Promise.all([
          supabase.from("positions").select("id, name"),
          supabase.from("specialties").select("id, name, position_id"),
        ]);
        if (!cancelled) {
          setPositionsById(new Map((posRes.data ?? []).map((p: any) => [p.id, p.name])));
          setSpecialtiesById(new Map((spcRes.data ?? []).map((s: any) => [s.id, { name: s.name, positionId: s.position_id }])));
        }
        if (q.jobRequestId) {
          const j = await supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle();
          if (!cancelled) setJob(j.data ?? null);
        }
        // Find the child quote that superseded this one, if any.
        const child = await supabase
          .from("quotes")
          .select("id, quote_no")
          .eq("parent_quote_id", q.id)
          .eq("is_draft", false)
          .order("revision_no", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && child.data) {
          setSupersededBy({ id: child.data.id, quoteNo: child.data.quote_no });
        }
        // Check for active invoices linked to this quote (deposit / final).
        const invoices = await loadInvoices({ sourceQuoteId: q.id });
        if (!cancelled) {
          const dep = invoices.find((i) => i.invoiceType === "deposit" && (!i.status || (i.status !== "superseded" && i.status !== "void")));
          const fin = invoices.find((i) => i.invoiceType === "final" && (!i.status || (i.status !== "superseded" && i.status !== "void")) && (!i.coveredDates || i.coveredDates.length === 0));
          setHasActiveDeposit(!!dep);
          setActiveDepositId(dep?.id ?? null);
          setHasActiveFinal(!!fin);
          setActiveFinalId(fin?.id ?? null);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[quote-detail] load failed:", err);
        setError(err.message || "Failed to load quote");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, router]);

  async function onRevise() {
    if (!quote) return;
    // Stronger confirmation when revising a signed quote — that's effectively
    // amending a contract. The signed version stays in the DB as superseded
    // (the audit trail is preserved), but the user should know what they're
    // doing.
    if (quote.status === "signed") {
      const ok = confirm(
        "This quote has been signed by the client. Creating a revision will:\n" +
        "  • Supersede the signed version (it stays in the DB as 'superseded')\n" +
        "  • Create a new unsigned revision that the client must re-sign\n\n" +
        "Continue?"
      );
      if (!ok) return;
    }
    try {
      const newDraft = await createDraftFromRevision(quote.id);
      router.push(`/quotes/${newDraft.id}/edit`);
    } catch (err: any) {
      alert(`Revise failed: ${err.message || err}`);
    }
  }

  async function onMarkSigned() {
    if (!quote || !signName.trim()) return;
    try {
      await markSigned(quote.id, signName.trim());
      setSignOpen(false);
      setSignName("");
      // Reload
      const q = await loadQuote(quote.id);
      setQuote(q);
    } catch (err: any) {
      alert(`Mark Signed failed: ${err.message || err}`);
    }
  }

  async function onOpenLink() {
    if (!quote) return;
    // Load job_requests, prefer same-client first.
    const { data, error } = await supabase
      .from("job_requests")
      .select("id, job_no, client, event_name, request_date, client_id")
      .not("job_no", "is", null)
      .order("request_date", { ascending: false });
    if (error) { alert(`Couldn't load jobs: ${error.message}`); return; }
    const rows = data ?? [];
    // Sort: same-client jobs first, then everything else by request_date desc.
    const sameClient = quote.clientId
      ? rows.filter((r) => r.client_id === quote.clientId)
      : [];
    const others = quote.clientId
      ? rows.filter((r) => r.client_id !== quote.clientId)
      : rows;
    setLinkJobs([...sameClient, ...others]);
    setLinkPickedJobId("");
    setLinkOpen(true);
  }

  async function onGenerateDeposit() {
    if (!quote) return;
    if (!confirm(`Generate a deposit invoice from this quote?`)) return;
    try {
      const draft = await createDepositDraftFromQuote(quote.id);
      router.push(`/invoices/${draft.id}/edit`);
    } catch (err: any) {
      alert(`Generate Deposit failed: ${err.message || err}`);
    }
  }

  async function onGenerateFinal() {
    if (!quote) return;
    if (!confirm(`Generate a final invoice covering the full job from this quote?`)) return;
    try {
      const draft = await createFinalDraftFromQuote(quote.id);
      router.push(`/invoices/${draft.id}/edit`);
    } catch (err: any) {
      alert(`Generate Final failed: ${err.message || err}`);
    }
  }

  async function onConfirmLink() {
    if (!quote || !linkPickedJobId) return;
    try {
      await linkOrphanQuote(quote.id, linkPickedJobId);
      setLinkOpen(false);
      // Reload the quote to show new quote_no + linked job.
      const q = await loadQuote(quote.id);
      setQuote(q);
      // Reload the linked job header info.
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
  if (!quote) return null;

  const statusLabel = displayStatus(quote);
  const isSigned = quote.status === "signed";
  const isSuperseded = quote.status === "superseded";

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          {quote.quoteNo || `Quote ${quote.id.slice(0, 12)}`}
          <span className="badge" style={{ marginLeft: 12 }}>{statusLabel}</span>
          {/* Revision indicator already encoded in the quote_no suffix
              (e.g. _EST_REV1). No redundant badge needed. */}
        </h2>
        <Link href="/quotes" className="badge">← All Quotes</Link>
      </div>

      {/* Job + client header */}
      <div className="grid2" style={{ marginBottom: 16 }}>
        <div>
          <div className="muted">Client</div>
          <div><strong>{quote.client || "—"}</strong></div>
          <div className="muted" style={{ marginTop: 8 }}>Event</div>
          <div>{quote.eventName || "—"}</div>
          <div className="muted" style={{ marginTop: 8 }}>Venue</div>
          <div>{quote.venue || "—"} {quote.cityState ? <span className="muted">— {quote.cityState}</span> : null}</div>
        </div>
        <div>
          <div className="muted">Dates</div>
          <div>{quote.startDate}{quote.endDate && quote.endDate !== quote.startDate ? ` → ${quote.endDate}` : ""}</div>
          <div className="muted" style={{ marginTop: 8 }}>Issued</div>
          <div>{quote.issuedAt ? new Date(quote.issuedAt).toLocaleString() : "—"}</div>
          {quote.signedAt ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Signed</div>
              <div>{new Date(quote.signedAt).toLocaleString()} {quote.signatureName ? <span className="muted">— {quote.signatureName}</span> : null}</div>
            </>
          ) : null}
          {quote.parentQuoteId ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Revises</div>
              <div><Link className="badge" href={`/quotes/${quote.parentQuoteId}`}>Previous revision</Link></div>
            </>
          ) : null}
          {supersededBy ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Superseded by</div>
              <div><Link className="badge" href={`/quotes/${supersededBy.id}`}>{supersededBy.quoteNo || "Newer revision →"}</Link></div>
            </>
          ) : null}
          {job?.id ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Source job</div>
              <div><Link className="badge" href={`/job-requests?id=${job.id}`}>{job.job_no || job.id}</Link></div>
            </>
          ) : null}
          {quote.preparedByName || quote.preparedByTitle ? (
            <>
              <div className="muted" style={{ marginTop: 8 }}>Prepared by</div>
              <div>{quote.preparedByName}{quote.preparedByTitle ? <span className="muted"> — {quote.preparedByTitle}</span> : null}</div>
            </>
          ) : null}
        </div>
      </div>

      {/* Lines */}
      <h3 className="section-title">Line items</h3>
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Department</th><th>Specialty</th><th>Shift</th>
              <th>Qty</th><th>Hrs</th><th>Hol</th><th>Travel</th>
              <th>$/hr</th><th>$/day</th><th>OT</th><th>DT</th>
              <th>Rule</th><th>Mode</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.length === 0 ? (
              <tr><td colSpan={15} className="muted">No line items.</td></tr>
            ) : quote.lines.map((l, i) => {
              // Resolve names from FK lookups (legacy text fields phasing out).
              const spc = l.specialtyId ? specialtiesById.get(l.specialtyId) : undefined;
              const positionName = (spc ? positionsById.get(spc.positionId) : undefined)
                ?? (l.positionId ? positionsById.get(l.positionId) : undefined)
                ?? l.department  // legacy fallback
                ?? "—";
              const specialtyName = spc?.name ?? l.specialty ?? "—";
              return (
              <tr key={i}>
                <td>{l.quoteDate || "—"}</td>
                <td>{positionName}</td>
                <td>{specialtyName}</td>
                <td>{l.shiftLabel || "—"}</td>
                <td>{l.qty}</td>
                <td>{l.hours}</td>
                <td>{l.holidayHours || 0}</td>
                <td>${(l.travel || 0).toFixed(2)}</td>
                <td>${(l.baseHourly || 0).toFixed(2)}</td>
                <td>${(l.baseDay || 0).toFixed(2)}</td>
                <td>${(l.otRate || 0).toFixed(2)}</td>
                <td>${(l.dtRate || 0).toFixed(2)}</td>
                <td style={{ fontSize: 11 }}>{l.rule || "—"}</td>
                <td>{l.rateMode || "hourly"}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>${l.total.toFixed(2)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div></div>
        <div>
          <div className="action-row"><div className="muted" style={{ flex: 1 }}>Subtotal</div><div>${quote.total.toFixed(2)}</div></div>
          <div className="action-row"><div className="muted" style={{ flex: 1 }}>Deposit</div><div>${quote.deposit.toFixed(2)}</div></div>
        </div>
      </div>

      {quote.notes ? <><h3 className="section-title">Notes</h3><div style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{quote.notes}</div></> : null}
      {quote.terms ? <><h3 className="section-title">Terms</h3><div style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{quote.terms}</div></> : null}

      {/* Action bar */}
      <div className="action-row" style={{ marginTop: 16 }}>
        <button onClick={() => window.open(`/quotes/${quote.id}/pdf`, "_blank")}>Print / PDF</button>
        {!isSuperseded && !isSigned ? (
          <button className="secondary" onClick={() => setSignOpen(true)}>Mark Signed</button>
        ) : null}
        {!isSuperseded ? (
          <button className="secondary" onClick={onRevise}>Revise</button>
        ) : null}
        {/* Legacy orphan adoption: visible only when this quote has no
            linked job_request. After successful link, the button hides on
            reload. */}
        {!quote.jobRequestId ? (
          <button className="secondary" onClick={onOpenLink} title="This legacy quote has no linked job. Pick a job to attach it to and recompute the quote number.">
            Link to Job…
          </button>
        ) : null}
        {/* Invoice generation — only on issued/signed quotes with a job link */}
        {quote.jobRequestId && !isSuperseded ? (
          hasActiveDeposit ? (
            <button className="secondary" onClick={() => router.push(`/invoices/${activeDepositId}`)}>
              View Deposit Invoice
            </button>
          ) : (
            <button className="secondary" onClick={onGenerateDeposit}>
              Generate Deposit Invoice
            </button>
          )
        ) : null}
        {quote.jobRequestId && !isSuperseded ? (
          hasActiveFinal ? (
            <button className="secondary" onClick={() => router.push(`/invoices/${activeFinalId}`)}>
              View Final Invoice
            </button>
          ) : (
            <button className="secondary" onClick={onGenerateFinal}>
              Generate Final Invoice
            </button>
          )
        ) : null}
        {/* Generate Invoice button intentionally absent — Phase C scope. */}
      </div>

      {linkOpen ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">Link to a Job</h3>
          <div className="muted" style={{ marginBottom: 8 }}>
            Pick the job this quote belongs to. The quote number will recompute as <code>{`{job_no}_EST`}</code> (or <code>_REV{`{N}`}</code> for revisions). Same-client jobs are listed first.
          </div>
          <select
            value={linkPickedJobId}
            onChange={(e) => setLinkPickedJobId(e.target.value)}
            style={{ minWidth: 360, marginBottom: 8 }}
          >
            <option value="">— Select a job —</option>
            {linkJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_no || "(no job_no)"} — {j.client || "?"} — {j.event_name || "?"}{j.request_date ? ` (${j.request_date})` : ""}
              </option>
            ))}
          </select>
          <div className="action-row">
            <button onClick={onConfirmLink} disabled={!linkPickedJobId}>Link Quote</button>
            <button className="secondary" onClick={() => { setLinkOpen(false); setLinkPickedJobId(""); }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {signOpen ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title">Mark as signed</h3>
          <div className="muted" style={{ marginBottom: 8 }}>Enter the customer's name as it appears on the signed document.</div>
          <input
            type="text"
            placeholder="Customer name"
            value={signName}
            onChange={(e) => setSignName(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div className="action-row">
            <button onClick={onMarkSigned} disabled={!signName.trim()}>Confirm</button>
            <button className="secondary" onClick={() => { setSignOpen(false); setSignName(""); }}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

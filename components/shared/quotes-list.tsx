/**
 * Unified quotes list — drafts and frozen quotes mixed, status badge column.
 *
 * No "+ New Quote" button — first quotes start from a job_request, revisions
 * from a frozen quote's Revise action.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadQuotes, displayStatus, type QuoteFilters } from "@/lib/store/quotes";
import { supabase } from "@/lib/supabase/client";
import type { QuoteDraft } from "@/lib/store/types";

type StatusFilter = "active" | "drafts" | "issued" | "signed" | "superseded" | "all";

export default function QuotesList() {
  const [rows, setRows] = useState<QuoteDraft[]>([]);
  /** projected quote_no per draft id, computed for display on the list */
  const [projections, setProjections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const filters: QuoteFilters = {};
    // active = drafts + issued + signed (hide superseded — handled in loadQuotes)
    if (statusFilter === "drafts") filters.isDraft = true;
    if (statusFilter === "issued" || statusFilter === "signed" || statusFilter === "superseded") {
      filters.isDraft = false;
      filters.hideSuperseded = statusFilter !== "superseded";
    }
    if (statusFilter === "all") filters.hideSuperseded = false;

    loadQuotes(filters)
      .then(async (data) => {
        if (cancelled) return;
        // Apply secondary status filter for issued/signed/superseded since loadQuotes
        // doesn't filter by exact status value.
        let filtered = data;
        if (statusFilter === "issued") filtered = filtered.filter((q) => q.status === "issued");
        if (statusFilter === "signed") filtered = filtered.filter((q) => q.status === "signed");
        if (statusFilter === "superseded") filtered = filtered.filter((q) => q.status === "superseded");
        setRows(filtered);

        // Compute projected quote_no for drafts. Need parent job_no + (for revisions)
        // parent revision_no. Batch-fetch.
        const drafts = filtered.filter((q) => q.isDraft);
        if (drafts.length > 0) {
          const jobIds = Array.from(new Set(drafts.map((q) => q.jobRequestId).filter(Boolean) as string[]));
          const parentIds = Array.from(new Set(drafts.map((q) => q.parentQuoteId).filter(Boolean) as string[]));
          const [jobsRes, parentsRes] = await Promise.all([
            jobIds.length > 0
              ? supabase.from("job_requests").select("id, job_no").in("id", jobIds)
              : Promise.resolve({ data: [], error: null }),
            parentIds.length > 0
              ? supabase.from("quotes").select("id, revision_no").in("id", parentIds)
              : Promise.resolve({ data: [], error: null }),
          ]);
          if (!cancelled) {
            const jobsById = new Map((jobsRes.data ?? []).map((j: any) => [j.id, j.job_no]));
            const parentsById = new Map((parentsRes.data ?? []).map((p: any) => [p.id, p.revision_no]));
            const proj: Record<string, string> = {};
            for (const d of drafts) {
              const jobNo = d.jobRequestId ? jobsById.get(d.jobRequestId) : null;
              if (!jobNo) continue;
              if (d.parentQuoteId) {
                const parentRev = parentsById.get(d.parentQuoteId);
                // Suffix uses revision count: first revision (parent.rev=1) -> REV1.
                if (parentRev !== undefined) proj[d.id] = `${jobNo}_EST_REV${parentRev}`;
              } else {
                proj[d.id] = `${jobNo}_EST`;
              }
            }
            setProjections(proj);
          }
        } else {
          setProjections({});
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[quotes-list] load failed:", err);
        setError(err.message || "Failed to load quotes");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [statusFilter]);

  const visible = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((q) =>
      (q.quoteNo || "").toLowerCase().includes(s) ||
      (q.client || "").toLowerCase().includes(s) ||
      (q.eventName || "").toLowerCase().includes(s) ||
      q.id.toLowerCase().includes(s),
    );
  }, [rows, search]);

  if (loading) return <div className="muted">Loading quotes…</div>;
  if (error) return <div className="muted">{error}</div>;

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, gap: 12, alignItems: "baseline" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>Quotes</h2>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="active">Active (drafts + issued + signed)</option>
          <option value="drafts">Drafts only</option>
          <option value="issued">Issued</option>
          <option value="signed">Signed</option>
          <option value="superseded">Superseded</option>
          <option value="all">All</option>
        </select>
        <input
          type="text"
          placeholder="Search quote # / client / event"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
      </div>

      <div className="muted" style={{ marginBottom: 8 }}>
        {visible.length} of {rows.length} quote{rows.length !== 1 ? "s" : ""}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Quote #</th>
              <th>Client</th>
              <th>Event</th>
              <th>Start</th>
              <th>Total</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} className="muted">No quotes match.</td></tr>
            ) : visible.map((q) => {
              const href = q.isDraft ? `/quotes/${q.id}/edit` : `/quotes/${q.id}`;
              const labelQuoteNo =
                q.quoteNo ||
                projections[q.id] ||
                (q.isDraft ? "— Draft —" : q.id.slice(0, 12));
              return (
                <tr key={q.id}>
                  <td><span className="badge">{displayStatus(q)}</span></td>
                  <td><Link href={href}>{labelQuoteNo}</Link></td>
                  <td>{q.client || "—"}</td>
                  <td>{q.eventName || "—"}</td>
                  <td>{q.startDate || "—"}</td>
                  <td>${q.total.toFixed(2)}</td>
                  <td>{q.updatedAt ? new Date(q.updatedAt).toLocaleDateString() : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

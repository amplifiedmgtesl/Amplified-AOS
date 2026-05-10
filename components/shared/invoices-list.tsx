/**
 * Unified invoices list — drafts and frozen invoices, status badges.
 * Mirrors quotes-list.tsx pattern.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadInvoices, displayStatus, balanceDue, type InvoiceFilters } from "@/lib/store/invoices";
import type { InvoiceDraft } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";

/** Build the same projected invoice # the editor shows for an unsaved draft. */
function projectedInvoiceNo(inv: InvoiceDraft, jobNo: string | undefined): string | null {
  if (!jobNo) return null;
  const suffix =
    inv.invoiceType === "deposit" ? "_DEP" :
    inv.coveredDates && inv.coveredDates.length > 0
      ? "_INV_" + inv.coveredDates[0].replace(/-/g, "")
      : "_INV";
  const rev = inv.revisionNo > 1 ? `_REV${inv.revisionNo - 1}` : "";
  return `${jobNo}${suffix}${rev}`;
}

type StatusFilter = "active" | "drafts" | "issued" | "sent" | "paid" | "superseded" | "void" | "all";

export default function InvoicesList() {
  const [rows, setRows] = useState<InvoiceDraft[]>([]);
  const [jobNoMap, setJobNoMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const filters: InvoiceFilters = {};
    if (statusFilter === "drafts") filters.isDraft = true;
    if (["issued", "sent", "paid"].includes(statusFilter)) {
      filters.isDraft = false;
    }
    if (statusFilter === "superseded" || statusFilter === "void") {
      filters.isDraft = false;
      filters.hideSupersededAndVoid = false;
    }
    if (statusFilter === "all") filters.hideSupersededAndVoid = false;

    loadInvoices(filters)
      .then(async (data) => {
        if (cancelled) return;
        let filtered = data;
        if (statusFilter === "issued")     filtered = filtered.filter((q) => q.status === "issued");
        if (statusFilter === "sent")       filtered = filtered.filter((q) => q.status === "sent");
        if (statusFilter === "paid")       filtered = filtered.filter((q) => q.status === "paid");
        if (statusFilter === "superseded") filtered = filtered.filter((q) => q.status === "superseded");
        if (statusFilter === "void")       filtered = filtered.filter((q) => q.status === "void");
        setRows(filtered);

        // Batch-load job_no for every job_request_id we'll show, so drafts
        // can render their projected invoice # without N+1 lookups.
        const jobIds = Array.from(new Set(
          filtered.map((q) => q.jobRequestId).filter(Boolean) as string[]
        ));
        if (jobIds.length > 0) {
          const { data: jobs } = await supabase
            .from("job_requests")
            .select("id, job_no")
            .in("id", jobIds);
          if (!cancelled && jobs) {
            const m = new Map<string, string>();
            for (const j of jobs as any[]) {
              if (j.job_no) m.set(j.id, j.job_no);
            }
            setJobNoMap(m);
          }
        } else if (!cancelled) {
          setJobNoMap(new Map());
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[invoices-list] load failed:", err);
        setError(err.message || "Failed to load invoices");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [statusFilter]);

  const visible = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((q) => {
      const projected = projectedInvoiceNo(q, q.jobRequestId ? jobNoMap.get(q.jobRequestId) : undefined);
      return (
        (q.invoiceNo || "").toLowerCase().includes(s) ||
        (projected || "").toLowerCase().includes(s) ||
        (q.sourceQuoteCode || "").toLowerCase().includes(s) ||
        (q.client || "").toLowerCase().includes(s) ||
        (q.eventName || "").toLowerCase().includes(s) ||
        q.id.toLowerCase().includes(s)
      );
    });
  }, [rows, search, jobNoMap]);

  if (loading) return <div className="muted">Loading invoices…</div>;
  if (error) return <div className="muted">{error}</div>;

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, gap: 12, alignItems: "baseline" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>Invoices</h2>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="active">Active (drafts + issued + sent + paid)</option>
          <option value="drafts">Drafts only</option>
          <option value="issued">Issued</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="superseded">Superseded</option>
          <option value="void">Void</option>
          <option value="all">All</option>
        </select>
        <input
          type="text"
          placeholder="Search invoice # / client / event"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
      </div>

      <div className="muted" style={{ marginBottom: 8 }}>
        {visible.length} of {rows.length} invoice{rows.length !== 1 ? "s" : ""}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Type</th>
              <th>Invoice #</th>
              <th>Source quote</th>
              <th>Client</th>
              <th>Event</th>
              <th>Subtotal</th>
              <th>Balance Due</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={9} className="muted">No invoices match.</td></tr>
            ) : visible.map((q) => {
              const href = q.isDraft ? `/invoices/${q.id}/edit` : `/invoices/${q.id}`;
              const projected = projectedInvoiceNo(q, q.jobRequestId ? jobNoMap.get(q.jobRequestId) : undefined);
              // Frozen rows show invoice_no. Drafts show the projected #
              // (so the operator can tell six drafts apart) and only fall
              // back to "— Draft —" when the job has no job_no yet.
              const labelInvoiceNo =
                q.invoiceNo ||
                projected ||
                (q.isDraft ? "— Draft —" : q.id.slice(0, 12));
              return (
                <tr key={q.id}>
                  <td><span className="badge">{displayStatus(q)}</span></td>
                  <td>{q.invoiceType || "—"}</td>
                  <td>
                    <Link
                      href={href}
                      style={{
                        color: "#2c4d73",
                        textDecoration: "underline",
                        fontWeight: 600,
                        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                      }}
                    >
                      {labelInvoiceNo}
                    </Link>
                    {q.isDraft && projected ? (
                      <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>(projected)</span>
                    ) : null}
                  </td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 12 }}>
                    {q.sourceQuoteCode || "—"}
                  </td>
                  <td>{q.client || "—"}</td>
                  <td>{q.eventName || "—"}</td>
                  <td>${(q.subtotal ?? 0).toFixed(2)}</td>
                  <td>${balanceDue(q).toFixed(2)}</td>
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

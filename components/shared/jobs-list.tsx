"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadJobRequests } from "@/lib/store/app-store";
import { supabase } from "@/lib/supabase/client";
import { JOB_REQUEST_STATUSES } from "@/lib/constants";
import JobsCalendar, { JOB_STATUS_PALETTE } from "./jobs-calendar";
import type { JobRequest, Client } from "@/lib/store/types";

type StatusFilter = "active" | "all" | "lead" | "quoted" | "booked" | "completed" | "lost";
const ACTIVE_STATUSES = new Set(["lead", "quoted", "booked"]);
const COMPLETED_NUDGE_DAYS = 7;

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso + "T00:00:00");
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

const STATUS_PALETTE = JOB_STATUS_PALETTE;

/**
 * Jobs list — the full-width searchable list. Selecting a row opens the job on
 * its own route ({basePath}/{id}), mirroring the quotes/invoices list→detail
 * flow.
 *
 * For backward compatibility this list also honors the legacy deep-link query
 * params (?id=, ?new=1&clientId=, &tab=) that older links across the app still
 * use, redirecting them to the new detail/new sub-routes.
 */
export default function JobsList({ basePath = "/job-requests" }: { basePath?: string }) {
  const router = useRouter();
  const [refreshKey] = useState(0);
  const rows = useMemo(() => loadJobRequests(), [refreshKey]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [redirecting, setRedirecting] = useState(false);
  // List/Calendar toggle. Both views render the same filtered set
  // (visibleRows), so status filter + search apply identically.
  const [view, setView] = useState<"list" | "calendar">("list");

  // Legacy deep-link redirect: /…?id=X[&tab=Y] → /…/X[?tab=Y];
  // /…?new=1&clientId=Z → /…/new?clientId=Z. Runs once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantNew = params.get("new") === "1";
    const wantId = params.get("id");
    if (wantNew) {
      setRedirecting(true);
      const q = new URLSearchParams();
      const clientId = params.get("clientId");
      const tab = params.get("tab");
      if (clientId) q.set("clientId", clientId);
      if (tab) q.set("tab", tab);
      const qs = q.toString();
      router.replace(`${basePath}/new${qs ? `?${qs}` : ""}`);
    } else if (wantId) {
      setRedirecting(true);
      const tab = params.get("tab");
      router.replace(`${basePath}/${encodeURIComponent(wantId)}${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.from("clients").select("id, name, code, is_active").order("name")
      .then(({ data }) => setClients((data ?? []).map((r: any) => ({
        id: r.id, name: r.name, code: r.code ?? undefined, isActive: !!r.is_active,
      }))));
  }, []);

  const clientById = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (statusFilter === "active") return ACTIVE_STATUSES.has(r.status);
        if (statusFilter === "all") return true;
        return r.status === statusFilter;
      })
      .filter((r) => {
        if (!term) return true;
        const code = clientById.get(r.clientId)?.code ?? "";
        return (
          r.eventName.toLowerCase().includes(term) ||
          (r.client ?? "").toLowerCase().includes(term) ||
          code.toLowerCase().includes(term) ||
          (r.venue ?? "").toLowerCase().includes(term) ||
          (r.jobNo ?? "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => (b.requestDate || "").localeCompare(a.requestDate || ""));
  }, [rows, search, statusFilter, clientById]);

  function detailHref(id: string) { return `${basePath}/${encodeURIComponent(id)}`; }

  if (redirecting) return <div className="muted">Opening job…</div>;

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>Jobs</h2>
        <button className={view === "list" ? "" : "secondary"} onClick={() => setView("list")}>List</button>
        <button className={view === "calendar" ? "" : "secondary"} onClick={() => setView("calendar")}>📅 Calendar</button>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="active">Active (Lead + Quoted + Booked)</option>
          <option value="all">All statuses</option>
          <option value="lead">Lead only</option>
          <option value="quoted">Quoted only</option>
          <option value="booked">Booked only</option>
          <option value="completed">Completed only</option>
          <option value="lost">Lost only</option>
        </select>
        <input
          type="text"
          placeholder="Search job # / client / event / venue"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <Link href={`${basePath}/new`} style={{
          textDecoration: "none", padding: "8px 14px", borderRadius: 6,
          background: "var(--accent, #2563eb)", color: "#fff", fontSize: 13, fontWeight: 600,
        }}>+ New Job</Link>
      </div>

      <div className="muted" style={{ marginBottom: 8 }}>
        {visibleRows.length} of {rows.length} job{rows.length !== 1 ? "s" : ""}
      </div>

      {view === "calendar" ? (
        <JobsCalendar jobs={visibleRows} clientById={clientById} detailHref={detailHref} />
      ) : (
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Job #</th>
              <th>Client</th>
              <th>Event</th>
              <th>Venue</th>
              <th>Start</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr><td colSpan={6} className="muted">No matching jobs.</td></tr>
            ) : visibleRows.map((r) => {
              const c = clientById.get(r.clientId);
              const label = c?.code ? `[${c.code}] ${c.name ?? ""}` : (c?.name ?? r.client ?? "—");
              const eventEnd = r.endDate || r.requestDate;
              const daysPast = r.status === "booked" ? daysSince(eventEnd) : null;
              const overdue = daysPast !== null && daysPast >= COMPLETED_NUDGE_DAYS;
              const pal = STATUS_PALETTE[r.status] ?? { bg: "#f3f4f6", fg: "#555" };
              const statusLabel = JOB_REQUEST_STATUSES.find((s) => s.value === r.status)?.label ?? r.status;
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={detailHref(r.id)} style={{
                      color: "#2c4d73", textDecoration: "underline", fontWeight: 600,
                      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                    }}>
                      {r.jobNo || "(no job #)"}
                    </Link>
                  </td>
                  <td>{label}</td>
                  <td>
                    <Link href={detailHref(r.id)} style={{ color: "#2c4d73", textDecoration: "underline" }}>
                      {r.eventName || "(no event name)"}
                    </Link>
                  </td>
                  <td>{r.venue || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.requestDate || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ background: pal.bg, color: pal.fg, borderRadius: 4, padding: "2px 8px", fontSize: 12 }}>
                      {statusLabel}
                    </span>
                    {overdue && (
                      <span title="Mark this Completed when the event is wrapped up" style={{ marginLeft: 6, fontSize: 11, color: "#a86400", fontStyle: "italic" }}>
                        ⚠ ended {daysPast}d ago
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

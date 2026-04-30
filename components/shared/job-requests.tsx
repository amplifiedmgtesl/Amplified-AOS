"use client";

import { useEffect, useMemo, useState } from "react";
import { setQuoteSeed, upsertJobRequest, deleteJobRequest, setActiveQuote } from "@/lib/store/app-store";
import { googleCalendarLink } from "@/lib/store/calendar";
import { loadJobRequests } from "@/lib/store/app-store";
import { timeOptions } from "@/lib/store/timekeeping";
import { supabase } from "@/lib/supabase/client";
import { US_STATES, JOB_REQUEST_STATUSES } from "@/lib/constants";
import type { JobRequest, Client } from "@/lib/store/types";

const TIMES = timeOptions();

function today() { return new Date().toISOString().slice(0, 10); }

const BLANK: JobRequest = {
  id: "", clientId: "", client: "", eventName: "", venue: "", venueAddress: "", venueAddress2: "",
  venueZip: "", city: "", state: "", cityState: "",
  receivedDate: today(), requestDate: "", endDate: "",
  startTime: "", endTime: "", expectedHours: 10, addToCalendar: true,
  status: "lead", notes: "", attachmentNames: [], packetNotes: "",
};

type StatusFilter = "active" | "all" | "lead" | "quoted" | "booked" | "lost";
const ACTIVE_STATUSES = new Set(["lead", "quoted", "booked"]);

type Mode = "none" | "new" | "edit";

export default function JobRequests() {
  const [refreshKey, setRefreshKey] = useState(0);
  const rows = useMemo(() => loadJobRequests(), [refreshKey]);
  const [mode, setMode] = useState<Mode>("none");
  const [form, setForm] = useState<JobRequest>({ ...BLANK });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

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

  const activeClients = useMemo(() => clients.filter((c) => c.isActive), [clients]);

  function selectClient(clientId: string) {
    const c = clientById.get(clientId);
    setForm((f) => ({ ...f, clientId, client: c?.name ?? "" }));
  }

  function mapAddress(r: JobRequest): string {
    return [r.venueAddress, r.venueAddress2, r.city, r.state, r.venueZip].filter(Boolean).join(", ");
  }

  function normalized(next: JobRequest): JobRequest {
    return {
      ...next,
      cityState: [next.city, next.state].filter(Boolean).join(", "),
    };
  }

  function selectRow(r: JobRequest) {
    setMode("edit");
    setEditingId(r.id);
    setForm({ ...r });
    setMsg("");
    setDeleteMsg(null);
    setConfirmDeleteId(null);
  }

  function startNew() {
    setMode("new");
    setEditingId(null);
    setForm({ ...BLANK });
    setMsg("");
    setDeleteMsg(null);
    setConfirmDeleteId(null);
  }

  function clearForm() {
    setMode("none");
    setEditingId(null);
    setForm({ ...BLANK });
    setMsg("");
    setDeleteMsg(null);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    clearForm();
  }

  async function requestDelete() {
    if (!editingId) return;
    setDeleteMsg(null);
    const [qRes, ceRes, jcRes] = await Promise.all([
      supabase.from("quotes").select("id", { count: "exact", head: true }).eq("linked_job_request_id", editingId),
      supabase.from("calendar_events").select("id", { count: "exact", head: true }).eq("linked_job_request_id", editingId),
      supabase.from("job_costing_drafts").select("id", { count: "exact", head: true }).eq("linked_job_request_id", editingId),
    ]);
    const qCount = qRes.count ?? 0;
    const ceCount = ceRes.count ?? 0;
    const jcCount = jcRes.count ?? 0;
    const msgs: string[] = [];
    if (qCount > 0) msgs.push(`${qCount} quote${qCount !== 1 ? "s" : ""}`);
    if (ceCount > 0) msgs.push(`${ceCount} calendar event${ceCount !== 1 ? "s" : ""}`);
    if (jcCount > 0) msgs.push(`${jcCount} job costing draft${jcCount !== 1 ? "s" : ""}`);
    if (msgs.length > 0) {
      setDeleteMsg(`Cannot delete "${form.eventName || "(no event name)"}" — ${msgs.join(" and ")} reference this job request. Remove or unlink them first.`);
      return;
    }
    setConfirmDeleteId(editingId);
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    const err = await deleteJobRequest(confirmDeleteId);
    setConfirmDeleteId(null);
    if (err) { setDeleteMsg(err); return; }
    setDeleteMsg(null);
    clearForm();
    setRefreshKey((x) => x + 1);
  }

  function save() {
    if (!form.clientId) { setMsg("Please select a client before saving."); return; }
    const row = normalized({ ...form, id: form.id || `jobreq-${Date.now()}` });
    upsertJobRequest(row);
    setMsg("Saved.");
    setMode("edit");
    setEditingId(row.id);
    setForm(row);
    setRefreshKey((x) => x + 1);
  }

  function sendToGoogleCalendar() {
    openGoogleCal(form);
    setMsg("Opened Google Calendar template — click Save in Google to add the event.");
  }

  function saveAndBuildQuote() {
    if (!form.clientId) { setMsg("Please select a client before saving."); return; }
    const row = normalized({ ...form, id: form.id || `jobreq-${Date.now()}` });
    upsertJobRequest(row);
    setQuoteSeed({
      linkedJobRequestId: row.id,
      client: row.client,
      eventName: row.eventName,
      venue: row.venue,
      cityState: row.cityState,
      startDate: row.requestDate,
      endDate: row.endDate || row.requestDate,
      startTime: row.startTime,
      endTime: row.endTime,
      expectedHoursPerDay: row.expectedHours || 10,
    });
    window.location.href = "/quote-builder";
  }

  function openGoogleCal(row: JobRequest) {
    window.open(googleCalendarLink({
      id: row.id, source: "job_request", client: row.client, eventName: row.eventName,
      venue: row.venue, venueAddress: row.venueAddress, city: row.city, state: row.state,
      cityState: row.cityState,
      startDate: row.requestDate, endDate: row.endDate || row.requestDate,
      startTime: row.startTime, endTime: row.endTime, notes: row.notes, status: row.status,
    }), "_blank", "noopener,noreferrer");
  }

  // ── Filtering / sorting for left list ──
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
          (r.venue ?? "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        // Most recent / upcoming first by event start date.
        const da = a.requestDate || "";
        const db = b.requestDate || "";
        return db.localeCompare(da);
      });
  }, [rows, search, statusFilter, clientById]);

  // Once a request leaves Lead status, lock everything except Status itself.
  // Editing a quoted/booked/lost request would silently mutate downstream
  // artifacts (the quote built off it, the booked job's terms, etc.).
  const isLocked = mode === "edit" && form.status !== "lead";
  const statusLabel = JOB_REQUEST_STATUSES.find((s) => s.value === form.status)?.label ?? form.status;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", height: "100%" }}>
      {/* ── Left: list ── */}
      <div style={{ width: 300, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search event / client / venue…"
            style={{ flex: 1 }}
          />
          <button onClick={startNew} title="New job request" style={{ whiteSpace: "nowrap" }}>+ New</button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ width: "100%", fontSize: 12 }}
          >
            <option value="active">Active (Lead + Quoted + Booked)</option>
            <option value="all">All statuses</option>
            <option value="lead">Lead only</option>
            <option value="quoted">Quoted only</option>
            <option value="booked">Booked only</option>
            <option value="lost">Lost only</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
          {visibleRows.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: "8px 4px" }}>No matching job requests.</div>
          ) : (
            visibleRows.map((r) => {
              const c = clientById.get(r.clientId);
              const code = c?.code;
              const isSelected = editingId === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => selectRow(r)}
                  style={{
                    textAlign: "left",
                    background: isSelected ? "var(--accent, #2563eb)" : "transparent",
                    color: isSelected ? "#fff" : "inherit",
                    border: "1px solid " + (isSelected ? "var(--accent, #2563eb)" : "var(--border, #e5e7eb)"),
                    borderRadius: 6, padding: "8px 12px", cursor: "pointer", width: "100%",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontFamily: "monospace" }}>
                      {code ? `[${code}]` : (c?.name ?? r.client ?? "?").slice(0, 18)}
                    </span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>{r.requestDate || "no date"}</span>
                    <span style={{
                      marginLeft: "auto", fontSize: 10, textTransform: "uppercase", opacity: 0.7,
                      fontWeight: 500, letterSpacing: 0.4,
                    }}>{r.status}</span>
                  </div>
                  <div style={{
                    fontSize: 12, opacity: 0.85, marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }} title={r.eventName}>
                    {r.eventName || <span style={{ fontStyle: "italic", opacity: 0.7 }}>(no event name)</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 8 }}>
          <div className="muted" style={{ fontSize: 11 }}>
            {visibleRows.length} of {rows.length} job request{rows.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* ── Right: form or empty state ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {mode === "none" ? (
          <div className="card" style={{ textAlign: "center", padding: "60px 24px", color: "#888" }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>No job request selected.</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>
              Pick one from the list on the left to view or edit it, or start a new one.
            </div>
            <button onClick={startNew}>+ New Job Request</button>
          </div>
        ) : (
        <div className="card">
          <h2 className="section-title">{mode === "edit" ? "Edit Job Request" : "New Job Request"}</h2>

          {deleteMsg && (
            <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#a00", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {deleteMsg}
              <button className="secondary" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setDeleteMsg(null)}>✕</button>
            </div>
          )}

          {confirmDeleteId && (
            <div style={{ background: "#fff8e1", border: "1px solid #e0c840", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#7a5f00" }}>
              Delete <strong>{form.eventName || "(no event name)"}</strong>? This cannot be undone.
              <div className="action-row" style={{ marginTop: 8 }}>
                <button style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }} onClick={confirmDelete}>Delete</button>
                <button className="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              </div>
            </div>
          )}

          {isLocked && (
            <div style={{
              background: "#eef5ff", border: "1px solid #b6cdf0", borderRadius: 8,
              padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#1e3a8a",
            }}>
              🔒 This job request is <strong>{statusLabel}</strong>. Only the Status field can be changed —
              switch back to <strong>Lead</strong> to edit other fields.
            </div>
          )}

          <div className="grid4">
            <div>
              <small>Client *</small>
              <select value={form.clientId ?? ""} disabled={isLocked} onChange={(e) => selectClient(e.target.value)}>
                <option value="">— Select Client —</option>
                {activeClients.map((c) => <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ${c.name}` : c.name}</option>)}
                {/* If editing a record whose client has been deactivated, keep it visible. */}
                {form.clientId && !activeClients.some((c) => c.id === form.clientId) && clientById.get(form.clientId) && (
                  <option value={form.clientId}>{clientById.get(form.clientId)?.name} (inactive)</option>
                )}
              </select>
            </div>
            <div><small>Event Name</small><input disabled={isLocked} value={form.eventName} onChange={(e)=>setForm({ ...form, eventName:e.target.value })} /></div>
            <div><small>Venue</small><input disabled={isLocked} value={form.venue} onChange={(e)=>setForm({ ...form, venue:e.target.value })} /></div>
            <div><small>Street Address</small><input disabled={isLocked} value={form.venueAddress} onChange={(e)=>setForm({ ...form, venueAddress:e.target.value })} placeholder="e.g. 123 Main St" /></div>
            <div><small>Suite / Unit</small><input disabled={isLocked} value={form.venueAddress2 ?? ""} onChange={(e)=>setForm({ ...form, venueAddress2:e.target.value })} placeholder="optional" /></div>
            <div><small>City</small><input disabled={isLocked} value={form.city} onChange={(e)=>setForm({ ...form, city:e.target.value })} /></div>
            <div><small>State</small>
              <select disabled={isLocked} value={form.state} onChange={(e)=>setForm({ ...form, state:e.target.value })}>
                <option value="">— Select —</option>
                {US_STATES.map((s)=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><small>Venue Zip</small><input disabled={isLocked} value={form.venueZip ?? ""} onChange={(e)=>setForm({ ...form, venueZip:e.target.value })} placeholder="00000" /></div>
            <div><small>Status</small>
              <select value={form.status} onChange={(e)=>setForm({ ...form, status:e.target.value })}>
                {JOB_REQUEST_STATUSES.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div><small>Request Date</small><input type="date" disabled={isLocked} value={form.receivedDate} onChange={(e)=>setForm({ ...form, receivedDate:e.target.value })} /></div>
            <div><small>Event Start Date</small><input type="date" disabled={isLocked} value={form.requestDate} onChange={(e)=>setForm({ ...form, requestDate:e.target.value })} /></div>
            <div><small>Event End Date</small><input type="date" disabled={isLocked} value={form.endDate || ""} onChange={(e)=>setForm({ ...form, endDate:e.target.value })} /></div>
            <div><small>Start Time</small>
              <select disabled={isLocked} value={form.startTime} onChange={(e)=>setForm({ ...form, startTime:e.target.value })}>
                {TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}
              </select>
            </div>
            <div><small>End Time</small>
              <select disabled={isLocked} value={form.endTime} onChange={(e)=>setForm({ ...form, endTime:e.target.value })}>
                {TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}
              </select>
            </div>
            <div><small>Expected Hours / Day</small><input type="number" disabled={isLocked} value={form.expectedHours || 10} onChange={(e)=>setForm({ ...form, expectedHours:Number(e.target.value || 0) })} /></div>
            <div><small>Show in app calendar</small>
              <select disabled={isLocked} value={String(form.addToCalendar)} onChange={(e)=>setForm({ ...form, addToCalendar:e.target.value === "true" })}>
                <option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
          </div>

          {mapAddress(form) && (
            <div style={{ marginTop: 12 }}>
              <small>Venue Map</small>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(mapAddress(form))}`}
                target="_blank"
                rel="noreferrer"
                title="Open in Maps"
                style={{ display: "block", marginTop: 4, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border, #e5e7eb)" }}
              >
                <iframe
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(mapAddress(form))}&output=embed`}
                  width="100%"
                  height="220"
                  style={{ border: 0, display: "block", pointerEvents: "none" }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </a>
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Tap to open in your maps app</div>
            </div>
          )}

          <div style={{ marginTop: 12 }}><small>Notes</small><textarea disabled={isLocked} value={form.notes} onChange={(e)=>setForm({ ...form, notes:e.target.value })} /></div>

          <div className="action-row" style={{ marginTop: 12 }}>
            <button onClick={save}>Save</button>
            {!editingId && <button className="secondary" onClick={saveAndBuildQuote}>Save + Build Quote</button>}
            {editingId && form.linkedQuoteId && (
              <button className="secondary" onClick={() => { setActiveQuote(form.linkedQuoteId!); window.location.href = "/quote-builder"; }}>
                View Quote
              </button>
            )}
            {editingId && !form.linkedQuoteId && !isLocked && (
              <button className="secondary" onClick={saveAndBuildQuote}>Build Quote</button>
            )}
            {editingId && form.addToCalendar && (
              <button
                onClick={sendToGoogleCalendar}
                title="Open a Google Calendar template prefilled with this event"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  background: "#fff", color: "#3c4043",
                  border: "1px solid #dadce0", borderRadius: 6,
                  padding: "6px 14px", fontWeight: 500, fontSize: 13,
                  boxShadow: "0 1px 2px rgba(60,64,67,0.1)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" fill="#fff" stroke="#dadce0" strokeWidth="1.2" />
                  <rect x="3" y="5" width="18" height="4" rx="2" fill="#4285f4" />
                  <rect x="6"  y="11" width="3" height="3" fill="#ea4335" />
                  <rect x="10.5" y="11" width="3" height="3" fill="#fbbc04" />
                  <rect x="15" y="11" width="3" height="3" fill="#34a853" />
                  <rect x="6"  y="15.5" width="3" height="3" fill="#34a853" />
                  <rect x="10.5" y="15.5" width="3" height="3" fill="#4285f4" />
                  <rect x="15" y="15.5" width="3" height="3" fill="#ea4335" />
                </svg>
                Add to Google Calendar
              </button>
            )}
            <button className="secondary" onClick={cancelEdit}>{editingId ? "Cancel" : "Clear"}</button>
            {editingId && (
              <button className="secondary" style={{ color: "#c00", marginLeft: "auto" }} onClick={requestDelete}>
                Delete
              </button>
            )}
          </div>
          {msg ? <div className="badge" style={{ marginTop: 12 }}>{msg}</div> : null}
        </div>
        )}
      </div>
    </div>
  );
}

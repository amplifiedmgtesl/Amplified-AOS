
"use client";

import { useEffect, useMemo, useState } from "react";
import { setQuoteSeed, upsertJobRequest, deleteJobRequest, setActiveQuote } from "@/lib/store/app-store";
import { googleCalendarLink } from "@/lib/store/calendar";
import { loadJobRequests } from "@/lib/store/app-store";
import { timeOptions } from "@/lib/store/timekeeping";
import { supabase } from "@/lib/supabase/client";
import { US_STATES, JOB_REQUEST_STATUSES } from "@/lib/constants";
import type { JobRequest } from "@/lib/store/types";
import type { Client } from "@/lib/store/types";

const TIMES = timeOptions();

const BLANK: JobRequest = {
  id: "", clientId: "", client: "", eventName: "", venue: "", venueAddress: "",
  city: "", state: "", cityState: "", googleMapsLink: "", requestDate: "", endDate: "",
  startTime: "", endTime: "", expectedHours: 10, addToCalendar: true,
  status: "lead", notes: "", attachmentNames: [], packetNotes: "",
};

export default function JobRequests() {
  const [refreshKey, setRefreshKey] = useState(0);
  const rows = useMemo(() => loadJobRequests(), [refreshKey]);
  const [form, setForm] = useState<JobRequest>({ ...BLANK });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [syncToGoogleOnSave, setSyncToGoogleOnSave] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("clients").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setClients((data ?? []).map((r: any) => ({ id: r.id, name: r.name, isActive: true }))));
  }, []);

  function selectClient(clientId: string) {
    const c = clients.find((c) => c.id === clientId);
    setForm((f) => ({ ...f, clientId, client: c?.name ?? "" }));
  }

  function normalized(next: JobRequest): JobRequest {
    return { ...next, cityState: [next.city, next.state].filter(Boolean).join(", ") };
  }

  function editRow(r: JobRequest) {
    setEditingId(r.id);
    setForm({ ...r });
    setMsg("");
    setDeleteMsg(null);
    setConfirmDeleteId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...BLANK });
    setMsg("");
  }

  async function requestDelete(r: JobRequest) {
    setDeleteMsg(null);
    if (r.linkedQuoteId) {
      setDeleteMsg(`Cannot delete "${r.eventName}" — a quote has been built from this job request.`);
      return;
    }
    setConfirmDeleteId(r.id);
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    const err = await deleteJobRequest(confirmDeleteId);
    setConfirmDeleteId(null);
    if (err) { setDeleteMsg(err); return; }
    setDeleteMsg(null);
    setRefreshKey((x) => x + 1);
  }

  function save() {
    if (!form.clientId) { setMsg("Please select a client before saving."); return; }
    const row = normalized({ ...form, id: form.id || `jobreq-${Date.now()}` });
    upsertJobRequest(row);
    if (row.addToCalendar && syncToGoogleOnSave) openGoogleCal(row);
    setMsg(row.addToCalendar ? "Job request saved and sent to calendar workflow." : "Job request saved.");
    setEditingId(null);
    setForm({ ...BLANK });
    setRefreshKey((x) => x + 1);
  }

  function saveAndBuildQuote() {
    if (!form.clientId) { setMsg("Please select a client before saving."); return; }
    const row = normalized({ ...form, id: form.id || `jobreq-${Date.now()}` });
    upsertJobRequest(row);
    if (row.addToCalendar && syncToGoogleOnSave) openGoogleCal(row);
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
      cityState: row.cityState, googleMapsLink: row.googleMapsLink,
      startDate: row.requestDate, endDate: row.endDate || row.requestDate,
      startTime: row.startTime, endTime: row.endTime, notes: row.notes, status: row.status,
    }), "_blank", "noopener,noreferrer");
  }

  function buildQuoteFromRow(r: JobRequest) {
    setQuoteSeed({
      linkedJobRequestId: r.id, client: r.client, eventName: r.eventName,
      venue: r.venue, cityState: r.cityState, startDate: r.requestDate,
      endDate: r.endDate || r.requestDate, startTime: r.startTime, endTime: r.endTime,
      expectedHoursPerDay: r.expectedHours || 10,
    });
    window.location.href = "/quote-builder";
  }

  return (
    <div className="grid">
      <div className="card">
        <h2 className="section-title">{editingId ? "Edit Job Request" : "New Job Request"}</h2>
        <div className="grid4">
          <div>
            <small>Client *</small>
            <select value={form.clientId ?? ""} onChange={(e) => selectClient(e.target.value)}>
              <option value="">— Select Client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><small>Event Name</small><input value={form.eventName} onChange={(e)=>setForm({ ...form, eventName:e.target.value })} /></div>
          <div><small>Venue</small><input value={form.venue} onChange={(e)=>setForm({ ...form, venue:e.target.value })} /></div>
          <div><small>Venue Address</small><input value={form.venueAddress} onChange={(e)=>setForm({ ...form, venueAddress:e.target.value })} /></div>
          <div><small>City</small><input value={form.city} onChange={(e)=>setForm({ ...form, city:e.target.value })} /></div>
          <div><small>State</small>
            <select value={form.state} onChange={(e)=>setForm({ ...form, state:e.target.value })}>
              <option value="">— Select —</option>
              {US_STATES.map((s)=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><small>Google Maps Link</small><input value={form.googleMapsLink} onChange={(e)=>setForm({ ...form, googleMapsLink:e.target.value })} /></div>
          <div><small>Status</small>
            <select value={form.status} onChange={(e)=>setForm({ ...form, status:e.target.value })}>
              {JOB_REQUEST_STATUSES.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div><small>Start Date</small><input type="date" value={form.requestDate} onChange={(e)=>setForm({ ...form, requestDate:e.target.value })} /></div>
          <div><small>End Date</small><input type="date" value={form.endDate || ""} onChange={(e)=>setForm({ ...form, endDate:e.target.value })} /></div>
          <div><small>Start Time</small>
            <select value={form.startTime} onChange={(e)=>setForm({ ...form, startTime:e.target.value })}>
              {TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}
            </select>
          </div>
          <div><small>End Time</small>
            <select value={form.endTime} onChange={(e)=>setForm({ ...form, endTime:e.target.value })}>
              {TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}
            </select>
          </div>
          <div><small>Expected Hours / Day</small><input type="number" value={form.expectedHours || 10} onChange={(e)=>setForm({ ...form, expectedHours:Number(e.target.value || 0) })} /></div>
          <div><small>Add to Calendar</small>
            <select value={String(form.addToCalendar)} onChange={(e)=>setForm({ ...form, addToCalendar:e.target.value === "true" })}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </div>
          <div><small>Add to Google Calendar on Save</small>
            <select value={String(syncToGoogleOnSave)} onChange={(e)=>setSyncToGoogleOnSave(e.target.value === "true")}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}><small>Notes</small><textarea value={form.notes} onChange={(e)=>setForm({ ...form, notes:e.target.value })} /></div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button onClick={save}>Save Job Request</button>
          {!editingId && <button className="secondary" onClick={saveAndBuildQuote}>Save + Build Quote</button>}
          {editingId && <button className="secondary" onClick={cancelEdit}>Cancel</button>}
          {form.googleMapsLink ? <a className="badge" href={form.googleMapsLink} target="_blank" rel="noreferrer">Open Map Link</a> : null}
        </div>
        {msg ? <div className="badge" style={{ marginTop: 12 }}>{msg}</div> : null}
      </div>

      <div className="card">
        <h2 className="section-title">Saved Job Requests</h2>

        {deleteMsg && (
          <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#a00", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {deleteMsg}
            <button className="secondary" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setDeleteMsg(null)}>✕</button>
          </div>
        )}

        {confirmDeleteId && (
          <div style={{ background: "#fff8e1", border: "1px solid #e0c840", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#7a5f00" }}>
            Delete <strong>{rows.find((r) => r.id === confirmDeleteId)?.eventName}</strong>? This cannot be undone.
            <div className="action-row" style={{ marginTop: 8 }}>
              <button style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }} onClick={confirmDelete}>Delete</button>
              <button className="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="muted">No job requests yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Client</th><th>Event</th><th>Venue</th><th>Dates</th>
                  <th>Times</th><th>Exp Hrs</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ background: editingId === r.id ? "var(--surface2, #f0f4ff)" : undefined }}>
                    <td>{r.client}</td>
                    <td>{r.eventName}</td>
                    <td>{r.venue}</td>
                    <td>{r.requestDate}{r.endDate ? ` to ${r.endDate}` : ""}</td>
                    <td>{r.startTime}{r.endTime ? ` to ${r.endTime}` : ""}</td>
                    <td>{r.expectedHours || "-"}</td>
                    <td>{JOB_REQUEST_STATUSES.find((s)=>s.value===r.status)?.label ?? r.status}</td>
                    <td>
                      <div className="action-row">
                        <button className="secondary" onClick={() => editRow(r)}>Edit</button>
                        {r.linkedQuoteId ? (
                          <button className="secondary" onClick={() => { setActiveQuote(r.linkedQuoteId!); window.location.href = "/quote-builder"; }}>View Quote</button>
                        ) : (
                          <button className="secondary" onClick={() => buildQuoteFromRow(r)}>Build Quote</button>
                        )}
                        <button className="secondary" style={{ color: "#c00" }} onClick={() => requestDelete(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

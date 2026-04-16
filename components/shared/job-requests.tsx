
"use client";

import { useMemo, useState } from "react";
import { setQuoteSeed, upsertJobRequest } from "@/lib/store/app-store";
import { googleCalendarLink } from "@/lib/store/calendar";
import { loadJobRequests } from "@/lib/store/app-store";
import { timeOptions } from "@/lib/store/timekeeping";
import { US_STATES, JOB_REQUEST_STATUSES } from "@/lib/constants";
import type { JobRequest } from "@/lib/store/types";

const TIMES = timeOptions();

export default function JobRequests() {
  const [refreshKey, setRefreshKey] = useState(0);
  const rows = useMemo(() => loadJobRequests(), [refreshKey]);
  const [form, setForm] = useState<JobRequest>({
    id: "",
    client: "",
    eventName: "",
    venue: "",
    venueAddress: "",
    city: "",
    state: "",
    cityState: "",
    googleMapsLink: "",
    requestDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    expectedHours: 10,
    addToCalendar: true,
    status: "lead",
    notes: "",
    attachmentNames: [],
    packetNotes: ""
  });
  const [msg, setMsg] = useState("");
  const [syncToGoogleOnSave, setSyncToGoogleOnSave] = useState(true);

  function normalized(next: JobRequest): JobRequest {
    return { ...next, cityState: [next.city, next.state].filter(Boolean).join(", ") };
  }

  function save() {
    const row = normalized({ ...form, id: form.id || `jobreq-${Date.now()}` });
    upsertJobRequest(row);
    if (row.addToCalendar && syncToGoogleOnSave) {
      window.open(googleCalendarLink({
        id: row.id,
        source: "job_request",
        client: row.client,
        eventName: row.eventName,
        venue: row.venue,
        venueAddress: row.venueAddress,
        city: row.city,
        state: row.state,
        cityState: row.cityState,
        googleMapsLink: row.googleMapsLink,
        startDate: row.requestDate,
        endDate: row.endDate || row.requestDate,
        startTime: row.startTime,
        endTime: row.endTime,
        notes: row.notes,
        status: row.status,
      }), "_blank", "noopener,noreferrer");
    }
    setMsg(row.addToCalendar ? "Job request saved and sent to calendar workflow." : "Job request saved.");
    setForm({
      id: "",
      client: "",
      eventName: "",
      venue: "",
      venueAddress: "",
      city: "",
      state: "",
      cityState: "",
      googleMapsLink: "",
      requestDate: "",
      endDate: "",
      startTime: "",
      endTime: "",
      expectedHours: 10,
      addToCalendar: true,
      status: "lead",
      notes: "",
      attachmentNames: [],
      packetNotes: ""
    });
    setRefreshKey((x) => x + 1);
  }

  function saveAndBuildQuote() {
    const row = normalized({ ...form, id: form.id || `jobreq-${Date.now()}` });
    upsertJobRequest(row);
    if (row.addToCalendar && syncToGoogleOnSave) {
      window.open(googleCalendarLink({
        id: row.id,
        source: "job_request",
        client: row.client,
        eventName: row.eventName,
        venue: row.venue,
        venueAddress: row.venueAddress,
        city: row.city,
        state: row.state,
        cityState: row.cityState,
        googleMapsLink: row.googleMapsLink,
        startDate: row.requestDate,
        endDate: row.endDate || row.requestDate,
        startTime: row.startTime,
        endTime: row.endTime,
        notes: row.notes,
        status: row.status,
      }), "_blank", "noopener,noreferrer");
    }
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

  return (
    <div className="grid">
      <div className="card">
        <h2 className="section-title">New Job Request</h2>
        <div className="grid4">
          <div><small>Client</small><input value={form.client} onChange={(e)=>setForm({ ...form, client:e.target.value })} /></div>
          <div><small>Event Name</small><input value={form.eventName} onChange={(e)=>setForm({ ...form, eventName:e.target.value })} /></div>
          <div><small>Venue</small><input value={form.venue} onChange={(e)=>setForm({ ...form, venue:e.target.value })} /></div>
          <div><small>Venue Address</small><input value={form.venueAddress} onChange={(e)=>setForm({ ...form, venueAddress:e.target.value })} /></div>
          <div><small>City</small><input value={form.city} onChange={(e)=>setForm({ ...form, city:e.target.value })} /></div>
          <div><small>State</small><select value={form.state} onChange={(e)=>setForm({ ...form, state:e.target.value })}><option value="">— Select —</option>{US_STATES.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>Google Maps Link</small><input value={form.googleMapsLink} onChange={(e)=>setForm({ ...form, googleMapsLink:e.target.value })} /></div>
          <div><small>Status</small><select value={form.status} onChange={(e)=>setForm({ ...form, status:e.target.value })}>{JOB_REQUEST_STATUSES.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
          <div><small>Start Date</small><input type="date" value={form.requestDate} onChange={(e)=>setForm({ ...form, requestDate:e.target.value })} /></div>
          <div><small>End Date</small><input type="date" value={form.endDate || ""} onChange={(e)=>setForm({ ...form, endDate:e.target.value })} /></div>
          <div><small>Start Time</small><select value={form.startTime} onChange={(e)=>setForm({ ...form, startTime:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
          <div><small>End Time</small><select value={form.endTime} onChange={(e)=>setForm({ ...form, endTime:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
          <div><small>Expected Hours / Day</small><input type="number" value={form.expectedHours || 10} onChange={(e)=>setForm({ ...form, expectedHours:Number(e.target.value || 0) })} /></div>
          <div><small>Add to Calendar</small><select value={String(form.addToCalendar)} onChange={(e)=>setForm({ ...form, addToCalendar:e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></div>
          <div><small>Add to Google Calendar on Save</small><select value={String(syncToGoogleOnSave)} onChange={(e)=>setSyncToGoogleOnSave(e.target.value === "true")}><option value="true">Yes</option><option value="false">No</option></select></div>
        </div>
        <div style={{ marginTop: 12 }}><small>Notes</small><textarea value={form.notes} onChange={(e)=>setForm({ ...form, notes:e.target.value })} /></div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button onClick={save}>Save Job Request</button>
          <button className="secondary" onClick={saveAndBuildQuote}>Save + Build Quote</button>
          {form.googleMapsLink ? <a className="badge" href={form.googleMapsLink} target="_blank" rel="noreferrer">Open Map Link</a> : null}
        </div>
        {msg ? <div className="badge" style={{ marginTop: 12 }}>{msg}</div> : null}
      </div>

      <div className="card">
        <h2 className="section-title">Saved Job Requests</h2>
        {rows.length === 0 ? (
          <div className="muted">No job requests yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Client</th><th>Event</th><th>Venue</th><th>Dates</th><th>Times</th><th>Expected Hrs</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.client}</td>
                    <td>{r.eventName}</td>
                    <td>{r.venue}</td>
                    <td>{r.requestDate}{r.endDate ? ` to ${r.endDate}` : ""}</td>
                    <td>{r.startTime} {r.endTime ? `to ${r.endTime}` : ""}</td>
                    <td>{r.expectedHours || "-"}</td>
                    <td>{JOB_REQUEST_STATUSES.find((s)=>s.value===r.status)?.label ?? r.status}</td>
                    <td><button className="secondary" onClick={() => { setQuoteSeed({ linkedJobRequestId: r.id, client: r.client, eventName: r.eventName, venue: r.venue, cityState: r.cityState, startDate: r.requestDate, endDate: r.endDate || r.requestDate, startTime: r.startTime, endTime: r.endTime, expectedHoursPerDay: r.expectedHours || 10 }); window.location.href="/quote-builder"; }}>Build Quote</button></td>
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

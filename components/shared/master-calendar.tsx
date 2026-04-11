
"use client";

import { useMemo, useState } from "react";
import { combinedCalendarEvents, googleCalendarLink, parseHour } from "@/lib/store/calendar";
import { deleteEventById, loadEventProfiles, loadJobSheets, saveEventProfile, setActiveJobSheet, setQuoteSeed, upsertJobSheet, upsertManualEvent } from "@/lib/store/app-store";
import type { CalendarEvent, JobSheet } from "@/lib/store/types";

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function pad(n: number) { return String(n).padStart(2, "0"); }
function toDateKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthMatrix(current: Date) {
  const first = new Date(current.getFullYear(), current.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }).map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}


function formatIcsDate(date: string, time?: string) {
  const d = (date || "").replaceAll("-", "");
  const raw = (time || "08:00").trim().toUpperCase();
  const m = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  let hour = 8;
  let minute = 0;
  if (m) {
    hour = Number(m[1]);
    minute = Number(m[2]);
    const mer = m[3];
    if (mer === "AM" && hour === 12) hour = 0;
    if (mer === "PM" && hour !== 12) hour += 12;
  } else {
    const parts = raw.split(":").map(Number);
    if (!Number.isNaN(parts[0])) hour = parts[0];
    if (!Number.isNaN(parts[1])) minute = parts[1];
  }
  return `${d}T${String(hour).padStart(2,"0")}${String(minute).padStart(2,"0")}00`;
}

function escapeIcsText(value?: string) {
  return (value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function downloadVisibleEventsIcs(events: CalendarEvent[]) {
  if (!events.length) return;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,"0")}${String(now.getUTCDate()).padStart(2,"0")}T${String(now.getUTCHours()).padStart(2,"0")}${String(now.getUTCMinutes()).padStart(2,"0")}${String(now.getUTCSeconds()).padStart(2,"0")}Z`;

  const body = events.map((e, idx) => {
    const uid = `${e.id || idx}@amplified-operations-suite`;
    const dtStart = formatIcsDate(e.startDate, e.startTime);
    const dtEnd = formatIcsDate(e.endDate || e.startDate, e.endTime || e.startTime || "09:00");
    const summary = escapeIcsText(`${e.client || "Client"} - ${e.eventName || "Event"}`);
    const description = escapeIcsText([e.notes || "", e.venue || "", e.cityState || ""].filter(Boolean).join("\n"));
    const location = escapeIcsText([e.venue || "", e.cityState || ""].filter(Boolean).join(", "));
    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location}`,
      "END:VEVENT",
    ].join("\r\n");
  }).join("\r\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Amplified Event Solutions//Operations Suite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    body,
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datePart = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `amplified-visible-events-${datePart}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function HoverCard({ e, onOpen, onDelete }: { e: CalendarEvent; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="hover-card" style={{ display: "block" }} onClick={(evt) => evt.stopPropagation()}>
      <strong>{e.client || "Client"} — {e.eventName || "Event"}</strong>
      <div className="muted" style={{ marginTop: 6 }}>{e.venue || "-"}</div>
      <div className="muted">{e.venueAddress || "-"}</div>
      <div className="muted">{e.cityState || "-"}</div>
      <div className="muted">{e.startDate} {e.startTime ? `· ${e.startTime}` : ""} {e.endTime ? `to ${e.endTime}` : ""}</div>
      {e.googleMapsLink ? <div className="muted" style={{ marginTop: 6, wordBreak: "break-all" }}>{e.googleMapsLink}</div> : null}
      <div className="action-row" style={{ marginTop: 10 }}>
        <button className="secondary" onClick={onOpen}>Open Job Profile</button>
        <a className="badge" href={googleCalendarLink(e)} target="_blank" rel="noreferrer">Add to Google Calendar</a>
        <button className="secondary" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

export default function MasterCalendar() {
  const [mode, setMode] = useState<"month" | "day">("month");
  const [current, setCurrent] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(toDateKey(new Date()));
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoveredEventId, setHoveredEventId] = useState("");
  const events = useMemo(() => combinedCalendarEvents(), [refreshKey]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;
  const profiles = loadEventProfiles();
  const allSheets = loadJobSheets();

  const unique = {
    clients: Array.from(new Set(events.map((e) => e.client).filter(Boolean))).sort(),
    eventNames: Array.from(new Set(events.map((e) => e.eventName).filter(Boolean))).sort(),
    venues: Array.from(new Set(events.map((e) => e.venue).filter(Boolean))).sort(),
    venueAddresses: Array.from(new Set(events.map((e) => e.venueAddress || "").filter(Boolean))).sort(),
    cities: Array.from(new Set(events.map((e) => e.city || "").filter(Boolean))).sort(),
    states: Array.from(new Set(events.map((e) => e.state || "").filter(Boolean))).sort(),
    maps: Array.from(new Set(events.map((e) => e.googleMapsLink || "").filter(Boolean))).sort()
  };

  const [manual, setManual] = useState({
    client: "",
    eventName: "",
    venue: "",
    venueAddress: "",
    city: "",
    state: "",
    googleMapsLink: "",
    startDate: selectedDate,
    endDate: selectedDate,
    startTime: "08:00",
    endTime: "17:00",
    notes: "",
  });
  const [profileNotesDraft, setProfileNotesDraft] = useState("");

  const monthDays = monthMatrix(current);
  const monthEventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    events.forEach((e) => {
      const key = e.startDate || "";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    });
    return m;
  }, [events]);

  const dayEvents = useMemo(() => events.filter((e) => (e.startDate || "") === selectedDate), [events, selectedDate]);

  function addEvent(buildQuote: boolean) {
    const row: CalendarEvent = {
      id: `manual-${Date.now()}`,
      source: "manual_calendar",
      client: manual.client,
      eventName: manual.eventName,
      venue: manual.venue,
      venueAddress: manual.venueAddress,
      city: manual.city,
      state: manual.state,
      cityState: [manual.city, manual.state].filter(Boolean).join(", "),
      googleMapsLink: manual.googleMapsLink,
      startDate: manual.startDate,
      endDate: manual.endDate,
      startTime: manual.startTime,
      endTime: manual.endTime,
      notes: manual.notes,
      status: "potential",
    };
    upsertManualEvent(row);
    if (buildQuote) {
      setQuoteSeed({
        client: row.client, eventName: row.eventName, venue: row.venue, cityState: row.cityState,
        startDate: row.startDate, endDate: row.endDate, startTime: row.startTime, endTime: row.endTime,
      });
      window.location.href = "/quote-builder";
      return;
    }
    setRefreshKey((x) => x + 1);
  }

  function openJobProfile(event: CalendarEvent) {
    setSelectedEventId(event.id);
    setProfileNotesDraft(profiles[event.id]?.notes || event.notes || "");
  }

  function openOrCreateJobSheetForEvent(event: CalendarEvent) {
    const existing = allSheets.find((s) => s.sourceEventId === event.id);
    if (existing) { setActiveJobSheet(existing.id); window.location.href = "/job-sheets"; return; }
    const row: JobSheet = {
      id: `jobsheet-${Date.now()}`,
      sourceEventId: event.id,
      title: `${event.client} - ${event.eventName}`,
      client: event.client,
      eventName: event.eventName,
      venue: event.venue,
      venueAddress: event.venueAddress || "",
      city: event.city || "",
      state: event.state || "",
      cityState: event.cityState,
      googleMapsLink: event.googleMapsLink || "",
      date: event.startDate,
      callTime: event.startTime || "08:00",
      notes: event.notes || "",
      attachmentNames: [],
      workers: []
    };
    upsertJobSheet(row);
    setActiveJobSheet(row.id);
    window.location.href = "/job-sheets";
  }

  function saveSelectedProfile(files: FileList | null) {
    if (!selectedEvent) return;
    const prior = profiles[selectedEvent.id]?.attachmentNames || [];
    const names = files ? [...prior, ...Array.from(files).map((f) => f.name)] : prior;
    saveEventProfile(selectedEvent.id, { notes: profileNotesDraft, attachmentNames: names });
    setRefreshKey((x) => x + 1);
  }

  function handleDelete(eventId: string) {
    deleteEventById(eventId);
    if (selectedEventId === eventId) setSelectedEventId("");
    if (hoveredEventId === eventId) setHoveredEventId("");
    setRefreshKey((x) => x + 1);
  }

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">Calendar Controls</h2>
        <div className="action-row">
          <button className={mode === "month" ? "" : "secondary"} onClick={() => setMode("month")}>Month</button>
          <button className={mode === "day" ? "" : "secondary"} onClick={() => setMode("day")}>Day</button>
          <button className="secondary" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1))}>Prev</button>
          <button className="secondary" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1))}>Next</button>
          <input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setManual((m) => ({ ...m, startDate: e.target.value, endDate: e.target.value })); }} style={{ width: 180 }} />
          <span className="badge">Visible events: {events.length}</span>
        </div>
      </div>

<div className="card hide-print">
  <h2 className="section-title">Google Calendar Sync</h2>
  <div className="action-row">
    <button className="secondary" onClick={() => events.forEach((e) => window.open(googleCalendarLink(e), "_blank", "noopener,noreferrer"))}>
      Add All Visible Events to Google Calendar
    </button>
    <span className="muted">This calendar only shows saved job requests and quoted/booked events.</span>
  </div>
</div>

{mode === "month" ? (
        <div className="calendar-shell calendar-shell-open">
          <div className="calendar-toolbar">
            <strong>{current.toLocaleString("en-US", { month:"long", year:"numeric" })}</strong>
            <div className="muted">Hover any event for details. Click any event to open the job profile popup.</div>
          </div>
          <div className="month-grid">
            {dayNames.map((n) => <div key={n} className="day-name">{n}</div>)}
            {monthDays.map((d, idx) => {
              const key = toDateKey(d);
              const items = monthEventsByDay.get(key) || [];
              const outside = d.getMonth() !== current.getMonth();
              return (
                <div key={idx} className={`month-cell ${outside ? "outside" : ""}`} onClick={() => { setSelectedDate(key); setManual((m)=>({ ...m, startDate:key, endDate:key })); setMode("day"); }}>
                  <div className="cell-date">{d.getDate()}</div>
                  {items.slice(0, 4).map((e) => (
                    <div
                      key={e.id}
                      className="event-pill"
                      onMouseEnter={(evt) => { evt.stopPropagation(); setHoveredEventId(e.id); }}
                      onMouseLeave={(evt) => { evt.stopPropagation(); setHoveredEventId((cur) => cur === e.id ? "" : cur); }}
                      onClick={(evt) => { evt.stopPropagation(); openJobProfile(e); }}
                      style={{ position: "relative" }}
                    >
                      {e.client || "Client"} — {e.eventName || "Event"}
                      {hoveredEventId === e.id ? <HoverCard e={e} onOpen={() => openJobProfile(e)} onDelete={() => handleDelete(e.id)} /> : null}
                    </div>
                  ))}
                  {items.length > 4 ? <div className="muted">+{items.length - 4} more</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="calendar-shell calendar-shell-open">
          <div className="calendar-toolbar">
            <strong>{selectedDate}</strong>
            <div className="muted">{dayEvents.length} events</div>
          </div>
          <div className="time-grid">
            <div className="time-labels">
              {Array.from({ length: 24 }).map((_, h) => <div key={h} className="time-label">{`${pad(h)}:00`}</div>)}
            </div>
            <div className="day-columns">
              <div className="day-lane">
                {dayEvents.map((e) => {
                  const sh = parseHour(e.startTime || "08:00");
                  const eh = Math.max(sh + 1, parseHour(e.endTime || ""));
                  const top = sh * 64 + 4;
                  const height = Math.max(56, (eh - sh) * 64 - 8);
                  return (
                    <div
                      key={e.id}
                      className="event-block"
                      style={{ top, height, position: "absolute" }}
                      onMouseEnter={() => setHoveredEventId(e.id)}
                      onMouseLeave={() => setHoveredEventId((cur) => cur === e.id ? "" : cur)}
                      onClick={() => openJobProfile(e)}
                    >
                      <div><strong>{e.client || "Client"}</strong> — {e.eventName || "Event"}</div>
                      <div className="tiny">{e.venue || ""} {e.cityState ? `— ${e.cityState}` : ""}</div>
                      <div className="tiny">{e.startTime || ""} {e.endTime ? `to ${e.endTime}` : ""}</div>
                      {hoveredEventId === e.id ? <HoverCard e={e} onOpen={() => openJobProfile(e)} onDelete={() => handleDelete(e.id)} /> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedEvent ? (
        <div className="modal-backdrop hide-print" onClick={() => setSelectedEventId("")}>
          <div className="modal-panel" onClick={(evt) => evt.stopPropagation()}>
            <div className="action-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <h2 className="section-title" style={{ margin: 0 }}>Job Profile</h2>
              <button className="secondary" onClick={() => setSelectedEventId("")}>Close</button>
            </div>

            <div className="grid3">
              <div className="list-card"><strong>Client</strong><div className="muted">{selectedEvent.client || "-"}</div></div>
              <div className="list-card"><strong>Event</strong><div className="muted">{selectedEvent.eventName || "-"}</div></div>
              <div className="list-card"><strong>Venue</strong><div className="muted">{selectedEvent.venue || "-"}</div></div>
            </div>

            <div className="grid3" style={{ marginTop: 12 }}>
              <div className="list-card"><strong>Venue Address</strong><div className="muted">{selectedEvent.venueAddress || "-"}</div></div>
              <div className="list-card"><strong>City / State</strong><div className="muted">{selectedEvent.cityState || "-"}</div></div>
              <div className="list-card"><strong>Time</strong><div className="muted">{selectedEvent.startDate} {selectedEvent.startTime ? `· ${selectedEvent.startTime}` : ""} {selectedEvent.endTime ? `to ${selectedEvent.endTime}` : ""}</div></div>
            </div>

            <div style={{ marginTop: 16 }}>
              <small>Job Notes</small>
              <textarea value={profileNotesDraft} onChange={(e) => setProfileNotesDraft(e.target.value)} />
            </div>

            <div style={{ marginTop: 12 }}>
              <small>Drawings / Files</small>
              <input type="file" multiple onChange={(e) => saveSelectedProfile(e.target.files)} />
              <div className="muted" style={{ marginTop: 8 }}>{(profiles[selectedEvent.id]?.attachmentNames || []).join(", ") || "No files attached yet."}</div>
            </div>

            <div className="action-row" style={{ marginTop: 16 }}>
              <button onClick={() => saveSelectedProfile(null)}>Save Job Profile</button>
              {selectedEvent.googleMapsLink ? <a className="badge" href={selectedEvent.googleMapsLink} target="_blank" rel="noreferrer">Open Google Maps</a> : null}
              <a className="badge" href={googleCalendarLink(selectedEvent)} target="_blank" rel="noreferrer">Add to Google Calendar</a>
              <button className="secondary" onClick={() => openOrCreateJobSheetForEvent(selectedEvent)}>
                {allSheets.find((s) => s.sourceEventId === selectedEvent.id) ? "Open Associated Job Sheet" : "Create Associated Job Sheet"}
              </button>
              <button className="secondary" onClick={() => handleDelete(selectedEvent.id)}>Delete Event</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

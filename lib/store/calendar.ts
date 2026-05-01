import { loadDeletedEventIds, loadJobRequests, loadManualEvents, loadQuotes } from "./app-store";
import type { CalendarEvent } from "./types";

function normalizeStatus(value?: string) {
  return (value || "").trim().toLowerCase();
}

function makeEventKey(e: { id?: string; client?: string; eventName?: string; venue?: string; startDate?: string; linkedJobRequestId?: string; source?: string }) {
  if (e.source === "manual_calendar") return e.id || "";
  if (e.source === "uploaded_master_calendar") return e.id || "";
  return e.linkedJobRequestId || [e.client || "", e.eventName || "", e.venue || "", e.startDate || ""].join("|").toLowerCase();
}

export function combinedCalendarEvents(): CalendarEvent[] {
  const deleted = new Set(loadDeletedEventIds());

  const manual = loadManualEvents()
    .filter((e) => !deleted.has(e.id))
    .map((e) => ({
      ...e,
      endDate: e.endDate || e.startDate,
      startTime: e.startTime || "08:00",
      endTime: e.endTime || "17:00",
      notes: e.notes || "",
      status: e.status || "potential",
    }));

  const requests = loadJobRequests()
    .filter((r) => r.addToCalendar !== false)
    .filter((r) => !["lost", "cancelled", "canceled"].includes(normalizeStatus(r.status)))
    .map((r) => {
      const addr = [r.venueAddress, r.venueAddress2, r.city, r.state, r.venueZip].filter(Boolean).join(", ");
      return {
        id: r.id,
        source: "job_request",
        client: r.client,
        eventName: r.eventName,
        venue: r.venue,
        venueAddress: r.venueAddress,
        city: r.city,
        state: r.state,
        cityState: r.cityState,
        googleMapsLink: addr ? `https://maps.google.com/?q=${encodeURIComponent(addr)}` : "",
        startDate: r.requestDate,
        endDate: r.endDate || r.requestDate,
        startTime: r.startTime || "08:00",
        endTime: r.endTime || "17:00",
        notes: r.notes,
        status: r.status || "lead",
        lead: r.id,
      };
    })
    .filter((e) => !deleted.has(e.id));

  const quotes = loadQuotes()
    .filter((q) => ["quoted", "booked"].includes(normalizeStatus(q.status)))
    .map((q) => ({
      id: q.id,
      source: "quote_builder",
      client: q.client,
      eventName: q.eventName,
      venue: q.venue,
      cityState: q.cityState,
      startDate: q.startDate,
      endDate: q.endDate || q.startDate,
      startTime: q.startTime || "08:00",
      endTime: q.endTime || "17:00",
      notes: q.notes,
      status: q.status,
      lead: q.linkedJobRequestId || q.id,
    }))
    .filter((e) => !deleted.has(e.id));

  const merged = new Map<string, CalendarEvent>();

  manual.forEach((m) => {
    merged.set(makeEventKey({ id: m.id, source: m.source }), m);
  });

  requests.forEach((r) => {
    merged.set(makeEventKey({ id: r.id, client: r.client, eventName: r.eventName, venue: r.venue, startDate: r.startDate, linkedJobRequestId: r.lead, source: r.source }), r);
  });

  quotes.forEach((q) => {
    merged.set(makeEventKey({ id: q.id, client: q.client, eventName: q.eventName, venue: q.venue, startDate: q.startDate, linkedJobRequestId: q.lead, source: q.source }), q);
  });

  return Array.from(merged.values()).sort((a, b) => `${a.startDate} ${a.startTime}`.localeCompare(`${b.startDate} ${b.startTime}`));
}

export function parseHour(input?: string | null): number {
  if (!input) return 8;
  const t = String(input).toLowerCase().trim();
  const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return 8;
  let h = Number(match[1]);
  const mer = match[3];
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return Math.max(0, Math.min(23, h));
}

export function googleCalendarLink(event: CalendarEvent) {
  const title = encodeURIComponent(event.eventName || "Event");
  const details = encodeURIComponent([event.notes || "", event.venue || "", event.cityState || ""].filter(Boolean).join("\n"));
  const location = encodeURIComponent([event.venue || "", event.cityState || ""].filter(Boolean).join(", "));
  const sh = parseHour(event.startTime);
  const eh = Math.max(sh + 1, parseHour(event.endTime));
  const start = event.startDate ? `${event.startDate.replaceAll("-", "")}T${String(sh).padStart(2,"0")}0000` : "";
  const endDate = event.endDate || event.startDate || "";
  const end = endDate ? `${endDate.replaceAll("-", "")}T${String(eh).padStart(2,"0")}0000` : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
}

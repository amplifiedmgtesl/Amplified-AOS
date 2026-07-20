"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { JOB_REQUEST_STATUSES } from "@/lib/constants";
import type { JobRequest, Client } from "@/lib/store/types";

// Status colors shared with the Jobs list badges (jobs-list.tsx imports this).
export const JOB_STATUS_PALETTE: Record<string, { bg: string; fg: string }> = {
  lead:      { bg: "#fef9c3", fg: "#854d0e" },
  quoted:    { bg: "#e0f2fe", fg: "#0369a1" },
  booked:    { bg: "#dcfce7", fg: "#166534" },
  completed: { bg: "#dcfce7", fg: "#166534" },
  lost:      { bg: "#f3f4f6", fg: "#555" },
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function pad(n: number) { return String(n).padStart(2, "0"); }
function toDateKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthMatrix(current: Date) {
  const first = new Date(current.getFullYear(), current.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }).map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}

/**
 * Month-grid calendar for the Jobs list — same jobs the list's filters allow,
 * laid out by date. Unlike the Master Calendar (single pill on the start
 * date), a multi-day job appears on every day from start through end, since
 * its header row already carries both dates. Pills link to the job detail.
 *
 * Presentational only: filtering stays in JobsList so the list and calendar
 * always show the same set.
 */
export default function JobsCalendar({
  jobs,
  clientById,
  detailHref,
}: {
  jobs: JobRequest[];
  clientById: Map<string, Client>;
  detailHref: (id: string) => string;
}) {
  const [current, setCurrent] = useState(new Date());
  const monthDays = useMemo(() => monthMatrix(current), [current]);
  const todayKey = toDateKey(new Date());

  // Jobs covering each visible day. A job spans requestDate..endDate
  // (bad data with endDate before start collapses to the start date).
  const jobsByDay = useMemo(() => {
    const map = new Map<string, JobRequest[]>();
    for (const d of monthDays) {
      const key = toDateKey(d);
      const items = jobs.filter((j) => {
        if (!j.requestDate) return false;
        const end = j.endDate && j.endDate >= j.requestDate ? j.endDate : j.requestDate;
        return j.requestDate <= key && key <= end;
      });
      if (items.length > 0) map.set(key, items);
    }
    return map;
  }, [jobs, monthDays]);

  return (
    <div className="calendar-shell calendar-shell-open">
      <div className="calendar-toolbar">
        <strong>{current.toLocaleString("en-US", { month: "long", year: "numeric" })}</strong>
        <div className="action-row" style={{ gap: 8 }}>
          <button className="secondary" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹ Prev</button>
          <button className="secondary" onClick={() => setCurrent(new Date())}>Today</button>
          <button className="secondary" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1))}>Next ›</button>
        </div>
      </div>
      <div className="month-grid">
        {dayNames.map((n) => <div key={n} className="day-name">{n}</div>)}
        {monthDays.map((d, idx) => {
          const key = toDateKey(d);
          const items = jobsByDay.get(key) ?? [];
          const outside = d.getMonth() !== current.getMonth();
          return (
            <div key={idx} className={`month-cell ${outside ? "outside" : ""}`} style={{ cursor: "default" }}>
              <div className="cell-date" style={key === todayKey ? { fontWeight: 700, color: "var(--accent, #2563eb)" } : undefined}>
                {d.getDate()}
              </div>
              {items.map((j) => {
                const c = clientById.get(j.clientId);
                const pal = JOB_STATUS_PALETTE[j.status] ?? { bg: "#f3f4f6", fg: "#555" };
                const statusLabel = JOB_REQUEST_STATUSES.find((s) => s.value === j.status)?.label ?? j.status;
                const range = j.endDate && j.endDate !== j.requestDate ? `${j.requestDate} – ${j.endDate}` : j.requestDate;
                return (
                  <Link
                    key={j.id}
                    href={detailHref(j.id)}
                    className="event-pill"
                    title={`${c?.name ?? j.client ?? ""} — ${j.eventName || "(no event name)"}\n${j.venue || ""}\n${range} · ${statusLabel}`}
                    style={{
                      display: "block", textDecoration: "none",
                      background: pal.bg, borderColor: pal.fg, color: pal.fg,
                    }}
                  >
                    {c?.code ? `[${c.code}] ` : ""}{j.eventName || "(no event name)"}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

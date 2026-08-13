"use client";

// CREW SCHEDULE REPORT — the BEFORE document (#46, artifact 1 of 3).
//
// The crew leader's pocket reference: who is working, in what role, on which
// shift, and when they are expected. Read-only. It is NOT a capture form —
// there is deliberately no signature block and no blank Time In/Out column,
// because the whole failure this set exists to fix is one document being
// mistaken for another.
//
// ── Why this document exists at all ────────────────────────────────────────
// Before Phase 0 the import copied the scheduled window into the ACTUAL time
// columns, so two surfaces accidentally doubled as the schedule: the
// Timekeeping screen and its printed timesheet. Phase 0 correctly blanks
// actuals — a no-show left untouched is 0 hours, not scheduled hours — and in
// doing so it silently removed the only place people were reading the schedule
// from. Nothing was deleted; the schedule view was a side effect of the bug.
// This backfills it deliberately.
//
// ── The set ────────────────────────────────────────────────────────────────
//   BEFORE  this file          — schedule, text only, no blanks       (job screen)
//   DURING  crew-sign-in-sheet — fill-in capture form                  (job screen)
//   AFTER   timesheet actuals  — the record, with real signatures      (Timekeeping)
//
// Sourced from crew ASSIGNMENTS (not the timesheet), so it can be printed at
// scheduling time, before any timekeeping row exists. That is the same reason
// the old flow copied the schedule into the timesheet early.
//
// Rendered display:none on screen and in ordinary print; revealed only when
// <body> carries `printing-schedule`. See app/globals.css.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadJobRequestDays } from "@/lib/storage/job-request-days";
import { loadAssignmentsForRequest } from "@/lib/storage/job-request-assignments";
import { loadShifts } from "@/lib/storage/job-request-shifts";
import { formatClock, formatClockRange } from "@/lib/time-utils";
import { formatPlannedTimes } from "@/lib/jobs/planned-times";
import type {
  JobRequest,
  JobRequestDay,
  JobRequestAssignment,
  JobRequestShift,
  Position,
  Specialty,
} from "@/lib/store/types";

type Employee = {
  employeeKey: string;
  fullName: string;
  phone?: string;
};

/** The day's scheduled window, BOTH blocks (#47). */
function dayWindowText(d: JobRequestDay): string {
  const pair1 = formatClockRange(d.startTime, d.endTime);
  const pair2 = formatClockRange(d.startTime2, d.endTime2);
  return [pair1, pair2].filter(Boolean).join(" · ");
}

export function CrewScheduleReport({
  form,
  dayFilter = "all",
  includeUnassigned = true,
}: {
  form: JobRequest;
  /** "all", or a single YYYY-MM-DD to print one day. */
  dayFilter?: string;
  /** False hides rows with no employee picked and rows not yet confirmed. */
  includeUnassigned?: boolean;
}) {
  const [days, setDays] = useState<JobRequestDay[]>([]);
  const [assignments, setAssignments] = useState<JobRequestAssignment[]>([]);
  const [shifts, setShifts] = useState<JobRequestShift[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    if (!form.id) return;
    let cancelled = false;
    (async () => {
      const [ds, asg, shiftList, posRes, spcRes] = await Promise.all([
        loadJobRequestDays(form.id),
        loadAssignmentsForRequest(form.id),
        loadShifts(form.id),
        supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
      ]);
      if (cancelled) return;
      setDays(ds);
      setAssignments(asg);
      setShifts(shiftList);
      setPositions((posRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      })));
      setSpecialties((spcRes.data ?? []).map((r: any) => ({
        id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      })));
      const empKeys = Array.from(new Set(asg.map((a) => a.employeeKey).filter(Boolean) as string[]));
      if (empKeys.length > 0) {
        const { data: empRows } = await supabase
          .from("employees")
          .select("employee_key, full_name, phone")
          .in("employee_key", empKeys);
        if (!cancelled) {
          setEmployees((empRows ?? []).map((r: any) => ({
            employeeKey: r.employee_key, fullName: r.full_name ?? "", phone: r.phone ?? "",
          })));
        }
      } else if (!cancelled) {
        setEmployees([]);
      }
    })();
    return () => { cancelled = true; };
  }, [form.id]);

  const positionsById = new Map(positions.map((p) => [p.id, p]));
  const specialtiesById = new Map(specialties.map((s) => [s.id, s]));
  const shiftsById = new Map(shifts.map((s) => [s.id, s]));
  const employeesByKey = new Map(employees.map((e) => [e.employeeKey, e]));
  const anyShift = assignments.some((a) => a.shiftId);

  function formatDay(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function fullAddress(): string {
    return [form.venueAddress, form.venueAddress2, form.city, form.state, form.venueZip]
      .filter(Boolean).join(", ");
  }

  return (
    <div className="crew-schedule-report">
      <header className="csr-header">
        <img src="/branding/client-logo.png" alt="Amplified" className="csr-logo" />
        <div className="csr-title-block">
          <div className="csr-job-no">{form.jobNo || "(no job #)"}</div>
          <h1 className="csr-event-name">{form.eventName || "(no event name)"} — Crew Schedule</h1>
          <div className="csr-meta">
            <strong>{form.client || "—"}</strong>
            {form.venue && <span> · {form.venue}</span>}
            {fullAddress() && <span> · {fullAddress()}</span>}
          </div>
        </div>
      </header>

      {/* Says what this is, so it cannot be mistaken for the capture form. */}
      <div className="csr-banner">
        SCHEDULE — reference only. Times are what is <strong>planned</strong>.
        Record actual times on the Crew Sign-In Sheet or at the Time Clock.
      </div>

      {days.length === 0 ? (
        <div className="csr-empty">No days defined for this job yet.</div>
      ) : (
        days.filter((d) => dayFilter === "all" || d.eventDate === dayFilter).map((d) => {
          const dayAsg = assignments
            .filter((a) => a.jobRequestDayId === d.id)
            .filter((a) => includeUnassigned || (a.employeeKey && a.confirmed))
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          const window = dayWindowText(d);
          return (
            <section key={d.id} className="csr-day">
              <div className="csr-day-header">
                <h2>{formatDay(d.eventDate)}</h2>
                <div className="csr-day-meta">
                  {d.callTime && <span>Call {formatClock(d.callTime)}</span>}
                  {window && <span> · {window}</span>}
                  <span> · {dayAsg.length} crew</span>
                </div>
              </div>
              {dayAsg.length === 0 ? (
                <div className="csr-empty">No crew assigned for this day.</div>
              ) : (
                <table className="csr-table">
                  <thead>
                    <tr>
                      <th style={{ width: "24%" }}>Name</th>
                      <th style={{ width: "22%" }}>Position</th>
                      {anyShift && <th style={{ width: "12%" }}>Shift</th>}
                      <th style={{ width: "26%" }}>Scheduled</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayAsg.map((a) => {
                      const emp = a.employeeKey ? employeesByKey.get(a.employeeKey) : null;
                      const pos = positionsById.get(a.positionId || "")?.name || "—";
                      const spc = specialtiesById.get(a.specialtyId || "")?.name || "";
                      const planned = formatPlannedTimes(a, d);
                      return (
                        <tr key={a.id}>
                          <td>
                            {emp?.fullName || <span className="csr-unfilled">(unassigned)</span>}
                            {!a.confirmed && <span className="csr-unconfirmed"> — unconfirmed</span>}
                          </td>
                          <td>{spc ? `${pos} · ${spc}` : pos}</td>
                          {anyShift && <td>{a.shiftId ? (shiftsById.get(a.shiftId)?.label || "") : ""}</td>}
                          <td>{planned || <span className="csr-unfilled">no time set</span>}</td>
                          <td>{emp?.phone || ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          );
        })
      )}

      <footer className="csr-footer">
        Printed {new Date().toLocaleString()} · Crew Schedule (planned times) ·
        Amplified Operations Suite
      </footer>
    </div>
  );
}

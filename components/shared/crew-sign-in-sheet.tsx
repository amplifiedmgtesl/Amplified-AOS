"use client";

// Print-only crew SIGN-IN SHEET, driven entirely by crew assignments +
// their day + planned times (Planned-vs-Actual redesign §5.2). This is the
// "planned" artifact the crew leader prints and carries on-site: it lists who
// is scheduled, their role/shift, their expected (planned) times, and leaves
// blank Time In / Time Out / Signature lines for hand capture.
//
// Because it reads from assignments (not the timesheet) it can be printed at
// SCHEDULING time — before any timekeeping entry exists — which was the real
// reason the old flow copied the schedule into the timesheet early.
//
// Rendered display:none on screen and in ordinary print; revealed only when
// <body> carries `printing-signin` (set by the Jobs editor's "Sign-In Sheet"
// button, which also hides the summary sheet). See app/globals.css.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadJobRequestDays } from "@/lib/storage/job-request-days";
import { loadAssignmentsForRequest } from "@/lib/storage/job-request-assignments";
import { loadShifts } from "@/lib/storage/job-request-shifts";
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

// Planned window text for one assignment. Pair 1 falls back to the day
// window; pair 2 is shown only when present. Mirrors copyPlannedToActual.
function expectedTimes(a: JobRequestAssignment, day: JobRequestDay): string {
  const in1 = a.plannedIn1 || day.startTime || "";
  const out1 = a.plannedOut1 || day.endTime || "";
  const pair1 = in1 || out1 ? `${in1 || "?"}–${out1 || "?"}` : "";
  const pair2 = a.plannedIn2 || a.plannedOut2
    ? `${a.plannedIn2 || "?"}–${a.plannedOut2 || "?"}`
    : "";
  return [pair1, pair2].filter(Boolean).join(" · ");
}

export function CrewSignInSheet({ form }: { form: JobRequest }) {
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
    <div className="crew-sign-in-sheet">
      <header className="csis-header">
        <img src="/branding/client-logo.png" alt="Amplified" className="csis-logo" />
        <div className="csis-title-block">
          <div className="csis-job-no">{form.jobNo || "(no job #)"}</div>
          <h1 className="csis-event-name">{form.eventName || "(no event name)"} — Crew Sign-In</h1>
          <div className="csis-meta">
            <strong>{form.client || "—"}</strong>
            {form.venue && <span> · {form.venue}</span>}
            {fullAddress() && <span> · {fullAddress()}</span>}
          </div>
        </div>
      </header>

      {days.length === 0 ? (
        <div className="csis-empty">No days defined for this job yet.</div>
      ) : (
        days.map((d) => {
          const dayAsg = assignments
            .filter((a) => a.jobRequestDayId === d.id)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          return (
            <section key={d.id} className="csis-day">
              <div className="csis-day-header">
                <h2>{formatDay(d.eventDate)}</h2>
                <div className="csis-day-meta">
                  {d.callTime && <span>Call {d.callTime}</span>}
                  {(d.startTime || d.endTime) && <span> · Window {d.startTime || "?"}–{d.endTime || "?"}</span>}
                </div>
              </div>
              {dayAsg.length === 0 ? (
                <div className="csis-empty">No crew assigned for this day.</div>
              ) : (
                <table className="csis-table">
                  <thead>
                    <tr>
                      <th style={{ width: "20%" }}>Name</th>
                      <th style={{ width: "14%" }}>Position</th>
                      {anyShift && <th style={{ width: "10%" }}>Shift</th>}
                      <th style={{ width: "16%" }}>Expected</th>
                      <th style={{ width: "13%" }}>Time In</th>
                      <th style={{ width: "13%" }}>Time Out</th>
                      <th>Signature</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayAsg.map((a) => {
                      const emp = a.employeeKey ? employeesByKey.get(a.employeeKey) : null;
                      const pos = positionsById.get(a.positionId || "")?.name || "—";
                      const spc = specialtiesById.get(a.specialtyId || "")?.name || "";
                      return (
                        <tr key={a.id}>
                          <td>{emp?.fullName || " "}</td>
                          <td>{spc ? `${pos} · ${spc}` : pos}</td>
                          {anyShift && <td>{a.shiftId ? (shiftsById.get(a.shiftId)?.label || "") : ""}</td>}
                          <td>{expectedTimes(a, d) || " "}</td>
                          <td className="csis-blank">&nbsp;</td>
                          <td className="csis-blank">&nbsp;</td>
                          <td className="csis-blank">&nbsp;</td>
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

      <footer className="csis-footer">
        Printed {new Date().toLocaleString()} · Expected times are the schedule (planned) — actual times captured above ·
        Amplified Operations Suite
      </footer>
    </div>
  );
}

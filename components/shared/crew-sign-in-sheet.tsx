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
// Rendered inside the print PREVIEW route (/job-requests/[id]/print?doc=signin),
// which shows it on screen exactly as it will print. Column widths and the
// two-row-per-person shape are copied from the PRODUCTION printed timesheet, so
// the paper crews fill in matches the document the office reads back.

import { Fragment, useEffect, useState } from "react";
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

// The day's scheduled window, BOTH blocks. Printing pair 1 alone made a
// two-block day contradict its own rows — the header read "Window 08:00–13:00"
// above rows saying "08:00–13:00 · 14:00–19:00".
function dayWindowText(d: JobRequestDay): string {
  const pair1 = formatClockRange(d.startTime, d.endTime);
  const pair2 = formatClockRange(d.startTime2, d.endTime2);
  return [pair1, pair2].filter(Boolean).join(" · ");
}

export function CrewSignInSheet({
  form,
  dayFilter = "all",
  includeUnassigned = true,
  blankRows = 0,
}: {
  form: JobRequest;
  /** "all", or a single YYYY-MM-DD to print one day. */
  dayFilter?: string;
  /** False hides rows with no employee picked and rows not yet confirmed. */
  includeUnassigned?: boolean;
  /** Extra empty rows for walk-ups and last-minute replacements (#48). */
  blankRows?: number;
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
        days.filter((d) => dayFilter === "all" || d.eventDate === dayFilter).map((d) => {
          const dayAsg = assignments
            .filter((a) => a.jobRequestDayId === d.id)
            .filter((a) => includeUnassigned || (a.employeeKey && a.confirmed))
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          return (
            <section key={d.id} className="csis-day">
              <div className="csis-day-header">
                <h2>{formatDay(d.eventDate)}</h2>
                <div className="csis-day-meta">
                  {d.callTime && <span>Call {formatClock(d.callTime)}</span>}
                  {dayWindowText(d) && <span> · Window {dayWindowText(d)}</span>}
                </div>
              </div>
              {dayAsg.length === 0 ? (
                <div className="csis-empty">No crew assigned for this day.</div>
              ) : (
                <table className="csis-table">
                  {/* Column widths copied from the PRODUCTION printed timesheet
                      (main: timekeeping.tsx colgroup) so the paper a crew leader
                      fills in on site lines up with the document the office
                      reads back in the app. */}
                  <colgroup>
                    <col style={{ width: "18%" }} />{/* Sign IN 1  */}
                    <col style={{ width: "9%"  }} />{/* Time IN 1  */}
                    <col style={{ width: "9%"  }} />{/* Time OUT 1 */}
                    <col style={{ width: "7%"  }} />{/* Meal 1     */}
                    <col style={{ width: "18%" }} />{/* Sign IN 2  */}
                    <col style={{ width: "9%"  }} />{/* Time IN 2  */}
                    <col style={{ width: "9%"  }} />{/* Time OUT 2 */}
                    <col style={{ width: "21%" }} />{/* Meal 2     */}
                  </colgroup>
                  <thead>
                    <tr>
                      <th colSpan={2}>Name</th>
                      <th colSpan={2}>Position</th>
                      <th colSpan={1}>{anyShift ? "Shift" : ""}</th>
                      <th colSpan={3}>Scheduled</th>
                    </tr>
                    <tr>
                      <th className="csis-sig-th">Sign IN 1</th>
                      <th>Time IN 1</th><th>Time OUT 1</th><th>Meal 1</th>
                      <th className="csis-sig-th">Sign IN 2</th>
                      <th>Time IN 2</th><th>Time OUT 2</th><th>Meal 2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayAsg.map((a) => {
                      const emp = a.employeeKey ? employeesByKey.get(a.employeeKey) : null;
                      const pos = positionsById.get(a.positionId || "")?.name || "\u2014";
                      const spc = specialtiesById.get(a.specialtyId || "")?.name || "";
                      return (
                        // Two rows per person, exactly as the printed timesheet
                        // does it: identity above, capture below.
                        <Fragment key={a.id}>
                          <tr className="csis-identity">
                            <td colSpan={2}>{emp?.fullName || ""}</td>
                            <td colSpan={2}>{spc ? pos + " \u00b7 " + spc : pos}</td>
                            <td colSpan={1}>{anyShift && a.shiftId ? (shiftsById.get(a.shiftId)?.label || "") : ""}</td>
                            <td colSpan={3}>{formatPlannedTimes(a, d) || ""}</td>
                          </tr>
                          <tr className="csis-capture">
                            <td className="csis-sig"></td>
                            <td className="csis-blank"></td>
                            <td className="csis-blank"></td>
                            <td className="csis-blank"></td>
                            <td className="csis-sig"></td>
                            <td className="csis-blank"></td>
                            <td className="csis-blank"></td>
                            <td className="csis-blank"></td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {/* Walk-ups and last-minute replacements. Printed sheets read
                        from ASSIGNMENTS, so someone added on the day appears on
                        no sheet at all (#48) — these give them somewhere to go.
                        Deliberately marked, not blank: "scheduled" vs "added on
                        the day" is worth telling apart on paper. */}
                    {Array.from({ length: blankRows }).map((_, i) => (
                      <Fragment key={`blank-${i}`}>
                        <tr className="csis-identity csis-walkup">
                          <td colSpan={2}></td>
                          <td colSpan={2}></td>
                          <td colSpan={1}></td>
                          <td colSpan={3}>added on the day</td>
                        </tr>
                        <tr className="csis-capture">
                          <td className="csis-sig"></td>
                          <td className="csis-blank"></td>
                          <td className="csis-blank"></td>
                          <td className="csis-blank"></td>
                          <td className="csis-sig"></td>
                          <td className="csis-blank"></td>
                          <td className="csis-blank"></td>
                          <td className="csis-blank"></td>
                        </tr>
                      </Fragment>
                    ))}
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

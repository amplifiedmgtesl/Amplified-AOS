"use client";

// Print-only summary of a Job: venue, daily requirements, assigned crew,
// notes, attachments. Renders display:none on screen, full layout in print.
// Triggered by the Jobs editor's "Download / Print PDF" button.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadJobRequestDays, loadCrewNeedsForRequest } from "@/lib/storage/job-request-days";
import { loadAssignmentsForRequest } from "@/lib/storage/job-request-assignments";
import type {
  JobRequest,
  JobRequestDay,
  JobRequestCrewNeed,
  JobRequestAssignment,
  Position,
  Specialty,
} from "@/lib/store/types";

type Employee = {
  employeeKey: string;
  fullName: string;
  phone?: string;
};

export function JobPrintSheet({ form }: { form: JobRequest }) {
  const [days, setDays] = useState<JobRequestDay[]>([]);
  const [crewNeeds, setCrewNeeds] = useState<JobRequestCrewNeed[]>([]);
  const [assignments, setAssignments] = useState<JobRequestAssignment[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    if (!form.id) return;
    let cancelled = false;
    (async () => {
      const [ds, needs, asg, posRes, spcRes] = await Promise.all([
        loadJobRequestDays(form.id),
        loadCrewNeedsForRequest(form.id),
        loadAssignmentsForRequest(form.id),
        supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
      ]);
      if (cancelled) return;
      setDays(ds);
      setCrewNeeds(needs);
      setAssignments(asg);
      setPositions((posRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      })));
      setSpecialties((spcRes.data ?? []).map((r: any) => ({
        id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      })));
      // Pull only the employees that appear in assignments — bounded fetch.
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
      } else {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => { cancelled = true; };
  }, [form.id]);

  const positionsById = new Map(positions.map((p) => [p.id, p]));
  const specialtiesById = new Map(specialties.map((s) => [s.id, s]));
  const employeesByKey = new Map(employees.map((e) => [e.employeeKey, e]));

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
    <div className="job-print-sheet">
      <header className="jps-header">
        <img src="/branding/client-logo.png" alt="Amplified" className="jps-logo" />
        <div className="jps-title-block">
          <div className="jps-job-no">{form.jobNo || "(no job #)"}</div>
          <h1 className="jps-event-name">{form.eventName || "(no event name)"}</h1>
          <div className="jps-meta">
            <strong>{form.client || "—"}</strong>
            <span> · {(form.status || "").toUpperCase()}</span>
            <span> · {form.requestDate}{form.endDate && form.endDate !== form.requestDate ? ` → ${form.endDate}` : ""}</span>
          </div>
        </div>
      </header>

      <section className="jps-section">
        <h2>Venue</h2>
        <div className="jps-kv">
          <div><strong>{form.venue || "(no venue)"}</strong></div>
          <div>{fullAddress() || "(no address)"}</div>
        </div>
      </section>

      <section className="jps-section">
        <h2>Daily Requirements</h2>
        {days.length === 0 ? (
          <div className="jps-empty">No days defined yet.</div>
        ) : (
          days.map((d) => {
            const dayNeeds = crewNeeds.filter((n) => n.jobRequestDayId === d.id);
            const totalQty = dayNeeds.reduce((s, n) => s + (n.quantity || 0), 0);
            return (
              <div key={d.id} className="jps-day">
                <div className="jps-day-header">
                  <h3>{formatDay(d.eventDate)}</h3>
                  <div className="jps-day-meta">
                    {d.callTime && <span>Call {d.callTime}</span>}
                    {(d.startTime || d.endTime) && <span> · {d.startTime || "?"}–{d.endTime || "?"}</span>}
                    {d.expectedHours && <span> · {d.expectedHours} hrs</span>}
                  </div>
                </div>
                {dayNeeds.length === 0 ? (
                  <div className="jps-empty">No crew requirements specified for this day.</div>
                ) : (
                  <table className="jps-table">
                    <thead>
                      <tr>
                        <th style={{ width: "30%" }}>Position</th>
                        <th style={{ width: "30%" }}>Specialty</th>
                        <th style={{ width: 60 }}>Qty</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayNeeds.map((n) => (
                        <tr key={n.id}>
                          <td>{positionsById.get(n.positionId || "")?.name || "—"}</td>
                          <td>{specialtiesById.get(n.specialtyId || "")?.name || "—"}</td>
                          <td>{n.quantity}</td>
                          <td>{n.notes || ""}</td>
                        </tr>
                      ))}
                      <tr className="jps-total-row">
                        <td colSpan={2}><strong>Total crew this day</strong></td>
                        <td><strong>{totalQty}</strong></td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {d.notes && <div className="jps-day-notes">Notes: {d.notes}</div>}
              </div>
            );
          })
        )}
      </section>

      <section className="jps-section">
        <h2>Assigned Crew</h2>
        {days.length === 0 ? (
          <div className="jps-empty">No days defined yet.</div>
        ) : (
          days.map((d) => {
            const dayAsg = assignments.filter((a) => a.jobRequestDayId === d.id);
            const confirmedCount = dayAsg.filter((a) => a.confirmed).length;
            return (
              <div key={d.id} className="jps-day">
                <div className="jps-day-header">
                  <h3>{formatDay(d.eventDate)}</h3>
                  <div className="jps-day-meta">
                    {dayAsg.length} assigned · {confirmedCount} confirmed
                  </div>
                </div>
                {dayAsg.length === 0 ? (
                  <div className="jps-empty">No crew assigned for this day yet.</div>
                ) : (
                  <table className="jps-table">
                    <thead>
                      <tr>
                        <th style={{ width: "30%" }}>Name</th>
                        <th style={{ width: "20%" }}>Position</th>
                        <th style={{ width: "20%" }}>Specialty</th>
                        <th style={{ width: 80 }}>Confirmed</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayAsg.map((a) => {
                        const emp = a.employeeKey ? employeesByKey.get(a.employeeKey) : null;
                        return (
                          <tr key={a.id}>
                            <td>{emp?.fullName || <em>(unassigned)</em>}</td>
                            <td>{positionsById.get(a.positionId || "")?.name || "—"}</td>
                            <td>{specialtiesById.get(a.specialtyId || "")?.name || "—"}</td>
                            <td>{a.confirmed ? "✓" : "—"}</td>
                            <td>{a.notes || ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </section>

      {form.notes && (
        <section className="jps-section">
          <h2>Notes</h2>
          <div className="jps-notes">{form.notes}</div>
        </section>
      )}

      <footer className="jps-footer">
        Generated {new Date().toLocaleString()} · Amplified Operations Suite
      </footer>
    </div>
  );
}

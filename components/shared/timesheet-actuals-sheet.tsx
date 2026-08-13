"use client";

// TIMESHEET OF ACTUALS — the AFTER document (#46, artifact 3 of 3).
//
// The record of what was actually worked, possibly client-facing. Unlike the
// other two it reads from `timesheet_entries` (the actual times), not from crew
// assignments, so it only exists once time has been recorded.
//
// ── What makes this document different ─────────────────────────────────────
// It has NO blank signature blocks. The other sheet in this set is a form to be
// filled in; this one is a finished record, and a blank box on a record invites
// someone to write in it afterwards. Where a signature exists it is the REAL
// captured image from the kiosk (private bucket, short-lived signed URL). Where
// none exists the cell says so plainly rather than leaving a space.
//
// That distinction doubles as provenance: a signed row was captured at the
// kiosk by the worker; an unsigned row was typed by the office. The kiosk spec
// calls this out as its Phase 2 "provenance badge", and this document is where
// it first becomes visible. ⚠ It also OVERLAPS the kiosk spec's Phase 2
// "email the filled-in timesheet to the client as a PDF" — reconcile the two
// rather than building a second document.

import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadTimesheetForJobLive } from "@/lib/store/app-store";
import { loadShifts } from "@/lib/storage/job-request-shifts";
import { loadCaptures, signSignatureUrls, type TimesheetCapture } from "@/lib/storage/timesheet-captures";
import { formatClock } from "@/lib/time-utils";
import type { JobRequest, JobRequestShift, TimeEntry, Specialty } from "@/lib/store/types";

function rowName(e: TimeEntry): string {
  const n = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim();
  return n || "(unnamed)";
}

export function TimesheetActualsSheet({
  form,
  dayFilter = "all",
}: {
  form: JobRequest;
  /** "all", or a single YYYY-MM-DD. */
  dayFilter?: string;
}) {
  const [rows, setRows] = useState<TimeEntry[]>([]);
  const [captures, setCaptures] = useState<Map<string, TimesheetCapture>>(new Map());
  const [sigUrls, setSigUrls] = useState<Map<string, string>>(new Map());
  const [shifts, setShifts] = useState<JobRequestShift[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!form.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ts, shiftList, spcRes] = await Promise.all([
          loadTimesheetForJobLive(form.id),
          loadShifts(form.id, { includeInactive: true }),
          supabase.from("specialties").select("*").order("sort_order"),
        ]);
        if (cancelled) return;
        const entries = ts?.rows ?? [];
        setRows(entries);
        setShifts(shiftList);
        setSpecialties((spcRes.data ?? []).map((r: any) => ({
          id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
        })));

        const caps = await loadCaptures(entries.map((r) => r.id));
        if (cancelled) return;
        setCaptures(caps);
        const paths: string[] = [];
        for (const c of caps.values()) {
          if (c.signatureIn1Path) paths.push(c.signatureIn1Path);
          if (c.signatureIn2Path) paths.push(c.signatureIn2Path);
        }
        const urls = await signSignatureUrls(paths);
        if (!cancelled) setSigUrls(urls);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form.id]);

  const shiftsById = new Map(shifts.map((s) => [s.id, s]));
  const specialtiesById = new Map(specialties.map((s) => [s.id, s]));
  const anyShift = rows.some((r) => r.shiftId);

  // Group by work date, so the document reads day by day like the others.
  const byDay = new Map<string, TimeEntry[]>();
  for (const r of rows) {
    const d = r.workDate || "(no date)";
    if (dayFilter !== "all" && d !== dayFilter) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(r);
  }
  const dayKeys = Array.from(byDay.keys()).sort();

  function formatDay(iso: string): string {
    if (!iso || iso === "(no date)") return "No date";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function fullAddress(): string {
    return [form.venueAddress, form.venueAddress2, form.city, form.state, form.venueZip]
      .filter(Boolean).join(", ");
  }

  /** A signature cell: the real image, or an honest statement that there isn't one. */
  function sigCell(cap: TimesheetCapture | undefined, slot: "in1" | "in2", hasTime: boolean) {
    const path = slot === "in1" ? cap?.signatureIn1Path : cap?.signatureIn2Path;
    const url = path ? sigUrls.get(path) : undefined;
    if (url) return <img src={url} alt="signature" className="tas-sig-img" />;
    // No blank box on a finished record — say what happened instead.
    return <span className="tas-nosig">{hasTime ? "entered by office" : ""}</span>;
  }

  const totalHours = rows
    .filter((r) => dayFilter === "all" || (r.workDate || "(no date)") === dayFilter)
    .reduce((s, r) => s + Number(r.totalHours ?? 0), 0);

  return (
    <div className="timesheet-actuals-sheet">
      <header className="tas-header">
        <img src="/branding/client-logo.png" alt="Amplified" className="tas-logo" />
        <div className="tas-title-block">
          <div className="tas-job-no">{form.jobNo || "(no job #)"}</div>
          <h1 className="tas-event-name">{form.eventName || "(no event name)"} — Timesheet</h1>
          <div className="tas-meta">
            <strong>{form.client || "—"}</strong>
            {form.venue && <span> · {form.venue}</span>}
            {fullAddress() && <span> · {fullAddress()}</span>}
          </div>
        </div>
      </header>

      <div className="tas-banner">
        RECORD OF HOURS WORKED — actual times as recorded. Signatures shown were
        captured at the Time Clock; rows marked <em>entered by office</em> were keyed in.
      </div>

      {loading ? (
        <div className="tas-empty">Loading…</div>
      ) : dayKeys.length === 0 ? (
        <div className="tas-empty">
          No timekeeping records for this job yet — nothing has been worked or entered.
        </div>
      ) : (
        dayKeys.map((dk) => {
          const dayRows = byDay.get(dk)!.sort((a, b) => rowName(a).localeCompare(rowName(b)));
          const dayHours = dayRows.reduce((s, r) => s + Number(r.totalHours ?? 0), 0);
          return (
            <section key={dk} className="tas-day">
              <div className="tas-day-header">
                <h2>{formatDay(dk)}</h2>
                <div className="tas-day-meta">
                  {dayRows.length} crew · {dayHours.toFixed(2)} hrs
                </div>
              </div>
              <table className="tas-table">
                <colgroup>
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "21%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={2}>Name</th>
                    <th colSpan={2}>Position</th>
                    <th colSpan={1}>{anyShift ? "Shift" : ""}</th>
                    <th colSpan={3}>Hours</th>
                  </tr>
                  <tr>
                    <th className="tas-sig-th">Signature 1</th>
                    <th>Time IN 1</th><th>Time OUT 1</th><th>Meal 1</th>
                    <th className="tas-sig-th">Signature 2</th>
                    <th>Time IN 2</th><th>Time OUT 2</th><th>Meal 2</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((r) => {
                    const cap = captures.get(r.id);
                    const spc = r.specialtyId ? specialtiesById.get(r.specialtyId)?.name : "";
                    const pos = r.position || "\u2014";
                    return (
                      // Identity above, captured detail below — the same two-row
                      // shape as the sign-in sheet, so the form and the record
                      // read as the same document at different stages.
                      <Fragment key={r.id}>
                        <tr className="tas-identity">
                          <td colSpan={2} className="tas-name">{rowName(r)}</td>
                          <td colSpan={2}>{spc ? pos + " \u00b7 " + spc : pos}</td>
                          <td colSpan={1}>{anyShift && r.shiftId ? (shiftsById.get(r.shiftId)?.label || "") : ""}</td>
                          <td colSpan={3} className="tas-hours">{Number(r.totalHours ?? 0).toFixed(2)} hrs</td>
                        </tr>
                        <tr className="tas-capture">
                          <td className="tas-sig">{sigCell(cap, "in1", !!r.timeIn1)}</td>
                          <td>{formatClock(r.timeIn1) || "\u2014"}</td>
                          <td>{formatClock(r.timeOut1) || "\u2014"}</td>
                          <td>{r.mealBreak1Minutes ? r.mealBreak1Minutes + "m" : "\u2014"}</td>
                          <td className="tas-sig">{sigCell(cap, "in2", !!r.timeIn2)}</td>
                          <td>{formatClock(r.timeIn2) || "\u2014"}</td>
                          <td>{formatClock(r.timeOut2) || "\u2014"}</td>
                          <td>{r.mealBreak2Minutes ? r.mealBreak2Minutes + "m" : "\u2014"}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })
      )}

      {dayKeys.length > 0 && (
        <div className="tas-total">Total hours: <strong>{totalHours.toFixed(2)}</strong></div>
      )}

      <footer className="tas-footer">
        Printed {new Date().toLocaleString()} · Actual recorded times ·
        Amplified Operations Suite
      </footer>
    </div>
  );
}

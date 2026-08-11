"use client";

// Time Clock kiosk (Phase 1).
//
// Flow: crew leader picks a Job + day → the day's pre-seeded timesheet rows are
// listed (one per employee/position/shift) → a worker taps their row → a
// four-slot action panel (Time In/Out for block 1 & 2). Sign-in captures
// a signature; sign-out is one tap. Each punch writes the SAME
// timesheet_entries.time_in1..out2 field the crew leader edits (via the normal
// upsertTimesheet path, so the record is identical), plus the raw instant +
// signature into timesheet_captures for audit/provenance.
//
// The kiosk is capture-only: no notes/overrides here. Corrections happen on the
// timekeeping screen. Button state is DERIVED from time_in1..out2, so times a
// crew leader typed there (e.g. a no-signal backfill) enable the right buttons.
//
// ─── Round-2 redesign (#49–#53) ────────────────────────────────────────────
// The screen previously showed four buttons labelled "Sign In — Shift 1/2" and
// nothing else. Five problems, one root cause — no context:
//   #53 "Shift" meant two different things. The kiosk's "Shift 1/2" are the two
//       TIME PAIRS on one row; job_request_shifts are the job's NAMED shifts
//       (Load In, Show). The kiosk used the word for the thing that isn't the
//       shift, and never displayed the thing that is. Pairs are now "Block 1/2"
//       with slots named Time In/Out 1 and 2; "Shift" is reserved for the
//       named shift, which is now shown.
//   #49 Both sign-in slots rendered as identical primary buttons reading "Tap
//       to sign in" — a mis-tap put time in time_in2, left block 1 empty and
//       computed hours wrong, and the worker SIGNED for it. Block 2 keeping its
//       start-of-day availability (second-shift-only workers need it) is what
//       made this dangerous; showing each block's planned window is what makes
//       it safe rather than merely relabelled.
//   #50 No planned/expected time and no named shift anywhere, though crew on
//       one day can span Load In and Show.
//   #51 The signature modal omitted the date — it matters on jobs crossing
//       midnight, and the kiosk spec lists showing it as a guard.
//   #52 Quoted vs recorded time could diverge: the modal built its text with
//       roundInstantToTimeString(new Date()) at RENDER and applyPunch
//       recomputed at CONFIRM, so signing slowly across a 5-minute boundary
//       meant signing "3:45 PM" while 3:50 PM was stored. The punch instant is
//       now frozen when the slot is tapped and carried through to both the
//       displayed text and the stored value, so what was signed is what is
//       recorded.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadJobRequests,
  loadSpecialties,
  loadTimesheetForJobLive,
  upsertTimesheet,
} from "@/lib/store/app-store";
import { computeTimeEntry, promoteWorkedStatus } from "@/lib/store/timekeeping";
import type { JobRequest, TimeEntry, Timesheet } from "@/lib/store/types";
import { SignaturePad, type SignaturePadHandle } from "@/components/shared/signature-pad";
import { deviceLocalDate, deviceTimeZone, roundInstantToTimeString } from "@/lib/timeclock/time";
import { uploadSignature, upsertCapture } from "@/lib/storage/timesheet-captures";
import { loadJobCrewSlots, type JobCrewSlot } from "@/lib/storage/job-request-assignments";
import { resolvePlannedTimes } from "@/lib/jobs/planned-times";
import { formatClock, formatClockRange } from "@/lib/time-utils";

type Slot = "in1" | "out1" | "in2" | "out2";
type SlotState = "available" | "done" | "disabled";

const filled = (s?: string | null) => !!(s && String(s).trim());

/** Derive the four-slot button states from the row's pay-facing times. */
function slotStates(e: TimeEntry): Record<Slot, SlotState> {
  const in1 = filled(e.timeIn1);
  const out1 = filled(e.timeOut1);
  const in2 = filled(e.timeIn2);
  const out2 = filled(e.timeOut2);
  const nothing = !in1 && !out1 && !in2 && !out2;
  return {
    in1: in1 ? "done" : nothing ? "available" : "disabled",
    out1: out1 ? "done" : in1 && !out1 ? "available" : "disabled",
    // In 2 opens at the very start (second-shift-only) or after Out 1 — never mid-shift-1.
    in2: in2 ? "done" : !out2 && (nothing || out1) ? "available" : "disabled",
    out2: out2 ? "done" : in2 && !out2 ? "available" : "disabled",
  };
}

function rowName(e: TimeEntry): string {
  const n = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim();
  return n || "(unnamed)";
}

// #53: these name the TIME PAIR, not the job's named shift.
const SLOT_LABEL: Record<Slot, string> = {
  in1: "Time In 1",
  out1: "Time Out 1",
  in2: "Time In 2",
  out2: "Time Out 2",
};
const SLOT_BLOCK: Record<Slot, 1 | 2> = { in1: 1, out1: 1, in2: 2, out2: 2 };

/** Key a timesheet row to its crew assignment — same grain the grid uses. */
function slotKey(employeeKey: string | null | undefined, workDate: string | null | undefined, shiftId: string | null | undefined): string {
  return `${employeeKey || ""}|${workDate || ""}|${shiftId || ""}`;
}

/** Long date for the on-screen clock: "Monday, August 11, 2026". */
function formatLongDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
/** Wall-clock with seconds, for the live header. */
function formatLiveTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
/** The date a work day belongs to, spelled out. Jobs cross midnight (#51). */
function formatWorkDate(ymd: string): string {
  if (!ymd || ymd === "no-date") return "No date";
  return formatLongDate(new Date(ymd + "T00:00:00"));
}

export default function TimeClockPage() {
  const [jobs, setJobs] = useState<JobRequest[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [day, setDay] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string>("");
  // #50: planned times + named shift for this job's crew, keyed by
  // (employee|date|shift). Empty map is survivable — the screen just shows
  // "not scheduled" rather than failing.
  const [crewSlots, setCrewSlots] = useState<Map<string, JobCrewSlot>>(new Map());

  // Signature modal state. pendingPunch carries the FROZEN instant (#52).
  const [sigOpen, setSigOpen] = useState(false);
  const [pendingPunch, setPendingPunch] = useState<{ slot: Slot; at: Date } | null>(null);
  const sigRef = useRef<SignaturePadHandle | null>(null);

  // Live clock. Starts null so the server-rendered markup and the first client
  // render agree; the interval fills it in immediately after mount.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const specialtyName = useMemo(() => {
    const m = new Map<string, string>();
    try {
      for (const s of loadSpecialties()) m.set(s.id, s.name);
    } catch { /* cache may be warming */ }
    return m;
  }, [timesheet]);

  useEffect(() => {
    document.title = "Time Clock";
    try {
      const all = loadJobRequests();
      // Most-recent event first; kiosk is opened for today's/near jobs.
      const sorted = [...all].sort((a, b) => (b.requestDate || "").localeCompare(a.requestDate || ""));
      setJobs(sorted);
    } catch { /* cache warming — StoreProvider guarantees it before render, but be safe */ }
  }, []);

  async function selectJob(id: string) {
    setJobId(id);
    setTimesheet(null);
    setSelectedRowId(null);
    setDay("");
    setCrewSlots(new Map());
    if (!id) return;
    setLoading(true);
    try {
      // Roster and schedule together — the schedule is what makes the punch
      // buttons meaningful, so don't render the roster without it.
      const [ts, slots] = await Promise.all([
        loadTimesheetForJobLive(id),
        loadJobCrewSlots(id).catch((e) => {
          console.error("[timeclock] loadJobCrewSlots failed:", e);
          return [] as JobCrewSlot[];
        }),
      ]);
      setTimesheet(ts);
      setCrewSlots(new Map(slots.map((s) => [slotKey(s.employeeKey, s.eventDate, s.shiftId), s])));
      const days = distinctDays(ts);
      const today = deviceLocalDate();
      setDay(days.includes(today) ? today : days[0] ?? "");
    } finally {
      setLoading(false);
    }
  }

  function distinctDays(ts: Timesheet | null): string[] {
    if (!ts) return [];
    const set = new Set<string>();
    for (const r of ts.rows) set.add(r.workDate || "no-date");
    return Array.from(set).sort();
  }

  const days = distinctDays(timesheet);
  const rows = useMemo(() => {
    if (!timesheet) return [];
    return timesheet.rows
      .filter((r) => (r.workDate || "no-date") === day)
      .sort((a, b) => rowName(a).localeCompare(rowName(b)));
  }, [timesheet, day]);

  const selectedRow = rows.find((r) => r.id === selectedRowId) || null;

  /** The crew assignment behind a timesheet row, if one matches. */
  const slotFor = useCallback((r: TimeEntry): JobCrewSlot | null =>
    crewSlots.get(slotKey(r.employeeKey, r.workDate, r.shiftId)) ?? null, [crewSlots]);

  /** Planned window text per block for a row: ["8:00 AM – 1:00 PM", ""]. */
  const plannedFor = useCallback((r: TimeEntry): [string, string] => {
    const s = slotFor(r);
    if (!s) return ["", ""];
    const { pair1, pair2 } = resolvePlannedTimes(s, s);
    return [formatClockRange(pair1.in, pair1.out), formatClockRange(pair2.in, pair2.out)];
  }, [slotFor]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  }

  // A tap on a slot button. The instant is FROZEN here (#52) and carried all
  // the way through — what the worker is shown and signs is exactly what gets
  // stored, however long they take over the signature.
  function onSlotTap(slot: Slot) {
    if (!selectedRow) return;
    const at = new Date();
    if (slot === "in1" || slot === "in2") {
      setPendingPunch({ slot, at });
      setSigOpen(true);
    } else {
      const ok = window.confirm(
        `${SLOT_LABEL[slot]} for ${rowName(selectedRow)}\n` +
        `${formatWorkDate(selectedRow.workDate || day)}\n` +
        `at ${formatClock(roundInstantToTimeString(at))}?`
      );
      if (ok) void applyPunch(selectedRow, slot, at);
    }
  }

  async function confirmSignature() {
    if (!selectedRow || !pendingPunch) return;
    const pad = sigRef.current;
    if (!pad || pad.isEmpty()) {
      flash("Please sign before confirming.");
      return;
    }
    const blob = await pad.toBlob();
    if (!blob) {
      flash("Could not capture signature — try again.");
      return;
    }
    setSigOpen(false);
    await applyPunch(selectedRow, pendingPunch.slot, pendingPunch.at, blob);
    setPendingPunch(null);
  }

  // Write the punch: rounded time → timesheet_entries (same path the crew leader
  // uses, so the record is identical), raw instant + signature → captures.
  // `at` is the instant frozen at tap time, NOT a fresh new Date() (#52).
  async function applyPunch(entry: TimeEntry, slot: Slot, at: Date, signatureBlob?: Blob) {
    if (!jobId) return;
    setBusy(true);
    try {
      const tz = deviceTimeZone();
      // Phase 1 renders in the device (on-site) zone; job_requests.timezone is
      // stored for the eventual override but not threaded through the picker yet.
      const timeStr = roundInstantToTimeString(at, undefined);

      // Reload fresh to avoid clobbering a concurrent edit, then patch one field.
      const fresh = await loadTimesheetForJobLive(jobId);
      if (!fresh) { flash("Could not load the timesheet — try again."); return; }

      const patch: Partial<TimeEntry> =
        slot === "in1" ? { timeIn1: timeStr }
        : slot === "out1" ? { timeOut1: timeStr }
        : slot === "in2" ? { timeIn2: timeStr }
        : { timeOut2: timeStr };

      // promoteWorkedStatus: a punch turns a 'planned' row into a real
      // 'submitted' one — it now has time on it and belongs in review (#54).
      const nextRows = fresh.rows.map((r) =>
        (r.id === entry.id ? promoteWorkedStatus(computeTimeEntry({ ...r, ...patch })) : r));
      const nextTs: Timesheet = { ...fresh, rows: nextRows };
      upsertTimesheet(nextTs); // updates shared cache + syncs to DB in background

      // Upload signature (sign-ins only), then write the audit/capture row.
      let signaturePath: string | undefined;
      if (signatureBlob && (slot === "in1" || slot === "in2")) {
        signaturePath = await uploadSignature(entry.id, slot, signatureBlob);
      }
      const isoAt = at.toISOString();
      await upsertCapture(entry.id, {
        captureTz: tz,
        capturedEmployeeKey: entry.employeeKey ?? null,
        ...(slot === "in1" ? { actualIn1: isoAt, signatureIn1Path: signaturePath } : {}),
        ...(slot === "out1" ? { actualOut1: isoAt } : {}),
        ...(slot === "in2" ? { actualIn2: isoAt, signatureIn2Path: signaturePath } : {}),
        ...(slot === "out2" ? { actualOut2: isoAt } : {}),
      });

      setTimesheet(nextTs);
      flash(`${SLOT_LABEL[slot]} recorded for ${rowName(entry)} at ${formatClock(timeStr)}.`);
    } catch (err) {
      console.error("[timeclock] applyPunch failed:", err);
      flash("Something went wrong saving that punch.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Styles (inline — kiosk is self-contained, big touch targets) ──────────
  const card: React.CSSProperties = { background: "#1e293b", border: "1px solid #334155", borderRadius: 12, color: "#e2e8f0" };
  const label: React.CSSProperties = { color: "#94a3b8", fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };

  const selectedPlanned = selectedRow ? plannedFor(selectedRow) : ["", ""] as [string, string];
  const selectedSlot = selectedRow ? slotFor(selectedRow) : null;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px 64px", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 30 }}>⏱️</span>
          <h1 style={{ color: "#f1f5f9", fontSize: 24, margin: 0 }}>Time Clock</h1>
        </div>
        {/* #51/#53: date AND time, prominently — many jobs cross midnight, so
            "which day am I punching?" has to be answerable at a glance. */}
        <div style={{ textAlign: "right", flex: "1 1 auto" }}>
          <div style={{ color: "#f1f5f9", fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
            {now ? formatLiveTime(now) : "—"}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13 }}>{now ? formatLongDate(now) : ""}</div>
        </div>
        <a href="/dashboard" style={{ color: "#64748b", fontSize: 13, textDecoration: "none" }}>Exit</a>
      </header>

      {/* Job + day picker */}
      <div style={{ ...card, padding: 16, marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <div style={label}>Job</div>
          <select
            value={jobId}
            onChange={(e) => void selectJob(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: "10px 12px", fontSize: 15, borderRadius: 8, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0" }}
          >
            <option value="">Select a job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {[j.client, j.eventName].filter(Boolean).join(" — ")}{j.requestDate ? ` (${j.requestDate})` : ""}
              </option>
            ))}
          </select>
        </div>
        {timesheet && days.length > 0 && (
          <div style={{ flex: "0 1 220px" }}>
            <div style={label}>Work day</div>
            <select
              value={day}
              onChange={(e) => { setDay(e.target.value); setSelectedRowId(null); }}
              style={{ width: "100%", marginTop: 6, padding: "10px 12px", fontSize: 15, borderRadius: 8, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0" }}
            >
              {days.map((d) => <option key={d} value={d}>{d === "no-date" ? "No date" : d}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Which day these punches land on, spelled out — the picker above shows
          a bare ISO date, which is easy to misread on a job crossing midnight. */}
      {timesheet && day && (
        <div style={{ ...card, padding: "10px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            Punching for <strong style={{ color: "#e2e8f0" }}>{formatWorkDate(day)}</strong>
          </span>
          {now && deviceLocalDate(now) !== day && (
            <span style={{ background: "#78350f", color: "#fde68a", borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>
              ⚠ Not today
            </span>
          )}
        </div>
      )}

      {loading && <p style={{ color: "#94a3b8" }}>Loading roster…</p>}

      {jobId && !loading && !timesheet && (
        <div style={{ ...card, padding: 20, color: "#fbbf24" }}>
          No timesheet exists for this job yet. Have the crew leader import the crew on the Timekeeping screen first.
        </div>
      )}

      {/* Roster (hidden while a row is selected) */}
      {timesheet && !selectedRow && (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.length === 0 && <p style={{ color: "#94a3b8" }}>No crew on this day.</p>}
          {rows.map((r) => {
            const st = slotStates(r);
            const doneCount = (["in1", "out1", "in2", "out2"] as Slot[]).filter((s) => st[s] === "done").length;
            const spec = r.specialtyId ? specialtyName.get(r.specialtyId) : "";
            const s = slotFor(r);
            const [p1, p2] = plannedFor(r);
            return (
              <button
                key={r.id}
                onClick={() => setSelectedRowId(r.id)}
                style={{ ...card, textAlign: "left", padding: 16, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
              >
                <span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>{rowName(r)}</span>
                  {/* #50/#53: the job's NAMED shift (Load In, Show) — crew on
                      one day routinely span more than one. */}
                  {s?.shiftLabel && (
                    <span style={{ marginLeft: 8, background: "#334155", color: "#cbd5e1", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
                      {s.shiftLabel}
                    </span>
                  )}
                  <span style={{ display: "block", color: "#94a3b8", fontSize: 13, marginTop: 2 }}>
                    {[r.position, spec].filter(Boolean).join(" · ") || "—"}
                  </span>
                  <span style={{ display: "block", color: "#64748b", fontSize: 12, marginTop: 2 }}>
                    {p1 || p2
                      ? `Scheduled ${[p1, p2].filter(Boolean).join(" · ")}`
                      : "No scheduled time"}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {(["in1", "out1", "in2", "out2"] as Slot[]).map((sl) => (
                    <span key={sl} title={SLOT_LABEL[sl]} style={{
                      width: 12, height: 12, borderRadius: "50%",
                      background: st[sl] === "done" ? "#22c55e" : st[sl] === "available" ? "#eab308" : "#334155",
                    }} />
                  ))}
                  <span style={{ color: "#64748b", fontSize: 12, marginLeft: 6 }}>{doneCount}/4</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Action panel for a selected row */}
      {selectedRow && (
        <div style={{ ...card, padding: 20 }}>
          <button onClick={() => setSelectedRowId(null)} style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, marginBottom: 12 }}>← Back to list</button>
          <h2 style={{ color: "#f1f5f9", fontSize: 22, margin: "0 0 2px" }}>
            {rowName(selectedRow)}
            {selectedSlot?.shiftLabel && (
              <span style={{ marginLeft: 10, background: "#334155", color: "#cbd5e1", borderRadius: 999, padding: "3px 12px", fontSize: 13, fontWeight: 700, verticalAlign: "middle" }}>
                {selectedSlot.shiftLabel}
              </span>
            )}
          </h2>
          <p style={{ color: "#94a3b8", margin: "0 0 4px", fontSize: 14 }}>
            {[selectedRow.position, selectedRow.specialtyId ? specialtyName.get(selectedRow.specialtyId) : ""].filter(Boolean).join(" · ")}
          </p>
          <p style={{ color: "#64748b", margin: "0 0 18px", fontSize: 13 }}>
            {formatWorkDate(selectedRow.workDate || day)}
            {(selectedPlanned[0] || selectedPlanned[1])
              ? ` · scheduled ${[selectedPlanned[0], selectedPlanned[1]].filter(Boolean).join(" · ")}`
              : " · no scheduled time on file"}
          </p>

          {/* #49/#53: the two blocks are separated and each is labelled with
              its own planned window, so "which button do I press" is answered
              by the screen rather than guessed. Block 2 stays tappable from the
              start — second-shift-only workers need it — but it can no longer
              be mistaken for block 1. */}
          <div style={{ display: "grid", gap: 16 }}>
            {([1, 2] as const).map((block) => {
              const blockSlots = (["in1", "out1", "in2", "out2"] as Slot[]).filter((s) => SLOT_BLOCK[s] === block);
              const planned = selectedPlanned[block - 1];
              return (
                <div key={block}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ ...label, fontSize: 14 }}>Block {block}</span>
                    <span style={{ color: planned ? "#cbd5e1" : "#64748b", fontSize: 13 }}>
                      {planned ? `Scheduled ${planned}` : "No scheduled time for this block"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {blockSlots.map((slot) => {
                      const st = slotStates(selectedRow)[slot];
                      const timeVal = selectedRow[slot === "in1" ? "timeIn1" : slot === "out1" ? "timeOut1" : slot === "in2" ? "timeIn2" : "timeOut2"];
                      const isIn = slot === "in1" || slot === "in2";
                      const disabled = st !== "available" || busy;
                      const bg = st === "done" ? "#14532d" : st === "available" ? (isIn ? "#2563eb" : "#b45309") : "#1e293b";
                      const border = st === "available" ? "none" : "1px solid #334155";
                      return (
                        <button
                          key={slot}
                          disabled={disabled}
                          onClick={() => onSlotTap(slot)}
                          style={{
                            padding: "22px 16px", borderRadius: 10, border, background: bg,
                            color: st === "disabled" ? "#475569" : "#fff",
                            fontSize: 16, fontWeight: 700, cursor: disabled ? "default" : "pointer",
                            opacity: st === "disabled" ? 0.6 : 1, minHeight: 90,
                          }}
                        >
                          <div>{SLOT_LABEL[slot]}</div>
                          <div style={{ fontSize: 13, fontWeight: 500, marginTop: 6, color: st === "done" ? "#86efac" : "#e0e7ff" }}>
                            {st === "done"
                              ? `✓ ${formatClock(timeVal) || timeVal}`
                              : st === "available" ? (isIn ? "Tap to sign in" : "Tap to sign out") : "—"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Signature modal */}
      {sigOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}>
          <div style={{ ...card, padding: 20, width: 640, maxWidth: "100%" }}>
            <h3 style={{ color: "#f1f5f9", margin: "0 0 4px" }}>{pendingPunch ? SLOT_LABEL[pendingPunch.slot] : "Time In"}</h3>
            {/* #51/#52: name, DATE, and the exact time being recorded. The time
                is the frozen tap instant, so it cannot drift while signing. */}
            <p style={{ color: "#94a3b8", margin: "0 0 12px", fontSize: 14 }}>
              {selectedRow ? rowName(selectedRow) : ""} — sign below to record your time as{" "}
              <strong style={{ color: "#e2e8f0" }}>
                {pendingPunch ? formatClock(roundInstantToTimeString(pendingPunch.at)) : ""}
              </strong>{" "}
              on <strong style={{ color: "#e2e8f0" }}>{formatWorkDate(selectedRow?.workDate || day)}</strong>.
            </p>
            <SignaturePad ref={sigRef} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 10 }}>
              <button onClick={() => sigRef.current?.clear()} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #475569", background: "transparent", color: "#e2e8f0", cursor: "pointer" }}>Clear</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { setSigOpen(false); setPendingPunch(null); }} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #475569", background: "transparent", color: "#e2e8f0", cursor: "pointer" }}>Cancel</button>
                <button onClick={() => void confirmSignature()} disabled={busy} style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                  Confirm {pendingPunch ? SLOT_LABEL[pendingPunch.slot] : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: "#0b1220", border: "1px solid #334155", color: "#e2e8f0", padding: "12px 20px", borderRadius: 10, zIndex: 60, fontSize: 14 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

"use client";

// Time Clock kiosk (Phase 1).
//
// Flow: crew leader picks a Job + day → the day's pre-seeded timesheet rows are
// listed (one per employee/position/shift) → a worker taps their row → a
// four-slot action panel (Sign In / Sign Out for shift 1 & 2). Sign-in captures
// a signature; sign-out is one tap. Each punch writes the SAME
// timesheet_entries.time_in1..out2 field the crew leader edits (via the normal
// upsertTimesheet path, so the record is identical), plus the raw instant +
// signature into timesheet_captures for audit/provenance.
//
// The kiosk is capture-only: no notes/overrides here. Corrections happen on the
// timekeeping screen. Button state is DERIVED from time_in1..out2, so times a
// crew leader typed there (e.g. a no-signal backfill) enable the right buttons.

import { useEffect, useMemo, useRef, useState } from "react";
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

const SLOT_LABEL: Record<Slot, string> = {
  in1: "Sign In — Shift 1",
  out1: "Sign Out — Shift 1",
  in2: "Sign In — Shift 2",
  out2: "Sign Out — Shift 2",
};

export default function TimeClockPage() {
  const [jobs, setJobs] = useState<JobRequest[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [day, setDay] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string>("");

  // Signature modal state
  const [sigOpen, setSigOpen] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);
  const sigRef = useRef<SignaturePadHandle | null>(null);

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
    if (!id) return;
    setLoading(true);
    try {
      const ts = await loadTimesheetForJobLive(id);
      setTimesheet(ts);
      const days = distinctDays(ts);
      const today = deviceLocalDate();
      setDay(days.includes(today) ? today : days[0] ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (!jobId) return;
    const ts = await loadTimesheetForJobLive(jobId);
    setTimesheet(ts);
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

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  }

  // A tap on a slot button. Sign-ins open the signature modal first; sign-outs
  // confirm and apply immediately.
  function onSlotTap(slot: Slot) {
    if (!selectedRow) return;
    if (slot === "in1" || slot === "in2") {
      setPendingSlot(slot);
      setSigOpen(true);
    } else {
      const ok = window.confirm(`${SLOT_LABEL[slot]} for ${rowName(selectedRow)} at ${roundInstantToTimeString(new Date())}?`);
      if (ok) void applyPunch(selectedRow, slot);
    }
  }

  async function confirmSignature() {
    if (!selectedRow || !pendingSlot) return;
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
    await applyPunch(selectedRow, pendingSlot, blob);
    setPendingSlot(null);
  }

  // Write the punch: rounded time → timesheet_entries (same path the crew leader
  // uses, so the record is identical), raw instant + signature → captures.
  async function applyPunch(entry: TimeEntry, slot: Slot, signatureBlob?: Blob) {
    if (!jobId) return;
    setBusy(true);
    try {
      const now = new Date();
      const tz = deviceTimeZone();
      // Phase 1 renders in the device (on-site) zone; job_requests.timezone is
      // stored for the eventual override but not threaded through the picker yet.
      const timeStr = roundInstantToTimeString(now, undefined);

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
      const isoNow = now.toISOString();
      await upsertCapture(entry.id, {
        captureTz: tz,
        capturedEmployeeKey: entry.employeeKey ?? null,
        ...(slot === "in1" ? { actualIn1: isoNow, signatureIn1Path: signaturePath } : {}),
        ...(slot === "out1" ? { actualOut1: isoNow } : {}),
        ...(slot === "in2" ? { actualIn2: isoNow, signatureIn2Path: signaturePath } : {}),
        ...(slot === "out2" ? { actualOut2: isoNow } : {}),
      });

      setTimesheet(nextTs);
      flash(`${SLOT_LABEL[slot]} recorded for ${rowName(entry)} at ${timeStr}.`);
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

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px 64px", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 30 }}>⏱️</span>
          <h1 style={{ color: "#f1f5f9", fontSize: 24, margin: 0 }}>Time Clock</h1>
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
            <div style={label}>Day</div>
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
            return (
              <button
                key={r.id}
                onClick={() => setSelectedRowId(r.id)}
                style={{ ...card, textAlign: "left", padding: 16, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
              >
                <span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>{rowName(r)}</span>
                  <span style={{ display: "block", color: "#94a3b8", fontSize: 13, marginTop: 2 }}>
                    {[r.position, spec].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  {(["in1", "out1", "in2", "out2"] as Slot[]).map((s) => (
                    <span key={s} title={SLOT_LABEL[s]} style={{
                      width: 12, height: 12, borderRadius: "50%",
                      background: st[s] === "done" ? "#22c55e" : st[s] === "available" ? "#eab308" : "#334155",
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
          <h2 style={{ color: "#f1f5f9", fontSize: 22, margin: "0 0 2px" }}>{rowName(selectedRow)}</h2>
          <p style={{ color: "#94a3b8", margin: "0 0 18px", fontSize: 14 }}>
            {[selectedRow.position, selectedRow.specialtyId ? specialtyName.get(selectedRow.specialtyId) : ""].filter(Boolean).join(" · ")}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {(["in1", "out1", "in2", "out2"] as Slot[]).map((slot) => {
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
                    {st === "done" ? `✓ ${timeVal}` : st === "available" ? (isIn ? "Tap to sign in" : "Tap to sign out") : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Signature modal */}
      {sigOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}>
          <div style={{ ...card, padding: 20, width: 640, maxWidth: "100%" }}>
            <h3 style={{ color: "#f1f5f9", margin: "0 0 4px" }}>{pendingSlot ? SLOT_LABEL[pendingSlot] : "Sign In"}</h3>
            <p style={{ color: "#94a3b8", margin: "0 0 12px", fontSize: 14 }}>
              {selectedRow ? rowName(selectedRow) : ""} — sign below to record your time as {roundInstantToTimeString(new Date())}.
            </p>
            <SignaturePad ref={sigRef} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 10 }}>
              <button onClick={() => sigRef.current?.clear()} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #475569", background: "transparent", color: "#e2e8f0", cursor: "pointer" }}>Clear</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { setSigOpen(false); setPendingSlot(null); }} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #475569", background: "transparent", color: "#e2e8f0", cursor: "pointer" }}>Cancel</button>
                <button onClick={() => void confirmSignature()} disabled={busy} style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Confirm Sign In</button>
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

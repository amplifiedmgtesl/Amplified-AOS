"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  loadJobRequestDays,
  loadCrewNeedsForRequest,
  upsertJobRequestDay,
  deleteJobRequestDay,
  upsertJobRequestCrewNeed,
  deleteJobRequestCrewNeed,
} from "@/lib/storage/job-request-days";
import { timeOptions } from "@/lib/store/timekeeping";
import type {
  JobRequestDay,
  JobRequestCrewNeed,
  Position,
  Specialty,
} from "@/lib/store/types";

const TIMES = timeOptions();

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextDayISO(iso: string): string {
  if (!iso) return todayISO();
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function newDayId(jobRequestId: string, eventDate: string): string {
  return `${jobRequestId}_d${eventDate.replace(/-/g, "")}`;
}

function newCrewNeedId(): string {
  return `jrcn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function JobRequestDaysSection({
  jobRequestId,
  disabled = false,
  onChange,
  hideHeader = false,
  jobStartDate,
}: {
  jobRequestId: string;
  disabled?: boolean;
  onChange?: () => void;
  hideHeader?: boolean;
  /**
   * The parent job's start date (request_date), used as the default
   * for the FIRST day added. Subsequent days default to "day-after-last".
   * Picker stays unrestricted so users can add setup/prep days before
   * the event date or buffer days after.
   */
  jobStartDate?: string;
}) {
  const [days, setDays] = useState<JobRequestDay[]>([]);
  const [crewByDayId, setCrewByDayId] = useState<Record<string, JobRequestCrewNeed[]>>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Load positions + specialties once.
  useEffect(() => {
    Promise.all([
      supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
    ]).then(([posRes, spcRes]) => {
      setPositions((posRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      })));
      setSpecialties((spcRes.data ?? []).map((r: any) => ({
        id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      })));
    });
  }, []);

  async function reload() {
    if (!jobRequestId) { setDays([]); setCrewByDayId({}); setLoading(false); return; }
    setLoading(true);
    try {
      const ds = await loadJobRequestDays(jobRequestId);
      setDays(ds);
      const allCrew = await loadCrewNeedsForRequest(jobRequestId);
      const grouped: Record<string, JobRequestCrewNeed[]> = {};
      for (const d of ds) grouped[d.id] = [];
      for (const c of allCrew) {
        if (!grouped[c.jobRequestDayId]) grouped[c.jobRequestDayId] = [];
        grouped[c.jobRequestDayId].push(c);
      }
      setCrewByDayId(grouped);
      // Default-expand if 1 day; collapse all otherwise.
      setExpandedIds(ds.length <= 1 ? new Set(ds.map((d) => d.id)) : new Set());
    } catch (err: any) {
      setMsg({ text: `Load failed: ${err?.message ?? err}`, ok: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [jobRequestId]);

  const specialtiesByPosition = useMemo(() => {
    const map = new Map<string, Specialty[]>();
    for (const s of specialties) {
      const list = map.get(s.positionId) ?? [];
      list.push(s);
      map.set(s.positionId, list);
    }
    return map;
  }, [specialties]);

  function flash(text: string, ok = true) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 2500);
  }

  // ─── Day actions ───────────────────────────────────────────────────────────
  async function addDay() {
    // First day defaults to the parent job's start date if known (so a fresh
    // multi-day job lands on the right day immediately). Subsequent days roll
    // forward by one. The picker itself stays unrestricted — users can
    // back-date for setup days or move forward for buffer/cleanup days.
    const lastDate = days.length > 0 ? days[days.length - 1].eventDate : (jobStartDate || todayISO());
    const proposed = days.length === 0 ? (jobStartDate || todayISO()) : nextDayISO(lastDate);
    if (days.some((d) => d.eventDate === proposed)) {
      flash(`A day with date ${proposed} already exists.`, false);
      return;
    }
    const newDay: JobRequestDay = {
      id: newDayId(jobRequestId, proposed),
      jobRequestId,
      eventDate: proposed,
      sortOrder: days.length,
      expectedHours: 10,
    };
    try {
      const persisted = await upsertJobRequestDay(newDay);
      setDays((cur) => [...cur, persisted]);
      setCrewByDayId((cur) => ({ ...cur, [persisted.id]: [] }));
      // Auto-expand new days so user can fill them in immediately.
      setExpandedIds((cur) => { const n = new Set(cur); n.add(persisted.id); return n; });
      onChange?.();
    } catch (err: any) {
      flash(`Add day failed: ${err?.message ?? err}`, false);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function expandAll() { setExpandedIds(new Set(days.map((d) => d.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  function dayLabel(d: JobRequestDay): string {
    const date = d.eventDate;
    const weekday = date ? new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }) : "";
    return weekday ? `${weekday} ${date}` : date;
  }
  function daySummary(d: JobRequestDay, crewCount: number): string {
    const bits: string[] = [];
    if (d.callTime) bits.push(`call ${d.callTime}`);
    if (d.startTime || d.endTime) bits.push(`${d.startTime || "?"}–${d.endTime || "?"}`);
    if (d.expectedHours) bits.push(`${d.expectedHours}h`);
    bits.push(`${crewCount} crew`);
    if (d.notes) bits.push(d.notes);
    return bits.join(" · ");
  }

  async function patchDay(d: JobRequestDay, patch: Partial<JobRequestDay>) {
    const next = { ...d, ...patch };
    setDays((cur) => cur.map((x) => (x.id === d.id ? next : x)));
    try {
      await upsertJobRequestDay(next);
      onChange?.();
    } catch (err: any) {
      flash(`Save failed: ${err?.message ?? err}`, false);
      // revert
      setDays((cur) => cur.map((x) => (x.id === d.id ? d : x)));
    }
  }

  async function removeDay(d: JobRequestDay) {
    if (!confirm(`Remove day ${d.eventDate} and all its crew needs?`)) return;
    try {
      await deleteJobRequestDay(d.id);
      setDays((cur) => cur.filter((x) => x.id !== d.id));
      setCrewByDayId((cur) => {
        const next = { ...cur };
        delete next[d.id];
        return next;
      });
      onChange?.();
    } catch (err: any) {
      flash(`Delete failed: ${err?.message ?? err}`, false);
    }
  }

  async function duplicatePreviousDay(d: JobRequestDay, prev: JobRequestDay) {
    // Copy times + crew needs from prev to d.
    const patch: Partial<JobRequestDay> = {
      callTime: prev.callTime,
      startTime: prev.startTime,
      endTime: prev.endTime,
      expectedHours: prev.expectedHours,
    };
    await patchDay(d, patch);
    const prevCrew = crewByDayId[prev.id] ?? [];
    for (const c of prevCrew) {
      const copy: JobRequestCrewNeed = {
        ...c,
        id: newCrewNeedId(),
        jobRequestDayId: d.id,
      };
      await upsertJobRequestCrewNeed(copy);
    }
    await reload();
  }

  // ─── Crew need actions ─────────────────────────────────────────────────────
  async function addCrewNeed(dayId: string) {
    const existing = crewByDayId[dayId] ?? [];
    const need: JobRequestCrewNeed = {
      id: newCrewNeedId(),
      jobRequestDayId: dayId,
      quantity: 1,
      sortOrder: existing.length,
    };
    try {
      const persisted = await upsertJobRequestCrewNeed(need);
      setCrewByDayId((cur) => ({ ...cur, [dayId]: [...(cur[dayId] ?? []), persisted] }));
    } catch (err: any) {
      flash(`Add crew need failed: ${err?.message ?? err}`, false);
    }
  }

  async function patchCrewNeed(dayId: string, c: JobRequestCrewNeed, patch: Partial<JobRequestCrewNeed>) {
    const next = { ...c, ...patch };
    setCrewByDayId((cur) => ({
      ...cur,
      [dayId]: (cur[dayId] ?? []).map((x) => (x.id === c.id ? next : x)),
    }));
    try {
      await upsertJobRequestCrewNeed(next);
    } catch (err: any) {
      flash(`Save failed: ${err?.message ?? err}`, false);
    }
  }

  async function removeCrewNeed(dayId: string, c: JobRequestCrewNeed) {
    try {
      await deleteJobRequestCrewNeed(c.id);
      setCrewByDayId((cur) => ({
        ...cur,
        [dayId]: (cur[dayId] ?? []).filter((x) => x.id !== c.id),
      }));
    } catch (err: any) {
      flash(`Delete failed: ${err?.message ?? err}`, false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  if (!jobRequestId) {
    return (
      <SectionFrame hideHeader={hideHeader}>
        <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
          Save the job request first to start adding days and crew requirements.
        </div>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame hideHeader={hideHeader}>
      {msg && (
        <div style={{
          background: msg.ok ? "#eef9ee" : "#fff3f3",
          border: `1px solid ${msg.ok ? "#b6e0b6" : "#e0a0a0"}`,
          color: msg.ok ? "#2e6b2e" : "#a00",
          borderRadius: 6, padding: "6px 12px", fontSize: 12, marginBottom: 8,
        }}>{msg.text}</div>
      )}

      {loading ? (
        <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {days.length === 0 && (
            <div className="muted" style={{ fontSize: 13, padding: "4px 0 12px" }}>
              No days yet. Add the first day of the event to begin.
            </div>
          )}

          {days.length > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 12 }}>
              <span className="muted">{days.length} days</span>
              <button type="button" className="secondary" onClick={expandAll} style={{ fontSize: 11, padding: "2px 8px" }}>Expand all</button>
              <button type="button" className="secondary" onClick={collapseAll} style={{ fontSize: 11, padding: "2px 8px" }}>Collapse all</button>
            </div>
          )}

          {days.map((d, idx) => {
            const prev = idx > 0 ? days[idx - 1] : null;
            const crew = crewByDayId[d.id] ?? [];
            const isExpanded = expandedIds.has(d.id);
            return (
              <div key={d.id} style={{
                border: "1px solid var(--border, #e5e7eb)", borderRadius: 8,
                marginBottom: 10,
              }}>
                <button
                  type="button"
                  onClick={() => toggleExpanded(d.id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    background: isExpanded ? "var(--accent, #2563eb)" : "#f7f4ee",
                    color: isExpanded ? "#fff" : "#1a1a1a",
                    border: "none", borderRadius: isExpanded ? "8px 8px 0 0" : 8,
                    padding: "10px 14px", cursor: "pointer", textAlign: "left",
                    borderBottom: isExpanded ? "1px solid var(--border, #e5e7eb)" : "none",
                  }}
                >
                  <span style={{ fontSize: 12, opacity: 0.85, width: 12 }}>{isExpanded ? "▾" : "▸"}</span>
                  <strong style={{ fontSize: 14, minWidth: 140 }}>{dayLabel(d)}</strong>
                  <span style={{ fontSize: 12, flex: 1, opacity: 0.85 }}>{daySummary(d, crew.length)}</span>
                </button>
                {isExpanded && (
                <div style={{ padding: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "130px 110px 110px 110px 90px 1fr 80px", gap: 8, alignItems: "end" }}>
                  <div>
                    <small>Date</small>
                    <input
                      type="date"
                      disabled={disabled}
                      value={d.eventDate}
                      onChange={(e) => patchDay(d, { eventDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <small>Call Time</small>
                    <select disabled={disabled} value={d.callTime ?? ""} onChange={(e) => patchDay(d, { callTime: e.target.value })}>
                      {TIMES.map((t) => <option key={t} value={t}>{t || "—"}</option>)}
                    </select>
                  </div>
                  <div>
                    <small>Start Time</small>
                    <select disabled={disabled} value={d.startTime ?? ""} onChange={(e) => patchDay(d, { startTime: e.target.value })}>
                      {TIMES.map((t) => <option key={t} value={t}>{t || "—"}</option>)}
                    </select>
                  </div>
                  <div>
                    <small>End Time</small>
                    <select disabled={disabled} value={d.endTime ?? ""} onChange={(e) => patchDay(d, { endTime: e.target.value })}>
                      {TIMES.map((t) => <option key={t} value={t}>{t || "—"}</option>)}
                    </select>
                  </div>
                  <div>
                    <small>Exp Hrs</small>
                    <input
                      type="number"
                      disabled={disabled}
                      value={d.expectedHours ?? 0}
                      onChange={(e) => patchDay(d, { expectedHours: Number(e.target.value || 0) })}
                    />
                  </div>
                  <div>
                    <small>Notes</small>
                    <input
                      disabled={disabled}
                      value={d.notes ?? ""}
                      onChange={(e) => patchDay(d, { notes: e.target.value })}
                      placeholder="e.g. Load-in day"
                    />
                  </div>
                  <div className="action-row" style={{ alignItems: "end", gap: 4 }}>
                    {prev && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={disabled}
                        title="Copy times + crew from previous day"
                        onClick={() => duplicatePreviousDay(d, prev)}
                        style={{ padding: "4px 8px", fontSize: 11 }}
                      >Dup ↑</button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      disabled={disabled}
                      onClick={() => removeDay(d)}
                      style={{ color: "#a00", padding: "4px 8px", fontSize: 12 }}
                    >✕</button>
                  </div>
                </div>

                <div style={{ marginTop: 10, paddingLeft: 8, borderLeft: "2px solid var(--border, #e5e7eb)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <strong style={{ fontSize: 12, opacity: 0.75 }}>Crew Needed ({crew.length})</strong>
                    <button
                      type="button"
                      className="secondary"
                      disabled={disabled}
                      onClick={() => addCrewNeed(d.id)}
                      style={{ fontSize: 11, padding: "2px 8px" }}
                    >+ Add Position</button>
                  </div>
                  {crew.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12, padding: "4px 0" }}>
                      No crew positions specified for this day yet.
                    </div>
                  ) : (
                    <table style={{ width: "100%", fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Position</th>
                          <th style={{ textAlign: "left" }}>Specialty</th>
                          <th style={{ textAlign: "left", width: 70 }}>Qty</th>
                          <th style={{ textAlign: "left" }}>Notes</th>
                          <th style={{ width: 30 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {crew.map((c) => {
                          const spcOptions = c.positionId ? (specialtiesByPosition.get(c.positionId) ?? []) : [];
                          return (
                            <tr key={c.id}>
                              <td>
                                <select
                                  disabled={disabled}
                                  value={c.positionId ?? ""}
                                  onChange={(e) => patchCrewNeed(d.id, c, {
                                    positionId: e.target.value || undefined,
                                    specialtyId: undefined,
                                  })}
                                >
                                  <option value="">— Select —</option>
                                  {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              </td>
                              <td>
                                <select
                                  disabled={disabled || !c.positionId}
                                  value={c.specialtyId ?? ""}
                                  onChange={(e) => patchCrewNeed(d.id, c, { specialtyId: e.target.value || undefined })}
                                >
                                  <option value="">— Select —</option>
                                  {spcOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={0}
                                  disabled={disabled}
                                  value={c.quantity}
                                  onChange={(e) => patchCrewNeed(d.id, c, { quantity: Number(e.target.value || 0) })}
                                />
                              </td>
                              <td>
                                <input
                                  disabled={disabled}
                                  value={c.notes ?? ""}
                                  onChange={(e) => patchCrewNeed(d.id, c, { notes: e.target.value })}
                                  placeholder="optional"
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={disabled}
                                  onClick={() => removeCrewNeed(d.id, c)}
                                  style={{ color: "#a00", padding: "2px 6px", fontSize: 12 }}
                                >✕</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                </div>
                )}
              </div>
            );
          })}

          <button type="button" disabled={disabled} onClick={addDay}>
            + Add Day
          </button>
        </>
      )}
    </SectionFrame>
  );
}

function SectionFrame({ children, hideHeader = false }: { children: React.ReactNode; hideHeader?: boolean }) {
  return (
    <div style={hideHeader
      ? { marginTop: 4 }
      : { marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border, #e5e7eb)" }
    }>
      {!hideHeader && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Days &amp; Crew Requirements</h3>
        </div>
      )}
      {children}
    </div>
  );
}

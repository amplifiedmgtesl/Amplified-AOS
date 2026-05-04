"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  loadJobRequestDays,
  loadCrewNeedsForRequest,
} from "@/lib/storage/job-request-days";
import {
  loadAssignmentsForRequest,
  upsertAssignment,
  deleteAssignment,
} from "@/lib/storage/job-request-assignments";
import type {
  JobRequestDay,
  JobRequestAssignment,
  JobRequestCrewNeed,
  Position,
  Specialty,
} from "@/lib/store/types";
import { EmployeePicker } from "./employee-picker";

function newAssignmentId(): string {
  return `jra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function JobRequestCrewSection({
  jobRequestId,
  disabled = false,
  hideHeader = false,
}: {
  jobRequestId: string;
  disabled?: boolean;
  hideHeader?: boolean;
}) {
  const [days, setDays] = useState<JobRequestDay[]>([]);
  const [assignmentsByDay, setAssignmentsByDay] = useState<Record<string, JobRequestAssignment[]>>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [crewNeedsByDay, setCrewNeedsByDay] = useState<Record<string, JobRequestCrewNeed[]>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Load positions + specialties once. Employees are loaded by EmployeePicker
  // on first focus (search-on-type, scales to thousands).
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
    if (!jobRequestId) { setDays([]); setAssignmentsByDay({}); setCrewNeedsByDay({}); setLoading(false); return; }
    setLoading(true);
    try {
      const ds = await loadJobRequestDays(jobRequestId);
      setDays(ds);
      const [allAsg, allNeeds] = await Promise.all([
        loadAssignmentsForRequest(jobRequestId),
        loadCrewNeedsForRequest(jobRequestId),
      ]);
      const grouped: Record<string, JobRequestAssignment[]> = {};
      for (const d of ds) grouped[d.id] = [];
      for (const a of allAsg) {
        if (!grouped[a.jobRequestDayId]) grouped[a.jobRequestDayId] = [];
        grouped[a.jobRequestDayId].push(a);
      }
      setAssignmentsByDay(grouped);

      const groupedNeeds: Record<string, JobRequestCrewNeed[]> = {};
      for (const d of ds) groupedNeeds[d.id] = [];
      for (const n of allNeeds) {
        if (!groupedNeeds[n.jobRequestDayId]) groupedNeeds[n.jobRequestDayId] = [];
        groupedNeeds[n.jobRequestDayId].push(n);
      }
      setCrewNeedsByDay(groupedNeeds);

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

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function expandAll()   { setExpandedIds(new Set(days.map((d) => d.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  async function addAssignment(dayId: string) {
    const existing = assignmentsByDay[dayId] ?? [];
    const next: JobRequestAssignment = {
      id: newAssignmentId(),
      jobRequestDayId: dayId,
      confirmed: false,
      sortOrder: existing.length,
    };
    try {
      const persisted = await upsertAssignment(next);
      setAssignmentsByDay((cur) => ({ ...cur, [dayId]: [...(cur[dayId] ?? []), persisted] }));
    } catch (err: any) {
      flash(`Add failed: ${err?.message ?? err}`, false);
    }
  }

  async function patchAssignment(dayId: string, a: JobRequestAssignment, patch: Partial<JobRequestAssignment>) {
    const next = { ...a, ...patch };
    setAssignmentsByDay((cur) => ({
      ...cur,
      [dayId]: (cur[dayId] ?? []).map((x) => (x.id === a.id ? next : x)),
    }));
    try {
      await upsertAssignment(next);
    } catch (err: any) {
      flash(`Save failed: ${err?.message ?? err}`, false);
    }
  }

  async function removeAssignment(dayId: string, a: JobRequestAssignment) {
    try {
      await deleteAssignment(a.id);
      setAssignmentsByDay((cur) => ({
        ...cur,
        [dayId]: (cur[dayId] ?? []).filter((x) => x.id !== a.id),
      }));
    } catch (err: any) {
      flash(`Delete failed: ${err?.message ?? err}`, false);
    }
  }

  async function copyFromPreviousDay(dayId: string, prevDayId: string) {
    const prev = assignmentsByDay[prevDayId] ?? [];
    if (prev.length === 0) { flash("Previous day has no assignments to copy.", false); return; }
    if (!confirm(`Copy ${prev.length} crew assignment(s) from the previous day?`)) return;
    try {
      const created: JobRequestAssignment[] = [];
      for (const a of prev) {
        const copy: JobRequestAssignment = {
          ...a,
          id: newAssignmentId(),
          jobRequestDayId: dayId,
          confirmed: false,
          sortOrder: created.length,
        };
        created.push(await upsertAssignment(copy));
      }
      setAssignmentsByDay((cur) => ({ ...cur, [dayId]: [...(cur[dayId] ?? []), ...created] }));
      flash(`Copied ${created.length} assignment(s).`);
    } catch (err: any) {
      flash(`Copy failed: ${err?.message ?? err}`, false);
    }
  }

  function dayLabel(d: JobRequestDay): string {
    const date = d.eventDate;
    const wd = date ? new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }) : "";
    return wd ? `${wd} ${date}` : date;
  }

  if (!jobRequestId) {
    return (
      <SectionFrame hideHeader={hideHeader}>
        <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
          Save the job request first to start assigning crew.
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
      ) : days.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, padding: "4px 0 12px" }}>
          No days defined yet. Add days under the Daily Requirements tab first.
        </div>
      ) : (
        <>
          {days.length > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 12 }}>
              <span className="muted">{days.length} days</span>
              <button type="button" className="secondary" onClick={expandAll} style={{ fontSize: 11, padding: "2px 8px" }}>Expand all</button>
              <button type="button" className="secondary" onClick={collapseAll} style={{ fontSize: 11, padding: "2px 8px" }}>Collapse all</button>
            </div>
          )}

          {days.map((d, idx) => {
            const isExpanded = expandedIds.has(d.id);
            const crew = assignmentsByDay[d.id] ?? [];
            const needs = crewNeedsByDay[d.id] ?? [];
            const confirmedCount = crew.filter((c) => c.confirmed).length;
            const prev = idx > 0 ? days[idx - 1] : null;

            // Spec adherence per position: aggregate need + confirmed by
            // position id (NULL key for positionless rows).
            type Stat = { need: number; confirmed: number };
            const byPosition = new Map<string, Stat>();
            for (const n of needs) {
              const k = n.positionId || "(none)";
              const s = byPosition.get(k) ?? { need: 0, confirmed: 0 };
              s.need += n.quantity || 0;
              byPosition.set(k, s);
            }
            for (const a of crew.filter((x) => x.confirmed)) {
              const k = a.positionId || "(none)";
              const s = byPosition.get(k) ?? { need: 0, confirmed: 0 };
              s.confirmed += 1;
              byPosition.set(k, s);
            }
            let totalNeed = 0, totalConfirmed = 0, deficit = 0, extras = 0;
            for (const s of byPosition.values()) {
              totalNeed += s.need;
              totalConfirmed += Math.min(s.need, s.confirmed); // counts only spec-fulfilling
              if (s.confirmed < s.need) deficit += s.need - s.confirmed;
              if (s.confirmed > s.need) extras += s.confirmed - s.need;
            }
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
                  <span style={{ fontSize: 12, flex: 1, opacity: 0.9, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {totalNeed > 0 && (
                      <span>{totalConfirmed}/{totalNeed} spec filled</span>
                    )}
                    {totalNeed === 0 && crew.length > 0 && (
                      <span>{crew.length} assigned (no spec set)</span>
                    )}
                    {confirmedCount > 0 && totalNeed === 0 && (
                      <span>· {confirmedCount} confirmed</span>
                    )}
                    {deficit > 0 && (
                      <span style={{
                        background: isExpanded ? "rgba(255,255,255,0.2)" : "#fef3e8",
                        color: isExpanded ? "#fff" : "#9a3412",
                        borderRadius: 999, padding: "1px 8px", fontWeight: 700,
                      }}>−{deficit} short</span>
                    )}
                    {extras > 0 && (
                      <span style={{
                        background: isExpanded ? "rgba(255,255,255,0.2)" : "#eef5ff",
                        color: isExpanded ? "#fff" : "#1e3a8a",
                        borderRadius: 999, padding: "1px 8px", fontWeight: 700,
                      }}>+{extras} extra</span>
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div style={{ padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div className="muted" style={{ fontSize: 11 }}>
                        Pick the actual people scheduled for this day. Confirmed = they&apos;ve agreed to work it.
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {prev && (assignmentsByDay[prev.id]?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={disabled}
                            onClick={() => copyFromPreviousDay(d.id, prev.id)}
                            style={{ fontSize: 11, padding: "2px 8px" }}
                            title="Copy yesterday's assignments to today"
                          >Copy ↑</button>
                        )}
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => addAssignment(d.id)}
                          style={{ fontSize: 11, padding: "2px 10px" }}
                        >+ Add Crew Member</button>
                      </div>
                    </div>

                    {crew.length === 0 ? (
                      <div className="muted" style={{ fontSize: 12, padding: "6px 0" }}>
                        No one assigned for this day yet.
                      </div>
                    ) : (
                      <table style={{ width: "100%", fontSize: 12 }}>
                        <thead>
                          <tr style={{ color: "#666", fontSize: 11 }}>
                            <th style={{ textAlign: "left" }}>Employee</th>
                            <th style={{ textAlign: "left" }}>Position</th>
                            <th style={{ textAlign: "left" }}>Specialty</th>
                            <th style={{ textAlign: "left", width: 90 }}>Confirmed</th>
                            <th style={{ textAlign: "left" }}>Notes</th>
                            <th style={{ width: 30 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {crew.map((a) => {
                            const spcOptions = a.positionId ? (specialtiesByPosition.get(a.positionId) ?? []) : [];
                            return (
                              <tr key={a.id}>
                                <td>
                                  <EmployeePicker
                                    employeeKey={a.employeeKey}
                                    disabled={disabled}
                                    onSelect={(emp) => patchAssignment(d.id, a, { employeeKey: emp.employeeKey })}
                                  />
                                </td>
                                <td>
                                  <select
                                    disabled={disabled}
                                    value={a.positionId ?? ""}
                                    onChange={(e) => patchAssignment(d.id, a, {
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
                                    disabled={disabled || !a.positionId}
                                    value={a.specialtyId ?? ""}
                                    onChange={(e) => patchAssignment(d.id, a, { specialtyId: e.target.value || undefined })}
                                  >
                                    <option value="">— Select —</option>
                                    {spcOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <input
                                      type="checkbox"
                                      disabled={disabled}
                                      checked={a.confirmed}
                                      onChange={(e) => patchAssignment(d.id, a, { confirmed: e.target.checked })}
                                    />
                                    {a.confirmed ? "✓" : ""}
                                  </label>
                                </td>
                                <td>
                                  <input
                                    disabled={disabled}
                                    value={a.notes ?? ""}
                                    onChange={(e) => patchAssignment(d.id, a, { notes: e.target.value })}
                                    placeholder="optional"
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={disabled}
                                    onClick={() => removeAssignment(d.id, a)}
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
                )}
              </div>
            );
          })}
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
          <h3 style={{ margin: 0, fontSize: 14 }}>Assigned Crew</h3>
        </div>
      )}
      {children}
    </div>
  );
}

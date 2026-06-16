"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { loadShifts } from "@/lib/storage/job-request-shifts";
import type {
  JobRequestDay,
  JobRequestAssignment,
  JobRequestCrewNeed,
  JobRequestShift,
  Position,
  Specialty,
} from "@/lib/store/types";
import { LazyEmployeePicker } from "./employee-picker";
import { buildRosterWorkbookBlob } from "@/lib/storage/crew-roster-export";
import {
  parseRosterWorkbook,
  planEmployeeReconciliation,
  commitRosterImport,
  buildReexportBlob,
  type EmployeeMatch,
  type EmployeeDecision,
  type ParsedRoster,
} from "@/lib/storage/crew-roster-import";
import type { RosterSource } from "@/lib/storage/crew-roster-schema";

const menuItemStyle: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
  background: "none", border: "none", borderBottom: "1px solid #f0e9e0",
  cursor: "pointer", fontSize: 12, color: "#0366d6",
};

// Must match normName() in crew-roster-import.ts so decision keys line up.
function normNameKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
  const [shifts, setShifts] = useState<JobRequestShift[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [crewNeedsByDay, setCrewNeedsByDay] = useState<Record<string, JobRequestCrewNeed[]>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean; sticky?: boolean } | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ─── Roster spreadsheet round-trip ───────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // Pending name-variation decisions surfaced after an import parse.
  const [pendingImport, setPendingImport] = useState<{
    parsed: ParsedRoster;
    ambiguous: EmployeeMatch[];
    autoCreateCount: number;
    // employee normName -> chosen action
    choices: Record<string, EmployeeDecision>;
  } | null>(null);

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
    if (!jobRequestId) { setDays([]); setAssignmentsByDay({}); setCrewNeedsByDay({}); setShifts([]); setLoading(false); return; }
    setLoading(true);
    try {
      const ds = await loadJobRequestDays(jobRequestId);
      setDays(ds);
      const [allAsg, allNeeds, shiftList] = await Promise.all([
        loadAssignmentsForRequest(jobRequestId),
        loadCrewNeedsForRequest(jobRequestId),
        loadShifts(jobRequestId),
      ]);
      setShifts(shiftList);
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

  function flash(text: string, ok = true, sticky = false) {
    if (msgTimerRef.current) { clearTimeout(msgTimerRef.current); msgTimerRef.current = null; }
    setMsg({ text, ok, sticky });
    // Errors stay until dismissed; successes auto-clear.
    if (!sticky && ok) msgTimerRef.current = setTimeout(() => setMsg(null), 2500);
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

  async function doExport(source: RosterSource) {
    setExportMenuOpen(false);
    setRosterBusy(true);
    try {
      const { blob, filename } = await buildRosterWorkbookBlob(jobRequestId, source, new Date().toISOString());
      downloadBlob(blob, filename);
      flash(`Exported ${filename}.`);
    } catch (err: any) {
      flash(`Export failed: ${err?.message ?? err}`, false);
    } finally {
      setRosterBusy(false);
    }
  }

  async function onPickImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setRosterBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseRosterWorkbook(buffer);
      if (parsed.meta.jobRequestId !== jobRequestId) {
        throw new Error(
          `This sheet is for Job ${parsed.meta.jobNo || parsed.meta.jobRequestId} (${parsed.meta.eventName}); you're on a different job.`,
        );
      }
      const plan = await planEmployeeReconciliation(parsed);
      if (plan.ambiguous.length === 0) {
        await finalizeImport(parsed, {});
      } else {
        // Default every ambiguous row to its top candidate (link) — friction
        // is on choosing "create new", which the coordinator must opt into.
        const choices: Record<string, EmployeeDecision> = {};
        for (const m of plan.ambiguous) {
          choices[normNameKey(m.parsed.fullName)] = { action: "link", linkKey: m.candidates[0].employeeKey };
        }
        setPendingImport({ parsed, ambiguous: plan.ambiguous, autoCreateCount: plan.autoCreate.length, choices });
      }
    } catch (err: any) {
      flash(`Import failed: ${err?.message ?? err}`, false);
    } finally {
      setRosterBusy(false);
    }
  }

  async function finalizeImport(parsed: ParsedRoster, choices: Record<string, EmployeeDecision>) {
    setRosterBusy(true);
    try {
      const decisions = new Map<string, EmployeeDecision>(Object.entries(choices));
      const result = await commitRosterImport(jobRequestId, parsed, decisions, new Date().toISOString().slice(0, 10));
      // Re-export the reviewed workbook (the fix loop).
      const { blob, filename } = await buildReexportBlob(
        jobRequestId, parsed.meta.source, new Date().toISOString(), result.skipped,
      );
      downloadBlob(blob, filename);
      await reload();
      const bits = [
        `${result.assignmentsUpserted} loaded`,
        result.assignmentsDeleted ? `${result.assignmentsDeleted} removed` : "",
        result.employeesCreated ? `${result.employeesCreated} new` : "",
        result.skipped.length ? `${result.skipped.length} need fixing — see downloaded sheet` : "",
      ].filter(Boolean);
      flash(bits.join(" · "), result.skipped.length === 0);

      // Unmissable completion notice. Always hand back the refreshed workbook;
      // only ask them to open it when something needs attention.
      const summary =
        `Import complete.\n\n` +
        `• ${result.assignmentsUpserted} crew loaded\n` +
        (result.assignmentsDeleted ? `• ${result.assignmentsDeleted} removed\n` : "") +
        (result.employeesCreated ? `• ${result.employeesCreated} new employee${result.employeesCreated === 1 ? "" : "s"} added\n` : "") +
        (result.employeesLinked ? `• ${result.employeesLinked} matched to existing people\n` : "");
      const tail = result.skipped.length
        ? `\n⚠ ${result.skipped.length} row${result.skipped.length === 1 ? "" : "s"} need attention. ` +
          `A refreshed file "${filename}" was downloaded — open it and check the Status column on the Crew tab, fix those rows, then re-upload.`
        : `\nEverything imported cleanly — no review needed. A refreshed copy "${filename}" was downloaded for your records.`;
      window.alert(summary + tail);
    } catch (err: any) {
      flash(`Import failed: ${err?.message ?? err}`, false);
    } finally {
      setRosterBusy(false);
      setPendingImport(null);
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
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10,
        }}>
          <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
          {!msg.ok && (
            <button
              type="button"
              onClick={() => { if (msgTimerRef.current) clearTimeout(msgTimerRef.current); setMsg(null); }}
              title="Dismiss"
              style={{ background: "none", border: "none", color: "#a00", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
            >✕</button>
          )}
        </div>
      )}

      {/* Roster spreadsheet round-trip toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            disabled={rosterBusy}
            onClick={() => setExportMenuOpen((o) => !o)}
            style={{ fontSize: 12, padding: "4px 10px" }}
            title="Download an Excel roster template for coordinators"
          >
            {rosterBusy ? "Working…" : "Export Roster ▾"}
          </button>
          {exportMenuOpen && (
            <div style={{
              position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: 2,
              background: "#fff", border: "1px solid #d7c6aa", borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.18)", minWidth: 220, overflow: "hidden",
            }}>
              <button type="button" className="link" style={menuItemStyle} onClick={() => doExport("requirements")}>
                From job requirements
              </button>
              <button type="button" className="link" style={menuItemStyle} onClick={() => doExport("quote")}>
                From active quote
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={rosterBusy}
          onClick={() => fileInputRef.current?.click()}
          style={{ fontSize: 12, padding: "4px 10px" }}
          title="Upload a filled roster workbook to populate crew assignments"
        >
          Import Roster
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          style={{ display: "none" }}
          onChange={onPickImportFile}
        />
        <span className="muted" style={{ fontSize: 11 }}>
          Coordinators fill the Employee column, then re-upload.
        </span>
      </div>

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
                            {shifts.length >= 2 && <th style={{ textAlign: "left", width: 120 }}>Shift</th>}
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
                                  <LazyEmployeePicker
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
                                {shifts.length >= 2 && (
                                  <td>
                                    <select
                                      disabled={disabled}
                                      value={a.shiftId ?? ""}
                                      onChange={(e) => patchAssignment(d.id, a, { shiftId: e.target.value || undefined })}
                                      title="Optional. Leave blank for general/unspecified."
                                    >
                                      <option value="">— Any —</option>
                                      {shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                    </select>
                                  </td>
                                )}
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

      {pendingImport && (
        <div
          onClick={() => !rosterBusy && setPendingImport(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3000,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(640px, 95vw)", maxHeight: "90vh", overflow: "auto",
              background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", padding: 18,
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: 16 }}>Some new names look like existing people</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Pick the existing person, or choose to create a new employee. New names with no
              match{pendingImport.autoCreateCount > 0 ? ` (${pendingImport.autoCreateCount})` : ""} are added automatically.
            </p>
            {pendingImport.ambiguous.map((m) => {
              const key = normNameKey(m.parsed.fullName);
              const choice = pendingImport.choices[key];
              const setChoice = (d: EmployeeDecision) =>
                setPendingImport((cur) => cur ? { ...cur, choices: { ...cur.choices, [key]: d } } : cur);
              return (
                <div key={key} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                    Sheet name: “{m.parsed.fullName}”
                  </div>
                  {m.candidates.map((c) => (
                    <label key={c.employeeKey} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "3px 0" }}>
                      <input
                        type="radio"
                        name={`match-${key}`}
                        checked={choice?.action === "link" && choice.linkKey === c.employeeKey}
                        onChange={() => setChoice({ action: "link", linkKey: c.employeeKey })}
                      />
                      <span>
                        Use <strong>{c.fullName}</strong>
                        <span className="muted">
                          {[c.phone, c.email, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).length
                            ? " · " + [c.phone, c.email, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")
                            : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "3px 0", color: "#a05a00" }}>
                    <input
                      type="radio"
                      name={`match-${key}`}
                      checked={choice?.action === "create"}
                      onChange={() => setChoice({ action: "create" })}
                    />
                    <span>Create new employee “{m.parsed.fullName}”</span>
                  </label>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" className="secondary" disabled={rosterBusy} onClick={() => setPendingImport(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={rosterBusy}
                onClick={() => finalizeImport(pendingImport.parsed, pendingImport.choices)}
              >
                {rosterBusy ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </div>
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

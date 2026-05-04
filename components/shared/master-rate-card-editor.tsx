"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { positionNames } from "@/lib/store/app-store";
import {
  loadRateCardProfiles,
  upsertRateCardProfile,
} from "@/lib/rates/storage";
import { DEFAULT_RATE_ROWS, type RateRow, type TriggerOption } from "@/lib/rates/defaults";
import type { Position, Specialty } from "@/lib/store/types";

const MASTER_PROFILE_ID = "ratecard-master-default";
const MASTER_PROFILE_NAME = "Master Default";

/**
 * Master Default rate card editor. Tab content for Maintenance.
 *
 * Edits the single profile keyed by `ratecard-master-default`. Used by the
 * regular Rate Card editor's "+ New Rate Card" button as the seed for new
 * client cards. Changes here propagate to every newly-created card going
 * forward; existing client rate cards are untouched.
 */
export default function MasterRateCardEditor() {
  const POSITIONS = positionNames();
  const [rows, setRows] = useState<RateRow[]>([]);
  const [terms, setTerms] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Load positions, specialties, and the master profile rows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [posRes, spcRes] = await Promise.all([
        supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
      ]);
      if (cancelled) return;
      const loadedPositions = (posRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      }));
      const loadedSpecialties = (spcRes.data ?? []).map((r: any) => ({
        id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
      }));
      setPositions(loadedPositions);
      setSpecialties(loadedSpecialties);

      // Find the master profile in the in-memory cache.
      const profiles = loadRateCardProfiles();
      const master = profiles.find((p) => p.id === MASTER_PROFILE_ID);
      setTerms(master?.terms ?? "");
      if (master?.rows?.length) {
        // Resolve specialtyId on legacy rows that came in with no explicit ID.
        setRows(master.rows.map((r) => {
          if (r.specialtyId) return r;
          const pos = loadedPositions.find((p) => p.name === r.position);
          if (!pos) return r;
          const spc = loadedSpecialties.find((s) => s.positionId === pos.id && s.name === r.specialty);
          return spc ? { ...r, specialtyId: spc.id } : r;
        }));
      } else {
        // Master profile missing (migration not yet applied or empty seed).
        setRows([...DEFAULT_RATE_ROWS]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  function specialtiesForPosition(positionName: string): Specialty[] {
    const pos = positions.find((p) => p.name === positionName);
    if (!pos) return [];
    return specialties.filter((s) => s.positionId === pos.id).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function resolveSpecialtyId(row: RateRow): string {
    if (row.specialtyId) return row.specialtyId;
    const spcs = specialtiesForPosition(row.position);
    return spcs.find((s) => s.name === row.specialty)?.id ?? "";
  }

  function updateRow(index: number, patch: Partial<RateRow>) {
    setRows((cur) => cur.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const posName = POSITIONS[0] || "Stagehand";
    const spcs = specialtiesForPosition(posName);
    const first = spcs[0];
    setRows((cur) => [...cur, {
      specialtyId: first?.id ?? "",
      department: posName, position: posName, specialty: first?.name ?? "",
      hourly: 35, day: 350, otRate: 52.5, dtRate: 70,
      dtAfter: "10" as TriggerOption, travel: 0, show: true,
    }]);
  }

  async function save() {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      upsertRateCardProfile({
        id: MASTER_PROFILE_ID,
        clientId: undefined,
        clientName: MASTER_PROFILE_NAME,
        name: MASTER_PROFILE_NAME,
        rows,
        terms,
        createdAt: now,
        updatedAt: now,
      });
      setStatusMsg({ text: "Master Default saved. New rate cards will seed from these rows.", ok: true });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ text: `Save failed: ${err?.message ?? err}`, ok: false });
    } finally {
      setSaving(false);
    }
  }

  const visibleRows = useMemo(() => rows.filter((r) => r.show), [rows]);

  if (loading) {
    return <div className="card"><div className="muted">Loading…</div></div>;
  }

  return (
    <div className="grid">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>🔧 Master Default Rate Card</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Used as the starter rows for every new client rate card.
              Changes here apply to <strong>future</strong> rate cards only — existing client cards are unchanged.
            </div>
          </div>
          <div className="action-row">
            <button className="secondary" onClick={addRow}>+ Add Row</button>
            <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Master Default"}</button>
          </div>
        </div>
        {statusMsg && (
          <div style={{
            marginTop: 8,
            background: statusMsg.ok ? "#eef9ee" : "#fff3f3",
            border: `1px solid ${statusMsg.ok ? "#b6e0b6" : "#e0a0a0"}`,
            color: statusMsg.ok ? "#2e6b2e" : "#a00",
            borderRadius: 6, padding: "6px 12px", fontSize: 12,
          }}>{statusMsg.text}</div>
        )}
      </div>

      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Show</th><th>Position</th><th>Specialty</th>
                <th>Hourly</th><th>Day</th><th>OT Rate</th><th>DT Rate</th>
                <th>OT Trigger</th><th>Travel</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const spcs = specialtiesForPosition(row.position);
                const resolvedId = resolveSpecialtyId(row);
                return (
                  <tr key={index}>
                    <td><input type="checkbox" checked={row.show} onChange={(e) => updateRow(index, { show: e.target.checked })} /></td>
                    <td>
                      <select value={row.position} onChange={(e) => {
                        const posName = e.target.value;
                        const newSpcs = specialtiesForPosition(posName);
                        const first = newSpcs[0];
                        updateRow(index, {
                          position: posName, department: posName,
                          specialtyId: first?.id ?? "",
                          specialty: first?.name ?? "",
                        });
                      }}>
                        {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={resolvedId} onChange={(e) => {
                        const spc = specialties.find((s) => s.id === e.target.value);
                        updateRow(index, { specialtyId: e.target.value, specialty: spc?.name ?? "" });
                      }}>
                        {spcs.length === 0 && <option value="">— no specialties —</option>}
                        {spcs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" value={row.hourly} onChange={(e) => {
                      const h = Number(e.target.value || 0);
                      updateRow(index, {
                        hourly: h,
                        day: Number((h * 10).toFixed(2)),
                        otRate: Number((h * 1.5).toFixed(2)),
                        dtRate: Number((h * 2).toFixed(2)),
                      });
                    }} /></td>
                    <td><input type="number" value={row.day} onChange={(e) => updateRow(index, { day: Number(e.target.value || 0) })} /></td>
                    <td><input type="number" value={row.otRate} onChange={(e) => updateRow(index, { otRate: Number(e.target.value || 0) })} /></td>
                    <td><input type="number" value={row.dtRate} onChange={(e) => updateRow(index, { dtRate: Number(e.target.value || 0) })} /></td>
                    <td>
                      <select value={row.dtAfter} onChange={(e) => updateRow(index, { dtAfter: e.target.value as TriggerOption })}>
                        <option value="none">No OT (flat)</option>
                        <option value="10">OT after 10</option>
                        <option value="11">OT after 11</option>
                        <option value="12">OT after 12</option>
                        <option value="13">OT after 13</option>
                        <option value="14">OT after 14</option>
                        <option value="15">OT after 15</option>
                        <option value="weekly40">OT after 40 / week</option>
                      </select>
                    </td>
                    <td><input type="number" value={row.travel} onChange={(e) => updateRow(index, { travel: Number(e.target.value || 0) })} /></td>
                    <td>
                      <button
                        className="secondary"
                        style={{ color: "#a00", borderColor: "#e0a0a0", padding: "3px 8px" }}
                        onClick={() => setRows((cur) => cur.filter((_, i) => i !== index))}
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          {rows.length} row{rows.length === 1 ? "" : "s"} ({visibleRows.length} visible). Click <strong>Save Master Default</strong> above to persist.
        </div>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>Master Default Terms & Conditions</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Default terms text used on quotes that don't have a client-specific rate card with its own terms. Edit and click <strong>Save Master Default</strong> above to persist.
        </div>
        <textarea
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          style={{
            width: "100%", minHeight: 400, fontSize: 14, lineHeight: 1.5,
            padding: 12, borderRadius: 8, border: "1px solid #d7c6aa",
            background: "#fff", resize: "vertical",
          }}
        />
      </div>
    </div>
  );
}

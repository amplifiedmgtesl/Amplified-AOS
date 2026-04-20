"use client";

import { useEffect, useState } from "react";
import { upsertPosition, deletePosition, upsertSpecialty, deleteSpecialty } from "@/lib/store/app-store";
import { supabase } from "@/lib/supabase/client";
import type { Position, Specialty } from "@/lib/store/types";

async function fetchAll(): Promise<{ positions: Position[]; specialties: Specialty[]; error: string | null }> {
  const [posRes, spcRes] = await Promise.all([
    supabase.from("positions").select("*").order("sort_order"),
    supabase.from("specialties").select("*").order("sort_order"),
  ]);
  if (posRes.error) return { positions: [], specialties: [], error: posRes.error.message };
  if (spcRes.error) return { positions: [], specialties: [], error: spcRes.error.message };

  const positions = (posRes.data ?? [])
    .filter((r: any) => r.is_active !== false)
    .map((r: any) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active }));

  const specialties = (spcRes.data ?? [])
    .filter((r: any) => r.is_active !== false)
    .map((r: any) => ({ id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active }));

  return { positions, specialties, error: null };
}

export default function PositionMaintenance() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editPosName, setEditPosName] = useState("");
  const [newPosName, setNewPosName] = useState("");
  const [confirmDeletePosId, setConfirmDeletePosId] = useState<string | null>(null);

  const [editingSpcId, setEditingSpcId] = useState<string | null>(null);
  const [editSpcName, setEditSpcName] = useState("");
  const [newSpcNames, setNewSpcNames] = useState<Record<string, string>>({});
  const [confirmDeleteSpcId, setConfirmDeleteSpcId] = useState<string | null>(null);
  const [deleteBlockMsg, setDeleteBlockMsg] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setFetchError(null);
    const { positions, specialties, error } = await fetchAll();
    setPositions(positions);
    setSpecialties(specialties);
    setFetchError(error);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  const sorted = [...positions].sort((a, b) => a.sortOrder - b.sortOrder);

  function spcForPosition(posId: string) {
    return specialties.filter((s) => s.positionId === posId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // ─── Delete-use checks ─────────────────────────────────────────────────────

  async function positionInUse(p: Position): Promise<string | null> {
    const spcs = spcForPosition(p.id);
    if (spcs.length > 0) return `Cannot delete — ${spcs.length} specialist${spcs.length !== 1 ? "ies" : "y"} are assigned to this position. Remove them first.`;
    const [tsRes, jsRes] = await Promise.all([
      supabase.from("timesheet_entries").select("id", { count: "exact", head: true }).eq("position", p.name),
      supabase.from("job_sheet_workers").select("id", { count: "exact", head: true }).eq("role", p.name),
    ]);
    const tsCount = tsRes.count ?? 0;
    const jsCount = jsRes.count ?? 0;
    if (tsCount > 0 || jsCount > 0) {
      const parts = [];
      if (tsCount > 0) parts.push(`${tsCount} timesheet entr${tsCount !== 1 ? "ies" : "y"}`);
      if (jsCount > 0) parts.push(`${jsCount} job sheet worker${jsCount !== 1 ? "s" : ""}`);
      return `Cannot delete — used by ${parts.join(" and ")}.`;
    }
    return null;
  }

  async function specialtyInUse(s: Specialty): Promise<string | null> {
    const [rcRes, qlRes, ilRes] = await Promise.all([
      supabase.from("rate_card_profile_rows").select("id", { count: "exact", head: true }).eq("specialty_id", s.id),
      supabase.from("quote_lines").select("id", { count: "exact", head: true }).eq("specialty", s.name),
      supabase.from("invoice_lines").select("id", { count: "exact", head: true }).eq("specialty", s.name),
    ]);
    const total = (rcRes.count ?? 0) + (qlRes.count ?? 0) + (ilRes.count ?? 0);
    if (total > 0) {
      const parts = [];
      if ((rcRes.count ?? 0) > 0) parts.push(`${rcRes.count} rate card row${rcRes.count !== 1 ? "s" : ""}`);
      if ((qlRes.count ?? 0) > 0) parts.push(`${qlRes.count} quote line${qlRes.count !== 1 ? "s" : ""}`);
      if ((ilRes.count ?? 0) > 0) parts.push(`${ilRes.count} invoice line${ilRes.count !== 1 ? "s" : ""}`);
      return `Cannot delete — used by ${parts.join(", ")}.`;
    }
    return null;
  }

  async function requestDeletePos(p: Position) {
    setDeleteBlockMsg(null);
    const msg = await positionInUse(p);
    if (msg) { setDeleteBlockMsg(msg); return; }
    setConfirmDeletePosId(p.id);
  }

  async function requestDeleteSpc(s: Specialty) {
    setDeleteBlockMsg(null);
    const msg = await specialtyInUse(s);
    if (msg) { setDeleteBlockMsg(msg); return; }
    setConfirmDeleteSpcId(s.id);
  }

  // ─── Position actions ──────────────────────────────────────────────────────

  async function savePosEdit(p: Position) {
    if (!editPosName.trim()) return;
    upsertPosition({ ...p, name: editPosName.trim() });
    setEditingPosId(null);
    await reload();
  }

  async function movePosUp(p: Position) {
    const idx = sorted.findIndex((x) => x.id === p.id);
    if (idx <= 0) return;
    const prev = sorted[idx - 1];
    upsertPosition({ ...p, sortOrder: prev.sortOrder });
    upsertPosition({ ...prev, sortOrder: p.sortOrder });
    await reload();
  }

  async function movePosDown(p: Position) {
    const idx = sorted.findIndex((x) => x.id === p.id);
    if (idx >= sorted.length - 1) return;
    const next = sorted[idx + 1];
    upsertPosition({ ...p, sortOrder: next.sortOrder });
    upsertPosition({ ...next, sortOrder: p.sortOrder });
    await reload();
  }

  async function addPosition() {
    if (!newPosName.trim()) return;
    const maxOrder = positions.reduce((m, p) => Math.max(m, p.sortOrder), 0);
    upsertPosition({ id: `pos-${Date.now()}`, name: newPosName.trim(), sortOrder: maxOrder + 1, isActive: true });
    setNewPosName("");
    await reload();
  }

  // ─── Specialty actions ─────────────────────────────────────────────────────

  async function saveSpcEdit(s: Specialty) {
    if (!editSpcName.trim()) return;
    upsertSpecialty({ ...s, name: editSpcName.trim() });
    setEditingSpcId(null);
    await reload();
  }

  async function moveSpcUp(s: Specialty) {
    const list = spcForPosition(s.positionId);
    const idx = list.findIndex((x) => x.id === s.id);
    if (idx <= 0) return;
    const prev = list[idx - 1];
    upsertSpecialty({ ...s, sortOrder: prev.sortOrder });
    upsertSpecialty({ ...prev, sortOrder: s.sortOrder });
    await reload();
  }

  async function moveSpcDown(s: Specialty) {
    const list = spcForPosition(s.positionId);
    const idx = list.findIndex((x) => x.id === s.id);
    if (idx >= list.length - 1) return;
    const next = list[idx + 1];
    upsertSpecialty({ ...s, sortOrder: next.sortOrder });
    upsertSpecialty({ ...next, sortOrder: s.sortOrder });
    await reload();
  }

  async function addSpecialty(posId: string) {
    const name = (newSpcNames[posId] ?? "").trim();
    if (!name) return;
    const list = spcForPosition(posId);
    const maxOrder = list.reduce((m, s) => Math.max(m, s.sortOrder), 0);
    upsertSpecialty({ id: `spc-${Date.now()}`, positionId: posId, name, sortOrder: maxOrder + 1, isActive: true });
    setNewSpcNames((prev) => ({ ...prev, [posId]: "" }));
    await reload();
  }

  if (loading) return <div className="card"><p className="muted">Loading…</p></div>;

  return (
    <div className="grid">
      {fetchError && (
        <div className="card" style={{ background: "#fff3f3", border: "1px solid #e0a0a0" }}>
          <strong style={{ color: "#a00" }}>Error:</strong> {fetchError}
        </div>
      )}
      {deleteBlockMsg && (
        <div className="card" style={{ background: "#fff8e1", border: "1px solid #e0c840", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#7a5f00", fontSize: 13 }}>{deleteBlockMsg}</span>
          <button className="secondary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => setDeleteBlockMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {sorted.map((p, idx) => {
          const spcs = spcForPosition(p.id);
          return (
            <div key={p.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>

              {/* Position header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button className="secondary" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => movePosUp(p)} disabled={idx === 0}>▲</button>
                  <button className="secondary" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => movePosDown(p)} disabled={idx === sorted.length - 1}>▼</button>
                </div>
                <div style={{ flex: 1 }}>
                  {editingPosId === p.id ? (
                    <input
                      value={editPosName}
                      onChange={(e) => setEditPosName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") savePosEdit(p); if (e.key === "Escape") setEditingPosId(null); }}
                      autoFocus
                      style={{ width: "100%", fontWeight: 600 }}
                    />
                  ) : (
                    <strong style={{ fontSize: 15 }}>{p.name}</strong>
                  )}
                </div>
                <div className="action-row" style={{ gap: 4 }}>
                  {editingPosId === p.id ? (
                    <>
                      <button style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => savePosEdit(p)}>Save</button>
                      <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setEditingPosId(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => { setEditingPosId(p.id); setEditPosName(p.name); }}>Edit</button>
                      {confirmDeletePosId === p.id ? (
                        <>
                          <button style={{ padding: "3px 10px", fontSize: 12, background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }} onClick={async () => { deletePosition(p.id); setConfirmDeletePosId(null); await reload(); }}>Confirm</button>
                          <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setConfirmDeletePosId(null)}>✕</button>
                        </>
                      ) : (
                        <button className="secondary" style={{ padding: "3px 10px", fontSize: 12, color: "#a00", borderColor: "#e0a0a0" }} onClick={() => requestDeletePos(p)}>Delete</button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <hr style={{ margin: 0, borderColor: "#e8dfd0" }} />

              {/* Specialties list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {spcs.map((s, si) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <button className="secondary" style={{ padding: "1px 5px", fontSize: 10 }} onClick={() => moveSpcUp(s)} disabled={si === 0}>▲</button>
                      <button className="secondary" style={{ padding: "1px 5px", fontSize: 10 }} onClick={() => moveSpcDown(s)} disabled={si === spcs.length - 1}>▼</button>
                    </div>
                    <div style={{ flex: 1 }}>
                      {editingSpcId === s.id ? (
                        <input
                          value={editSpcName}
                          onChange={(e) => setEditSpcName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveSpcEdit(s); if (e.key === "Escape") setEditingSpcId(null); }}
                          autoFocus
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <span style={{ fontSize: 13 }}>{s.name}</span>
                      )}
                    </div>
                    <div className="action-row" style={{ gap: 4 }}>
                      {editingSpcId === s.id ? (
                        <>
                          <button style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => saveSpcEdit(s)}>Save</button>
                          <button className="secondary" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setEditingSpcId(null)}>✕</button>
                        </>
                      ) : (
                        <>
                          <button className="secondary" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => { setEditingSpcId(s.id); setEditSpcName(s.name); }}>Edit</button>
                          {confirmDeleteSpcId === s.id ? (
                            <>
                              <button style={{ padding: "2px 8px", fontSize: 11, background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }} onClick={async () => { deleteSpecialty(s.id); setConfirmDeleteSpcId(null); await reload(); }}>Confirm</button>
                              <button className="secondary" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setConfirmDeleteSpcId(null)}>✕</button>
                            </>
                          ) : (
                            <button className="secondary" style={{ padding: "2px 8px", fontSize: 11, color: "#a00", borderColor: "#e0a0a0" }} onClick={() => requestDeleteSpc(s)}>Delete</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add specialty */}
              <div className="action-row" style={{ gap: 6, marginTop: 4 }}>
                <input
                  value={newSpcNames[p.id] ?? ""}
                  onChange={(e) => setNewSpcNames((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") addSpecialty(p.id); }}
                  placeholder="Add specialty…"
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => addSpecialty(p.id)} disabled={!(newSpcNames[p.id] ?? "").trim()}>Add</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add position */}
      <div className="card">
        <h2 className="section-title">Add Position</h2>
        <div className="action-row">
          <input
            value={newPosName}
            onChange={(e) => setNewPosName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPosition(); }}
            placeholder="Position name…"
            style={{ flex: 1 }}
          />
          <button onClick={addPosition} disabled={!newPosName.trim()}>Add</button>
        </div>
      </div>
    </div>
  );
}

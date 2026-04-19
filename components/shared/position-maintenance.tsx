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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Position edit state
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editPosName, setEditPosName] = useState("");
  const [newPosName, setNewPosName] = useState("");
  const [confirmDeletePosId, setConfirmDeletePosId] = useState<string | null>(null);

  // Specialty edit state
  const [editingSpcId, setEditingSpcId] = useState<string | null>(null);
  const [editSpcName, setEditSpcName] = useState("");
  const [newSpcNames, setNewSpcNames] = useState<Record<string, string>>({});
  const [confirmDeleteSpcId, setConfirmDeleteSpcId] = useState<string | null>(null);

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

  function spcForPosition(posId: string) {
    return specialties.filter((s) => s.positionId === posId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

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

  return (
    <div className="grid">
      <div className="card">
        <h2 className="section-title">
          {loading ? "Loading…" : `${positions.length} Position${positions.length !== 1 ? "s" : ""}`}
        </h2>
        <p className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
          Positions and their specialties drive all dropdowns in Timekeeping, Job Sheets,
          Rate Cards, and the Staff Portal. Click a position row to manage its specialties.
        </p>

        {fetchError && (
          <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "10px 14px", color: "#a00", marginBottom: 16, fontSize: 13 }}>
            <strong>Error:</strong> {fetchError}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 48 }}>Order</th>
                <th>Position Name</th>
                <th style={{ width: 120 }}>Specialties</th>
                <th style={{ width: 220 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, idx) => {
                const spcs = spcForPosition(p.id);
                const isExpanded = expandedId === p.id;
                return (
                  <>
                    <tr key={p.id}>
                      <td style={{ textAlign: "center" }}>
                        <div className="action-row" style={{ justifyContent: "center", gap: 2 }}>
                          <button className="secondary" style={{ padding: "2px 7px", fontSize: 12 }} onClick={() => movePosUp(p)} disabled={idx === 0} title="Move up">▲</button>
                          <button className="secondary" style={{ padding: "2px 7px", fontSize: 12 }} onClick={() => movePosDown(p)} disabled={idx === sorted.length - 1} title="Move down">▼</button>
                        </div>
                      </td>
                      <td>
                        {editingPosId === p.id ? (
                          <input
                            value={editPosName}
                            onChange={(e) => setEditPosName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") savePosEdit(p); if (e.key === "Escape") setEditingPosId(null); }}
                            autoFocus
                            style={{ width: "100%" }}
                          />
                        ) : (
                          <span>{p.name}</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="secondary"
                          style={{ fontSize: 12 }}
                          onClick={() => setExpandedId(isExpanded ? null : p.id)}
                        >
                          {spcs.length} {isExpanded ? "▲" : "▼"}
                        </button>
                      </td>
                      <td>
                        <div className="action-row">
                          {editingPosId === p.id ? (
                            <>
                              <button onClick={() => savePosEdit(p)}>Save</button>
                              <button className="secondary" onClick={() => setEditingPosId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="secondary" onClick={() => { setEditingPosId(p.id); setEditPosName(p.name); }}>Edit</button>
                              {confirmDeletePosId === p.id ? (
                                <>
                                  <button onClick={async () => { deletePosition(p.id); setConfirmDeletePosId(null); await reload(); }} style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }}>Confirm</button>
                                  <button className="secondary" onClick={() => setConfirmDeletePosId(null)}>Cancel</button>
                                </>
                              ) : (
                                <button className="secondary" style={{ color: "#a00", borderColor: "#e0a0a0" }} onClick={() => setConfirmDeletePosId(p.id)}>Delete</button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${p.id}-specialties`}>
                        <td colSpan={4} style={{ background: "#f8f5f0", padding: "12px 20px" }}>
                          <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>Specialties for {p.name}</div>
                          <table style={{ marginBottom: 10 }}>
                            <thead>
                              <tr>
                                <th style={{ width: 48 }}>Order</th>
                                <th>Specialty Name</th>
                                <th style={{ width: 220 }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {spcs.map((s, si) => (
                                <tr key={s.id}>
                                  <td style={{ textAlign: "center" }}>
                                    <div className="action-row" style={{ justifyContent: "center", gap: 2 }}>
                                      <button className="secondary" style={{ padding: "2px 7px", fontSize: 12 }} onClick={() => moveSpcUp(s)} disabled={si === 0}>▲</button>
                                      <button className="secondary" style={{ padding: "2px 7px", fontSize: 12 }} onClick={() => moveSpcDown(s)} disabled={si === spcs.length - 1}>▼</button>
                                    </div>
                                  </td>
                                  <td>
                                    {editingSpcId === s.id ? (
                                      <input
                                        value={editSpcName}
                                        onChange={(e) => setEditSpcName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") saveSpcEdit(s); if (e.key === "Escape") setEditingSpcId(null); }}
                                        autoFocus
                                        style={{ width: "100%" }}
                                      />
                                    ) : (
                                      <span>{s.name}</span>
                                    )}
                                  </td>
                                  <td>
                                    <div className="action-row">
                                      {editingSpcId === s.id ? (
                                        <>
                                          <button onClick={() => saveSpcEdit(s)}>Save</button>
                                          <button className="secondary" onClick={() => setEditingSpcId(null)}>Cancel</button>
                                        </>
                                      ) : (
                                        <>
                                          <button className="secondary" onClick={() => { setEditingSpcId(s.id); setEditSpcName(s.name); }}>Edit</button>
                                          {confirmDeleteSpcId === s.id ? (
                                            <>
                                              <button onClick={async () => { deleteSpecialty(s.id); setConfirmDeleteSpcId(null); await reload(); }} style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }}>Confirm</button>
                                              <button className="secondary" onClick={() => setConfirmDeleteSpcId(null)}>Cancel</button>
                                            </>
                                          ) : (
                                            <button className="secondary" style={{ color: "#a00", borderColor: "#e0a0a0" }} onClick={() => setConfirmDeleteSpcId(s.id)}>Delete</button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="action-row">
                            <input
                              value={newSpcNames[p.id] ?? ""}
                              onChange={(e) => setNewSpcNames((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") addSpecialty(p.id); }}
                              placeholder="New specialty name…"
                              style={{ flex: 1 }}
                            />
                            <button onClick={() => addSpecialty(p.id)} disabled={!(newSpcNames[p.id] ?? "").trim()}>Add Specialty</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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

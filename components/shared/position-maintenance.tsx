"use client";

import { useMemo, useState } from "react";
import { loadPositions, upsertPosition, deletePosition } from "@/lib/store/app-store";
import type { Position } from "@/lib/store/types";

export default function PositionMaintenance() {
  const [refreshKey, setRefreshKey] = useState(0);
  const positions = useMemo(() => loadPositions(), [refreshKey]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function refresh() { setRefreshKey((k) => k + 1); }

  function startEdit(p: Position) {
    setEditingId(p.id);
    setEditName(p.name);
  }

  function saveEdit(p: Position) {
    if (!editName.trim()) return;
    upsertPosition({ ...p, name: editName.trim() });
    setEditingId(null);
    refresh();
  }

  function moveUp(p: Position) {
    const sorted = [...positions].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((x) => x.id === p.id);
    if (idx <= 0) return;
    const prev = sorted[idx - 1];
    upsertPosition({ ...p,    sortOrder: prev.sortOrder });
    upsertPosition({ ...prev, sortOrder: p.sortOrder   });
    refresh();
  }

  function moveDown(p: Position) {
    const sorted = [...positions].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((x) => x.id === p.id);
    if (idx >= sorted.length - 1) return;
    const next = sorted[idx + 1];
    upsertPosition({ ...p,    sortOrder: next.sortOrder });
    upsertPosition({ ...next, sortOrder: p.sortOrder    });
    refresh();
  }

  function addPosition() {
    if (!newName.trim()) return;
    const maxOrder = positions.reduce((m, p) => Math.max(m, p.sortOrder), 0);
    upsertPosition({
      id: `pos-${Date.now()}`,
      name: newName.trim(),
      sortOrder: maxOrder + 1,
      isActive: true,
    });
    setNewName("");
    refresh();
  }

  const sorted = [...positions].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="grid">
      <div className="card">
        <h2 className="section-title">Positions</h2>
        <p className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
          This list drives the position dropdowns in Timekeeping, Job Sheets, Job Costing,
          and the Staff Portal. Changes take effect immediately for new entries.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 48 }}>Order</th>
                <th>Position Name</th>
                <th style={{ width: 200 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, idx) => (
                <tr key={p.id}>
                  <td style={{ textAlign: "center" }}>
                    <div className="action-row" style={{ justifyContent: "center", gap: 2 }}>
                      <button
                        className="secondary"
                        style={{ padding: "2px 7px", fontSize: 12 }}
                        onClick={() => moveUp(p)}
                        disabled={idx === 0}
                        title="Move up"
                      >▲</button>
                      <button
                        className="secondary"
                        style={{ padding: "2px 7px", fontSize: 12 }}
                        onClick={() => moveDown(p)}
                        disabled={idx === sorted.length - 1}
                        title="Move down"
                      >▼</button>
                    </div>
                  </td>
                  <td>
                    {editingId === p.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(p); if (e.key === "Escape") setEditingId(null); }}
                        autoFocus
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <span>{p.name}</span>
                    )}
                  </td>
                  <td>
                    <div className="action-row">
                      {editingId === p.id ? (
                        <>
                          <button onClick={() => saveEdit(p)}>Save</button>
                          <button className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="secondary" onClick={() => startEdit(p)}>Edit</button>
                          {confirmDeleteId === p.id ? (
                            <>
                              <button
                                onClick={() => { deletePosition(p.id); setConfirmDeleteId(null); refresh(); }}
                                style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }}
                              >Confirm</button>
                              <button className="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                            </>
                          ) : (
                            <button
                              className="secondary"
                              style={{ color: "#a00", borderColor: "#e0a0a0" }}
                              onClick={() => setConfirmDeleteId(p.id)}
                            >Delete</button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Add Position</h2>
        <div className="action-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPosition(); }}
            placeholder="Position name…"
            style={{ flex: 1 }}
          />
          <button onClick={addPosition} disabled={!newName.trim()}>Add</button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  loadShifts,
  createShift,
  updateShift,
  deactivateShift,
  deleteShift,
} from "@/lib/storage/job-request-shifts";
import type { JobRequestShift } from "@/lib/store/types";

/**
 * Shift management for a job_request. Lives on the Job Request screen
 * alongside Daily Requirements, Assigned Crew, and Attachments.
 *
 * Each shift is a job-scoped row (e.g., "Load In", "Show Call", "Strike").
 * Quote and invoice lines pick from this list via dropdown. If a job has
 * no shifts defined, downstream pickers show no options — line shift is
 * empty, no free-text entry possible. This was the whole point of
 * eliminating shift_label as free text.
 */

export function JobRequestShiftsSection({
  jobRequestId,
  hideHeader = false,
}: {
  jobRequestId: string;
  hideHeader?: boolean;
}) {
  const [items, setItems] = useState<JobRequestShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setItems(await loadShifts(jobRequestId, { includeInactive: true }));
    } catch (err: any) {
      setMsg({ text: `Load failed: ${err?.message ?? err}`, ok: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [jobRequestId]);

  async function handleAdd() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    setAdding(true);
    setMsg(null);
    try {
      await createShift(jobRequestId, trimmed);
      setNewLabel("");
      setMsg({ text: `Added "${trimmed}".`, ok: true });
      await reload();
    } catch (err: any) {
      // Most likely the case-insensitive unique constraint tripped.
      const m = String(err?.message ?? err);
      if (/duplicate key value/i.test(m) || /unique/i.test(m)) {
        setMsg({ text: `"${trimmed}" already exists on this job (case-insensitive match).`, ok: false });
      } else {
        setMsg({ text: `Add failed: ${m}`, ok: false });
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(shift: JobRequestShift, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === shift.label) return;
    try {
      await updateShift(shift.id, { label: trimmed });
      await reload();
    } catch (err: any) {
      setMsg({ text: `Rename failed: ${err?.message ?? err}`, ok: false });
    }
  }

  async function handleToggleActive(shift: JobRequestShift) {
    try {
      await updateShift(shift.id, { isActive: !shift.isActive });
      await reload();
    } catch (err: any) {
      setMsg({ text: `Update failed: ${err?.message ?? err}`, ok: false });
    }
  }

  async function handleDelete(shift: JobRequestShift) {
    if (!confirm(
      `Delete shift "${shift.label}"?\n\n` +
      `Blocked if any quote or invoice line references it (use Deactivate instead).`
    )) return;
    try {
      await deleteShift(shift.id);
      await reload();
    } catch (err: any) {
      const m = String(err?.message ?? err);
      if (/foreign key/i.test(m) || /violates/i.test(m)) {
        setMsg({
          text: `Cannot delete "${shift.label}" — it's referenced by one or more quote/invoice lines. Use Deactivate instead.`,
          ok: false,
        });
      } else {
        setMsg({ text: `Delete failed: ${m}`, ok: false });
      }
    }
  }

  return (
    <div>
      {!hideHeader ? (
        <h3 className="section-title" style={{ marginTop: 0 }}>Shifts</h3>
      ) : null}

      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Job-specific shifts (e.g., Load In, Show Call, Strike). Quote and
        invoice line editors pick from this list. If empty, lines have no
        shift assigned.
      </div>

      <div className="action-row" style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAdd(); } }}
          placeholder="New shift label"
          style={{ width: 240 }}
        />
        <button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
          {adding ? "Adding…" : "Add Shift"}
        </button>
        {msg ? (
          <span className="badge" style={{
            marginLeft: 8,
            background: msg.ok ? "#d6f4e0" : "#fde2e2",
            color: msg.ok ? "#0c6b35" : "#8a1c1c",
          }}>{msg.text}</span>
        ) : null}
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="muted" style={{ fontStyle: "italic" }}>
          No shifts defined yet. Add one above to enable shift picking on lines.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Sort</th>
                <th>Label</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} style={{ opacity: s.isActive ? 1 : 0.55 }}>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.sortOrder}</td>
                  <td>
                    <input
                      type="text"
                      defaultValue={s.label}
                      onBlur={(e) => void handleRename(s, e.target.value)}
                      style={{ width: "100%", minWidth: 200 }}
                    />
                  </td>
                  <td>
                    <span className="badge">{s.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => void handleToggleActive(s)}
                      style={{ fontSize: 12, marginRight: 6 }}
                    >
                      {s.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void handleDelete(s)}
                      style={{ fontSize: 12, color: "#8a1c1c" }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

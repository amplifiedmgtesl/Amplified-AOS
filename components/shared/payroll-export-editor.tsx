/**
 * Maintenance → Payroll Export. Edits the payroll_settings singleton and the
 * payroll_component_map rows the Paychex CSV export reads (20261012a).
 *
 * Pay component names must match Paychex Flex exactly — a single missing
 * space failed Paychex's first test import — so the hint lives in the
 * field tooltips rather than an on-screen banner.
 */

"use client";

import { useEffect, useState } from "react";
import {
  loadComponentMap,
  loadPayrollExportSettings,
  saveComponentName,
  savePayrollExportSettings,
  type ComponentMapRecord,
} from "@/lib/store/payroll-export-settings";
import type { JobNameSource, PayType, PayrollExportSettings, WorkerType } from "@/lib/store/paychex-export";

const WORKER_TYPES: WorkerType[] = ["Employee", "Contractor"];
const PAY_TYPES: { id: PayType; label: string }[] = [
  { id: "REG", label: "Regular" },
  { id: "OT", label: "Overtime" },
  { id: "DT", label: "Double time" },
];
const JOB_NAME_SOURCES: { id: JobNameSource; label: string }[] = [
  { id: "event_abbr", label: "Event Abbr (e.g. LBFT)" },
  { id: "event_name", label: "Event Name" },
  { id: "none", label: "Leave blank" },
];

export default function PayrollExportEditor() {
  const [settings, setSettings] = useState<PayrollExportSettings | null>(null);
  const [rows, setRows] = useState<ComponentMapRecord[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function load() {
    setLoading(true);
    const [s, m] = await Promise.all([loadPayrollExportSettings(), loadComponentMap()]);
    if (!s || !m) {
      setLoadError("Couldn't load payroll export settings.");
    } else {
      setLoadError(null);
      setSettings(s);
      setRows(m);
      setDraft(Object.fromEntries(m.map((r) => [r.id, r.componentName])));
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      const err = await savePayrollExportSettings(settings);
      if (err) throw new Error(err);
      for (const r of rows) {
        const next = (draft[r.id] ?? "").trim();
        if (next === r.componentName) continue;
        const e = await saveComponentName(r.id, next);
        if (e) throw new Error(e);
      }
      await load();
      setStatusMsg({ text: "Payroll export settings saved.", ok: true });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ text: `Save failed: ${err?.message ?? err}`, ok: false });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card"><div className="muted">Loading…</div></div>;
  if (loadError || !settings) return <div className="card"><div className="muted">{loadError}</div></div>;

  const rowFor = (w: WorkerType, p: PayType) => rows.find((r) => r.workerType === w && r.payType === p);

  return (
    <div className="grid">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="section-title" style={{ margin: 0 }}>💵 Payroll Export — Paychex</h2>
          <div className="action-row">
            <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
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
        <div className="grid2">
          <label title="Amplified's Paychex company number. Goes in the Company ID column on every line.">
            <div className="muted">Paychex Company ID</div>
            <input
              type="text"
              value={settings.companyId}
              onChange={(e) => setSettings({ ...settings, companyId: e.target.value })}
            />
          </label>
          <label title="What goes in Paychex's Job Name column. Event Abbr is the short code from the job (up to 8 characters).">
            <div className="muted">Job Name column</div>
            <select
              value={settings.jobNameSource}
              onChange={(e) => setSettings({ ...settings, jobNameSource: e.target.value as JobNameSource })}
            >
              {JOB_NAME_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>Pay components</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              {WORKER_TYPES.map((w) => <th key={w}>{w === "Employee" ? "Employee (W-2)" : "Contractor (1099)"}</th>)}
            </tr>
          </thead>
          <tbody>
            {PAY_TYPES.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.label}</strong></td>
                {WORKER_TYPES.map((w) => {
                  const r = rowFor(w, p.id);
                  if (!r) return <td key={w} className="muted">—</td>;
                  const val = draft[r.id] ?? "";
                  return (
                    <td key={w}>
                      <input
                        type="text"
                        value={val}
                        placeholder="not set"
                        onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })}
                        title="Copy and paste this from Paychex Flex. It has to match exactly — spaces, dashes and capitals included — or Paychex rejects the line. Blank = not set; the export stops if it needs it."
                        style={{ fontFamily: "monospace", borderColor: val.trim() ? undefined : "#e0a0a0" }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

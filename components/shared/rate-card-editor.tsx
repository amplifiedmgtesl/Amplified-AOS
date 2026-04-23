
"use client";

import { useEffect, useMemo, useState } from "react";
import { printWithTitle } from "@/lib/print-with-title";
import { DEFAULT_RATE_ROWS, type TriggerOption, type RateRow } from "@/lib/rates/defaults";
import { positionNames } from "@/lib/store/app-store";
import { supabase } from "@/lib/supabase/client";
import type { Client } from "@/lib/store/types";
import {
  getActiveRateCardProfileId,
  loadClientName,
  loadProfileIntoCurrent,
  loadRateCardProfiles,
  loadRateRows,
  loadTerms,
  saveClientName,
  saveRateRows,
  saveTerms,
  setActiveRateCardProfileId,
  upsertRateCardProfile,
  type RateCardProfile,
} from "@/lib/rates/storage";
import type { Position, Specialty } from "@/lib/store/types";

function triggerLabel(value: TriggerOption) {
  return `OT after ${value} / DT after 15`;
}
function blankProfileName() {
  return `Client Rate Card ${new Date().toISOString().slice(0,10)}`;
}

export default function RateCardEditor() {
  const POSITIONS = positionNames();
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [profileName, setProfileName] = useState("Standard");
  const [rows, setRows] = useState<RateRow[]>(DEFAULT_RATE_ROWS);
  const [terms, setTerms] = useState("");
  const [profiles, setProfiles] = useState<RateCardProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    setRows(loadRateRows());
    setTerms(loadTerms());
    setClientName(loadClientName());
    const loadedProfiles = loadRateCardProfiles();
    const activeId = getActiveRateCardProfileId();
    setProfiles(loadedProfiles);
    setActiveProfileIdState(activeId);
    // Hydrate client dropdown and name from the active profile
    const activeProfile = loadedProfiles.find((p) => p.id === activeId);
    if (activeProfile) {
      setClientId(activeProfile.clientId ?? "");
      setProfileName(activeProfile.name ?? "Standard");
    }
    // Load directly from DB — cache may not be ready at mount time
    Promise.all([
      supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("clients").select("id, name").eq("is_active", true).order("name"),
    ]).then(([posRes, spcRes, clientsRes]) => {
      setClients((clientsRes.data ?? []).map((r: any) => ({ id: r.id, name: r.name, isActive: true })));
      const loadedPositions = (posRes.data ?? []).map((r: any) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active }));
      const loadedSpecialties = (spcRes.data ?? []).map((r: any) => ({ id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active }));
      setPositions(loadedPositions);
      setSpecialties(loadedSpecialties);
      // Resolve specialtyId for existing rows that predate Phase 2 (no specialtyId stored)
      setRows((current) => current.map((row) => {
        if (row.specialtyId) return row;
        const pos = loadedPositions.find((p) => p.name === row.position);
        if (!pos) return row;
        const spc = loadedSpecialties.find((s) => s.positionId === pos.id && s.name === row.specialty);
        return spc ? { ...row, specialtyId: spc.id } : row;
      }));
    });
  }, []);

  useEffect(() => { saveRateRows(rows); }, [rows]);
  useEffect(() => { saveTerms(terms); }, [terms]);
  useEffect(() => { saveClientName(clientName); }, [clientName]);

  const visibleRows = useMemo(() => rows.filter((r) => r.show), [rows]);

  function specialtiesForPosition(positionName: string): Specialty[] {
    const pos = positions.find((p) => p.name === positionName);
    if (!pos) return [];
    return specialties.filter((s) => s.positionId === pos.id).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function resolveSpecialtyId(row: RateRow): string {
    if (row.specialtyId) return row.specialtyId;
    // Fallback: match by position + specialty name for legacy rows
    const spcs = specialtiesForPosition(row.position);
    return spcs.find((s) => s.name === row.specialty)?.id ?? "";
  }

  function refreshProfiles() {
    setProfiles(loadRateCardProfiles());
    setActiveProfileIdState(getActiveRateCardProfileId());
  }

  function updateRow(index: number, patch: Partial<RateRow>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRateRow() {
    const posName = POSITIONS[0] || "Stagehand";
    const spcs = specialtiesForPosition(posName);
    const first = spcs[0];
    setRows([...rows, {
      specialtyId: first?.id ?? "",
      department: posName,
      position: posName,
      specialty: first?.name ?? "",
      hourly: 35, day: 350, otRate: 52.5, dtRate: 70,
      dtAfter: "10", travel: 0, show: true,
    }]);
  }

  function saveCurrentProfile() {
    const now = new Date().toISOString();
    const id = activeProfileId || `ratecard-${Date.now()}`;
    upsertRateCardProfile({
      id,
      clientId: clientId || undefined,
      clientName: clientName || blankProfileName(),
      name: profileName || "Standard",
      rows,
      terms,
      createdAt: now,
      updatedAt: now,
    });
    setActiveRateCardProfileId(id);
    setStatusMsg("Rate card saved.");
    refreshProfiles();
  }

  function saveAsCopy() {
    const now = new Date().toISOString();
    const id = `ratecard-${Date.now()}`;
    upsertRateCardProfile({
      id,
      clientId: clientId || undefined,
      clientName: clientName || blankProfileName(),
      name: `${profileName || "Standard"} Copy`,
      rows, terms, createdAt: now, updatedAt: now,
    });
    loadProfileIntoCurrent(id);
    setProfileName(`${profileName || "Standard"} Copy`);
    setStatusMsg("Rate card copied.");
    refreshProfiles();
  }

  function openProfile(id: string) {
    loadProfileIntoCurrent(id);
    setRows(loadRateRows());
    setTerms(loadTerms());
    setClientName(loadClientName());
    const profile = profiles.find((p) => p.id === id);
    setClientId(profile?.clientId ?? "");
    setProfileName(profile?.name ?? "Standard");
    refreshProfiles();
    setStatusMsg("Rate card loaded.");
  }

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">Master Rate Editor</h2>
        <div className="grid4">
          <div>
            <small>Client</small>
            <select value={clientId} onChange={(e) => {
              const c = clients.find((c) => c.id === e.target.value);
              setClientId(e.target.value);
              setClientName(c?.name ?? "");
            }}>
              <option value="">— Select Client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <small>Rate Card Name</small>
            <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. Standard, Union, Weekend" />
          </div>
          <div>
            <small>Saved Rate Cards</small>
            <select value={activeProfileId} onChange={(e) => openProfile(e.target.value)}>
              <option value="">Current Unsaved Working Card</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.clientName}{p.name && p.name !== p.clientName ? ` — ${p.name}` : ""}</option>)}
            </select>
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button onClick={saveCurrentProfile}>Save Rate Card</button>
            <button className="secondary" onClick={saveAsCopy}>Copy for New Client</button>
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button className="secondary" onClick={addRateRow}>Add Row</button>
            <button className="secondary" onClick={() => printWithTitle([
              "Rate Card",
              profileName,
              clientName,
            ])}>Download / Print PDF</button>
          </div>
        </div>
        {statusMsg ? <div className="badge" style={{ marginTop: 12 }}>{statusMsg}</div> : null}
      </div>

      <div className="card hide-print">
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Show</th><th>Position</th><th>Specialty</th><th>Hourly</th><th>Day</th><th>OT Rate</th><th>DT Rate</th><th>OT Trigger</th><th>Travel</th><th></th>
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
                          position: posName,
                          department: posName,
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
                    <td><input type="number" value={row.hourly} onChange={(e) => updateRow(index, { hourly: Number(e.target.value || 0) })} /></td>
                    <td><input type="number" value={row.day} onChange={(e) => updateRow(index, { day: Number(e.target.value || 0) })} /></td>
                    <td><input type="number" value={row.otRate} onChange={(e) => updateRow(index, { otRate: Number(e.target.value || 0) })} /></td>
                    <td><input type="number" value={row.dtRate} onChange={(e) => updateRow(index, { dtRate: Number(e.target.value || 0) })} /></td>
                    <td>
                      <select value={row.dtAfter} onChange={(e) => updateRow(index, { dtAfter: e.target.value as TriggerOption })}>
                        <option value="10">OT after 10</option>
                        <option value="11">OT after 11</option>
                        <option value="12">OT after 12</option>
                        <option value="13">OT after 13</option>
                        <option value="14">OT after 14</option>
                        <option value="15">OT after 15</option>
                      </select>
                    </td>
                    <td><input type="number" value={row.travel} onChange={(e) => updateRow(index, { travel: Number(e.target.value || 0) })} /></td>
                    <td><button className="secondary" style={{ color: "#a00", borderColor: "#e0a0a0", padding: "3px 8px" }} onClick={() => setRows(rows.filter((_, i) => i !== index))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="doc-sheet">
        <div className="pdf-header">
          <div></div>
          <div className="pdf-title-wrap">
            <div className="pdf-logo-wrap"><img src="/branding/client-logo.png" alt="Client logo" className="pdf-logo" /></div>
            <h2 className="pdf-title">Client Rate Card</h2>
            <div className="pdf-subtitle">Amplified Event Solutions{clientName ? ` — ${clientName}` : ""}</div>
          </div>
          <div></div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Position</th><th>Specialty</th><th>Hr</th><th>Day</th><th>OT</th><th>DT</th><th>Rule</th><th>Travel</th></tr></thead>
            <tbody>
              {visibleRows.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.position}</td><td>{row.specialty}</td><td>${row.hourly.toFixed(2)}</td><td>${row.day.toFixed(2)}</td><td>${row.otRate.toFixed(2)}</td><td>${row.dtRate.toFixed(2)}</td><td>{triggerLabel(row.dtAfter)}</td><td>{row.travel ? `$${row.travel.toFixed(2)}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 20 }}>
          <h3 className="section-title">Terms & Conditions</h3>
          <div className="hide-print">
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} style={{ width: "100%", minHeight: "900px", height: "900px", fontSize: "15px", lineHeight: "1.5", padding: "16px", borderRadius: "12px", border: "1px solid #d7c6aa", background: "#fff", resize: "vertical" }} />
          </div>
          <div className="print-terms" style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: "1.35", padding: "12px 0" }}>{terms}</div>
        </div>
      </div>
    </div>
  );
}

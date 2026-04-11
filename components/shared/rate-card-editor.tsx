
"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_RATE_ROWS, type TriggerOption, type RateRow } from "@/lib/rates/defaults";
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

function triggerLabel(value: TriggerOption) {
  return `OT after ${value} / DT after 15`;
}
function blankProfileName() {
  return `Client Rate Card ${new Date().toISOString().slice(0,10)}`;
}

export default function RateCardEditor() {
  const [clientName, setClientName] = useState("");
  const [rows, setRows] = useState<RateRow[]>(DEFAULT_RATE_ROWS);
  const [terms, setTerms] = useState("");
  const [profiles, setProfiles] = useState<RateCardProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    setRows(loadRateRows());
    setTerms(loadTerms());
    setClientName(loadClientName());
    setProfiles(loadRateCardProfiles());
    setActiveProfileIdState(getActiveRateCardProfileId());
  }, []);

  useEffect(() => { saveRateRows(rows); }, [rows]);
  useEffect(() => { saveTerms(terms); }, [terms]);
  useEffect(() => { saveClientName(clientName); }, [clientName]);

  const visibleRows = useMemo(() => rows.filter((r) => r.show), [rows]);

  function refreshProfiles() {
    setProfiles(loadRateCardProfiles());
    setActiveProfileIdState(getActiveRateCardProfileId());
  }

  function updateRow(index: number, patch: Partial<RateRow>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRateRow() {
    setRows([
      ...rows,
      {
        group: "Operations",
        position: "Custom",
        specialty: "New Position",
        hourly: 35,
        day: 350,
        otRate: 52.5,
        dtRate: 70,
        dtAfter: "10",
        travel: 0,
        show: true,
      },
    ]);
  }

  function saveCurrentProfile() {
    const now = new Date().toISOString();
    const id = activeProfileId || `ratecard-${Date.now()}`;
    upsertRateCardProfile({
      id,
      clientName: clientName || blankProfileName(),
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
    const nextName = clientName ? `${clientName} Copy` : `${blankProfileName()} Copy`;
    upsertRateCardProfile({
      id,
      clientName: nextName,
      rows,
      terms,
      createdAt: now,
      updatedAt: now,
    });
    loadProfileIntoCurrent(id);
    setStatusMsg("Rate card copied.");
    setClientName(nextName);
    refreshProfiles();
  }

  function openProfile(id: string) {
    loadProfileIntoCurrent(id);
    setRows(loadRateRows());
    setTerms(loadTerms());
    setClientName(loadClientName());
    refreshProfiles();
    setStatusMsg("Rate card loaded.");
  }

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">Master Rate Editor</h2>
        <div className="grid4">
          <div>
            <small>Client Name</small>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div>
            <small>Saved Client Rate Cards</small>
            <select value={activeProfileId} onChange={(e) => openProfile(e.target.value)}>
              <option value="">Current Unsaved Working Card</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.clientName}</option>)}
            </select>
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button onClick={saveCurrentProfile}>Save Rate Card</button>
            <button className="secondary" onClick={saveAsCopy}>Copy for New Client</button>
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button className="secondary" onClick={addRateRow}>Add Position</button>
            <button className="secondary" onClick={() => window.print()}>Download / Print PDF</button>
          </div>
        </div>
        {statusMsg ? <div className="badge" style={{ marginTop: 12 }}>{statusMsg}</div> : null}
      </div>

      <div className="card hide-print">
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Show</th><th>Group</th><th>Position</th><th>Specialty</th><th>Hourly</th><th>Day</th><th>OT Rate</th><th>DT Rate</th><th>OT Trigger</th><th>Travel</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td><input type="checkbox" checked={row.show} onChange={(e) => updateRow(index, { show: e.target.checked })} /></td>
                  <td><input value={row.group} onChange={(e) => updateRow(index, { group: e.target.value })} /></td>
                  <td><input value={row.position} onChange={(e) => updateRow(index, { position: e.target.value })} /></td>
                  <td><input value={row.specialty} onChange={(e) => updateRow(index, { specialty: e.target.value })} /></td>
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
                </tr>
              ))}
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
            <thead><tr><th>Department</th><th>Position</th><th>Specialty</th><th>Hr</th><th>Day</th><th>OT</th><th>DT</th><th>Rule</th><th>Travel</th></tr></thead>
            <tbody>
              {visibleRows.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.group}</td><td>{row.position}</td><td>{row.specialty}</td><td>${row.hourly.toFixed(2)}</td><td>${row.day.toFixed(2)}</td><td>${row.otRate.toFixed(2)}</td><td>${row.dtRate.toFixed(2)}</td><td>{triggerLabel(row.dtAfter)}</td><td>{row.travel ? `$${row.travel.toFixed(2)}` : "-"}</td>
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

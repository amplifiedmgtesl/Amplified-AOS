
"use client";

import { useEffect, useMemo, useState } from "react";
import { printWithTitle } from "@/lib/print-with-title";
import { DEFAULT_RATE_ROWS, type TriggerOption, type RateRow } from "@/lib/rates/defaults";
import { triggerLabel } from "@/lib/rates/ot-trigger";
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
  const [effectiveDate, setEffectiveDate] = useState("");
  const [holidayMultiplier, setHolidayMultiplier] = useState<number>(2.0);
  const [mode, setMode] = useState<"none" | "new" | "edit">("none");
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
      setEffectiveDate(activeProfile.effectiveDate ?? "");
      setHolidayMultiplier(activeProfile.holidayMultiplier ?? 2.0);
      setMode("edit");
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

  // Deep-link: /rate-card?new=1&clientId=<client> opens a fresh rate card
  // prefilled with that client. Lets the Client Maintenance "Rate Cards"
  // tab jump straight into a new card scoped to the current client.
  // Runs once after clients have loaded so we can resolve the client name.
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  useEffect(() => {
    if (deepLinkHandled || typeof window === "undefined") return;
    if (clients.length === 0) return; // wait for clients to load
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") { setDeepLinkHandled(true); return; }
    const wantClientId = params.get("clientId") ?? "";
    const c = wantClientId ? clients.find((x) => x.id === wantClientId) : undefined;

    // Use the existing startNewRateCard pathway, then overwrite client.
    startNewRateCard();
    if (c) {
      setClientId(c.id);
      setClientName(c.name);
    }
    window.history.replaceState({}, "", window.location.pathname);
    setDeepLinkHandled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.length, deepLinkHandled]);

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
      // Pay rates default to 0 — admin enters them explicitly.
      payHourly: 0, payOtRate: 0, payDtRate: 0,
      dtAfter: "10", travel: 0, show: true,
    }]);
  }

  function saveCurrentProfile() {
    if (mode === "none") {
      setStatusMsg("Pick a saved rate card or click + New Rate Card before saving.");
      return;
    }
    // Uniqueness guard: enforces the same (client_id, lower(name), effective_date)
    // constraint that's set on the DB (migration 20260429i), but with a friendly
    // inline message instead of a silent server-side rejection.
    const targetClientForUniq = clientId || null;
    const targetNameForUniq = (profileName || "Standard").trim().toLowerCase();
    const targetDateForUniq = effectiveDate || null;
    if (targetClientForUniq) {
      const collision = profiles.find(
        (p) =>
          p.id !== activeProfileId &&
          (p.clientId ?? null) === targetClientForUniq &&
          (p.name ?? "Standard").trim().toLowerCase() === targetNameForUniq &&
          (p.effectiveDate ?? null) === targetDateForUniq,
      );
      if (collision) {
        const dateNote = targetDateForUniq
          ? ` effective ${targetDateForUniq}`
          : " (no effective date)";
        setStatusMsg(
          `A rate card named "${profileName}"${dateNote} already exists for this client. ` +
          `Pick a different name or set a different effective date.`,
        );
        return;
      }
    }

    // Cross-client / cross-name overwrite guard. If the loaded profile has
    // moved to a different client or had its name changed, treat it as a new
    // profile rather than silently overwriting the original. Mirrors the
    // upsertQuote collision check shipped during the Connor hot-fixes.
    if (activeProfileId) {
      const original = profiles.find((p) => p.id === activeProfileId);
      const targetClient = clientId || undefined;
      const targetName = profileName || "Standard";
      const targetDate = effectiveDate || undefined;
      const movedClient = original && (original.clientId ?? undefined) !== targetClient;
      const renamed = original && (original.name ?? "Standard") !== targetName;
      const dateChanged = original && (original.effectiveDate ?? undefined) !== targetDate;
      if (movedClient || renamed || dateChanged) {
        const parts: string[] = [];
        if (movedClient) parts.push("client");
        if (renamed) parts.push("name");
        if (dateChanged) parts.push("effective date");
        const which = parts.length === 3 ? "client, name, and effective date"
          : parts.length === 2 ? `${parts[0]} and ${parts[1]}`
          : parts[0];
        const ok = window.confirm(
          `The ${which} on the loaded rate card has changed.\n\n` +
          `OK = save as a NEW rate card (recommended; keeps the original intact).\n` +
          `Cancel = stop and review.`,
        );
        if (!ok) return;
        const now = new Date().toISOString();
        const id = `ratecard-${Date.now()}`;
        upsertRateCardProfile({
          id,
          clientId: targetClient,
          clientName: clientName || blankProfileName(),
          name: targetName,
          effectiveDate: effectiveDate || undefined,
          rows, terms, holidayMultiplier, createdAt: now, updatedAt: now,
        });
        setActiveRateCardProfileId(id);
        setMode("edit");
        setStatusMsg("Saved as a new rate card. Original is unchanged.");
        refreshProfiles();
        return;
      }
    }
    const now = new Date().toISOString();
    const id = activeProfileId || `ratecard-${Date.now()}`;
    upsertRateCardProfile({
      id,
      clientId: clientId || undefined,
      clientName: clientName || blankProfileName(),
      name: profileName || "Standard",
      effectiveDate: effectiveDate || undefined,
      rows,
      terms,
      holidayMultiplier,
      createdAt: now,
      updatedAt: now,
    });
    setActiveRateCardProfileId(id);
    setMode("edit");
    setStatusMsg("Rate card saved.");
    refreshProfiles();
  }

  function startNewRateCard() {
    setActiveRateCardProfileId("");
    setActiveProfileIdState("");
    setClientId("");
    setClientName("");
    setProfileName("Standard");
    setEffectiveDate("");
    // Seed from the Master Default profile if it exists; fall back to the
    // hardcoded constant so brand-new dev databases or partial migrations
    // still produce a usable starter card. Holiday multiplier also seeds
    // from the master default so operator's company-wide setting propagates.
    const masterDefault = profiles.find((p) => p.id === "ratecard-master-default");
    setRows(masterDefault?.rows && masterDefault.rows.length > 0 ? masterDefault.rows : DEFAULT_RATE_ROWS);
    setHolidayMultiplier(masterDefault?.holidayMultiplier ?? 2.0);
    setTerms("");
    setMode("new");
    setStatusMsg(
      masterDefault?.rows && masterDefault.rows.length > 0
        ? "New rate card seeded from Master Default. Pick a client, adjust rows, click Save Rate Card."
        : "New rate card. Pick a client, set the rows, click Save Rate Card."
    );
  }

  function saveAsCopy() {
    if (mode !== "edit" || !activeProfileId) {
      setStatusMsg("Open a saved rate card first, then click Copy for New Client to duplicate it.");
      return;
    }
    const now = new Date().toISOString();
    const id = `ratecard-${Date.now()}`;
    upsertRateCardProfile({
      id,
      clientId: clientId || undefined,
      clientName: clientName || blankProfileName(),
      name: `${profileName || "Standard"} Copy`,
      effectiveDate: effectiveDate || undefined,
      rows, terms, holidayMultiplier, createdAt: now, updatedAt: now,
    });
    loadProfileIntoCurrent(id);
    setProfileName(`${profileName || "Standard"} Copy`);
    setMode("edit");
    setStatusMsg("Rate card copied.");
    refreshProfiles();
  }

  function openProfile(id: string) {
    if (!id) {
      // User picked the placeholder option — return to "no card selected" state.
      setActiveRateCardProfileId("");
      setActiveProfileIdState("");
      setClientId("");
      setClientName("");
      setProfileName("Standard");
      setEffectiveDate("");
      setRows(DEFAULT_RATE_ROWS);
      setTerms("");
      setMode("none");
      setStatusMsg("");
      return;
    }
    loadProfileIntoCurrent(id);
    setRows(loadRateRows());
    setTerms(loadTerms());
    setClientName(loadClientName());
    const profile = profiles.find((p) => p.id === id);
    setClientId(profile?.clientId ?? "");
    setProfileName(profile?.name ?? "Standard");
    setEffectiveDate(profile?.effectiveDate ?? "");
    setHolidayMultiplier(profile?.holidayMultiplier ?? 2.0);
    setMode("edit");
    refreshProfiles();
    setStatusMsg("Rate card loaded.");
  }

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">Master Rate Editor</h2>

        {/* Row 1 — pick existing or start fresh. Visually separated from the
            edit form below so it's clear this is a navigation control,
            not a field on the loaded rate card. */}
        <div style={{
          display: "flex", gap: 12, alignItems: "flex-end",
          padding: "8px 12px", marginBottom: 16,
          background: "var(--surface2, #f7f7f9)",
          border: "1px solid var(--border, #e5e7eb)", borderRadius: 8,
        }}>
          <div style={{ flex: 1 }}>
            <small>Saved Rate Cards</small>
            <select
              value={activeProfileId}
              onChange={(e) => openProfile(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">— Select a saved rate card —</option>
              {profiles
                // The Master Default profile is edited via Maintenance, not picked here.
                .filter((p) => p.id !== "ratecard-master-default")
                .map((p) => {
                  const label = p.clientName + (p.name && p.name !== p.clientName ? ` — ${p.name}` : "");
                  const dateLabel = p.effectiveDate ? ` (effective ${p.effectiveDate})` : "";
                  return <option key={p.id} value={p.id}>{label}{dateLabel}</option>;
                })}
            </select>
          </div>
          <button onClick={startNewRateCard} title="Start a new rate card from defaults">
            + New Rate Card
          </button>
        </div>

        {/* Row 2 — fields belonging to the currently-loaded (or new) rate card. */}
        <div className="grid4">
          <div>
            <small>Client</small>
            <select disabled={mode === "none"} value={clientId} onChange={(e) => {
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
            <input disabled={mode === "none"} value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. Standard, Union, Weekend" />
          </div>
          <div>
            <small>Effective Date</small>
            <input
              type="date"
              disabled={mode === "none"}
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              title="Date this rate card becomes effective. Leave blank for an undated card."
            />
          </div>
          <div>
            <small>Holiday Multiplier</small>
            <input
              type="number"
              min={1.0}
              step={0.1}
              disabled={mode === "none"}
              value={holidayMultiplier}
              onChange={(e) => setHolidayMultiplier(Number(e.target.value) || 2.0)}
              title="Multiplier applied to all billable hours on days flagged as holiday. Typical values: 2.0 (most), 2.5 (some IATSE locals), 3.0 (rare)."
              style={{ width: 80 }}
            />
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button onClick={saveCurrentProfile} disabled={mode === "none"}>Save Rate Card</button>
            <button
              className="secondary"
              onClick={saveAsCopy}
              disabled={mode !== "edit" || !activeProfileId}
              title={mode === "edit" && activeProfileId ? "Duplicate this rate card for another client" : "Open a saved rate card first to copy it"}
            >
              Copy for New Client
            </button>
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button className="secondary" onClick={addRateRow} disabled={mode === "none"}>Add Row</button>
            <button
              className="secondary"
              disabled={mode === "none"}
              onClick={() => printWithTitle([
                "Rate Card",
                profileName,
                clientName,
              ])}
            >
              Download / Print PDF
            </button>
          </div>
        </div>
        {statusMsg ? <div className="badge" style={{ marginTop: 12 }}>{statusMsg}</div> : null}
        {mode === "none" && !statusMsg && (
          <div className="muted" style={{ marginTop: 12, fontSize: 13, fontStyle: "italic" }}>
            No rate card loaded. Pick one from the dropdown above, or click <strong>+ New Rate Card</strong> to start fresh.
          </div>
        )}
      </div>

      <div className="card hide-print">
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Show</th><th>Position</th><th>Specialty</th>
                <th colSpan={4} style={{ textAlign: "center", borderBottom: "1px solid #d7c6aa" }} title="Bill rates: what AES bills the client">Bill</th>
                <th colSpan={3} style={{ textAlign: "center", borderBottom: "1px solid #d7c6aa", background: "#fff4d6", color: "#181410" }} title="Pay rates: what AES pays the worker. ADMIN-ONLY — never appears on client-facing documents.">Pay</th>
                <th>OT Trigger</th><th>Travel</th><th></th>
              </tr>
              <tr>
                <th></th><th></th><th></th>
                <th>Hourly</th><th>Day</th><th>OT</th><th>DT</th>
                <th style={{ background: "#fff4d6", color: "#181410" }}>Hourly</th>
                <th style={{ background: "#fff4d6", color: "#181410" }}>OT</th>
                <th style={{ background: "#fff4d6", color: "#181410" }}>DT</th>
                <th></th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const spcs = specialtiesForPosition(row.position);
                const resolvedId = resolveSpecialtyId(row);
                return (
                  <tr key={index}>
                    <td><input type="checkbox" disabled={mode === "none"} checked={row.show} onChange={(e) => updateRow(index, { show: e.target.checked })} /></td>
                    <td>
                      <select disabled={mode === "none"} value={row.position} onChange={(e) => {
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
                      <select disabled={mode === "none"} value={resolvedId} onChange={(e) => {
                        const spc = specialties.find((s) => s.id === e.target.value);
                        updateRow(index, { specialtyId: e.target.value, specialty: spc?.name ?? "" });
                      }}>
                        {spcs.length === 0 && <option value="">— no specialties —</option>}
                        {spcs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" disabled={mode === "none"} value={row.hourly} onChange={(e) => {
                      const h = Number(e.target.value || 0);
                      updateRow(index, {
                        hourly: h,
                        day: Number((h * 10).toFixed(2)),
                        otRate: Number((h * 1.5).toFixed(2)),
                        dtRate: Number((h * 2).toFixed(2)),
                      });
                    }} /></td>
                    <td><input type="number" disabled={mode === "none"} value={row.day} onChange={(e) => updateRow(index, { day: Number(e.target.value || 0) })} /></td>
                    <td><input type="number" disabled={mode === "none"} value={row.otRate} onChange={(e) => updateRow(index, { otRate: Number(e.target.value || 0) })} /></td>
                    <td><input type="number" disabled={mode === "none"} value={row.dtRate} onChange={(e) => updateRow(index, { dtRate: Number(e.target.value || 0) })} /></td>
                    {/* ── Pay rates (admin-only, never client-facing) ──
                        Typing payHourly auto-cascades payOt = h × 1.5 and
                        payDt = h × 2 (per Connor's rule); operator can still
                        override per-column afterwards. */}
                    <td style={{ background: "#fffaeb" }}>
                      <input type="number" disabled={mode === "none"} value={row.payHourly}
                        title="Pay rate (what AES pays the worker). NEVER printed on client docs."
                        onChange={(e) => {
                          const h = Number(e.target.value || 0);
                          updateRow(index, {
                            payHourly: h,
                            payOtRate: Number((h * 1.5).toFixed(2)),
                            payDtRate: Number((h * 2).toFixed(2)),
                          });
                        }} />
                    </td>
                    <td style={{ background: "#fffaeb" }}>
                      <input type="number" disabled={mode === "none"} value={row.payOtRate}
                        title="Pay OT rate. Defaults to payHourly × 1.5; override per-row if needed."
                        onChange={(e) => updateRow(index, { payOtRate: Number(e.target.value || 0) })} />
                    </td>
                    <td style={{ background: "#fffaeb" }}>
                      <input type="number" disabled={mode === "none"} value={row.payDtRate}
                        title="Pay DT rate. Defaults to payHourly × 2; override per-row if needed."
                        onChange={(e) => updateRow(index, { payDtRate: Number(e.target.value || 0) })} />
                    </td>
                    <td>
                      <select disabled={mode === "none"} value={row.dtAfter} onChange={(e) => updateRow(index, { dtAfter: e.target.value as TriggerOption })}>
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
                    <td><input type="number" disabled={mode === "none"} value={row.travel} onChange={(e) => updateRow(index, { travel: Number(e.target.value || 0) })} /></td>
                    <td><button className="secondary" disabled={mode === "none"} style={{ color: "#a00", borderColor: "#e0a0a0", padding: "3px 8px" }} onClick={() => setRows(rows.filter((_, i) => i !== index))}>✕</button></td>
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
            <textarea disabled={mode === "none"} value={terms} onChange={(e) => setTerms(e.target.value)} style={{ width: "100%", minHeight: "900px", height: "900px", fontSize: "15px", lineHeight: "1.5", padding: "16px", borderRadius: "12px", border: "1px solid #d7c6aa", background: "#fff", resize: "vertical" }} />
          </div>
          <div className="print-terms" style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: "1.35", padding: "12px 0" }}>{terms}</div>
        </div>
      </div>
    </div>
  );
}

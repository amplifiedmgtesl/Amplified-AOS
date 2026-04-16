
"use client";

import { useMemo, useState } from "react";
import { combinedCalendarEvents } from "@/lib/store/calendar";
import { addWorkerToTimesheet, getActiveJobSheet, getTimesheetByJobSheetId, loadEmployees, loadJobSheets, setActiveJobSheet, upsertEmployee, upsertJobSheet } from "@/lib/store/app-store";
import { timeOptions } from "@/lib/store/timekeeping";
import { positionNames } from "@/lib/store/app-store";
import { US_STATES } from "@/lib/constants";
import type { EmployeeRecord, JobSheet, JobSheetWorker } from "@/lib/store/types";

const TIMES = timeOptions();
// POSITIONS loaded from store inside component

export default function JobSheets() {
  const POSITIONS = positionNames();
  const [refreshKey, setRefreshKey] = useState(0);
  const sheets = useMemo(() => loadJobSheets(), [refreshKey]);
  const events = useMemo(() => combinedCalendarEvents(), [refreshKey]);
  const activeId = getActiveJobSheet() || sheets[0]?.id || "";
  const active = sheets.find((s) => s.id === activeId) || null;

  const [seedEventId, setSeedEventId] = useState("");
  const [manual, setManual] = useState({
    title: "",
    client: "",
    eventName: "",
    venue: "",
    venueAddress: "",
    city: "",
    state: "",
    cityState: "",
    googleMapsLink: "",
    date: "",
    callTime: "08:00",
    notes: ""
  });
  const [manualWorker, setManualWorker] = useState({ firstName:"", lastName:"", phone:"", email:"", role:"Crew" });
  const [addStatus, setAddStatus] = useState<{ type: "found" | "created"; name: string } | null>(null);

  // Live employee lookup — match by email first, then by full name
  const employees = loadEmployees();
  const matchedEmployee = useMemo<EmployeeRecord | null>(() => {
    const email = manualWorker.email.trim().toLowerCase();
    const fullName = `${manualWorker.firstName} ${manualWorker.lastName}`.trim().toLowerCase();
    if (email) {
      const byEmail = employees.find((e) => e.email?.toLowerCase() === email);
      if (byEmail) return byEmail;
    }
    if (fullName.length > 2) {
      const byName = employees.find((e) => e.fullName.toLowerCase() === fullName);
      if (byName) return byName;
    }
    return null;
  }, [manualWorker.email, manualWorker.firstName, manualWorker.lastName, employees]);

  function chooseSheet(id: string) {
    setActiveJobSheet(id);
    setRefreshKey((x) => x + 1);
  }

  function createFromEvent() {
    const found = events.find((e) => e.id === seedEventId);
    if (!found) return;
    const row: JobSheet = {
      id: `jobsheet-${Date.now()}`,
      sourceEventId: found.id,
      title: `${found.client} - ${found.eventName}`,
      client: found.client,
      eventName: found.eventName,
      venue: found.venue,
      venueAddress: found.venueAddress || "",
      city: found.city || "",
      state: found.state || "",
      cityState: found.cityState,
      googleMapsLink: found.googleMapsLink || "",
      date: found.startDate,
      callTime: found.startTime || "08:00",
      notes: found.notes || "",
      attachmentNames: [],
      workers: []
    };
    upsertJobSheet(row);
    setActiveJobSheet(row.id);
    setRefreshKey((x) => x + 1);
  }

  function createManual() {
    const row: JobSheet = {
      id: `jobsheet-${Date.now()}`,
      title: manual.title || `${manual.client} - ${manual.eventName}`,
      client: manual.client,
      eventName: manual.eventName,
      venue: manual.venue,
      venueAddress: manual.venueAddress,
      city: manual.city,
      state: manual.state,
      cityState: manual.cityState || [manual.city, manual.state].filter(Boolean).join(", "),
      googleMapsLink: manual.googleMapsLink,
      date: manual.date,
      callTime: manual.callTime,
      notes: manual.notes,
      attachmentNames: [],
      workers: []
    };
    upsertJobSheet(row);
    setActiveJobSheet(row.id);
    setRefreshKey((x) => x + 1);
  }

  function addManualWorker() {
    if (!active) return;
    const fullName = `${manualWorker.firstName} ${manualWorker.lastName}`.trim();
    if (!fullName) return;

    let employeeKey: string;
    let statusType: "found" | "created";

    if (matchedEmployee) {
      // Use existing employee record
      employeeKey = matchedEmployee.employeeKey;
      statusType = "found";
    } else {
      // Create a new employee record
      employeeKey = `AES-${Date.now().toString().slice(-5)}`;
      const newEmp: EmployeeRecord = {
        employeeKey,
        fullName,
        firstName: manualWorker.firstName,
        lastName: manualWorker.lastName,
        email: manualWorker.email || undefined,
        phone: manualWorker.phone || undefined,
        type: "contractor",
        source: "manual",
      };
      upsertEmployee(newEmp);
      statusType = "created";
    }

    const worker: JobSheetWorker = {
      employeeKey,
      fullName: matchedEmployee?.fullName || fullName,
      firstName: matchedEmployee?.firstName || manualWorker.firstName,
      lastName: matchedEmployee?.lastName || manualWorker.lastName,
      stateCode: matchedEmployee?.stateCode || active.state || "",
      phone: matchedEmployee?.phone || manualWorker.phone,
      email: matchedEmployee?.email || manualWorker.email,
      role: manualWorker.role,
      confirmed: false,
    };

    upsertJobSheet({ ...active, workers: [...active.workers, worker] });
    addWorkerToTimesheet(active.id, worker);
    setAddStatus({ type: statusType, name: worker.fullName });
    setManualWorker({ firstName:"", lastName:"", phone:"", email:"", role:"Crew" });
    setRefreshKey((x) => x + 1);
    setTimeout(() => setAddStatus(null), 4000);
  }


function addWorkerToLinkedTimesheet(worker: JobSheetWorker) {
  if (!active) return;
  addWorkerToTimesheet(active.id, worker);
  setRefreshKey((x) => x + 1);
}

  function removeWorker(employeeKey: string) {
    if (!active) return;
    upsertJobSheet({ ...active, workers: active.workers.filter((w) => w.employeeKey !== employeeKey) });
    setRefreshKey((x) => x + 1);
  }

  function saveNotes(val: string) {
    if (!active) return;
    upsertJobSheet({ ...active, notes: val });
    setRefreshKey((x) => x + 1);
  }

  function saveAttachments(files: FileList | null) {
    if (!active || !files) return;
    upsertJobSheet({ ...active, attachmentNames: [...active.attachmentNames, ...Array.from(files).map((f)=>f.name)] });
    setRefreshKey((x) => x + 1);
  }

  const linkedTimesheet = active ? getTimesheetByJobSheetId(active.id) : null;

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">Create Job Sheet</h2>
        <div className="grid2">
          <div>
            <small>Create from calendar event</small>
            <select value={seedEventId} onChange={(e)=>setSeedEventId(e.target.value)}>
              <option value="">Select event</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.client} - {e.eventName} - {e.startDate}</option>)}
            </select>
          </div>
          <div className="action-row" style={{ alignItems: "end" }}>
            <button onClick={createFromEvent}>Create from Event</button>
          </div>
        </div>

        <div style={{ marginTop: 14 }} className="grid4">
          <div><small>Title</small><input value={manual.title} onChange={(e)=>setManual({ ...manual, title:e.target.value })} /></div>
          <div><small>Client</small><input value={manual.client} onChange={(e)=>setManual({ ...manual, client:e.target.value })} /></div>
          <div><small>Event Name</small><input value={manual.eventName} onChange={(e)=>setManual({ ...manual, eventName:e.target.value })} /></div>
          <div><small>Venue</small><input value={manual.venue} onChange={(e)=>setManual({ ...manual, venue:e.target.value })} /></div>
          <div><small>Venue Address</small><input value={manual.venueAddress} onChange={(e)=>setManual({ ...manual, venueAddress:e.target.value })} /></div>
          <div><small>City</small><input value={manual.city} onChange={(e)=>setManual({ ...manual, city:e.target.value })} /></div>
          <div><small>State</small><select value={manual.state} onChange={(e)=>setManual({ ...manual, state:e.target.value })}><option value="">— Select —</option>{US_STATES.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>Google Maps Link</small><input value={manual.googleMapsLink} onChange={(e)=>setManual({ ...manual, googleMapsLink:e.target.value })} /></div>
          <div><small>Date</small><input type="date" value={manual.date} onChange={(e)=>setManual({ ...manual, date:e.target.value })} /></div>
          <div><small>Call Time</small><select value={manual.callTime} onChange={(e)=>setManual({ ...manual, callTime:e.target.value })}>{TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <small>Notes</small>
          <textarea value={manual.notes} onChange={(e)=>setManual({ ...manual, notes:e.target.value })} />
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <button className="secondary" onClick={createManual}>Create Manual Job Sheet</button>
        </div>
      </div>

      <div className="grid2">
        <div className="card hide-print">
          <h2 className="section-title">Job Sheets</h2>
          {sheets.length === 0 ? <div className="muted">No job sheets yet.</div> : (
            <div className="grid">
              {sheets.map((sheet) => (
                <div key={sheet.id} className="list-card">
                  <div><strong>{sheet.title}</strong></div>
                  <div className="muted">{sheet.date} - {sheet.callTime}</div>
                  <div className="muted">{sheet.venue}</div>
                  <div className="action-row" style={{ marginTop: 8 }}>
                    <button className="secondary" onClick={() => chooseSheet(sheet.id)}>Open</button>
                    {activeId === sheet.id ? <span className="badge pill-green">Current target</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="doc-sheet">
          <div className="pdf-header">
            <div></div>
            <div className="pdf-title-wrap">
              <div className="pdf-logo-wrap"><img src="/branding/client-logo.png" alt="Logo" className="pdf-logo" /></div>
              <h2 className="pdf-title">Job Profile</h2>
              <div className="pdf-subtitle">{active ? active.title : "No job sheet selected"}</div>
            </div>
            <div></div>
          </div>

          {!active ? (
            <div className="muted">Select a job sheet to review it here.</div>
          ) : (
            <>
              <div className="grid3">
                <div className="metric-card"><div className="metric-label">Client</div><div className="metric-value" style={{ fontSize: 18 }}>{active.client}</div></div>
                <div className="metric-card"><div className="metric-label">Venue</div><div className="metric-value" style={{ fontSize: 18 }}>{active.venue}</div></div>
                <div className="metric-card"><div className="metric-label">Workers</div><div className="metric-value">{active.workers.length}</div></div>
              </div>

              <div className="action-row hide-print" style={{ marginTop: 12 }}>
                <a className="badge" href="/timekeeping">Open Linked Timekeeping Sheet</a>
                <button className="secondary" onClick={() => active.workers.forEach((w) => addWorkerToLinkedTimesheet(w))}>Add All Crew to Timekeeping</button>
                <a className="badge" href="/employee-directory">Add from Employee Directory</a>
                {active.googleMapsLink ? <a className="badge" href={active.googleMapsLink} target="_blank" rel="noreferrer">Open Google Maps</a> : null}
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 className="section-title">Add Crew to Job Sheet</h3>
                <div className="grid4">
                  <div><small>First Name</small><input value={manualWorker.firstName} onChange={(e)=>setManualWorker({ ...manualWorker, firstName:e.target.value })} /></div>
                  <div><small>Last Name</small><input value={manualWorker.lastName} onChange={(e)=>setManualWorker({ ...manualWorker, lastName:e.target.value })} /></div>
                  <div><small>Phone</small><input value={manualWorker.phone} onChange={(e)=>setManualWorker({ ...manualWorker, phone:e.target.value })} /></div>
                  <div><small>Email</small><input value={manualWorker.email} onChange={(e)=>setManualWorker({ ...manualWorker, email:e.target.value })} /></div>
                  <div><small>Role</small><select value={manualWorker.role} onChange={(e)=>setManualWorker({ ...manualWorker, role:e.target.value })}>{POSITIONS.map((p)=><option key={p} value={p}>{p}</option>)}</select></div>
                </div>

                {/* Live match indicator */}
                {matchedEmployee && (
                  <div style={{ marginTop: 8, padding: "8px 12px", background: "#eef8ef", border: "1px solid #cfe7d1", borderRadius: 8, fontSize: 13, color: "#2a5a31" }}>
                    ✓ Found existing employee: <strong>{matchedEmployee.fullName}</strong> ({matchedEmployee.employeeKey})
                    {matchedEmployee.phone && <> — {matchedEmployee.phone}</>}
                  </div>
                )}

                <div className="action-row" style={{ marginTop: 10 }}>
                  <button onClick={addManualWorker}>
                    {matchedEmployee ? "Add to Job Sheet" : "Add & Create Employee Record"}
                  </button>
                  {addStatus && (
                    <span style={{ fontSize: 13, color: addStatus.type === "found" ? "#2a5a31" : "#6b4c00" }}>
                      {addStatus.type === "found"
                        ? `✓ Linked to existing employee: ${addStatus.name}`
                        : `✓ Created new employee record: ${addStatus.name}`}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 className="section-title">Assigned Workers</h3>
                {active.workers.length === 0 ? (
                  <div className="muted">No workers assigned yet. Use the Employee Directory page and click “Add to Current Job Sheet”.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Role</th><th>Confirmed</th><th>Action</th></tr></thead>
                      <tbody>
                        {active.workers.map((w) => (
                          <tr key={w.employeeKey}>
                            <td>{w.fullName}</td>
                            <td>{w.phone}</td>
                            <td>{w.email}</td>
                            <td>{w.role}</td>
                            <td>{w.confirmed ? "Yes" : "No"}</td>
                            <td><div className="action-row"><button className="secondary" onClick={() => addWorkerToLinkedTimesheet(w)}>Add to Timekeeping</button><button className="secondary" onClick={() => removeWorker(w.employeeKey)}>Remove</button></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 className="section-title">Job Notes & Drawings</h3>
                <textarea value={active.notes} onChange={(e) => saveNotes(e.target.value)} />
                <div style={{ marginTop: 10 }}>
                  <small>Drawings / Files</small>
                  <input type="file" multiple onChange={(e) => saveAttachments(e.target.files)} />
                  <div className="muted" style={{ marginTop: 8 }}>{active.attachmentNames.join(", ") || "No files added yet."}</div>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 className="section-title">Linked Timekeeping</h3>
                <div className="muted">{linkedTimesheet ? `${linkedTimesheet.rows.length} rows linked to this job sheet.` : "No timekeeping rows yet."}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

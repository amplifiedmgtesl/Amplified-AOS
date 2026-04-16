
"use client";

import { useEffect, useMemo, useState } from "react";
import { IMPORTED_EMPLOYEES } from "@/lib/data/employees";
import { addWorkerToTimesheet, bulkUpsertEmployees, deleteEmployee, getActiveEmployee, getActiveJobSheet, loadDeletedEmployeeKeys, loadEmployees, loadJobSheets, loadTimesheets, setActiveEmployee, upsertEmployee, upsertJobSheet } from "@/lib/store/app-store";
import type { EmployeeDocument, EmployeeRecord } from "@/lib/store/types";

type Employee = EmployeeRecord;

// Returns employees from Supabase cache. Falls back to including the hardcoded
// import list until the one-time migration to Supabase has been completed.
function mergedEmployees() {
  const deleted = new Set(loadDeletedEmployeeKeys());
  const fromDb = loadEmployees().filter((e) => !deleted.has(e.employeeKey));
  // If Supabase already has records, use only those (migration done).
  if (fromDb.length > 0) return fromDb;
  // Pre-migration fallback: blend hardcoded list with any local additions.
  const imported = (IMPORTED_EMPLOYEES as unknown as EmployeeRecord[])
    .map((e) => ({ ...e, type: "contractor" as const, source: "imported" }))
    .filter((e) => !deleted.has(e.employeeKey));
  const map = new Map<string, EmployeeRecord>();
  imported.forEach((e) => map.set(e.employeeKey, e));
  return Array.from(map.values());
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export default function EmployeeDirectory() {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortAZ, setSortAZ] = useState<"A-Z"|"Z-A">("A-Z");
  const [refreshKey, setRefreshKey] = useState(0);
  const [role, setRole] = useState("Crew");
  const [csvText, setCsvText] = useState("");
  const [historyModal, setHistoryModal] = useState<"jobs" | "timesheets" | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{ inserted: number; errors: number } | null>(null);
  const [form, setForm] = useState<EmployeeRecord>({
    employeeKey: "",
    fullName: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    stateCode: "",
    state: "",
    city: "",
    address: "",
    employmentType: "",
    type: "contractor",
    notes: "",
    documents: [],
    source: "local"
  });
  const activeSheetId = getActiveJobSheet();
  const activeSheet = loadJobSheets().find((s) => s.id === activeSheetId) || null;
  const employees = useMemo(() => mergedEmployees(), [refreshKey]);
  const activeEmployeeKey = getActiveEmployee() || employees[0]?.employeeKey || "";
  const activeEmployee = employees.find((e) => e.employeeKey === activeEmployeeKey) || null;

  useEffect(() => {
    if (!getActiveEmployee() && employees[0]) setActiveEmployee(employees[0].employeeKey);
  }, [refreshKey]);

  const states = useMemo(() => Array.from(new Set(employees.map((e) => e.stateCode || e.state || "").filter(Boolean))).sort(), [employees]);
  const cities = useMemo(() => Array.from(new Set(employees.map((e) => e.city || "").filter(Boolean))).sort(), [employees]);
  const statuses = useMemo(() => Array.from(new Set(employees.map((e) => e.status || "").filter(Boolean))).sort(), [employees]);
  const types = useMemo(() => Array.from(new Set(employees.map((e) => e.employmentType || "").filter(Boolean))).sort(), [employees]);

  async function handleMigrateToDatabase() {
    setMigrating(true);
    setMigrateResult(null);
    const toMigrate = (IMPORTED_EMPLOYEES as unknown as EmployeeRecord[]).map((e) => ({
      ...e,
      type: "contractor" as const,
      source: "imported",
    }));
    const result = await bulkUpsertEmployees(toMigrate);
    setMigrateResult(result);
    setMigrating(false);
    setRefreshKey((x) => x + 1);
  }

  const isMigrated = loadEmployees().length > 0;

  const filtered = useMemo(() => {
    const rows = employees.filter((e) => {
      const hay = `${e.employeeKey || ""} ${e.fullName || ""} ${e.firstName || ""} ${e.lastName || ""} ${e.email || ""} ${e.phone || ""} ${e.stateCode || e.state || ""} ${e.city || ""} ${e.status || ""} ${e.employmentType || ""}`.toLowerCase();
      const q = query.toLowerCase();
      return (!q || hay.includes(q))
        && (!stateFilter || (e.stateCode || e.state || "") === stateFilter)
        && (!cityFilter || (e.city || "") === cityFilter)
        && (!statusFilter || (e.status || "") === statusFilter)
        && (!typeFilter || (typeFilter === "__blank__" ? !e.employmentType : (e.employmentType || "") === typeFilter))
;
    });
    rows.sort((a,b) => {
      const av = (a.fullName || "").toLowerCase();
      const bv = (b.fullName || "").toLowerCase();
      return sortAZ === "A-Z" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return rows;
  }, [query, stateFilter, cityFilter, statusFilter, typeFilter, sortAZ, employees]);

  function addToCurrentJob(employee: Employee) {
    if (!activeSheet) return;
    const exists = activeSheet.workers.some((w) => w.employeeKey === employee.employeeKey);
    if (exists) return;
    upsertJobSheet({
      ...activeSheet,
      workers: [
        ...activeSheet.workers,
        {
          employeeKey: employee.employeeKey,
          fullName: employee.fullName,
          firstName: employee.firstName || employee.fullName.split(" ")[0] || "",
          lastName: employee.lastName || employee.fullName.split(" ").slice(1).join(" "),
          stateCode: employee.stateCode || "",
          phone: employee.phone || "",
          email: employee.email || "",
          role,
          confirmed: false
        }
      ]
    });
    setRefreshKey((x) => x + 1);
  }


function addToCurrentTimesheet(employee: Employee) {
  if (!activeSheet) return;
  const worker = {
    employeeKey: employee.employeeKey,
    fullName: employee.fullName,
    firstName: employee.firstName || employee.fullName.split(" ")[0] || "",
    lastName: employee.lastName || employee.fullName.split(" ").slice(1).join(" "),
    stateCode: employee.stateCode || "",
    phone: employee.phone || "",
    email: employee.email || "",
    role,
    confirmed: false
  };
  addWorkerToTimesheet(activeSheet.id, worker);
  setRefreshKey((x) => x + 1);
}

  function saveManualEmployee() {
    const key = form.employeeKey || `emp-${Date.now()}`;
    const fullName = form.fullName || `${form.firstName} ${form.lastName}`.trim();
    upsertEmployee({ ...form, employeeKey: key, fullName, type: form.type || "contractor", source: "local" });
    setForm({
      employeeKey: "", fullName: "", firstName: "", lastName: "", phone: "", email: "",
      stateCode: "", state: "", city: "", address: "", employmentType: "", type: "contractor", notes: "", documents: [], source: "local"
    });
    setRefreshKey((x) => x + 1);
  }

  function importCsv() {
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return;
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    lines.slice(1).forEach((line, idx) => {
      const cols = line.split(",").map((c) => c.trim());
      const get = (name: string) => cols[headers.indexOf(name)] || "";
      const firstName = get("first name") || get("firstname");
      const lastName = get("last name") || get("lastname");
      upsertEmployee({
        employeeKey: get("employee key") || `csv-${Date.now()}-${idx}`,
        fullName: get("full name") || `${firstName} ${lastName}`.trim(),
        firstName, lastName,
        phone: get("phone"), email: get("email"),
        stateCode: get("state code") || get("state"),
        state: get("state"), city: get("city"),
        address: get("address"), employmentType: get("employment type"),
        status: get("status"),
        type: get("type") === "staff" ? "staff" : "contractor",
        source: "local", documents: []
      });
    });
    setCsvText("");
    setRefreshKey((x) => x + 1);
  }

  async function updateActivePicture(files: FileList | null) {
    if (!activeEmployee || !files?.[0]) return;
    const dataUrl = await readFileAsDataUrl(files[0]);
    upsertEmployee({ ...activeEmployee, profilePicture: dataUrl, source: "local" });
    setRefreshKey((x) => x + 1);
  }

  async function updateActiveDocuments(files: FileList | null) {
    if (!activeEmployee || !files?.length) return;
    const docs: EmployeeDocument[] = [...(activeEmployee.documents || [])];
    for (const file of Array.from(files)) {
      const dataUrl = await readFileAsDataUrl(file);
      docs.push({ id: `doc-${Date.now()}-${file.name}`, name: file.name, dataUrl });
    }
    upsertEmployee({ ...activeEmployee, documents: docs, source: "local" });
    setRefreshKey((x) => x + 1);
  }

  function saveActiveNotes(notes: string) {
    if (!activeEmployee) return;
    upsertEmployee({ ...activeEmployee, notes, source: "local" });
    setRefreshKey((x) => x + 1);
  }

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">National Employee Directory</h2>

        {/* ── Migration banner (shown until records are in Supabase) ── */}
        {!isMigrated && (
          <div className="badge" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <span>⚠️ The 2,473 imported contacts are stored in a local file and have not been migrated to the database yet.</span>
            <button type="button" onClick={handleMigrateToDatabase} disabled={migrating}>
              {migrating ? "Migrating…" : "Migrate to Database"}
            </button>
          </div>
        )}
        {migrateResult && (
          <div className="badge" style={{ marginBottom: 12 }}>
            ✅ Migration complete — {migrateResult.inserted} records saved{migrateResult.errors > 0 ? `, ${migrateResult.errors} errors` : ""}.
          </div>
        )}


        <div className="grid4">
          <div><small>Search</small><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Name, key, phone, email..." /></div>
          <div><small>City</small><select value={cityFilter} onChange={(e)=>setCityFilter(e.target.value)}><option value="">All cities</option>{cities.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>State</small><select value={stateFilter} onChange={(e)=>setStateFilter(e.target.value)}><option value="">All states</option>{states.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>Status</small><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="">All status</option>{statuses.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>Employment Type</small><select value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)}><option value="">All types</option>{types.map((s)=><option key={s} value={s}>{s}</option>)}<option value="__blank__">— Not set —</option></select></div>
          <div><small>Name Sort</small><select value={sortAZ} onChange={(e)=>setSortAZ(e.target.value as "A-Z"|"Z-A")}><option value="A-Z">A-Z</option><option value="Z-A">Z-A</option></select></div>
          <div><small>Role to assign</small><input value={role} onChange={(e)=>setRole(e.target.value)} /></div>
          <div className="list-card"><strong>Current Job Sheet</strong><div className="muted">{activeSheet ? activeSheet.title : "No active job sheet selected"}</div></div>
        </div>
      </div>

      <div className="grid2 hide-print">
        <div className="card">
          <h2 className="section-title">Add Crew Manually</h2>
          <div className="grid2">
            <div><small>Employee Key</small><input value={form.employeeKey} onChange={(e)=>setForm({ ...form, employeeKey:e.target.value })} /></div>
            <div><small>Full Name</small><input value={form.fullName} onChange={(e)=>setForm({ ...form, fullName:e.target.value })} /></div>
            <div><small>First Name</small><input value={form.firstName} onChange={(e)=>setForm({ ...form, firstName:e.target.value })} /></div>
            <div><small>Last Name</small><input value={form.lastName} onChange={(e)=>setForm({ ...form, lastName:e.target.value })} /></div>
            <div><small>Phone</small><input value={form.phone || ""} onChange={(e)=>setForm({ ...form, phone:e.target.value })} /></div>
            <div><small>Email</small><input value={form.email || ""} onChange={(e)=>setForm({ ...form, email:e.target.value })} /></div>
            <div><small>City</small><input value={form.city || ""} onChange={(e)=>setForm({ ...form, city:e.target.value })} /></div>
            <div><small>State Code</small><input value={form.stateCode || ""} onChange={(e)=>setForm({ ...form, stateCode:e.target.value })} /></div>
            <div><small>Status</small><input value={form.status || ""} onChange={(e)=>setForm({ ...form, status:e.target.value })} /></div>
            <div><small>Employment Type</small><input value={form.employmentType || ""} onChange={(e)=>setForm({ ...form, employmentType:e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><small>Address</small><input value={form.address || ""} onChange={(e)=>setForm({ ...form, address:e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 12 }}><small>Notes</small><textarea value={form.notes || ""} onChange={(e)=>setForm({ ...form, notes:e.target.value })} /></div>
          <div className="action-row" style={{ marginTop: 12 }}><button onClick={saveManualEmployee}>Save Employee</button></div>
        </div>

        <div className="card">
          <h2 className="section-title">Import Crew via CSV / Excel Export</h2>
          <p className="muted">Paste CSV from Excel here. Expected headers can include: employee key, full name, first name, last name, phone, email, state code, city, address, employment type, status.</p>
          <textarea value={csvText} onChange={(e)=>setCsvText(e.target.value)} style={{ minHeight: 260 }} />
          <div className="action-row" style={{ marginTop: 12 }}><button onClick={importCsv}>Import CSV Text</button></div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2 className="section-title">Directory Results</h2>
          <div className="muted" style={{ marginBottom: 8 }}>Directory count: {filtered.length} of {employees.length}</div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Employee Key</th><th>Full Name</th><th>First Name</th><th>Last Name</th><th>Phone</th><th>Email</th>
                  <th>City</th><th>State</th><th>Status</th><th>Employment Type</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.employeeKey}>
                    <td>{e.employeeKey}</td>
                    <td>{e.fullName}</td>
                    <td>{e.firstName}</td>
                    <td>{e.lastName}</td>
                    <td>{e.phone}</td>
                    <td>{e.email}</td>
                    <td>{e.city}</td>
                    <td>{e.stateCode || e.state}</td>
                    <td>{e.status}</td>
                    <td>
                      {e.employmentType
                        ? <span className={`badge ${e.type === "staff" ? "" : "secondary"}`}>{e.employmentType}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="action-row">
                        <button className="secondary" onClick={() => { setActiveEmployee(e.employeeKey); setRefreshKey((x)=>x+1); }}>Open Profile</button>
                        <button className="secondary" onClick={() => addToCurrentJob(e)} disabled={!activeSheet}>Add to Current Job Sheet</button>
                        <button className="secondary" onClick={() => addToCurrentTimesheet(e)} disabled={!activeSheet}>Add to Current Timekeeping</button>
                        <button className="secondary" onClick={() => { deleteEmployee(e.employeeKey); setRefreshKey((x)=>x+1); }}>Delete</button>
                      </div>
                    </td>
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
              <div className="pdf-logo-wrap"><img src="/branding/client-logo.png" alt="Logo" className="pdf-logo" /></div>
              <h2 className="pdf-title">Employee Profile</h2>
              <div className="pdf-subtitle">{activeEmployee ? activeEmployee.fullName : "No employee selected"}</div>
            </div>
            <div></div>
          </div>
          {!activeEmployee ? <div className="muted">Select an employee to open their profile.</div> : (
            <>
              <div className="grid3">
                <div className="list-card">
                  {activeEmployee.profilePicture ? <img src={activeEmployee.profilePicture} alt="Profile" style={{ width:"100%", maxWidth:180, borderRadius:12 }} /> : <div className="muted">No profile picture uploaded</div>}
                  <div className="hide-print" style={{ marginTop: 8 }}><input type="file" accept="image/*" onChange={(e)=>updateActivePicture(e.target.files)} /></div>
                </div>
                <div className="metric-card"><div className="metric-label">Contact</div><div style={{ marginTop: 12 }}>{activeEmployee.phone || "-"}<br />{activeEmployee.email || "-"}</div></div>
                <div className="metric-card"><div className="metric-label">Location</div><div style={{ marginTop: 12 }}>{activeEmployee.city || "-"}<br />{activeEmployee.stateCode || activeEmployee.state || "-"}</div></div>
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 className="section-title">Notes</h3>
                <textarea value={activeEmployee.notes || ""} onChange={(e)=>saveActiveNotes(e.target.value)} />
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 className="section-title">Certificates / ID / Files</h3>
                <div className="hide-print"><input type="file" multiple onChange={(e)=>updateActiveDocuments(e.target.files)} /></div>
                <div style={{ marginTop: 10 }}>
                  {(activeEmployee.documents || []).length === 0 ? (
                    <div className="muted">No files uploaded yet.</div>
                  ) : (
                    <div className="grid">
                      {(activeEmployee.documents || []).map((doc) => (
                        <div key={doc.id} className="list-card">
                          <strong>{doc.name}</strong>
                          {doc.dataUrl ? <div className="action-row" style={{ marginTop: 8 }}><a className="badge" href={doc.dataUrl} target="_blank" rel="noreferrer">View File</a></div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Job History summary ── */}
              {(() => {
                const jobHistory = loadJobSheets()
                  .filter((js) => js.workers.some((w) => w.employeeKey === activeEmployee.employeeKey));
                return (
                  <div style={{ marginTop: 16 }}>
                    <div className="action-row" style={{ marginBottom: 8 }}>
                      <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Job History</h3>
                      {jobHistory.length > 0 && (
                        <button className="secondary" onClick={() => setHistoryModal("jobs")}>
                          View All ({jobHistory.length})
                        </button>
                      )}
                    </div>
                    {jobHistory.length === 0
                      ? <div className="muted">No job sheets found for this employee.</div>
                      : <div className="muted">{jobHistory.length} job{jobHistory.length !== 1 ? "s" : ""} assigned — most recent: <strong>{jobHistory.sort((a,b) => b.date.localeCompare(a.date))[0]?.date}</strong></div>
                    }
                  </div>
                );
              })()}

              {/* ── Timesheet History summary ── */}
              {(() => {
                const tsWithEntries = loadTimesheets()
                  .map((ts) => ({ ts, entries: ts.rows.filter((r) => r.employeeKey === activeEmployee.employeeKey) }))
                  .filter((x) => x.entries.length > 0);
                const totalHours = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.totalHours, 0), 0);
                const totalPay = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.totalPay, 0), 0);
                return (
                  <div style={{ marginTop: 16 }}>
                    <div className="action-row" style={{ marginBottom: 8 }}>
                      <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Timesheet History</h3>
                      {tsWithEntries.length > 0 && (
                        <button className="secondary" onClick={() => setHistoryModal("timesheets")}>
                          View All ({tsWithEntries.length})
                        </button>
                      )}
                    </div>
                    {tsWithEntries.length === 0
                      ? <div className="muted">No timesheet entries found for this employee.</div>
                      : (
                        <div className="grid3">
                          <div className="metric-card"><div className="metric-label">Timesheets</div><div className="metric-value">{tsWithEntries.length}</div></div>
                          <div className="metric-card"><div className="metric-label">Total Hours</div><div className="metric-value">{totalHours.toFixed(1)}</div></div>
                          <div className="metric-card"><div className="metric-label">Total Pay</div><div className="metric-value">${totalPay.toFixed(2)}</div></div>
                        </div>
                      )
                    }
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
      {/* ── History modal ── */}
      {historyModal && activeEmployee && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setHistoryModal(null); }}>
          <div className="modal-panel">
            <div className="action-row" style={{ marginBottom: 16 }}>
              <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
                {historyModal === "jobs" ? "Job History" : "Timesheet History"} — {activeEmployee.fullName}
              </h2>
              <button className="secondary" onClick={() => setHistoryModal(null)}>Close</button>
            </div>

            {historyModal === "jobs" && (() => {
              const jobHistory = loadJobSheets()
                .filter((js) => js.workers.some((w) => w.employeeKey === activeEmployee.employeeKey))
                .sort((a, b) => b.date.localeCompare(a.date));
              return (
                <table>
                  <thead><tr><th>Date</th><th>Job</th><th>Client</th><th>Venue</th><th>Role</th></tr></thead>
                  <tbody>
                    {jobHistory.map((js) => {
                      const w = js.workers.find((w) => w.employeeKey === activeEmployee.employeeKey);
                      return (
                        <tr key={js.id}>
                          <td>{js.date}</td>
                          <td>{js.title || js.eventName}</td>
                          <td>{js.client}</td>
                          <td>{js.venue}</td>
                          <td>{w?.role || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}

            {historyModal === "timesheets" && (() => {
              const tsWithEntries = loadTimesheets()
                .map((ts) => ({ ts, entries: ts.rows.filter((r) => r.employeeKey === activeEmployee.employeeKey) }))
                .filter((x) => x.entries.length > 0)
                .sort((a, b) => b.ts.id.localeCompare(a.ts.id));
              const totalHours = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.totalHours, 0), 0);
              const totalPay   = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.totalPay, 0), 0);
              return (
                <>
                  <div className="grid3" style={{ marginBottom: 16 }}>
                    <div className="metric-card"><div className="metric-label">Timesheets</div><div className="metric-value">{tsWithEntries.length}</div></div>
                    <div className="metric-card"><div className="metric-label">Total Hours</div><div className="metric-value">{totalHours.toFixed(1)}</div></div>
                    <div className="metric-card"><div className="metric-label">Total Pay</div><div className="metric-value">${totalPay.toFixed(2)}</div></div>
                  </div>
                  <table>
                    <thead><tr><th>Timesheet</th><th>Position</th><th>Std Hrs</th><th>OT Hrs</th><th>DT Hrs</th><th>Total Hrs</th><th>Total Pay</th></tr></thead>
                    <tbody>
                      {tsWithEntries.map(({ ts, entries }) =>
                        entries.map((r) => (
                          <tr key={r.id}>
                            <td>{ts.title}</td>
                            <td>{r.position || "—"}</td>
                            <td>{r.stdHours.toFixed(1)}</td>
                            <td>{r.otHours.toFixed(1)}</td>
                            <td>{r.dtHours.toFixed(1)}</td>
                            <td>{r.totalHours.toFixed(1)}</td>
                            <td>${r.totalPay.toFixed(2)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

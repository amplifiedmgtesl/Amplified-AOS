
"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteEmployee, getActiveEmployee, loadDeletedEmployeeKeys, loadEmployees, loadJobSheets, loadTimesheets, setActiveEmployee, upsertEmployee } from "@/lib/store/app-store";
import { useUserRole } from "@/lib/auth/use-user-role";
import { uploadProfilePicture, deleteEmployeeAsset } from "@/lib/storage/employee-assets";
import {
  loadDocuments as loadEmployeeDocs,
  uploadDocument as uploadEmployeeDoc,
  removeDocument as removeEmployeeDoc,
  type EmployeeDocument as EmployeeDocRow,
} from "@/lib/storage/employee-documents";
import { US_STATES } from "@/lib/constants";
import type { EmployeeRecord } from "@/lib/store/types";

type Employee = EmployeeRecord;

// Employees come from the Supabase cache. The legacy IMPORTED_EMPLOYEES
// constant fallback (47K-line hardcoded array) was removed 2026-05-04 —
// the one-time migration is done; the DB is the source of truth.
function activeEmployees() {
  const deleted = new Set(loadDeletedEmployeeKeys());
  return loadEmployees().filter((e) => !deleted.has(e.employeeKey));
}

export default function EmployeeDirectory({ hideBill: hideBillProp = false }: { hideBill?: boolean } = {}) {
  // Belt + suspenders: even if this component somehow renders inside an
  // admin shell, force-hide pay if the viewer is a crew_leader.
  const viewerRole = useUserRole();
  const hideBill = hideBillProp || viewerRole === "crew_leader";
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortAZ, setSortAZ] = useState<"A-Z"|"Z-A">("A-Z");
  const [refreshKey, setRefreshKey] = useState(0);
  const [csvText, setCsvText] = useState("");
  const [historyModal, setHistoryModal] = useState<"jobs" | "timesheets" | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDocRow[]>([]);
  const employees = useMemo(() => activeEmployees(), [refreshKey]);
  const activeEmployeeKey = getActiveEmployee() || employees[0]?.employeeKey || "";
  const activeEmployee = employees.find((e) => e.employeeKey === activeEmployeeKey) || null;

  // Load this employee's documents when the selection changes.
  useEffect(() => {
    if (!activeEmployee) { setEmployeeDocs([]); return; }
    let cancelled = false;
    loadEmployeeDocs(activeEmployee.employeeKey)
      .then((docs) => { if (!cancelled) setEmployeeDocs(docs); })
      .catch((err) => { console.error("[employee-directory] doc load failed:", err); if (!cancelled) setEmployeeDocs([]); });
    return () => { cancelled = true; };
  }, [activeEmployee?.employeeKey, refreshKey]);

  useEffect(() => {
    if (!getActiveEmployee() && employees[0]) setActiveEmployee(employees[0].employeeKey);
  }, [refreshKey]);

  const states = useMemo(() => Array.from(new Set(employees.map((e) => e.stateCode || e.state || "").filter(Boolean))).sort(), [employees]);
  const cities = useMemo(() => Array.from(new Set(employees.map((e) => e.city || "").filter(Boolean))).sort(), [employees]);
  const statuses = useMemo(() => Array.from(new Set(employees.map((e) => e.status || "").filter(Boolean))).sort(), [employees]);
  const types = useMemo(() => Array.from(new Set(employees.map((e) => e.employmentType || "").filter(Boolean))).sort(), [employees]);
  // Common employment-type choices + any distinct values already saved in
  // the directory. Lets the profile dropdown pick from a clean list while
  // still honoring any legacy values that happen to exist.
  const COMMON_EMPLOYMENT_TYPES = ["Employee", "Contractor", "W2", "1099", "Full-Time", "Part-Time", "Seasonal"];
  const employmentTypeOptions = useMemo(
    () => Array.from(new Set([...COMMON_EMPLOYMENT_TYPES, ...types])).sort(),
    [types],
  );


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

  async function startNewEmployee() {
    const key = `emp-${Date.now()}`;
    const blank: EmployeeRecord = {
      employeeKey: key, fullName: "", firstName: "", lastName: "", phone: "", email: "",
      stateCode: "", state: "", city: "", address: "", employmentType: "", status: "",
      type: "contractor", notes: "", source: "local",
    };
    // Await the insert: timesheet entries / crew assignments FK onto
    // employee_key, so a silently-failed create here surfaces later as a
    // 23503 that rolls back whole timesheet batches (Brent, 2026-06-11).
    const { error } = await upsertEmployee(blank);
    if (error) {
      alert("Failed to create the employee record in the database — try again. If this keeps happening, contact IT.");
      return;
    }
    setActiveEmployee(key);
    setRefreshKey((x) => x + 1);
  }

  function updateActiveField<K extends keyof EmployeeRecord>(key: K, value: EmployeeRecord[K]) {
    if (!activeEmployee) return;
    const updated = { ...activeEmployee, [key]: value, source: "local" as const };
    // Keep fullName in sync when first/last change
    if (key === "firstName" || key === "lastName") {
      const fn = key === "firstName" ? (value as string) : activeEmployee.firstName;
      const ln = key === "lastName" ? (value as string) : activeEmployee.lastName;
      if (!activeEmployee.fullName || activeEmployee.fullName === `${activeEmployee.firstName} ${activeEmployee.lastName}`.trim()) {
        updated.fullName = `${fn} ${ln}`.trim();
      }
    }
    upsertEmployee(updated);
    setRefreshKey((x) => x + 1);
  }

  async function importCsv() {
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { setImportModalOpen(false); return; }
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    // Await every insert and report failures — a silently-dropped row here
    // is an employee the operator believes exists (same FK-race family as
    // the Brent timesheet loss).
    const results = await Promise.all(lines.slice(1).map((line, idx) => {
      const cols = line.split(",").map((c) => c.trim());
      const get = (name: string) => cols[headers.indexOf(name)] || "";
      const firstName = get("first name") || get("firstname");
      const lastName = get("last name") || get("lastname");
      return upsertEmployee({
        employeeKey: get("employee key") || `csv-${Date.now()}-${idx}`,
        fullName: get("full name") || `${firstName} ${lastName}`.trim(),
        firstName, lastName,
        phone: get("phone"), email: get("email"),
        stateCode: get("state code") || get("state"),
        state: get("state"), city: get("city"),
        address: get("address"), employmentType: get("employment type"),
        status: get("status"),
        type: get("type") === "staff" ? "staff" : "contractor",
        source: "local"
      });
    }));
    const failed = results.filter((r) => r.error).length;
    if (failed > 0) {
      alert(`${failed} of ${results.length} imported employee row${failed === 1 ? "" : "s"} FAILED to save to the database. Check the console for details and re-import the failed rows.`);
    }
    setCsvText("");
    setRefreshKey((x) => x + 1);
    setImportModalOpen(false);
  }

  async function updateActivePicture(files: FileList | null) {
    if (!activeEmployee || !files?.[0]) return;
    try {
      const publicUrl = await uploadProfilePicture(activeEmployee.employeeKey, files[0]);
      upsertEmployee({ ...activeEmployee, profilePicture: publicUrl, source: "local" });
      setRefreshKey((x) => x + 1);
    } catch (err) {
      console.error("[employee-directory] profile picture upload failed:", err);
      alert("Failed to upload profile picture. Check console for details.");
    }
  }

  async function updateActiveDocuments(files: FileList | null) {
    if (!activeEmployee || !files?.length) return;
    try {
      const added: EmployeeDocRow[] = [];
      for (const file of Array.from(files)) {
        added.push(await uploadEmployeeDoc(activeEmployee.employeeKey, file));
      }
      setEmployeeDocs((cur) => [...added, ...cur]);
    } catch (err) {
      console.error("[employee-directory] document upload failed:", err);
      alert("Failed to upload one or more documents. Check console for details.");
    }
  }

  function saveActiveNotes(notes: string) {
    if (!activeEmployee) return;
    upsertEmployee({ ...activeEmployee, notes, source: "local" });
    setRefreshKey((x) => x + 1);
  }

  async function removeActivePicture() {
    if (!activeEmployee || !activeEmployee.profilePicture) return;
    if (!confirm("Remove this profile picture?")) return;
    try {
      await deleteEmployeeAsset(activeEmployee.profilePicture);
    } catch (err) {
      console.error("[employee-directory] failed to remove picture from storage:", err);
    }
    upsertEmployee({ ...activeEmployee, profilePicture: undefined, source: "local" });
    setRefreshKey((x) => x + 1);
  }

  async function removeActiveDocument(docId: string) {
    if (!activeEmployee) return;
    const doc = employeeDocs.find((d) => d.id === docId);
    if (!doc) return;
    if (!confirm(`Delete "${doc.fileName}"?`)) return;
    try {
      await removeEmployeeDoc(doc);
      setEmployeeDocs((cur) => cur.filter((d) => d.id !== docId));
    } catch (err) {
      console.error("[employee-directory] failed to remove document:", err);
      alert("Failed to delete document. Check console for details.");
    }
  }

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">National Employee Directory</h2>

        {/* ── Top action row ── */}
        <div className="action-row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <button type="button" onClick={startNewEmployee}>+ Add Crew Manually</button>
          <button type="button" className="secondary" onClick={() => setImportModalOpen(true)}>⇪ Import from CSV</button>
        </div>

        <div className="grid4">
          <div><small>Search</small><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Name, key, phone, email..." /></div>
          <div><small>City</small><select value={cityFilter} onChange={(e)=>setCityFilter(e.target.value)}><option value="">All cities</option>{cities.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>State</small><select value={stateFilter} onChange={(e)=>setStateFilter(e.target.value)}><option value="">All states</option>{states.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>Status</small><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="">All status</option>{statuses.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><small>Employment Type</small><select value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)}><option value="">All types</option>{types.map((s)=><option key={s} value={s}>{s}</option>)}<option value="__blank__">— Not set —</option></select></div>
          <div><small>Name Sort</small><select value={sortAZ} onChange={(e)=>setSortAZ(e.target.value as "A-Z"|"Z-A")}><option value="A-Z">A-Z</option><option value="Z-A">Z-A</option></select></div>
        </div>
      </div>

      {importModalOpen && (
        <div className="modal-backdrop" onClick={() => setImportModalOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 className="section-title" style={{ margin: 0 }}>Import Crew via CSV / Excel Export</h2>
              <button type="button" className="secondary" onClick={() => setImportModalOpen(false)} aria-label="Close">✕</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>Paste CSV from Excel here. Expected headers can include: employee key, full name, first name, last name, phone, email, state code, city, address, employment type, status.</p>
            <textarea value={csvText} onChange={(e)=>setCsvText(e.target.value)} style={{ minHeight: 320, fontFamily: "monospace", fontSize: 12 }} placeholder="Paste comma-separated rows here…" />
            <div className="action-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="secondary" onClick={() => setImportModalOpen(false)}>Cancel</button>
              <button type="button" onClick={importCsv} disabled={!csvText.trim()}>Import CSV Text</button>
            </div>
          </div>
        </div>
      )}

      {activeEmployee && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Employee Profile{activeEmployee.fullName ? ` — ${activeEmployee.fullName}` : ""}</h2>
            <div className="muted" style={{ fontSize: 13 }}>{activeEmployee.employeeKey}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, alignItems: "start" }}>
            <div className="list-card" style={{ textAlign: "center" }}>
              {activeEmployee.profilePicture ? <img src={activeEmployee.profilePicture} alt="Profile" style={{ width:"100%", maxWidth:160, borderRadius:12 }} /> : <div className="muted" style={{ padding: "32px 8px" }}>No profile picture</div>}
              <div className="hide-print" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <input type="file" accept="image/*" onChange={(e)=>updateActivePicture(e.target.files)} />
                {activeEmployee.profilePicture ? (
                  <button type="button" className="secondary" onClick={removeActivePicture} style={{ fontSize: 12, padding: "4px 10px" }}>Remove Picture</button>
                ) : null}
              </div>
            </div>
            <div className="grid2">
              <div><small>Employee Key</small><input value={activeEmployee.employeeKey} onChange={(e)=>updateActiveField("employeeKey", e.target.value)} /></div>
              <div><small>Full Name</small><input value={activeEmployee.fullName} onChange={(e)=>updateActiveField("fullName", e.target.value)} /></div>
              <div><small>First Name</small><input value={activeEmployee.firstName} onChange={(e)=>updateActiveField("firstName", e.target.value)} /></div>
              <div><small>Last Name</small><input value={activeEmployee.lastName} onChange={(e)=>updateActiveField("lastName", e.target.value)} /></div>
              <div><small>Phone</small><input value={activeEmployee.phone || ""} onChange={(e)=>updateActiveField("phone", e.target.value)} /></div>
              <div><small>Email</small><input value={activeEmployee.email || ""} onChange={(e)=>updateActiveField("email", e.target.value)} /></div>
              <div style={{ gridColumn: "1 / -1" }}><small>Address</small><input value={activeEmployee.address || ""} onChange={(e)=>updateActiveField("address", e.target.value)} placeholder="Street address (and apt/suite if applicable)" /></div>
              <div><small>City</small><input value={activeEmployee.city || ""} onChange={(e)=>updateActiveField("city", e.target.value)} /></div>
              <div><small>State</small><select value={activeEmployee.stateCode || ""} onChange={(e)=>updateActiveField("stateCode", e.target.value)}><option value="">— Select —</option>{US_STATES.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
              <div><small>Zip</small><input value={activeEmployee.zip || ""} onChange={(e)=>updateActiveField("zip", e.target.value)} /></div>
              <div><small>Status</small><input value={activeEmployee.status || ""} onChange={(e)=>updateActiveField("status", e.target.value)} /></div>
              <div>
                <small>Employment Type</small>
                <select value={activeEmployee.employmentType || ""} onChange={(e)=>updateActiveField("employmentType", e.target.value)}>
                  <option value="">— Select —</option>
                  {employmentTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <small title="Date this person was added to the roster — drives HR's onboarding backlog. Auto-stamped when added on-the-fly from Timekeeping; editable here for backfill or corrections.">
                  Hire Date
                </small>
                <input
                  type="date"
                  value={activeEmployee.hireDate || ""}
                  onChange={(e) => updateActiveField("hireDate", e.target.value)}
                />
              </div>
              <div>
                <small title="Rippling employee number. Used by the payroll CSV export to match this person to their Rippling pay run row. Leave blank if not in Rippling.">
                  Rippling Emp No
                </small>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={activeEmployee.ripplingEmployeeId ?? ""}
                  onChange={(e) => updateActiveField(
                    "ripplingEmployeeId",
                    e.target.value === "" ? null : Number(e.target.value),
                  )}
                  placeholder="(none)"
                />
              </div>
            </div>
          </div>

          {/* ─── Pay Rate Override (admin-only) ──────────────────────────
              These values override the rate-card default for this employee
              when payroll resolves the pay rate. NULL = "use rate card";
              any set value WINS regardless of rate card. ADMIN-ONLY — never
              shown to crew leaders (hideBill strips the section). */}
          {!hideBill && (
            <div style={{ marginTop: 16 }}>
              <h3 className="section-title">Pay Rate Override</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Optional. Leave blank to use the rate card for this employee's
                specialty. Any value entered overrides the rate card — per
                column (set just std to keep OT/DT from rate card, etc.).
              </div>
              <div className="grid grid3" style={{ gap: 12 }}>
                <div>
                  <small>Std $/hr</small>
                  <input
                    type="number" step="0.01" min="0"
                    placeholder="(rate card)"
                    value={activeEmployee.payStdRate ?? ""}
                    onChange={(e) => updateActiveField(
                      "payStdRate",
                      e.target.value === "" ? null : Number(e.target.value),
                    )}
                  />
                </div>
                <div>
                  <small>OT $/hr</small>
                  <input
                    type="number" step="0.01" min="0"
                    placeholder="(rate card)"
                    value={activeEmployee.payOtRate ?? ""}
                    onChange={(e) => updateActiveField(
                      "payOtRate",
                      e.target.value === "" ? null : Number(e.target.value),
                    )}
                  />
                </div>
                <div>
                  <small>DT $/hr</small>
                  <input
                    type="number" step="0.01" min="0"
                    placeholder="(rate card)"
                    value={activeEmployee.payDtRate ?? ""}
                    onChange={(e) => updateActiveField(
                      "payDtRate",
                      e.target.value === "" ? null : Number(e.target.value),
                    )}
                  />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <h3 className="section-title">Notes</h3>
            <textarea value={activeEmployee.notes || ""} onChange={(e)=>saveActiveNotes(e.target.value)} />
          </div>

          <div style={{ marginTop: 16 }}>
            <h3 className="section-title">Certificates / ID / Files</h3>
            <div className="hide-print"><input type="file" multiple onChange={(e)=>updateActiveDocuments(e.target.files)} /></div>
            <div style={{ marginTop: 10 }}>
              {employeeDocs.length === 0 ? (
                <div className="muted">No files uploaded yet.</div>
              ) : (
                <div className="grid">
                  {employeeDocs.map((doc) => (
                    <div key={doc.id} className="list-card">
                      <strong>{doc.fileName}</strong>
                      <div className="action-row" style={{ marginTop: 8, gap: 8 }}>
                        {doc.url ? <a className="badge" href={doc.url} target="_blank" rel="noreferrer">View File</a> : null}
                        <button type="button" className="secondary" onClick={() => removeActiveDocument(doc.id)} style={{ fontSize: 12, padding: "4px 10px" }}>Delete</button>
                      </div>
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
            // billTotal renamed from totalPay in 20260528b — these are billing
            // numbers, not pay. Pay totals live on payroll_run_entries.
            const totalPay = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.billTotal, 0), 0);
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
                    <div className={hideBill ? "grid2" : "grid3"}>
                      <div className="metric-card"><div className="metric-label">Timesheets</div><div className="metric-value">{tsWithEntries.length}</div></div>
                      <div className="metric-card"><div className="metric-label">Total Hours</div><div className="metric-value">{totalHours.toFixed(1)}</div></div>
                      {!hideBill && (
                        <div className="metric-card"><div className="metric-label">Total Pay</div><div className="metric-value">${totalPay.toFixed(2)}</div></div>
                      )}
                    </div>
                  )
                }
              </div>
            );
          })()}
        </div>
      )}

      <div>
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
                        <button className="secondary" onClick={() => { deleteEmployee(e.employeeKey); setRefreshKey((x)=>x+1); }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                <div style={{ position: "relative", paddingLeft: 28 }}>
                  {/* timeline spine */}
                  <div style={{ position: "absolute", left: 9, top: 8, bottom: 8, width: 2, background: "var(--line)" }} />
                  {jobHistory.map((js) => {
                    const w = js.workers.find((w) => w.employeeKey === activeEmployee.employeeKey);
                    return (
                      <div key={js.id} style={{ position: "relative", marginBottom: 14 }}>
                        {/* dot */}
                        <div style={{ position: "absolute", left: -23, top: 14, width: 10, height: 10, borderRadius: "50%", background: "var(--gold)", border: "2px solid var(--gold-dark)" }} />
                        <div className="list-card" style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{js.title || js.eventName}</div>
                              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{js.client} · {js.venue}</div>
                              {js.cityState && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 1 }}>{js.cityState}</div>}
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gold-dark)" }}>{js.date}</div>
                              {w?.role && <span className="badge" style={{ marginTop: 4, display: "inline-block" }}>{w.role}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {historyModal === "timesheets" && (() => {
              const tsWithEntries = loadTimesheets()
                .map((ts) => ({ ts, entries: ts.rows.filter((r) => r.employeeKey === activeEmployee.employeeKey) }))
                .filter((x) => x.entries.length > 0)
                .sort((a, b) => b.ts.id.localeCompare(a.ts.id));
              const totalHours = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.totalHours, 0), 0);
              // Billing totals (renamed in 20260528b). Labels updated to "Bill".
              const totalBill  = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.billTotal, 0), 0);
              return (
                <>
                  <div className={hideBill ? "grid2" : "grid3"} style={{ marginBottom: 16 }}>
                    <div className="metric-card"><div className="metric-label">Timesheets</div><div className="metric-value">{tsWithEntries.length}</div></div>
                    <div className="metric-card"><div className="metric-label">Total Hours</div><div className="metric-value">{totalHours.toFixed(1)}</div></div>
                    {!hideBill && (
                      <div className="metric-card"><div className="metric-label">Total Bill</div><div className="metric-value">${totalBill.toFixed(2)}</div></div>
                    )}
                  </div>
                  <table>
                    <thead><tr><th>Timesheet</th><th>Position</th><th>Std Hrs</th><th>OT Hrs</th><th>DT Hrs</th><th>Total Hrs</th>{!hideBill && <th>Total Bill</th>}</tr></thead>
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
                            {!hideBill && <td>${r.billTotal.toFixed(2)}</td>}
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


"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteEmployee, loadDeletedEmployeeKeys, loadEmployees, upsertEmployee } from "@/lib/store/app-store";
import { useUserRole } from "@/lib/auth/use-user-role";
import type { EmployeeRecord } from "@/lib/store/types";

// Employees come from the Supabase cache. The legacy IMPORTED_EMPLOYEES
// constant fallback (47K-line hardcoded array) was removed 2026-05-04 —
// the one-time migration is done; the DB is the source of truth.
function activeEmployees() {
  const deleted = new Set(loadDeletedEmployeeKeys());
  return loadEmployees().filter((e) => !deleted.has(e.employeeKey));
}

/**
 * Employee directory — the full-width searchable list. Selecting a row opens
 * the profile on its own route ({basePath}/{employeeKey}), mirroring the
 * quotes/invoices list→detail flow.
 *
 * `basePath` keeps the profile links inside the admin app (/employee-directory)
 * or the crew-leader app (/lead/employees). `hideBill` is forwarded by the lead
 * page; this list shows no billing columns, but the flag is kept for symmetry.
 */
export default function EmployeeDirectory({
  basePath = "/employee-directory",
  hideBill: _hideBill = false,
}: { basePath?: string; hideBill?: boolean } = {}) {
  // Surface (and respect) the viewer role even though the list carries no pay.
  useUserRole();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortAZ, setSortAZ] = useState<"A-Z"|"Z-A">("A-Z");
  const [refreshKey, setRefreshKey] = useState(0);
  const [csvText, setCsvText] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const employees = useMemo(() => activeEmployees(), [refreshKey]);

  const states = useMemo(() => Array.from(new Set(employees.map((e) => e.stateCode || e.state || "").filter(Boolean))).sort(), [employees]);
  const cities = useMemo(() => Array.from(new Set(employees.map((e) => e.city || "").filter(Boolean))).sort(), [employees]);
  const statuses = useMemo(() => Array.from(new Set(employees.map((e) => e.status || "").filter(Boolean))).sort(), [employees]);
  const types = useMemo(() => Array.from(new Set(employees.map((e) => e.employmentType || "").filter(Boolean))).sort(), [employees]);

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

  function profileHref(key: string) {
    return `${basePath}/${encodeURIComponent(key)}`;
  }

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
    router.push(profileHref(key));
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
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="muted">No employees match.</td></tr>
              ) : filtered.map((e) => (
                <tr key={e.employeeKey}>
                  <td>{e.employeeKey}</td>
                  <td>
                    <Link href={profileHref(e.employeeKey)} style={{ color: "#2c4d73", textDecoration: "underline", fontWeight: 600 }}>
                      {e.fullName || "—"}
                    </Link>
                  </td>
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
                      <Link href={profileHref(e.employeeKey)} className="secondary" style={{ textDecoration: "none", padding: "4px 10px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, fontSize: 13 }}>Open Profile</Link>
                      <button className="secondary" onClick={() => { if (confirm(`Delete ${e.fullName || "this employee"}?`)) { deleteEmployee(e.employeeKey); setRefreshKey((x)=>x+1); } }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

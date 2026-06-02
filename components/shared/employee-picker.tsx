"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUserRole } from "@/lib/auth/use-user-role";

export type PickerEmployee = {
  employeeKey: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
};

// Module-level cache so multiple EmployeePicker instances on the same page
// share one load (a multi-day job's Assigned Crew tab can have dozens).
// Lives until full page reload.
let employeesCache: PickerEmployee[] | null = null;
let employeesPromise: Promise<PickerEmployee[]> | null = null;

// Subscribers are notified after pushEmployeeIntoCache() mutates the cache,
// so any mounted picker can re-render with the new employee visible.
const cacheSubscribers = new Set<() => void>();
function notifyCacheSubscribers() {
  for (const fn of cacheSubscribers) fn();
}

/**
 * Insert a freshly-created employee into the shared cache so every picker
 * on the page sees them immediately, without re-fetching the directory.
 * Call this from any inline-create flow after the DB write completes.
 *
 * Idempotent — replaces an existing entry with the same employeeKey if
 * one's already present.
 */
export function pushEmployeeIntoCache(emp: PickerEmployee): void {
  if (!emp.employeeKey) return;
  if (employeesCache === null) {
    // Cache hasn't been hydrated yet — start it with just this one entry,
    // the regular fetch will replace it on first picker focus.
    employeesCache = [emp];
  } else {
    const idx = employeesCache.findIndex((e) => e.employeeKey === emp.employeeKey);
    if (idx >= 0) employeesCache[idx] = emp;
    else employeesCache = [...employeesCache, emp];
  }
  notifyCacheSubscribers();
}

async function loadAllEmployees(): Promise<PickerEmployee[]> {
  if (employeesCache !== null) return employeesCache;
  if (employeesPromise) return employeesPromise;
  employeesPromise = (async () => {
    const PAGE = 1000;
    const all: any[] = [];
    let start = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("employees")
        .select("employee_key, full_name, first_name, last_name, email, phone, city, state")
        .eq("is_deleted", false)
        .order("full_name")
        .range(start, start + PAGE - 1);
      if (error) throw error;
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < PAGE) break;
      start += PAGE;
      if (start > 50000) break;
    }
    employeesCache = all.map((r: any) => ({
      employeeKey: r.employee_key,
      fullName: r.full_name ?? "",
      firstName: r.first_name ?? "",
      lastName: r.last_name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      city: r.city ?? "",
      state: r.state ?? "",
    }));
    // Wake up any LazyEmployeePicker cells that fell through to the full
    // picker while the cache was loading, so they can drop back to the
    // cheap tile now that names are resolvable.
    notifyCacheSubscribers();
    return employeesCache;
  })();
  try {
    return await employeesPromise;
  } finally {
    employeesPromise = null;
  }
}

/**
 * Search-as-you-type employee picker. Designed for screens where the user
 * needs to find ONE employee out of thousands.
 *
 * Loads the full active employee list once on first focus (cheap — small
 * payload, ~2-3K rows). Filters in-memory against name / email / phone /
 * city / state. Shows up to 12 matches with full row context so the user
 * can disambiguate similar names.
 *
 * When linked, displays the chosen employee's name. The input becomes a
 * "Change…" trigger that re-opens the search.
 *
 * The "+ Add new employee" link at the bottom of the result list opens
 * the Employee Directory in a new tab so the user can add and come back.
 */
export function EmployeePicker({
  employeeKey,
  onSelect,
  onCreateInline,
  fallbackName,
  defaultOpen = false,
  disabled = false,
  placeholder = "Search employee…",
}: {
  employeeKey?: string | null;
  onSelect: (emp: PickerEmployee) => void;
  /** When provided, the picker shows a "+ Create employee 'X'" button in the
   *  dropdown when the typed query has no matches. The callback should
   *  insert the employee into the directory, call pushEmployeeIntoCache(),
   *  and resolve. The picker then calls onSelect with the new employee
   *  and closes itself. Used by timekeeping for fast field entry. */
  onCreateInline?: (typedName: string) => Promise<PickerEmployee>;
  /** Optional display name to show when no employeeKey is linked yet —
   *  e.g. a staff-submitted name awaiting link. Renders in amber with
   *  "(unlinked)" tag like the legacy timekeeping autofill did. */
  fallbackName?: string;
  /** Start the picker already in search mode (input visible, dropdown
   *  opening on focus). Used by LazyEmployeePicker so the operator goes
   *  straight from clicking the lazy tile to typing, skipping the
   *  intermediate "click the picker's tile too" step. */
  defaultOpen?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [employees, setEmployees] = useState<PickerEmployee[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(defaultOpen);
  // If we start open, kick off the cache load right away so the dropdown
  // has results to show as soon as the operator focuses the input.
  useEffect(() => {
    if (defaultOpen) void ensureLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const role = useUserRole();
  const addEmployeeHref = role === "crew_leader" ? "/lead/employees" : "/employee-directory";

  // Re-render when another picker on the page adds a new employee to the
  // shared cache (so the dropdown stays in sync with concurrent inline creates).
  const [, setCacheTick] = useState(0);
  useEffect(() => {
    const fn = () => {
      if (employeesCache) setEmployees([...employeesCache]);
      setCacheTick((t) => t + 1);
    };
    cacheSubscribers.add(fn);
    return () => { cacheSubscribers.delete(fn); };
  }, []);

  async function handleInlineCreate() {
    if (!onCreateInline || !query.trim() || creating) return;
    setCreating(true);
    try {
      const created = await onCreateInline(query.trim());
      // Make sure the shared cache contains the new row, in case the
      // caller forgot to push.
      pushEmployeeIntoCache(created);
      onSelect(created);
      setQuery("");
      setOpen(false);
    } catch (err) {
      console.error("EmployeePicker.onCreateInline failed:", err);
      alert("Couldn't create employee — see console.");
    } finally {
      setCreating(false);
    }
  }

  const linked = useMemo(
    () => (employeeKey && employees ? employees.find((e) => e.employeeKey === employeeKey) : null),
    [employeeKey, employees],
  );

  // If a row already has an employeeKey on mount, load the directory so the
  // linked tile can render its name + contact info. Without this the picker
  // shows a blank search input even though the assignment is saved.
  useEffect(() => {
    if (employeeKey && employees === null && !loading) {
      void ensureLoaded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeKey]);

  // Pulls from the module-level cache; first picker on the page does the
  // fetch, all others share it.
  async function ensureLoaded() {
    if (employees !== null || loading) return;
    setLoading(true);
    try {
      const list = await loadAllEmployees();
      setEmployees(list);
    } catch (err) {
      console.error("EmployeePicker: failed to load employees", err);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }

  const RESULT_CAP = 50;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Inline picker filters by NAME only — keeps the dropdown simple. For
  // wider search (city / phone / email / etc.) the user clicks the 🔍
  // button to open EmployeeSearchModal.
  const results = useMemo(() => {
    if (!employees) return [];
    const q = query.trim().toLowerCase();
    if (!q) return employees.slice(0, RESULT_CAP);
    const tokens = q.split(/\s+/).filter(Boolean);

    function tokenScore(t: string, e: PickerEmployee): number {
      const fullLower = e.fullName.toLowerCase();
      const nameWords = fullLower.split(/\s+/);
      if (nameWords.some((w) => w.startsWith(t))) return 100;
      if (fullLower.includes(t)) return 50;
      return 0;
    }

    type Scored = { e: PickerEmployee; score: number };
    const scored: Scored[] = [];
    for (const e of employees) {
      let total = 0;
      let matchedAll = true;
      for (const t of tokens) {
        const s = tokenScore(t, e);
        if (s === 0) { matchedAll = false; break; }
        total += s;
      }
      if (matchedAll) scored.push({ e, score: total });
    }
    scored.sort((a, b) => b.score - a.score || a.e.fullName.localeCompare(b.e.fullName));
    return scored.slice(0, RESULT_CAP).map((s) => s.e);
  }, [employees, query]);

  const totalMatches = useMemo(() => {
    if (!employees) return 0;
    const q = query.trim().toLowerCase();
    if (!q) return employees.length;
    const tokens = q.split(/\s+/).filter(Boolean);
    return employees.filter((e) => {
      const fullLower = e.fullName.toLowerCase();
      return tokens.every((t) => fullLower.includes(t));
    }).length;
  }, [employees, query]);

  // Show a "(unlinked)" amber tile when the row has a typed-in name but no
  // employee_key — typical for legacy rows or staff submissions awaiting link.
  // Clicking it opens the search so the operator can link the right person.
  const showFallbackTile = !linked && !!fallbackName && !open;

  return (
    <div style={{ position: "relative", minWidth: 200 }}>
      {linked && !open && (
        <div
          onClick={() => { if (!disabled) { setOpen(true); void ensureLoaded(); } }}
          style={{
            cursor: disabled ? "default" : "pointer",
            padding: "5px 8px",
            borderRadius: 6,
            border: "1px solid var(--line, #d7c6aa)",
            background: "#fff",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            minWidth: 170,
          }}
          title={disabled ? "" : "Click to change employee"}
        >
          <span style={{ fontWeight: 600 }}>{linked.fullName}</span>
          <span style={{ opacity: 0.55, fontSize: 13 }} aria-hidden>🔍</span>
        </div>
      )}
      {showFallbackTile && (
        <div
          onClick={() => { if (!disabled) { setOpen(true); void ensureLoaded(); } }}
          style={{
            cursor: disabled ? "default" : "pointer",
            padding: "5px 8px",
            borderRadius: 6,
            border: "1px solid #e0c070",
            background: "#fff7e0",
            fontSize: 12,
            color: "#a05a00",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            minWidth: 170,
          }}
          title="No employee linked yet — click to search"
        >
          <span style={{ fontWeight: 600 }}>
            {fallbackName}{" "}
            <span style={{ fontWeight: 400, fontStyle: "italic", fontSize: 11 }}>(unlinked)</span>
          </span>
          <span style={{ opacity: 0.55, fontSize: 13 }} aria-hidden>🔍</span>
        </div>
      )}
      {((!linked && !showFallbackTile) || open) && (
        <div style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
          <input
            autoFocus={open}
            disabled={disabled}
            value={query}
            placeholder={linked ? `Change from ${linked.fullName}…` : "Search by name…"}
            onFocus={() => { setOpen(true); void ensureLoaded(); }}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            style={{ flex: 1, fontSize: 12, padding: "5px 8px" }}
          />
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => { setAdvancedOpen(true); void ensureLoaded(); }}
            title="Search by city, state, phone, email…"
            style={{
              padding: "0 10px",
              fontSize: 14,
              border: "1px solid var(--line, #d7c6aa)",
              background: "#fff",
              borderRadius: 6,
              cursor: disabled ? "default" : "pointer",
            }}
          >🔍</button>
        </div>
      )}
      {advancedOpen && employees && (
        <EmployeeSearchModal
          employees={employees}
          addEmployeeHref={addEmployeeHref}
          onSelect={(emp) => {
            onSelect(emp);
            setAdvancedOpen(false);
            setQuery("");
            setOpen(false);
          }}
          onClose={() => setAdvancedOpen(false)}
        />
      )}
      {open && !disabled && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          zIndex: 200,
          marginTop: 2,
          background: "#fff",
          border: "1px solid #d7c6aa",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
          minWidth: 320,
          maxHeight: 360,
          overflowY: "auto",
        }}>
          {loading && (
            <div style={{ padding: 12, fontSize: 12, color: "#666" }}>Loading…</div>
          )}
          {!loading && results.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: "#888" }}>
              {query ? `No employees match "${query}".` : "No employees found."}
              {onCreateInline && query.trim().length >= 2 && (
                <div
                  onMouseDown={(e) => { e.preventDefault(); void handleInlineCreate(); }}
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    background: "var(--accent, #2563eb)",
                    color: "#fff",
                    borderRadius: 6,
                    cursor: creating ? "wait" : "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    opacity: creating ? 0.7 : 1,
                  }}
                  title="Create a new employee with this name and link the row to them."
                >
                  {creating ? "Creating…" : `+ Create employee "${query.trim()}"`}
                  <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, opacity: 0.9 }}>
                    Adds them to the Employee Directory as a contractor. Edit details later from Maintenance.
                  </div>
                </div>
              )}
            </div>
          )}
          {!loading && results.map((e) => (
            <div
              key={e.employeeKey}
              onMouseDown={() => {
                onSelect(e);
                setQuery("");
                setOpen(false);
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #f0e9e0",
                fontSize: 12,
              }}
              onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = "#fbf6ee"; }}
              onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = ""; }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{e.fullName}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                {[e.email, e.phone, [e.city, e.state].filter(Boolean).join(", ")]
                  .filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
          {!loading && employees && employees.length > 0 && (
            <div style={{
              padding: "8px 12px",
              borderTop: "1px solid #d7c6aa",
              background: "#fbf6ee",
              fontSize: 11,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ color: "#666" }}>
                {query
                  ? `${results.length} shown · ${totalMatches} total matches`
                  : `${employees.length} employees`}
              </span>
              <a
                href={addEmployeeHref}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent, #2563eb)", fontWeight: 600 }}
                onMouseDown={(e) => e.stopPropagation()}
              >+ Add new employee ↗</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lazy wrapper around EmployeePicker — renders a cheap text-only display
 * by default and only mounts the full picker (with its hooks, useMemo,
 * cache subscriber, etc.) when the operator clicks to interact.
 *
 * Use this on screens where the cell could be rendered hundreds of times
 * but only a handful are interacted with — e.g. timekeeping grids with
 * 75-100 rows in an expanded day. Visual at-rest state is nearly identical
 * to the regular picker's linked tile; the cost difference is in React's
 * per-instance bookkeeping.
 */
export function LazyEmployeePicker({
  employeeKey,
  displayName,
  fallbackName,
  onSelect,
  onCreateInline,
  disabled = false,
  placeholder = "Search employee…",
}: {
  employeeKey?: string | null;
  /** Optional denormalized name to show at rest without hitting the
   *  module-level employee cache. Pass this when the caller already
   *  has the name (e.g. timekeeping rows have firstName/lastName
   *  denormalized on the row). When omitted, the picker reads from
   *  the cache instead. */
  displayName?: string;
  fallbackName?: string;
  onSelect: (emp: PickerEmployee) => void;
  onCreateInline?: (typedName: string) => Promise<PickerEmployee>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [active, setActive] = useState(false);
  // Re-render this cell when the module-level cache populates so we can
  // drop down from the full <EmployeePicker> mount to the cheap tile.
  // Only needed when we don't have an explicit `displayName` (e.g. crew
  // assignments). Skipped otherwise to keep this cell hook-free for
  // timekeeping's row count.
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (displayName || !employeeKey) return;
    const fn = () => forceRender((t) => t + 1);
    cacheSubscribers.add(fn);
    return () => { cacheSubscribers.delete(fn); };
  }, [displayName, employeeKey]);

  // Resolve the at-rest display name in priority order:
  //   1. Explicit `displayName` from the caller (cheapest — no cache touch).
  //   2. Cache lookup by employeeKey (still cheap, just an array find).
  //   3. None — fall through to either fallbackName or "+ Pick employee".
  const cachedName = !displayName && employeeKey && employeesCache
    ? employeesCache.find((e) => e.employeeKey === employeeKey)?.fullName
    : null;
  const resolvedName = (displayName ?? cachedName ?? "").trim();

  // When we have an employeeKey but no name to show (cache hasn't loaded
  // yet AND no denormalized displayName was passed), fall through to the
  // full picker so its mount-time ensureLoaded() kicks the cache load.
  // Subsequent renders elsewhere on the page will hit the cache and
  // render cheaply.
  const mustMount = (employeeKey && !resolvedName) || active;

  if (mustMount) {
    return (
      <EmployeePicker
        employeeKey={employeeKey}
        fallbackName={fallbackName}
        onSelect={onSelect}
        onCreateInline={onCreateInline}
        // Open in search mode when activated by user click — they wanted
        // to change the employee, not see another tile they have to click
        // through. Skip when we're just falling through to load the cache
        // (employeeKey set, no displayName, cache not yet loaded), so the
        // operator sees the linked tile first once names arrive.
        defaultOpen={active}
        disabled={disabled}
        placeholder={placeholder}
      />
    );
  }

  const cellBase = {
    cursor: disabled ? "default" : "pointer",
    padding: "5px 8px",
    borderRadius: 6,
    border: "1px solid var(--line, #d7c6aa)",
    background: "#fff",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    minWidth: 170,
  } as const;

  const onClick = () => { if (!disabled) setActive(true); };

  // 1. Linked + we have a name — show the resolved name in a cheap tile.
  if (employeeKey && resolvedName) {
    return (
      <div onClick={onClick} style={cellBase} title={disabled ? "" : "Click to change employee"}>
        <span style={{ fontWeight: 600 }}>{resolvedName}</span>
        <span style={{ opacity: 0.55, fontSize: 13 }} aria-hidden>🔍</span>
      </div>
    );
  }
  // 2. Unlinked legacy — typed-in name with no employee_key. Amber warning.
  if (!employeeKey && (fallbackName ?? "").trim()) {
    return (
      <div
        onClick={onClick}
        style={{
          ...cellBase,
          background: "#fff7e0",
          border: "1px solid #e0c070",
          color: "#a05a00",
        }}
        title="No employee linked yet — click to search"
      >
        <span style={{ fontWeight: 600 }}>
          {fallbackName}{" "}
          <span style={{ fontWeight: 400, fontStyle: "italic", fontSize: 11 }}>(unlinked)</span>
        </span>
        <span style={{ opacity: 0.55, fontSize: 13 }} aria-hidden>🔍</span>
      </div>
    );
  }
  // 3. Empty — no employee and no fallback. Show a pick button.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...cellBase,
        cursor: disabled ? "default" : "pointer",
        background: "#fbf6ee",
        color: "var(--accent, #2563eb)",
        fontWeight: 600,
      }}
    >
      + Pick employee
      <span style={{ opacity: 0.55, fontSize: 13 }} aria-hidden>🔍</span>
    </button>
  );
}

// ─── Advanced search modal ─────────────────────────────────────────────────
// Opens from the 🔍 button. Lets the user filter by independent fields:
// name, city, state, phone, email — useful when the name alone isn't enough
// to find the right person (similar names, or "the only Devan in Cleveland").
function EmployeeSearchModal({
  employees,
  onSelect,
  onClose,
  addEmployeeHref,
}: {
  employees: PickerEmployee[];
  onSelect: (emp: PickerEmployee) => void;
  onClose: () => void;
  addEmployeeHref: string;
}) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // ESC closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    function matches(haystack: string | undefined, needle: string): boolean {
      if (!needle.trim()) return true;
      return (haystack || "").toLowerCase().includes(needle.trim().toLowerCase());
    }
    return employees.filter((e) =>
      matches(e.fullName, name) &&
      matches(e.city, city) &&
      matches(e.state, state) &&
      matches((e.phone || "").replace(/[^0-9]/g, ""), phone.replace(/[^0-9]/g, "")) &&
      matches(e.email, email)
    ).slice(0, 200);
  }, [employees, name, city, state, phone, email]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 95vw)", maxHeight: "90vh", overflow: "hidden",
          background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Search Employees</h3>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer" }} title="Close (esc)">✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 80px 1fr 1fr", gap: 8, padding: "12px 18px", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
          <div><small>Name</small><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="any part of the name" /></div>
          <div><small>City</small><input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div><small>State</small><input value={state} onChange={(e) => setState(e.target.value)} placeholder="OH" maxLength={4} /></div>
          <div><small>Phone</small><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="any part" /></div>
          <div><small>Email</small><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="any part" /></div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px" }}>
          <div style={{ fontSize: 11, color: "#666", padding: "8px 0" }}>
            {filtered.length === employees.length
              ? `${filtered.length} employees`
              : `${filtered.length} match${filtered.length === 1 ? "" : "es"}`}
            {filtered.length === 200 && " (cap reached — refine filters)"}
          </div>
          {filtered.length === 0 ? (
            <div className="muted" style={{ padding: "20px 0", textAlign: "center", fontSize: 13 }}>
              No employees match.{" "}
              <a href={addEmployeeHref} target="_blank" rel="noreferrer" style={{ color: "var(--accent, #2563eb)", fontWeight: 600 }}>+ Add new employee ↗</a>
            </div>
          ) : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#fff", color: "#666", fontSize: 11, borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px 6px 0", fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: "left", padding: "6px 8px 6px 0", fontWeight: 600 }}>Email</th>
                  <th style={{ textAlign: "left", padding: "6px 8px 6px 0", fontWeight: 600 }}>Phone</th>
                  <th style={{ textAlign: "left", padding: "6px 8px 6px 0", fontWeight: 600 }}>City</th>
                  <th style={{ textAlign: "left", padding: "6px 8px 6px 0", fontWeight: 600 }}>State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr
                    key={e.employeeKey}
                    onClick={() => onSelect(e)}
                    style={{ cursor: "pointer", borderBottom: "1px solid #f1f3f5" }}
                    onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = "#fbf6ee"; }}
                    onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = ""; }}
                  >
                    <td style={{ padding: "8px 8px 8px 0", fontWeight: 600 }}>{e.fullName}</td>
                    <td style={{ padding: "8px 8px 8px 0", color: "#444" }}>{e.email || "—"}</td>
                    <td style={{ padding: "8px 8px 8px 0", color: "#444" }}>{e.phone || "—"}</td>
                    <td style={{ padding: "8px 8px 8px 0", color: "#444" }}>{e.city || "—"}</td>
                    <td style={{ padding: "8px 8px 8px 0", color: "#444" }}>{e.state || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border, #e5e7eb)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fbf6ee" }}>
          <a href={addEmployeeHref} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent, #2563eb)", fontWeight: 600 }}>+ Add new employee ↗</a>
          <button type="button" onClick={onClose} className="secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

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
  disabled = false,
  placeholder = "Search employee…",
}: {
  employeeKey?: string | null;
  onSelect: (emp: PickerEmployee) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [employees, setEmployees] = useState<PickerEmployee[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const linked = useMemo(
    () => (employeeKey && employees ? employees.find((e) => e.employeeKey === employeeKey) : null),
    [employeeKey, employees],
  );

  // Lazy-load on first focus. Avoids loading thousands of rows for every
  // crew-needs row that may never get touched. Paginates through Supabase's
  // default 1000-row cap so the full directory is searchable regardless of
  // size.
  async function ensureLoaded() {
    if (employees !== null || loading) return;
    setLoading(true);
    try {
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
        if (start > 50000) break; // safety stop
      }
      setEmployees(all.map((r: any) => ({
        employeeKey: r.employee_key,
        fullName: r.full_name ?? "",
        firstName: r.first_name ?? "",
        lastName: r.last_name ?? "",
        email: r.email ?? "",
        phone: r.phone ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
      })));
    } catch (err) {
      console.error("EmployeePicker: failed to load employees", err);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }

  const RESULT_CAP = 50;

  const results = useMemo(() => {
    if (!employees) return [];
    const q = query.trim().toLowerCase();
    if (!q) return employees.slice(0, RESULT_CAP);
    const tokens = q.split(/\s+/).filter(Boolean);

    // Score each token-vs-employee match: higher = better fit. Word-prefix
    // in the name beats substring; substring in name beats substring in
    // email; both beat phone/city/state. Token must score >0 to qualify;
    // an employee qualifies only when EVERY token scores >0.
    function tokenScore(t: string, e: PickerEmployee): number {
      const fullLower = e.fullName.toLowerCase();
      const nameWords = fullLower.split(/\s+/);
      if (nameWords.some((w) => w.startsWith(t))) return 100;
      if (fullLower.includes(t)) return 50;
      if ((e.email || "").toLowerCase().includes(t)) return 20;
      if (
        (e.phone || "").toLowerCase().includes(t) ||
        (e.city || "").toLowerCase().includes(t) ||
        (e.state || "").toLowerCase().includes(t)
      ) return 10;
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
      const hay = [e.fullName, e.email, e.phone, e.city, e.state].filter(Boolean).join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    }).length;
  }, [employees, query]);

  return (
    <div style={{ position: "relative", minWidth: 200 }}>
      {linked && !open && (
        <div
          onClick={() => { if (!disabled) { setOpen(true); void ensureLoaded(); } }}
          style={{
            cursor: disabled ? "default" : "pointer",
            padding: "5px 8px",
            border: "1px solid var(--line, #d7c6aa)",
            borderRadius: 6,
            background: "#fff",
            fontSize: 12,
          }}
          title={disabled ? "" : "Click to change"}
        >
          <div style={{ fontWeight: 600 }}>{linked.fullName}</div>
          {(linked.email || linked.phone) && (
            <div style={{ fontSize: 11, color: "#666" }}>
              {linked.email}{linked.email && linked.phone ? " · " : ""}{linked.phone}
            </div>
          )}
        </div>
      )}
      {(!linked || open) && (
        <input
          autoFocus={open}
          disabled={disabled}
          value={query}
          placeholder={linked ? `Change from ${linked.fullName}…` : placeholder}
          onFocus={() => { setOpen(true); void ensureLoaded(); }}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          style={{ width: "100%", fontSize: 12, padding: "5px 8px" }}
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
                href="/employee-directory"
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

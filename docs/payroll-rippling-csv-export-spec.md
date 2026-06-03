# Payroll → Rippling CSV Export — Spec

Status: **Draft v6** — single CSV (no staff/contractor split), no validation (2026-06-03)

## V1 = ONE CSV button, all entries dumped together

The clerk separates staff from contractor on the Rippling side when she uploads. Building two separate exports doesn't earn its keep in V1. One button, one file, every entry on the payroll run goes in.

V2 may split if it turns out the clerk wants pre-sorted files.

## Guiding principle: dump it all, clerk fixes the rest

The export is dumb on purpose:

- **No validation, no skip logic, no banners.** Every entry on the payroll run goes into the CSV. If a row has no Rippling Emp No, it still ships with an empty Emp No column. If a specialty doesn't match any Rippling column, the row's hours land in the generic bucket (`Base Pay` / `Contractor Hourly`).
- **The payroll clerk is the QA step.** Rippling will reject or partially load whatever's broken; the clerk patches it via Rippling's own UI (global search/replace on position and specialty, manual entry for unmatched employees).
- **V2 can add intelligence.** Validation, mapping warnings, fuzzy matching — all deferred.

This collapses most of the earlier spec's complexity. No skip logic. No "Open Questions" that block the build.
Owner: jobrien
Related code: [components/shared/payroll-run-detail.tsx](../components/shared/payroll-run-detail.tsx), [lib/store/payroll.ts](../lib/store/payroll.ts), [lib/store/types.ts](../lib/store/types.ts) (`PayrollRunEntry`)
Reference: Rippling template `template.csv` (downloaded 2026-06-03), Rippling Help Center "Import a CSV in the pay run" PDF

## What changed from v1

v1 of this spec assumed a **per-day, per-entry** import keyed on **work email**. The real Rippling format is:

- **Per-employee period totals** — one row per employee per pay run, no work-date column. We must aggregate Amplified's per-day entries before export.
- **Keyed on Rippling Emp No** (integer) — Amplified does NOT currently store this. New field + backfill required.
- **Specialty encoded as columns, not rows** — each Rippling-configured specialty (Rigger, Fork, Lead, Day Rate 1, Luke Bryan Tour, Climber, Coordinator) gets its own Hours/Rate/Amount/Earning Period column set, plus matching OT and DT triplets.

## What changed from v2 (after seeing the contractor template)

- **TWO Rippling pay runs to feed, with different column sets.** Staff (W-2) and Contractor (1099) have separate pay runs in Rippling, separate pay schedules (Bi-Weekly contractor schedule "Default Pay Schedule for Contractors"), and **different earning column structures**. We must produce two distinct CSV exports.
- **Contractor template is shorter** — no Base Pay, no Salary, no tax-specific columns (NSO/ISO/Minister/Housing/fringe/etc). Generic catch-all is `Contractor Hourly Hours/Rate/Amount` instead of `Base Pay Hours/Rate/Amount`.
- **Per-employee per-specialty rates vary individually** — confirmed. e.g. Cortez Davis has Climber at $26 (vs $25 for everyone else), with OT $39 / DT $52 derived from that base. Our export must NOT push Amplified's snapshot rates over Rippling's stored rates.
- **Duplicate employee records confirmed visible to Rippling** — both Anthony Thigpen rows (emp 171 and emp 174) appear in the template. Connects to the `project_employee_dedup.md` memory: ~24 dupe employees system-wide. Means Amplified's `employees.rippling_employee_id` mapping isn't simply 1:1 with Amplified employee records — we may need to choose which Rippling Emp No each Amplified record maps to, and surface mismatches.
- **Stray empty columns** — the contractor template has a literal `"Rigger"` column (no Hours/Rate/Amount suffix) in position 3, and `"Shift ID"` in position 4. Both are blank for every row. Likely Rippling Department/Team label columns that come through unfilled for this entity. We **echo them as blank** — do not emit values.

## Goal

Add **two** "📥 Export Rippling CSV" buttons (Staff / Contractor) to the payroll run detail page. Each click produces a `.csv` file that maps cleanly to the corresponding Rippling pay run, so that the upload through **Payroll → Run Payroll → Earnings → Import CSV** populates hours per employee per specialty without manual entry.

Amplified payroll runs may contain a mix of staff and contractor entries (the candidate picker has an `employmentType` filter but doesn't force separation). The export splits by `PayrollRunEntry.employmentType` and emits the right CSV format for each side.

## Where it goes

`components/shared/payroll-run-detail.tsx`, in the action row at line ~615–682. Placed immediately after the Print/PDF button.

```tsx
<button
  className="secondary"
  onClick={() => handleExportRipplingCsv("staff")}
  disabled={!!busy || staffEntryCount === 0 || exportBlocked}
  title={exportBlockedReason ?? `Export ${staffEntryCount} staff rows for Rippling W-2 payroll`}
>
  📥 Staff CSV
</button>
<button
  className="secondary"
  onClick={() => handleExportRipplingCsv("contractor")}
  disabled={!!busy || contractorEntryCount === 0 || exportBlocked}
  title={exportBlockedReason ?? `Export ${contractorEntryCount} contractor rows for Rippling 1099 payroll`}
>
  📥 Contractor CSV
</button>
```

Enabled per-side when entries of that type exist. (Same overall enable rule as Print.)

## The Rippling templates, broken down

Two templates, one per pay run type. Diff:

| Concept                              | Staff template          | Contractor template            |
|--------------------------------------|-------------------------|--------------------------------|
| Generic hourly bucket                | `Base Pay`              | `Contractor Hourly`            |
| Salary support                       | Yes (`Salary` column)   | No                             |
| Owner/partner draws                  | Yes (`Owner's Draw`, `Guaranteed Payments`, `S-Corp Health and Disability`) | No |
| Equity events (NSO/ISO/PA-ISO)       | Yes                     | No                             |
| Minister Housing / Housing CA        | Yes                     | No                             |
| Fringe benefits (taxable / PR / PA)  | Yes                     | No                             |
| Cash Tips (multiple variants)        | Yes                     | Only `Payable Cash Tips`       |
| CA flat-sum bonus retro OT           | Yes                     | No                             |
| COVID-19 CA supplemental sick        | Yes                     | No                             |
| QSEHRA / supplemental benefit / device reimbursement | Yes     | No                             |
| Per-specialty Rigger/Fork/Lead/Day Rate 1/Luke Bryan Tour/Climber/Coordinator columns | Yes — full std/OT/DT triplet | Yes — identical column set |
| Generic Overtime / Double Overtime   | Yes                     | No (only per-specialty OT/DT)  |
| Regular Rate of Pay (Premium)        | Yes                     | Yes                            |
| Stray empty `Rigger` and `Shift ID` label columns | No        | Yes (positions 3 and 4)        |
| Paystub Note (final column)          | Yes                     | Yes                            |

Both templates carry the same **per-specialty earning structure** (Rigger / Fork / Lead / Day Rate 1 / Luke Bryan Tour / Climber / Coordinator), with each specialty contributing 12 columns (Hours/Rate/Amount/Earning Period × std/OT 1.5x/DT 2.0x). So the per-specialty aggregation logic is **shared** between the two exports — only the generic-bucket column name (`Base Pay Hours` vs `Contractor Hourly Hours`) and the surrounding tax-specific columns differ.

### Columns we'll populate

**Identity (every row):**
- `Rippling Emp No` — integer (`2`, `13`, `15`, `21`, `109`, `110`, `111` in your sample). Required.
- `Employee Name` — full name string (`David Strang`, `Chris Travis`, …). Required as a human label; Rippling matches on Emp No.

**Generic earnings (one set of columns, applied across all specialties):**
- `Base Pay Hours` / `Base Pay Rate` / `Base Pay Amount` — leave **blank** for hourly employees. (Sample shows `0.0000` / `25.00` / `0.00` on Chris Travis — pre-populated by Rippling as the employee's standing base rate. We echo it back unchanged so we don't accidentally override.)
- `Overtime Hours` / `Overtime Rate` / `Overtime Amount` — generic OT bucket. **Leave blank** — we use the per-specialty OT columns instead, since Amplified rates are per-specialty.
- `Double Overtime Hours` / `Double Overtime Rate` / `Double Overtime Amount` — same, blank.
- `Regular Rate of Pay (Premium) Hours/Rate/Amount` — blank.

**Per-specialty earnings (one Hours/Rate/Amount/Earning Period set per specialty, repeated for std, OT 1.5x, DT 2.0x):**

For each Rippling-configured specialty in `[Rigger, Fork, Lead, Day Rate 1, Luke Bryan Tour, Climber, Coordinator]`:

| Column                                          | Source                                               |
|-------------------------------------------------|------------------------------------------------------|
| `{Specialty} Hours`                             | Σ `payStdHours` where mapped specialty == this one   |
| `{Specialty} Rate`                              | Echo from template (Rippling's stored per-employee rate) — do NOT override with Amplified snapshot |
| `{Specialty} Amount`                            | Hours × Rate (Rippling auto-calcs if both provided)  |
| `{Specialty} Earning Period`                    | Pay period `MM/DD/YYYY - MM/DD/YYYY` (see open Q4)   |
| `{Specialty} overtime (1.5x base) Hours`        | Σ `payOtHours` where mapped specialty == this one    |
| `{Specialty} overtime (1.5x base) Rate`         | Echo from template                                   |
| `{Specialty} overtime (1.5x base) Amount`       | Hours × Rate                                         |
| `{Specialty} overtime (1.5x base) Earning Period` | Pay period                                         |
| `{Specialty} double overtime (2.0x base) Hours` | Σ `payDtHours` where mapped specialty == this one    |
| `{Specialty} double overtime (2.0x base) Rate`  | Echo from template                                   |
| `{Specialty} double overtime (2.0x base) Amount`| Hours × Rate                                         |
| `{Specialty} double overtime (2.0x base) Earning Period` | Pay period                                  |

Specialties the employee didn't work this period: **leave every cell blank** (per Rippling docs: empty = no change, `0` = explicit override). Critical — if we send `0.0000` for unused specialties we'll overwrite Rippling's stored defaults with zeros.

**Trailing column:**
- `Paystub Note` — optional free text. Candidate: `payAdjustmentReason` rolled up per employee, e.g. `"5hr min applied on 2026-05-21; +2hr weekly OT spill"`. Useful for Connor to spot-check why a row's hours differ from the timesheet raw.

### Columns we'll always leave blank

Rippling's template includes ~40+ tax-specific and edge-case earning columns we don't use:

- `Shift ID`, `Salary` — Amplified doesn't run salaried timesheet entries
- `PTO Payout *` — PTO isn't tracked in Amplified yet
- `Owner's Draw`, `Guaranteed Payments`, `S-Corp Health and Disability` — owner/partner-specific
- `NSO Exercise Income`, `ISO (Disqualifying disposition)`, `Pennsylvania Incentive Stock Option` — equity events
- `Minister Housing Allowance`, `Housing CA` — housing-specific
- `Fringe Benefit (Imputed Earning)`, `PA non-taxable fringe benefit`, `Puerto Rico Fringe Benefit`, `Puerto Rico non-taxable fringe benefit` — fringe benefits
- `Non-Qualified Deferred Compensation`, `Non Qualified Deferred Compensation (Payout)` — deferred comp
- `Cash Tips`, `Payable Cash Tips`, `Tip to Minimum Wage` — Amplified doesn't process tips
- `California flat sum bonus overtime *`, `California flat sum double overtime bonus *`, `Retro overtime earnings due to California flat sum bonus`, `Retro overtime earning due to bonus` — CA-specific bonus retro calcs
- `Payable Non-Taxable Disability`, `Reportable Non-Taxable Disability` — disability
- `COVID-19: California Supplemental Sick Leave *` — COVID-era leave (dormant)
- `QSEHRA (Taxable)`, `Reportable QSEHRA (Non-payable)`, `Supplemental Benefit`, `Device Reimbursement` — benefit/reimbursement
- `Regular Rate of Pay (Premium) *` — premium regular rate (CA-specific calc)

Empty cells = no override = Rippling keeps whatever it has. Safe.

## Specialty mapping (Amplified → Rippling)

Amplified's `specialty` field is a free-form string per `PayrollRunEntry`. Rippling has a fixed set of specialty columns. We need an explicit mapping table.

**Provisional mapping** (verify each line with Connor):

| Amplified `specialty`     | Rippling specialty | Notes                                                |
|---------------------------|--------------------|------------------------------------------------------|
| `Rigger / Climber`        | `Climber`          | Or `Rigger` — Amplified may need to be split         |
| `Rigger`                  | `Rigger`           |                                                      |
| `Climber`                 | `Climber`          |                                                      |
| `Forklift Operator`       | `Fork`             |                                                      |
| `Forklift`                | `Fork`             |                                                      |
| `Lead`                    | `Lead`             |                                                      |
| `Lead Hand`               | `Lead`             |                                                      |
| `Coordinator`             | `Coordinator`      |                                                      |
| `Production Coordinator`  | `Coordinator`      |                                                      |
| (Luke Bryan tour rows)    | `Luke Bryan Tour`  | Tour-specific override — needs Connor's trigger rule |
| (day-rate flat shifts)    | `Day Rate 1`       | Same — when does an entry route here?                |

**Implementation:** new const map in `lib/store/payroll-export.ts` keyed off Amplified specialty + (optionally) job_id for tour-specific routing. Unknown specialties throw a pre-export validation error listing the affected rows so Connor knows to either rename the Amplified specialty or extend the map.

## Aggregation logic

For a payroll run with N entries:

```ts
// Group by employee, then by mapped Rippling specialty
const byEmp = groupBy(entries, e => e.employeeKey);
for (const [empKey, empEntries] of byEmp) {
  for (const e of empEntries) {
    const rippSpec = mapSpecialty(e.specialty, e.jobId); // → "Rigger" | "Lead" | ...
    bucket[empKey][rippSpec].std += e.payStdHours;
    bucket[empKey][rippSpec].ot  += e.payOtHours;
    bucket[empKey][rippSpec].dt  += e.payDtHours;
  }
}
```

**Holiday rows** (`isHoliday === true`): currently `payTotalHours` collapses into std + OT + DT zero, with the holiday multiplier baked into `totalPay`. Hours-wise these aggregate exactly like normal rows; the multiplier is invisible in the hours column. See **Open Q3** for how to surface it.

## Rate handling — push Amplified rates

**Decision (2026-06-03):** Push Amplified's `stdRate` (and derived OT/DT) into the CSV's Rate columns. NOT blank, NOT echoed from Rippling.

Why:
- **Saves the clerk time.** She doesn't have to verify each row's rate against Rippling's stored value; if Amplified's rate is right, she just submits.
- **Surfaces discrepancies.** If Amplified's rate is wrong, Rippling shows the override in the pay-run UI and the clerk sees it. She can fix it in Rippling AND tell us, then we fix Amplified.
- **Improves job costing.** Job costing pulls labor cost from Amplified's rates. If those rates aren't trustworthy, job costing is junk. Forcing the rate through the payroll review loop makes Amplified the source of truth over time.

OT = `stdRate × 1.5`, DT = `stdRate × 2.0` for the matching specialty's OT/DT columns. Amount = `hours × rate` (Rippling auto-computes if both are present anyway, but we emit it explicitly for the clerk's eyeball check).

Holiday rows: V1 sends them under the regular specialty at base rate (no 2x bake-in). Clerk handles the holiday premium manually in Rippling. V2 can route to a dedicated Holiday earning type once Connor sets one up.

## Rate handling — CRITICAL

**Do NOT send Amplified's snapshot `stdRate` as the Rippling Rate column.**

Reasoning: Rippling pre-populates the template with each employee's stored per-specialty rate (`Chris Travis: Rigger $30, Lead $35, Climber $25`). Amplified stores its own snapshot rate which Connor types in the payroll run UI. These two rates are managed independently. If Amplified's snapshot drifts from Rippling's stored rate (e.g. Connor updates Rippling but not Amplified, or vice versa), pushing Amplified's rate would silently change pay.

**Two options:**

**Option A (safer, recommended for V1):** Echo the rate from the template back unchanged.
- Implementation: Connor downloads Rippling's fresh template into Amplified before exporting. Amplified parses the template once to extract `{Rippling Emp No → {specialty → rate}}` and uses those rates in the export.
- UX: a "Drop Rippling template here" file picker on the payroll run page, separate from the export button. Once parsed, the rate map is cached for that run.

**Option B:** Omit the Rate column entirely.
- Per Rippling docs: "If only Hours are imported, Rippling will update that value and use the default Rate from the employee profile."
- Simpler — no template upload needed. But riskier: if Hours are imported without Rate, Amount can't be imported either ("Amount can only be imported if both Hours and Rate are included"), so Rippling computes the Amount from its own rate. Which is fine — that's what we want.
- **Recommendation: Option B for V1.** Just send Hours, blank the Rate and Amount columns, and let Rippling do the math. Removes the entire class of "Amplified rate drift" bugs.

(Confirm with Connor.)

## Required schema change: `rippling_employee_id` on employees — CONFIRMED

Rippling matches on `Rippling Emp No`. Amplified currently has no field for this.

**Decision (2026-06-03):** add `employees.rippling_employee_id integer` directly on the `employees` table. Keep it simple — no lookup table.

Implementation:

1. Migration adds nullable `rippling_employee_id integer` column to `employees`. Nullable so we can ship the schema before the backfill is complete.
2. Unique partial index `WHERE rippling_employee_id IS NOT NULL` — catches accidental duplicate mappings during backfill.
3. UI: numeric input on the employee maintenance screen, labeled "Rippling Emp No".
4. Backfill: Connor exports Rippling's employee roster (name + emp no), drops it into Amplified, we name-match with manual confirm for ambiguous cases.

Standard dev → prod migration path. No new table → no new RLS/grants.

## Surface Rippling Emp No on the payroll run detail screen

So the clerk can spot missing IDs while reviewing a run (without having to bounce out to the employee directory), add a **`Rippling #`** column to the per-employee entries grid on `components/shared/payroll-run-detail.tsx`.

- Sits in the employee group header (the grey strip showing `{Name} · N entries · X hrs · $Y`) — display as `Rippling #123` next to the name, or `—` if not set.
- If missing, render in red (`#c0392b`, same as the existing "specialty missing" treatment) so it's scannable when the clerk skims the list.
- Sourced from `entries[0].employeeKey → employees.rippling_employee_id` lookup. Cache the lookup in the run's data fetch.
- No inline edit on this screen — clicking the red `—` link can deep-link to `/employee-directory?focus={employeeKey}` so the clerk lands directly on the right record. (Phase 2 if it's worth it; for V1 they just navigate manually.)

## Payroll role access

The payroll clerk needs the employee directory **including pay rates** — they're the one setting rates per employee per specialty, so hiding them defeats the purpose.

Changes:

1. Remove `/employee-directory` from the payroll-role bounce-list in [components/layout/app-shell.tsx:85](components/layout/app-shell.tsx:85).
2. Add `/employee-directory` to the visible nav for payroll users (line 140-142).
3. Do NOT extend `hideBill` to payroll — they see pay rates same as admins.
4. Update the schema comment at [supabase/schema.sql:284](supabase/schema.sql:284) to remove "no employee pay rates" — it's no longer the intent.

`hideBill` keeps its current behavior (only hides pay rates from `crew_leader`). The earlier suggestion to rename it to `hidePayRates` still has merit as an independent cleanup, but isn't required for this work.

## CSV format

- Encoding: UTF-8, no BOM.
- Line endings: CRLF (Rippling's template uses them).
- Quoting: every field quoted with `"`, per the template. Escape embedded `"` as `""`.
- Header row 1; data rows 2+.
- Numerics:
  - Hours: 4 decimal places (`6.0000`)
  - Rate: 2 decimal places (`30.00`)
  - Amount: 2 decimal places (`180.00`)
  - **Never include currency symbols.**
- Empty cells: literal `""` (quoted empty), matches the template's style.

## File naming

`amplified-payroll-{payDate}-{shortId}.csv`
e.g. `amplified-payroll-2026-06-10-a3f8c2.csv`

## Pre-export validation — none

No validation. Every entry on the run goes into the CSV. Missing Rippling Emp No → row exports with an empty value in that column. Unmapped specialty → row's hours fold into the generic bucket (`Base Pay` for staff, `Contractor Hourly` for contractors). The clerk handles whatever Rippling rejects.

The only thing the button checks is whether there are any entries of that type on the run — if `entries.filter(e => e.employmentType === "staff").length === 0`, the Staff button is disabled. Same for Contractor.

## File-naming and download

Standard `Blob` + `<a download>` trigger, no server round-trip.

## Implementation sketch

```ts
// lib/store/payroll-export.ts (new)

import type { PayrollRun, PayrollRunEntry } from "./types";

const RIPPLING_SPECIALTIES = [
  "Rigger", "Fork", "Lead", "Day Rate 1",
  "Luke Bryan Tour", "Climber", "Coordinator",
] as const;
type RipplingSpecialty = typeof RIPPLING_SPECIALTIES[number];

// Mapping table — verify with Connor.
const SPECIALTY_MAP: Record<string, RipplingSpecialty> = {
  "Rigger": "Rigger",
  "Climber": "Climber",
  "Rigger / Climber": "Climber",
  "Forklift Operator": "Fork",
  "Forklift": "Fork",
  "Lead": "Lead",
  "Lead Hand": "Lead",
  "Coordinator": "Coordinator",
  "Production Coordinator": "Coordinator",
  // tour + day-rate routing: TBD
};

export function buildRipplingCsv(
  run: PayrollRun,
  entries: PayrollRunEntry[],
  employeeRipplingNo: Map<string, number>,  // employeeKey → Rippling Emp No
): string {
  // 1. Aggregate per (employee, specialty)
  type Bucket = { std: number; ot: number; dt: number };
  type EmpRow = {
    empNo: number;
    name: string;
    notes: string[];
    byspec: Map<RipplingSpecialty, Bucket>;
  };
  const rows = new Map<string, EmpRow>();
  for (const e of entries) {
    const spec = SPECIALTY_MAP[e.specialty ?? ""];
    if (!spec) throw new Error(`Unmapped specialty "${e.specialty}" on entry ${e.id}`);
    const key = e.employeeKey!;
    const empNo = employeeRipplingNo.get(key);
    if (empNo == null) throw new Error(`Missing Rippling Emp No for ${e.firstName} ${e.lastName}`);
    let r = rows.get(key);
    if (!r) {
      r = { empNo, name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
            notes: [], byspec: new Map() };
      rows.set(key, r);
    }
    let b = r.byspec.get(spec);
    if (!b) { b = { std: 0, ot: 0, dt: 0 }; r.byspec.set(spec, b); }
    b.std += e.payStdHours;
    b.ot  += e.payOtHours;
    b.dt  += e.payDtHours;
    if (e.payAdjustmentReason) r.notes.push(`${e.workDate}: ${e.payAdjustmentReason}`);
  }

  // 2. Build header row — must match Rippling's template exactly.
  // (Full list compiled from template.csv — codified as a constant.)
  const headers = HEADERS_FROM_TEMPLATE;
  const lines = [headers.map(csvField).join(",")];

  // 3. Build data rows. Option B: emit Hours only, leave Rate/Amount blank.
  for (const r of rows.values()) {
    const row: Record<string, string> = {
      "Rippling Emp No": String(r.empNo),
      "Employee Name": r.name,
      "Paystub Note": r.notes.join("; "),
    };
    for (const spec of RIPPLING_SPECIALTIES) {
      const b = r.byspec.get(spec);
      if (!b) continue;  // leave blank — no override
      if (b.std > 0) row[`${spec} Hours`] = b.std.toFixed(4);
      if (b.ot  > 0) row[`${spec} overtime (1.5x base) Hours`] = b.ot.toFixed(4);
      if (b.dt  > 0) row[`${spec} double overtime (2.0x base) Hours`] = b.dt.toFixed(4);
    }
    lines.push(headers.map(h => csvField(row[h] ?? "")).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function csvField(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
```

Constant `HEADERS_FROM_TEMPLATE` is the literal header row from `template.csv`, codified verbatim. Lock it in once Connor confirms the V1 export is column-clean against a real Rippling test upload.

## Open questions (deferred to V2 unless noted)

0. **Employee-dedup mapping.** Anthony Thigpen appears twice in the contractor template (Rippling Emp 171 and 174). If Amplified has one Anthony Thigpen and we map him to one of those Rippling Emp Nos, the *other* Rippling record continues to receive zero hours. Decision: do we (a) require Connor to dedup the Rippling side first, (b) let Amplified's mapping pick the "primary" Rippling Emp No and accept that the dupes get stale entries, or (c) flag dupes during backfill so Connor reconciles before we go live? See `project_employee_dedup.md`. **Recommendation: (c).**

1. **Holiday encoding.** Rippling's template has no Holiday column. Three options:
   - (a) Connor creates a `Holiday` earning type in Rippling with a 2x multiplier baked in. We send holiday hours under a new `Holiday Hours / Rate / Amount` column. Cleanest long-term.
   - (b) We send holiday hours under the regular specialty's `Amount` field at `hours × rate × 2`, with `Hours` blank, `Rate` blank. Rippling docs say `Amount` alone can't be imported — only if both `Hours` and `Rate` are present. So this path requires sending `Hours` and a *doubled* `Rate` so `Amount = Hours × doubledRate`. Hacky and would confuse Connor in audit.
   - (c) Defer holiday to manual entry in Rippling for V1. Banner the operator: "N holiday-pay rows on this run — enter manually in Rippling after import."
   - **Recommendation:** (c) for V1, (a) once Connor adds the earning type.

2. **Rate strategy: Option A vs B?** See Rate handling section. **Recommendation: B** — omit Rate, let Rippling apply its stored per-employee per-specialty rates. Simpler, no template-upload step, no rate-drift risk.

3. **Specialty mapping — confirm each line** with Connor. Open items: (a) does `Rigger / Climber` route to Rigger or Climber? (b) When does a row route to `Luke Bryan Tour` vs `Climber`/`Rigger`? Job-based override? (c) `Day Rate 1` — what triggers it? Specialty name, job tag, or a manual flag?

4. **`Earning Period` columns** — what format does Rippling expect? `MM/DD/YYYY - MM/DD/YYYY`? Just the end date? Or leave blank and let Rippling default to the pay run period? Test with a dry-run upload.

5. **Status side effect.** Should clicking Export auto-stamp `exported_at / exported_by` and flip a `finalized` run to `exported`? Likely yes for finalized, no-op for draft/voided.

6. **Header drift.** Rippling's template includes columns specific to the entity's enabled earning types. If Connor adds a new specialty (e.g. "Drone Operator") in Rippling, the template grows. Our hardcoded header list will then be incomplete. Mitigations:
   - Pin the V1 export to the known 2026-06-03 header list. Document that adding a Rippling specialty requires editing `HEADERS_FROM_TEMPLATE`.
   - V2: parse the latest template Connor uploads and use it as the schema source of truth.

## Out of scope for V1

- Direct Rippling API push (would replace CSV upload). V2.
- Multi-run batching.
- Deductions (column set is on the template but we don't have a source field for them in Amplified).
- Qualified Overtime CSV (separate tab in Rippling for FLSA tax reporting — different column set).
- Job-dimension allocation (Amplified's `jobId` mapped to Rippling Department/Project/Cost Center). Per the PDF, this would create one row per (employee × job) instead of one row per employee. Defer until Connor turns on job dimensions in Rippling.
- Editing Rippling-side data from Amplified.

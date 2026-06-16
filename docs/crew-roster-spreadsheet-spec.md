# Crew Roster Spreadsheet — Export / Import (Phase 1)

**Status:** Design ready. No schema changes required.
**Supersedes:** the "Bulk import: load crew assignments from a spreadsheet" stub in
`docs/technical-debt-backlog.md` (~line 794) — that entry was CSV/paste, import-only.
This design is a superset: bidirectional Excel round-trip, in-sheet employee
validation, employee auto-create on import, and a choice of source (requirements
or the active quote).

---

## 1. Goal

Coordinators work the roster outside the app. Give them a self-contained Excel
workbook, pre-filled with one row per crew slot the job needs, where the **only**
field they fill is *which employee* takes each slot. When they upload it back, it
populates `job_request_assignments`, creating any new employees first so the FK is
satisfied. Re-uploads reconcile (idempotent, multiple partial loads supported).

This is Phase 1 of the larger [[project_crew_import]] vision (eventual in-app
outreach / confirm / reject tracking). Phase 1 is just the spreadsheet loop.

## 2. Where it lives

On the **Job screen**, in `JobRequestCrewSection`
(`components/shared/job-request-crew-section.tsx`) — the "Assigned Crew" area.
Coordinators have access to this screen; they do **not** have access to the quote
screen. The quote is read behind the scenes (§4) — never navigated to.

Two buttons: **Export Roster** and **Import Roster**.

---

## 3. The workbook

Tab order: **Job Info · Crew · Employees · Valid Roles**, plus a separate hidden
metadata sheet (§3.5). Tabs are referenced by name below, not number.

### Tab — "Job Info" (visible; human orientation)
Coordinators often have several jobs' workbooks open at once, so the first thing
they see is *which* job this is. Read-only display of all relevant job context:

- Client, event name, `job_no`
- Venue / location, city, state
- Date range + per-day call/start/end times
- **Source used to build this template:** `requirements`, or `quote` + the
  quote's display code (so it's clear which quote generated it)
- Export timestamp
- **Reconciliation summary** (see §3.6): current needed-vs-assigned counts per
  role, e.g. *"Rigger: needs 3 · assigned 5 · 2 over"*.

This is the human-readable counterpart to the hidden metadata in §3.5 — the two
are complementary: this tab is for people, the hidden sheet is for the import
guard.

### Tab — "Crew"
One row per needed slot (a crew_need / quote-line crew_count of N expands into N
rows). Columns:

| Column | Source | Notes |
|---|---|---|
| Date | day | `event_date`, e.g. 2026-08-10 — the binding source of truth for the day (no day-of-week column, so there's nothing to leave inconsistent when copying a row) |
| Shift | shift label | blank if job has no shifts |
| Call / Start / End | day or quote line | times, display-only |
| Position | position name | **dropdown** validated against the distinct-positions list on Valid Roles |
| Specialty | specialty name | **dropdown that cascades from Position** — only that position's specialties are selectable, so only valid pairs |
| **Employee** | **blank / pre-filled** | the one field they fill; list-validated against the Employees tab |
| **Confirmed** | blank / pre-filled | Yes/No validation; coordinator sets confirmation here |
| Notes | need/line notes | optional, coordinator-editable |
| Status | system | written on (re-)export: `✓ loaded`, over/under-staffed and validation notes (§5 Step C) — read-only to the coordinator |
| _(hidden)_ day_id, shift_id, position_id, specialty_id, assignment_id | ids | so re-import binds precisely, no text matching |

- **Pre-fill:** where an assignment already exists for a slot, Employee +
  Confirmed are pre-filled (re-export of an in-progress roster). Reuse the
  existing `loadJobCrewSlots()` join.
- **Extras beyond requirements:** coordinators may add rows past the pre-filled
  set. `job_request_assignments` does not enforce against `crew_needs`, so extras
  just become extra assignments. They fill Date/Shift/Position+Specialty (validated) +
  Employee for an added row.
- **Employee validation:** Excel list validation pointing at the Employees tab
  Table column. To add someone not in the list, the coordinator adds a row on the
  Employees tab, then it becomes selectable here — closing the loop. (Requires the
  validation source to be an Excel **Table** so the list auto-grows.)

### Tab — "Employees"
The full **active** employee roster as an Excel Table (so the Crew tab's dropdown
auto-expands as rows are added). Columns: Full Name, First, Last, Phone, Email,
Address, City, State, Zip, plus a hidden `employee_key`. Coordinators append new
people at the bottom; new rows have a blank `employee_key` (the import mints it).

### Tab — "Valid Roles" (reference + validation source)
The position/specialty combos allowed for this job, as an Excel Table. Visible
columns: **Position, Specialty only — no rates.** Coordinators never see billing
or pay figures anywhere in this workbook. The tab exists purely to constrain role
selection. Two hidden helper columns back the dropdowns: `specialty_id` (the
authoritative id for name→id resolution on import) and a distinct-positions list
(source for the Position dropdown). Rows are **sorted by position** so each
position's specialties are contiguous.

**Cascading dropdowns — Position then Specialty.** Position picks from the
distinct-positions list. Specialty cascades from the chosen position via an
`OFFSET(… MATCH … COUNTIF …)` list formula that returns only that position's
contiguous block of specialties — so a coordinator can only land on a valid
(position, specialty) **pair**, never a mismatch. On import the pair resolves to
`specialty_id` (hidden id wins; else the (position, specialty) name pair; else
specialty name alone), and `position_id` is re-derived from the specialty
server-side as the authority.

**Source:** the job's resolved rate card via `pickRateCardForJob(clientId,
requestDate)` → `rate_card_profile_rows` (used only to determine *which* roles are
valid — the rate values are read internally and **never written to the sheet**).
`rate_card_profile_rows` has `specialty_id` only — **position is derived through
`specialties.position_id`** (same normalization as quote lines). So each rate-card
row = one valid role.

**Guard against false flags:** allowed set = rate-card roles **∪** roles this
job's own requirements/quote already use. A pre-filled row whose specialty isn't
on the rate card (see [[project_position_specialty_cleanup]]) is marked
*"role not on this job's rate card — verify"* rather than rejected — signal, not a
block, and with no dollar figure.

### 3.5 Hidden metadata sheet (machine guard — keep it)
A very-hidden sheet (or workbook document properties) carrying the machine-readable
stamp the import guard relies on: `job_request_id`, `job_no`, source
(`requirements` | `quote` + quote id), template-generation timestamp, and schema
version. Distinct from the Job Info tab: that's for humans to read, this is for
the §5 Step 0 identity check. Both are written on every export and re-export.

### 3.6 Requirements reconciliation (export AND re-export)
The template reflects **current** requirements, but the saved assignments may have
been built against an **older** quote. Classic case: Quote A needed 5 riggers, the
coordinator assigned 5; Quote B (now active) needs only 3. We must not silently
drop the 2 extra riggers — the coordinator chose them on purpose, and extras are
allowed.

On every export **and** on the post-import re-export, re-read the current source
(active quote or requirements) and compare needed-vs-assigned **per role per
day/shift**:
- **Over-staffed** (assigned > needed): keep the rows, flag in Status —
  *"2 over current requirement (needs 3, 5 assigned)"*. Coordinator decides: leave
  the extras (fine) or delete those rows (import then removes those assignments).
- **Under-staffed** (assigned < needed): the remaining blank slots are already
  present as unfilled rows; Status notes *"2 unfilled"*.
- The per-role roll-up also appears on the **Job Info** tab so the discrepancy is
  visible at a glance, not just buried per-row.

Running this on the re-export means every round-trip re-checks against the live
quote — so a requirements change between loads surfaces immediately rather than
going unnoticed.

### Library
Add **ExcelJS**. SheetJS community edition cannot *write* data-validation
dropdowns; ExcelJS supports per-cell list validation and Tables.

---

## 4. Source: Requirements vs Active Quote

Export dialog offers two sources (no quote picker needed):

- **Requirements** → `job_request_crew_needs` joined to `job_request_days`.
  Always available; already shaped as day × shift × position × specialty × qty,
  a 1:1 map to slot rows. `position_id` stored directly.
- **Active Quote** → resolved via a shared helper (see below). Days come from
  `quote_days` (includes the `is_holiday` flag); slots come from `quote_lines`
  joined by `quote_date`. **Position is derived through the specialty FK**
  (`quote_line.specialty_id → specialties.position_id`) — quote lines have no
  `position_id` column, and that's correct normalization, not a gap. The
  `service_key` text ("… | Fork Op | …") is cosmetic only.
  - **Job Info "Template source" label** shows the real quote number when the
    quote has one, else the job's **AES number** (`job_no`) — never the opaque
    quote row id. `resolveActiveQuoteForJob` returns `quoteNo` (nullable) for
    this; drafts without a number fall back to the AES.

### Shared "active quote" resolver
Extract the logic currently inline in `job-requests.tsx` (~line 173) into
`resolveActiveQuoteForJob(jobRequestId)`:

```
quotes WHERE job_request_id = job  ORDER BY updated_at DESC
  → open draft (is_draft) if one exists
  → else latest issued (not is_draft, status != 'superseded')
```

Both the existing "Continue Draft / View Quote" button **and** the roster export
call this helper, so "the active quote" has one definition and the multi-quote
case (4 jobs today have >1 quote) resolves the same way the button already does.
Note: key on `quotes.job_request_id` (matches the button), not
`linked_job_request_id`.

---

## 5. Import

Upload the workbook (supports multiple partial loads; idempotent).

### Step 0 — Job-identity guard (run before any write)
A sheet exported for one job must never load onto another. The FK on
`job_request_assignments.job_request_day_id` only checks the day *exists*, not
that it belongs to the job on screen — so without this guard, uploading Job A's
sheet while viewing Job B would silently attach crew to Job A's days.

- **Stamp on export:** the hidden metadata sheet (§3.5) carries `job_request_id`
  + source + timestamp for the machine check; the **Job Info tab** (§3) shows the
  same identity in human-readable form so a coordinator notices a mismatch too.
- **Verify on import (hard stop):** compare the stamped `job_request_id` to the
  current screen's `jobRequestId`. Mismatch → reject the entire upload before any
  write: *"This sheet was exported for Job <A> (<event>). You're uploading to Job
  <B>. Open the right job or re-export."*
- **Per-row defense-in-depth:** even on a matching stamp, every hidden `day_id` /
  `shift_id` must resolve to the target job (`job_request_days.job_request_id =
  target`). A stray id (hand-edited or stale sheet) → flag that row in the
  re-export Status column, never write it to another job.

### Step A — Employees first (so the FK exists before assignments)
For each Employees-tab row with a blank `employee_key`:

- **Match on NAME (weaker match — deliberate).** The existing `employees` table
  has many records with missing/inaccurate phone and email, so requiring a
  phone+email match would fail constantly and produce duplicates — the very thing
  we're avoiding. So the dedup is **name-based**, mirroring the timekeeping
  inline-create gate, using the **same name-token scoring as the EmployeePicker**
  (`employee-picker.tsx` `tokenScore`) for consistency. Phone/email, *when present
  on both sides*, only **boost confidence** in a name match — they are never
  required for one.
- **Where the check runs:** at **import time, as the one interactive on-screen
  step** (Excel can't run "did you mean…?" logic live in the sheet; see Step C).
  For each new Employees-tab row, search the existing roster by name; if a likely match
  exists, show *"'Nick Huth' looks like existing employee 'Nicholas Huth' — link
  instead of create?"* and the coordinator decides. This adds the human confirm the timekeeping name-only-empty
  gate lacks, catching variants (Nick↔Nicholas) it misses.
- **Optional in-sheet hint:** a formula column on the Employees tab (`COUNTIF`/`SEARCH`
  against the hidden existing-roster list) that flags exact/substring name
  overlaps as the coordinator types. A hint only — it can't catch fuzzy variants,
  so the import-preview check remains the real guard.
- On a confirmed match → link to the existing `employee_key` (don't create).
- On no match (or coordinator chooses "create new anyway") → mint
  `emp-<timestamp>`, capture whatever name/phone/email/address the row provides
  (require at least a **name**), default `source='roster-import'`, flag for later
  review. Never delete employees on re-upload.

> Note: the import deliberately does **not** reuse the timekeeping name-only-empty
> gate (which silently creates when no exact name matches — the source of the
> Category-1 dupes in [[project_employee_dedup]]). It uses the same name scoring
> but adds the human "link vs create" confirm. Hardening the timekeeping gate
> itself stays a separate backlog item.

**New-employee name reconciliation.** Excel in-cell AutoComplete can silently fill
First/Last from another row (e.g. "Doe" → "Doeringer") while the Full Name stays
"John Doe". The **Full Name is authoritative** for new employees (it's what the
dropdown binds to): a typed First/Last is kept only if it appears in the Full
Name, else re-derived from it, with a non-blocking warning in the completion
pop-up. Name fields are otherwise never changed from the sheet.

**Contact updates for EXISTING employees (confirm-changed-fields).** For
Employees-tab rows that already have an `employee_key`, the import diffs the
contact fields (phone/email/address/city/state/zip — **not** name) against the DB.
Any field where the sheet is non-blank and differs is surfaced in the same
confirmation modal as a checkbox (default on; phone compared on digits only). Only
checked fields are written; a blank sheet cell never clears a DB value. This
captures corrections/additions a coordinator discovers, while a confirm step
guards against stale-export / typo / autocomplete clobber. `employeesUpdated` is
reported in the completion pop-up.

### Step B — Assignment diff (upsert + delete)
For the target job, compare the sheet's filled slots against existing
`job_request_assignments`:
- Row with an employee → upsert assignment (resolve `employee_key` via the Employees tab),
  carrying day_id / shift_id / position_id / specialty_id / confirmed.
- Existing assignment **no longer present** in the sheet → **delete** it
  (re-slotting). Safe: `timesheet_entries` has **no FK to assignments** (verified)
  — removing an assignment never touches logged time.
- Honor the partial-unique index `(job_request_day_id, COALESCE(shift_id,''),
  employee_key)`: dedupe repeated (day, shift, employee) tuples in the sheet so
  the commit doesn't error.
- Set `created_by = auth.uid()` on new rows.

### Step C — Commit, then re-export as the review/fix loop
**There is no full on-screen preview.** Unambiguous rows commit silently. The only
two surfaces:

1. **On-screen — name-variation decisions only.** The single interactive step:
   for each new name that resembles an existing employee, the "link vs create new"
   prompt (Step A). "Use existing" is the default/easy path; "Create new" is the
   de-emphasized, deliberate choice — friction by design so coordinators don't
   reflexively spawn dupes. Bias the matcher toward *asking*: truly-novel names
   (no plausible match) auto-create with no prompt; anything remotely close gets
   the prompt.

2. **Re-exported workbook — the row-level error/fix artifact.** On completion we
   regenerate and offer the workbook for download, reflecting committed state:
   - **Crew tab** Status column per row: `✓ loaded`, `⚠ skipped — "Grip /
     Rigging" isn't a valid role`, `⚠ skipped — no date`, `role not on this job's
     rate card — verify`, over/under-staffed notes (§3.6), etc. (never any dollar
     figures). Good rows are already committed; flagged rows are right there to
     fix and re-upload (idempotent import reconciles on the next round).
   - **Employees tab** gains `employee_key` for newly created/linked people, so
     the next round matches them instantly.
   - **Job Info + Valid Roles** tabs refreshed (incl. the §3.6 reconciliation
     summary re-checked against the current quote/requirements).
   - Plus a one-line on-screen summary: *"45 slots loaded · 3 employees added · 2
     rows need fixing — see the downloaded sheet."*

This keeps the fix loop in Excel (the coordinators' native tool), never rejects a
whole sheet over one bad row, and never builds a heavy review UI.

---

## 6. Flag-don't-guess edge cases

Surface these as a **Status note on the re-exported sheet** (not silently dropped
or invented), so the row can be fixed and re-uploaded:

1. **Quote line with null `specialty_id`** → no derivable position (position comes
   *through* specialty). Can't build a valid slot. (The Carolina "33 rows missing
   specialty" family.) Quote-source path only.
2. **Quote line with null `quote_date`** → no day to attach the slot to (1 such
   line exists today). Quote-source path only.
3. Requirements path can't hit the date case (needs are already attached to a
   day) but a need lacking position/specialty is flagged the same way.

---

## 7. Build checklist

- [ ] Add `exceljs` dependency.
- [ ] `resolveActiveQuoteForJob(jobRequestId)` helper; refactor `job-requests.tsx`
      button to use it.
- [ ] `lib/storage/crew-roster-export.ts` — build Job Info / Crew / Employees /
      Valid Roles tabs + hidden metadata sheet, validation, pre-fill from
      `loadJobCrewSlots`, §3.6 reconciliation. Reused for the post-import
      re-export (adds Status notes + resolved employee_keys).
- [ ] `lib/storage/crew-roster-import.ts` — parse, name-based employee match/
      create, assignment upsert/delete diff, per-row status results.
- [ ] `JobRequestCrewSection` UI — export-source dialog, name-variation
      decision modal (the only interactive step), post-commit summary + re-export
      download.
- [ ] Reconciliation note (optional): if requirements totals differ from the
      active quote totals, show an advisory banner at export time.

## 8. Decisions confirmed (2026-06-14)

- Source = coordinator's choice of **Requirements or Active Quote** (both
  supported); active quote resolved by the shared button logic.
- Lives on the **Job screen** (coordinators have no quote-screen access).
- **Confirmed** column included; editable via the sheet.
- New-employee dedup is **name-based** (existing phone/email too dirty to require);
  phone/email boost confidence only. Match runs at import time with a human
  "link vs create" confirm. Minimum to create: a **name** (phone/email/address
  captured when provided, not required).
- **No full on-screen preview.** Only name-variation decisions are interactive;
  all row-level data errors are written back into a **re-exported workbook**
  (Status column) for fix-and-re-upload. One bad row never rejects the sheet.
- **"Valid Roles" tab** sourced from the job's rate card drives **cascading
  Position → Specialty** dropdowns on the Crew tab (Position first; Specialty
  limited to that position's specialties). **No rates anywhere in the workbook**
  — coordinators never see bill or pay figures; the rate card is used
  only to decide which roles are valid. Off-card roles flagged "verify", not
  rejected.
- **Job Info tab** (visible) shows client/event/dates/location + the source quote
  used to build the template, so coordinators juggling multiple jobs know which
  one they're in. The **hidden metadata sheet** is kept too — it's the machine
  stamp the import guard reads.
- **Requirements reconciliation** runs on export *and* re-export: re-check the
  current quote/requirements, flag over-staffed roles (Quote A wanted 5 riggers,
  Quote B wants 3 → "2 over") in Crew-tab Status + a Job Info roll-up. Extras are
  never auto-deleted — coordinator decides.
- **Job-identity guard:** workbook is stamped with `job_request_id` on export;
  import hard-rejects a mismatch and verifies every day/shift id belongs to the
  target job (the FK alone doesn't enforce this).
- Crew assignments are **not** linked to timekeeping — delete-on-reupload is safe.
- Concurrency / multi-coordinator: out of scope (treated as one coordinator per
  job).

## 9. Open for later (not Phase 1)

- Multi-job import from a master scheduling sheet (different entry point;
  disambiguate by job_no) — the [[project_crew_import]] v2 direction.
- In-app outreach / confirm / reject tracking replacing the spreadsheet.
- Building the employee dedup guard into the maintenance screen itself
  ([[project_employee_dedup]]) — independent of this feature.

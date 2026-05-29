# Phase 6 — Post-cutover smoke

Goal: confirm V2 is actually working on prod for the real workflows.

Prereq: Phase 5 complete, Vercel build green, app loading on prod URL.

If `docs/smoke-test*.md` exists, that's the canonical checklist. This
file is the V2-cutover-specific abbreviated version.

---

## Step 6a — Login + nav sanity

- [ ] Login works
- [ ] Nav renders all expected sections (Jobs / Quotes / Invoices /
      Timekeeping / Payroll / Maintenance / Master Calendar)
- [ ] No console errors on home page

---

## Step 6b — Quote flow

- [ ] Open Quotes list — renders all rows + quote_no codes
- [ ] Open a frozen quote detail — PDF preview works
- [ ] Click "Revise" on a frozen quote — new draft created
- [ ] Edit draft, change a line total — autosave fires
- [ ] Issue draft — promotes to frozen, supersedes parent

---

## Step 6c — Invoice flow

- [ ] Open Invoices list — renders all rows including PROJECTED # on drafts
- [ ] Open a frozen invoice detail — PDF preview works
- [ ] Create deposit invoice from quote — no line items, header amount
- [ ] Create final invoice from quote — lines seeded from quote
- [ ] Pull from Timesheets on a final draft — labor aggregates correctly
- [ ] Record payment — auto-flip to status='paid' triggers

---

## Step 6d — Job request + crew flow

- [ ] Open Jobs list — job_no codes render
- [ ] Open a job — Days / Crew Needs / Assigned Crew / Shifts / Attachments tabs all load
- [ ] Toggle holiday day flag — recalcs cascade to quote_days
- [ ] Add a crew assignment — appears under the right day
- [ ] Add a shift — quote/invoice lines can pick it

---

## Step 6e — Timekeeping

- [ ] Open Timekeeping → pick a Job (job_request, not legacy job_sheet)
- [ ] Add Crew from Job — seeds entries from assignments
- [ ] Submit + approve an entry — freeze trigger kicks in (no edit)
- [ ] Holiday flag toggle on row — multiplier applies, OT/DT inputs disabled
- [ ] Bulk select + batch approve works

---

## Step 6f — Payroll

- [ ] Open Payroll list
- [ ] Create a new run — candidate query returns eligible entries
- [ ] Add entries to run — payroll_run_id stamped, entries super-frozen
- [ ] Finalize — refuses if any pay_std_rate = 0
- [ ] Print PDF — renders

---

## Step 6g — Maintenance

- [ ] Master Rate Card editor — Pay columns + holiday multiplier visible
- [ ] Client maintenance — Jobs / Quotes / Invoices / Calendar tabs all populated
- [ ] Employee Directory — hire_date editable, Pay Rate Override section visible
- [ ] Company Info tab — singleton row editable

---

## Step 6h — Final integrity sanity

Re-run `docs/data-integrity/01_audit_drafts.sql` on prod.

Expected: every count = 0.

Re-run `docs/data-integrity/00_prod_preflight_audit.sql` Section 8.

Expected: row counts match end-of-Phase-2 baseline plus any rows added
by smoke testing.

---

## Phase 6 complete when

All boxes above checked.

If anything fails: log the issue, decide whether to roll back (rare —
PIT restore from Phase 0a backup) or hot-fix forward.

---

## Post-cutover follow-ups

Spawn separate sessions for:
- Walking Connor through frozen + deposit audit worksheets (Phase 4d/4e)
- Any free-text orphan rows surfaced by Phase 3 Section B
- Memory cleanup pass on `project_todo.md` (items now complete)

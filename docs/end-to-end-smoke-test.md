# End-to-End Smoke Test — V2 Preview

Use this checklist when validating the dev Preview against the V2 work
before the prod cutover. Run as one cohesive dry-run job ("Smoke Test Co
— 2026-08-15" or similar) so it's easy to wipe afterward.

Tester: ____________________________  Date: ____________

Build commit: ____________________________ (top of `git log`)

---

## Phase 1 — Client setup

- [ ] Maintenance → Clients → **New Client**: enter name, 3-letter code
      (e.g. `SMK`), contact info, billing address. Save.
- [ ] Confirm new row appears in the client list with `is_active=true`.
- [ ] **Add a client contact** (role = billing) — needed for later
      invoice addressing.
- [ ] Maintenance → Rate Cards → **New Rate Card** for this client.
  - [ ] Set `effective_date` to today or earlier.
  - [ ] Change at least one specialty's **bill** hourly/OT/DT so they
        differ from the master default (proves the rate-card BILL
        values flow through, not a placeholder).
  - [ ] On the SAME rows, set **pay** Hourly / OT / DT to non-zero
        values (e.g. base $25, OT $37.50, DT $50). These get pulled
        into payroll runs later. Leave at least ONE specialty with
        pay rates at $0 so we can verify the payroll "needs rates"
        banner.
  - [ ] Save.

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 2 — Job request

- [ ] Job Requests → **New**. Pick the client.
- [ ] Confirm the **rate-card label** under the picker shows the new
      card you just created (not "Master Default").
- [ ] Fill event name (≤40 chars), venue, city/state.
- [ ] Pick a **2-day** start/end so multi-day features get exercised.
- [ ] Save → confirm `job_no` populates and status is `lead`.

### Duplicate warning

- [ ] Open **New** again, pick the same client + same start date.
- [ ] Confirm the **amber "Possible duplicate" panel** appears with the
      job you just saved.
- [ ] Click **open** on the candidate → form swaps to that job.
- [ ] Cancel out (don't save the duplicate).

### Header-vs-days mismatch warning

- [ ] On the saved 2-day job, drop the header end date back by one day.
      Confirm the amber **"Header dates don't match day rows"** warning
      appears.
- [ ] Restore the original end date → warning clears.

### Days, crew, shifts

- [ ] **Days tab**: confirm both day rows appear. Tick the 🎄 Holiday
      checkbox on **one** day.
- [ ] **Crew Needs tab**: add 2–3 (position × specialty) rows with qty
      + hours on each day. Include at least ONE row whose specialty has
      $0 pay rates (set up in Phase 1) so the payroll banner fires
      later.
- [ ] **Shifts tab**: add at least two shifts (e.g. `Load In`, `SHOW`).
- [ ] **Assigned Crew tab**: add a few confirmed assignments from real
      employees. At least one should be an employee whose
      `pay_std_rate` is NULL (no override) so the rate-card path gets
      exercised in payroll.
- [ ] **Attachments tab**: upload any file, pick **Timesheet** as the
      doc type → confirm no CHECK constraint error and the new option
      appears in the dropdown.

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 3 — Initial quote

- [ ] From the job → **Save + Create Quote**.
- [ ] Quote draft editor opens. Verify:
  - [ ] Lines pre-seeded from crew needs.
  - [ ] **Rates match the rate card you created** (not the master
        default placeholder).
  - [ ] The holiday-flagged day shows the 🎄 badge.
  - [ ] Toggling holiday on a different day recomputes line totals.
  - [ ] Holiday multiplier is editable (default 2.0).
- [ ] Adjust qty/hours on one line — total recomputes.
- [ ] **Issue Quote** → confirm frozen, `quote_no` assigned, lines
      become read-only.
- [ ] From the issued quote → confirm "Source Job" link routes back to
      the job.

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 4 — Job change + sync to quote

This phase exercises the new "Sync from Job" workflow.

- [ ] From the issued quote → **Revise** → a new draft opens with
      `_REV2` projected number.
- [ ] Confirm the revision-draft starts with the parent's lines.
- [ ] Go back to the job → bump one position's quantity (e.g. 5 → 7),
      add an extra position, **and add a third day with one crew need
      on it** (exercises the day-added path). Save the job.
- [ ] Return to the revision draft (Job → Continue Draft).
- [ ] Click **⟳ Sync from Job** in the Line items header bar.
- [ ] Confirm the dialog warns about replacing lines + losing manual
      edits. Click OK.
- [ ] Verify the post-action alert reports the line-count delta
      (e.g. "8 → 10 lines").
- [ ] Verify the new lines reflect the **updated job** (new qty, new
      position, third day appears).
- [ ] (Optional) Remove the third day on the job, return to the draft,
      click Sync again → confirm the day-3 strip + its lines vanish
      cleanly (no ghost day in the editor).
- [ ] **Issue Revision** → confirm parent flips to `superseded` and new
      quote has `_REV2` suffix.

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 5 — Deposit invoice + Record Payment

- [ ] From the (revised) issued quote → **Generate Deposit**.
- [ ] Deposit draft editor opens.
- [ ] Confirm subtotal = quote total × deposit_pct (rounded to cents).
- [ ] **Issue Invoice** → confirm frozen, `invoice_no` ends `_DEP`.
- [ ] **Mark Sent** → status flips to `sent`.

### Record a payment

- [ ] Click **Record Payment** → modal opens with amount pre-filled to
      the current balance due.
- [ ] Set payment date (today), method (e.g. `check`), reference # (any
      string), memo (optional). Save.
- [ ] Verify the **Payments** panel below the pricing summary now
      shows the new row with date, method, reference, amount.
- [ ] Verify status auto-flipped to **paid** (no Mark Paid button
      anymore — the auto-paid trigger fires when paid_amount covers
      the balance).
- [ ] Verify the Pricing summary now shows `Paid: −$X` and Balance
      due: `$0.00`.

### Partial payment + Void (optional but recommended)

- [ ] Skip these if you only want to test the happy path.
- [ ] On a fresh invoice (or temporarily Revise this one), click
      Record Payment but set the amount to LESS than balance due
      (e.g. half). Save.
- [ ] Confirm Payments panel shows the partial row; status stays
      `sent` (NOT paid); balance shows the remaining amount.
- [ ] Record a second payment for the remainder → status now flips
      to `paid`.
- [ ] In the Payments panel, click **Void** on one of the payments →
      confirm the running total + balance due recompute and status
      reverts to `sent`.

### One-active-deposit-per-job guard

- [ ] On the same issued quote → click **Generate Deposit** again →
      confirm it's blocked (the partial unique index allows only one
      non-superseded/non-void deposit per job).

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 6 — Timesheets

- [ ] **Timekeeping** → pick the canonical Job from the dropdown.
- [ ] Click **Add Crew from Job** → confirm rows seed with:
  - [ ] One per (assigned employee × day × shift)
  - [ ] Position + Specialty + Shift IDs all populated
  - [ ] Times default from each day's start/end
  - [ ] Holiday rows show 🎄 and the row's pay multiplier
- [ ] Fill in actual times on each row → totals + ST/OT/DT split
      compute.
- [ ] Verify a holiday row's pay = `totalHours × stdRate × 2`.
- [ ] **Submit + Approve** a few rows individually.
- [ ] **Pending Review** section → bulk Approve the rest.
- [ ] Confirm the **Labor Summary for Invoices** panel shows totals
      matching the approved rows.

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 7 — Final invoice (THE big test)

- [ ] From the issued quote → **Generate Final**.
- [ ] Final draft editor opens with lines copied from the quote.

### Deposit auto-applies on final-draft creation

This is the most important math check in the whole walkthrough. The
final invoice's `depositApplied` field is filled at draft creation from
the issued deposit invoice's subtotal — operator does not have to apply
it manually.

- [ ] Verify the header / summary panel on the new final draft shows:
  - [ ] **Subtotal**: matches the quote total (sum of seeded lines)
  - [ ] **Deposit applied**: −(the issued deposit's amount)
  - [ ] **Balance due**: subtotal − deposit applied
- [ ] If the math is off by a cent, flag it (rounding edge cases on odd
      deposit percentages).

### Overwrite from Timesheets

- [ ] Click **Overwrite from Timesheets**.
- [ ] **Verify the post-action alert** reports:
  - [ ] `N new lines from M of T approved entries`
  - [ ] `K manual lines preserved` (0 expected this round)
  - [ ] No warnings if data is clean
- [ ] **Verify the resulting lines:**
  - [ ] Rates match the **rate card** (not 35/52/70 pay rates)
  - [ ] Hours match the timesheets (ST/OT/DT split + crew count)
  - [ ] Holiday day lines bill at 2× rate
  - [ ] Subtotal is sane and = sum of line totals
- [ ] Scroll past line items → **Approved Timesheet Actuals
      (comparison)** panel shows the same hours grouped by position,
      **no pay column**.

### Manual-line preservation

- [ ] Add a manual line ($100 misc charge or similar). Save draft.
- [ ] Click **Overwrite from Timesheets** again.
- [ ] Verify the alert reports `1 manual line preserved`.
- [ ] Verify the manual line is still there, with new timesheet lines
      sorted after it.

### Issue + Pay

- [ ] **Issue Invoice** → frozen, `invoice_no` ends `_INV`.
- [ ] **Mark Sent** → status flips to `sent`. Balance due unchanged
      (still = subtotal − deposit applied).
- [ ] **Record Payment** for the full balance → Payments panel shows
      the row; auto-paid trigger flips status to `paid`; balance due
      now $0.

### End-of-job state check

- [ ] Open the deposit invoice → confirm `paid`.
- [ ] Open the final invoice → confirm `paid`, balance $0.
- [ ] On the job → confirm both invoices listed and both marked paid.

### Out of scope today (no UI yet — flag if Connor asks)

- One customer payment allocated across multiple invoices (one check
  covering both the deposit and the final). Today each invoice tracks
  its own payments independently.
- Overpayment routing excess to the credit ledger.
- Apply Credit button on an open invoice (only appears when the client
  has a non-zero credit balance, which today can only get there via the
  missing overpayment flow above).

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 8 — Final invoice revise (auto-release entries)

- [ ] On the issued final invoice → **Revise**.
- [ ] New draft appears; original flips to `superseded`.
- [ ] On the new draft → click **Overwrite from Timesheets**.
- [ ] Verify the entries from the superseded invoice are **available
      again** and land on the new lines cleanly. (This proves the
      auto-release trigger fired on supersede.)
- [ ] **Issue Revision** → confirm `_REV1` (or higher) suffix.
- [ ] Re-pay if needed using Record Payment (since the new revised
      invoice has its own balance).

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 9 — Payroll (Phase 1)

Tests the new paydate runs workflow. Entries from the timesheet job
above flow into a payroll run, get pay rates resolved, and finalize.

### Pay-rate setup verification

- [ ] Maintenance → Employees → pick one assigned employee → set
      **Pay Std Rate** to a specific number (e.g. $30). Save. (This
      employee should land in the run with that override.)
- [ ] Leave at least one other assigned employee's pay override blank
      so we verify the rate-card fallback (the rate-card pay columns
      set up in Phase 1).
- [ ] Confirm the specialty whose rate-card pay is $0 (from Phase 1)
      will be on the run — that row should land with $0 pay and trip
      the "needs rates" banner.

### Create a payroll run

- [ ] Navigate to **Payroll** in the nav → list view loads.
- [ ] Click **+ New Run** → candidate picker page opens.
- [ ] Set date filters covering the smoke-test job's work dates.
      (Leave job + employee filters empty for now.)
- [ ] Click **Search** → confirm the approved entries from Phase 6
      appear in the grid. Each row should show employee, job, hours,
      employment type.
- [ ] Verify **already-paid entries are excluded** — if you re-search
      after creating a run later, those entries shouldn't reappear.
- [ ] Set **Pay date** (today), optionally Period start/end + notes.
- [ ] Leave all rows checked (default). Click **Create Run**.
- [ ] Routed to the run detail page; run appears in `draft` status.

### Verify pay-rate resolution

- [ ] Each row should show a **Base $/hr** input.
- [ ] The employee whose `pay_std_rate` override you set should show
      that value (e.g. $30) with a source badge / hint indicating
      `employee` override.
- [ ] Employees without overrides should show the **rate card** pay
      value for their (specialty, job).
- [ ] At least one row should show `$0` → trips the yellow **"needs
      rates"** banner above the entries table.
- [ ] OT/DT rates auto-derive as base × 1.5 / base × 2 (e.g. base $30
      → OT $45, DT $60).
- [ ] Holiday rows compute `totalHours × base × multiplier` (OT/DT
      premium does NOT stack on holiday rows).

### Try to finalize while unrated

- [ ] Click **Finalize** → should error (or be disabled): "Cannot
      finalize — N entries have no base pay rate set."

### Set the missing rate + recalculate

- [ ] Type a base rate into the $0 row's input. OT/DT/Total Pay update
      live in that row.
- [ ] (Optional) Click **🔁 Recalculate rates** → confirms every row's
      OT/DT are normalized at 1.5×/2× of base, totals refreshed.
- [ ] Verify run-header totals (entry count, employee count, total
      hours, total pay) match the entry rows.

### Source entry super-freeze

- [ ] Open Timekeeping for the same job in another tab.
- [ ] Find one of the entries that's now on the payroll run → confirm
      it shows a "🔒 Billed/Payroll" lock state (the trigger super-
      freezes the source while it's on a non-voided run).
- [ ] Try to edit a content field on the locked entry → DB error
      reported in console (UI input should be disabled).

### Finalize → Reopen → Re-finalize

- [ ] Yellow banner now gone. Click **Finalize** → status flips to
      `finalized`. Entries become read-only on the run (greyed out).
- [ ] Click **Reopen** → status drops back to `draft`; entry inputs
      become editable again.
- [ ] Click **Finalize** again → back to `finalized`.

### Print

- [ ] Click **Print** (or open `/payroll/[id]/pdf`) → preview opens
      with one row per entry: employee, work date, position, hours,
      base rate, OT/DT rates, total pay; run totals at the bottom.
- [ ] (Optional) `Cmd+P` → save as PDF for archive.

### Void → entries released

- [ ] Click **Void** → enter a reason → confirm.
- [ ] Status flips to `voided`. The detail page should reflect that.
- [ ] Open Timekeeping for the same job → confirm the source entries
      are no longer locked (super-freeze released by the void cascade
      trigger).
- [ ] Navigate back to **Payroll → New Run** → run the candidate
      search again → confirm the previously-voided entries reappear
      as candidates.

### Out of scope today (Phase 1 only — future payroll project)

- Pay periods + automatic period generation.
- Export to Gusto / ADP / QB CSV.
- Per-employee pay stubs.
- Tax withholding calculations.
- Direct deposit / ACH file generation.

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 10 — PDFs

- [ ] Open the PDF view for each issued document. Confirm each renders
      cleanly and shows the right content:
  - [ ] Initial quote
  - [ ] Revised quote (_REV2)
  - [ ] Deposit invoice
  - [ ] Final invoice
  - [ ] Revised final invoice
  - [ ] Payroll run (finalized version)
- [ ] Letterhead, dates, lines, holiday badges, terms, signature blocks
      all present.

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Out of scope (NOT tested here)

- `job_requests` → `jobs` rename (Phase B — after Connor's review)
- Quote/invoice email-out (separate project)
- Online signature flow (separate project)
- Customer-payment allocation across multiple invoices (Phase C+ work)
- Communications / calendar integrations
- Payroll exports + tax (future payroll project)

---

## Sign-off

- [ ] All checked, no blocking issues — ready for the V2 cutover batch
- [ ] Blocking issue found — see notes per phase

Reviewer signature: __________________________

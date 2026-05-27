# End-to-End Smoke Test — V2 Preview

Use this checklist when validating the dev Preview against the V2 work
before the prod cutover. Run as one cohesive dry-run job ("Smoke Test Co
— 2026-08-15" or similar) so it's easy to wipe afterward.

Tester: ____________________________  Date: ____________

Build commit: ____________________________ (top of git log)

---

## Phase 1 — Client setup

- [ ] Maintenance → Clients → **New Client**: enter name, 3-letter code
      (e.g. `SMK`), contact info, billing address. Save.
- [ ] Confirm new row appears in the client list with `is_active=true`.
- [ ] **Add a client contact** (role = billing) — needed for later
      invoice addressing.
- [ ] Maintenance → Rate Cards → **New Rate Card** for this client.
      - [ ] Set `effective_date` to today or earlier.
      - [ ] Change at least one specialty's hourly/OT/DT rates so they
            differ from the master default (proves the rate-card values
            flow through, not the placeholder).
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
      + hours on each day.
- [ ] **Shifts tab**: add at least two shifts (e.g. `Load In`, `SHOW`).
- [ ] **Assigned Crew tab**: add a few confirmed assignments from real
      employees.
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

## Phase 4 — Job change + sync to quote (NEW)

This phase exercises the new "Sync from Job" workflow. Skip if the
client hasn't requested a change in your test scenario.

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

## Phase 5 — Deposit invoice

- [ ] From the (revised) issued quote → **Generate Deposit**.
- [ ] Deposit draft editor opens.
- [ ] Confirm subtotal = quote total × deposit_pct (rounded to cents).
- [ ] **Issue Invoice** → confirm frozen, `invoice_no` ends `_DEP`.
- [ ] **Mark Sent** → status flips to `sent`.
- [ ] **Record Payment** for the full deposit amount → status flips to
      `paid`.

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

- [ ] **Issue Invoice** → frozen, `invoice_no` ends `_INV`.
- [ ] **Mark Sent** → balance shows = total − deposit applied.

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

Notes / issues:

```
______________________________________________________________________
______________________________________________________________________
```

---

## Phase 9 — PDFs

- [ ] Open the PDF view for each issued document. Confirm each renders
      cleanly and shows the right content:
      - [ ] Initial quote
      - [ ] Revised quote (_REV2)
      - [ ] Deposit invoice
      - [ ] Final invoice
      - [ ] Revised final invoice
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

---

## Sign-off

- [ ] All checked, no blocking issues — ready for the V2 cutover batch
- [ ] Blocking issue found — see notes per phase

Reviewer signature: __________________________

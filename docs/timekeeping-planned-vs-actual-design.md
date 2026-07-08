# Timekeeping Redesign — Planned vs. Actual (and how Time Clock fits)

Status: **Design — agreed direction, not started** (2026-07-08)
Owner: jobrien

---

## TL;DR

Today the crew-assignment import copies **scheduled** times into the timesheet's **actual** time columns, so the two are conflated in one place. This is the root of several problems (a kiosk can't tell planned from actual, no-shows can be billed for scheduled hours, and whole crews get identical "actual" times that are really just the plan).

**The fix — separate the two by where they live:**

- **Planned** = the **crew-assignment** setup (extended with optional per-worker planned times). This is also where advance scheduling of a whole job belongs.
- **Actual** = the **timesheet** record (filled by the crew leader or the Time Clock kiosk).

The business keeps working exactly as it does now — same data captured, same sign-in sheet, same invoices/payroll — just entering planned info on the crew-assignment screen, with an explicit **"copy planned → actual"** button preserving today's pre-fill convenience. The **Time Clock** kiosk then layers cleanly on top as the *actual*-capture surface.

---

## 1. Background — the problem

`timesheet_entries` is an overloaded record: it drives **timekeeping**, **payroll**, and **invoicing**. Into that same record, the crew-assignment import (`addCrewFromJob` → `loadJobCrewSlots`) copies each worker's row and seeds the **scheduled** day times into the **actual** columns:

```
time_in1  ← job_request_days.start_time   (scheduled)
time_out1 ← job_request_days.end_time     (scheduled)
time_in2 / time_out2 ← left blank
```

So "planned" and "actual" share `time_in1..out2`. Consequences:

- **The Time Clock kiosk can't distinguish them** — a scheduled 16:30/01:30 looks identical to a real sign-in, so a worker's Shift 1 appears already "done" and the kiosk pushes them into Shift 2 (observed in testing).
- **No-show over-billing risk** — an imported row that's never edited keeps the *scheduled* times → computes hours → can bill for time not worked.
- **"Actuals" are often the plan** — whole crews are recorded with byte-identical times (see §2), i.e. the scheduled window applied to everyone, not individually-observed actuals.

---

## 2. What production shows (evidence)

Analysis of **2,242** production `timesheet_entries` (`amplified-aos`, 2026-07-08):

| Fill pattern | Rows | % |
|---|---|---|
| Pair 1 only (single in/out) | 1,523 | 67.9% |
| **All four (two pairs)** | **82** | **3.7%** |
| In 1 only (clock-in, no out) | 280 | 12.5% |
| No times at all | 342 | 15.3% |

**All-four rows** break into two real behaviors, and **43% cross midnight**:
- **~43%** are a **meal-break split** — ~1-hour gap between `out1` and `in2`.
- **~38%** are a **genuine second shift** — >4-hour gap.
- (gap `out1`→`in2`: median 60 min, mean 235 min.)

**Representative example** — June 28, sixteen stagehands, every row identical:
```
pair 1: 08:00–13:00     pair 2: 14:00–19:00     (work 8–1, lunch 1–2, work 2–7)
```

**Interpretation:**
1. The **two-pair** structure is genuinely used (meal splits + second shifts) — the kiosk's four-slot model is correct.
2. Identical whole-crew rows mean today's "actual" is frequently the **planned window applied to everyone** — the exact gap the kiosk closes by capturing per-person sign-ins + signatures.
3. Missing-punch (12.5% in-only) and no-times (15.3%) are common — so incomplete/no-show handling and a wrong-day guard genuinely matter.

---

## 3. Schema facts (verified)

**Planned side** — where the schedule lives today:

- **`job_request_assignments`** (one row per **worker × day × shift**): `employee_key`, `position_id`, `specialty_id`, `shift_id`, `confirmed`, `notes`, `sort_order`, `job_request_day_id`. **No time columns.**
- **`job_request_days`**: `event_date` (date), `call_time`, `start_time`, `end_time` (text), `expected_hours`, `is_holiday`. Day-level times, **populated on 44/46 days (96%)**.
- **`job_request_shifts`**: `label`, `sort_order`, `is_active`. **No time columns** — pure naming buckets, job-scoped.

**Actual side** — what the timesheet adds over crew assignments:

| Category | Columns | In crew assignments? |
|---|---|---|
| Identity ("planned") | `employee_key`, `position_id`, `specialty_id`, `shift_id`, `work_date` | ✅ yes |
| **Actual times** | `time_in1/out1/in2/out2`, `lunch_minutes`, `meal_break_1/2_minutes`, `end_date` | ❌ no |
| Computed pay/bill | `std/ot/dt/total_hours`, `bill_std/ot/dt_rate`, `bill_total`, `bill_ot_after`, `bill_dt_after`, `holiday_multiplier` | ❌ no |
| Workflow/state | `status`, `staff_finalized(_at)`, `notes`, `sort_order`, audit | ❌ no |
| Downstream links | `timesheet_id`, `invoice_line_id`, `payroll_run_id`, `user_id`, `job_id` | ❌ no |
| Snapshots | `first_name`, `last_name`, `phone`, `email`, `job_name`, `position` (text) | ⚠️ derived |

**Conclusion:** crew assignments (+ their day) already are a complete *planned* record of who/role/shift/date. Everything the timesheet adds is legitimately **actual, computed, workflow, or billing**. The **only** planned data wrongly copied into the actual columns is the scheduled times.

---

## 4. The model

> **Planned lives on crew assignments. Actual lives on the timesheet.**

- **Planned = crew assignments**, extended with optional **per-worker planned times**. This is also the home for **advance scheduling** of an entire job.
- **Actual = timesheet** — filled by the crew leader (hand-entry) or the Time Clock kiosk.
- The Time Clock kiosk writes *actual* and reads *planned* as hints.

This dissolves the conflation: on any screen, you know which is which by **which record it's in**, not by guessing.

---

## 5. The changes

### 5.1 Planned times on crew assignments
Add optional, **two-pair** planned times to `job_request_assignments`, mirroring the timesheet shape:
```
planned_in1, planned_out1, planned_in2, planned_out2   (all nullable)
```
- **Per worker × day × shift** (the assignment's existing grain) → an individual advance schedule across the whole job, incl. "back at 14:00."
- **Nullable** — leave blank when unknown; fill when known.
- **Fallback to the day window** (`job_request_days.start_time/end_time`) for display and for the copy button, so the common whole-crew-one-window case needs no per-person entry.
- A **shift-level** default window is a possible future convenience, but the **assignment** is the meaningful granularity for "tell *this* crew member when *they're* needed."

### 5.2 Print the sign-in sheet from crew assignments
Move the printed sign-in sheet to the crew-assignment side. Assignments (+ day + planned times) hold everything the sheet needs — names, positions, specialties, shifts, dates, expected times, blank signature/time lines. Bonus: it can be printed at **scheduling time**, before any timekeeping entry — which was the real reason we copied to timekeeping early.

### 5.3 Import brings actuals over blank
Change the import (`addCrewFromJob`) to copy **everything it does today except the times** — identity, position/specialty/shift, `work_date`, bill rates + OT/DT thresholds, holiday flag, `status`, timesheet link — and leave `time_in1..out2` **blank**. (Literally: set the two `timeIn1/timeOut1` seed lines to `""`.)
- Rows are still billing-ready the instant times are entered.
- **Safer than today:** a no-show left untouched is correctly 0 hours, not scheduled hours.

### 5.4 "Copy planned → actual" button
An explicit button on the timekeeping screen that pulls planned times into the actual columns on demand (both pairs), **falling back to the day window** when a worker has no per-assignment planned times. This preserves today's pre-fill convenience — as a deliberate action, not a silent conflation.

### 5.5 Downstream unchanged
Payroll, invoicing, and job-costing keep reading the **actual** `time_*`/hours exactly as they do now. No change to those consumers — which is what keeps the blast radius small.

---

## 6. Why the business runs the same

- Same data captured, same sign-in sheet printed, same invoices and payroll.
- The only workflow change: planned info is entered on the **crew-assignment screen**, and the crew leader either starts blank or clicks **"copy planned."**
- Blank-by-default is strictly safer (no phantom no-show billing).
- It's **real work** — planned-time fields + UI on the assignment tab, the import tweak, the copy button, and a new print view — but none of it changes *how* the business operates or what downstream sees.

---

## 7. How Time Clock fits (the actual-capture layer)

The kiosk is the *actual*-capture surface on top of this model. Full kiosk design (four-slot state machine, signatures, `timesheet_captures` audit table, timezone handling, provenance badge, phases) is in **`docs/aos-timeclock-spec.md`**. Key intersections with this redesign:

- **Reads planned as a hint** — e.g. "expected in 08:00 · back 14:00" from the assignment's planned times.
- **Writes actual** — the same `time_in1..out2` fields, via the existing compute/save path, so records are identical to hand-entered ones; plus a raw-instant + signature audit row in `timesheet_captures`.
- **Auto-day / "which shift block is active now":** derive from the planned day/shift window (`start_time`→`end_time`), crossing midnight via `end_date`. Show only the block whose window contains *now* (± grace); no free day dropdown.
- **Wrong-day stopper:** a row is punchable only if **today ∈ `[work_date, end_date]`** — which also handles the 43% of two-pair rows that cross midnight, since `end_date` is already set.
- **Guards:** show the date in the sign/confirm dialog; warn on an implausible time (far outside the window) or a near-instant in→out.
- Because actuals now start **blank**, the kiosk's "empty = not signed in" premise holds again — the bug from testing is gone.

---

## 8. Open decisions

- **Planned storage shape:** two-pair columns on `job_request_assignments` (recommended) vs. a child table for arbitrary segments. Two-pair matches how time is actually recorded (§2).
- **Shift-level default times:** worth adding to `job_request_shifts` only if shifts have consistent per-label windows; otherwise skip (assignment + day cover it).
- **Sequencing:** the planned-scheduling work and the kiosk **compose cleanly** — actual/kiosk don't depend on how rich planned gets. Either can go first. If advance crew scheduling is a near-term goal in its own right, do §5 first.
- **Signature granularity** and other kiosk specifics: see `aos-timeclock-spec.md`.

---

## 9. Sequencing / phases

- **Phase 0 — Planned/Actual rework (this doc):** planned-time fields + UI on crew assignments, import-blank, copy-planned button, print-from-assignments. *Prerequisite for a correct kiosk.*
- **Phase 1 — Time Clock kiosk:** built (currently parked on local branch `feature/timeclock-phase1`), to be re-applied on top of Phase 0. See `aos-timeclock-spec.md`.
- **Phase 2 — Provenance badge on the timekeeping screen + PDF of the timesheet with signatures** (+ email to client).
- **Phase 3 — Admin view of capture data + record maintenance** (e.g. delete a mistaken capture).

---

## Appendix — analysis source

Production numbers in §2 from `timesheet_entries` on `amplified-aos` (ref `wmssllfmahotppoyxxrr`), 2026-07-08, via the Supabase Management API (read-only). Schema in §3 from `information_schema.columns` on `amplified-aos-dev`. Environment/workflow reference: dev = `amplified-aos-dev` + GitHub `dev` branch → Vercel preview → promote to prod.

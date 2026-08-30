# Day Rates in Payroll — Design

**Status:** Design settled, one open question · **Updated:** 2026-08-30 · **Owner:** John

---

## The rule

**On a day-rate job day, payroll pays the day-rate number of hours. Always. Regardless of actual hours worked.**

No comparison, no floor, no max. A straight assignment.

Why: on day-rate jobs the crew checks in and stays **on call** across the whole span — they are used sporadically, not worked continuously. The 17 hours on the Neon Nights timesheet is elapsed on-call time, not labor. That is precisely why the job is priced as a day rate. So actual hours are the wrong input, and comparing against them is meaningless.

---

## How it works

Payroll already keeps its own copy of timekeeping. `payroll_run_entries` stores two sets of hours:

| Bucket | Meaning |
|---|---|
| `std_hours` / `ot_hours` / `dt_hours` | what they actually worked — **left untouched** |
| `pay_std_hours` / `pay_ot_hours` / `pay_dt_hours` | what they get paid for — **set to the day-rate hours** |

Pay is computed off the pay buckets (`recomputePayFromBase`), so the timesheet stays truthful while payroll pays the flat day.

On a day-rate day:

```
pay_std_hours = dayRateHours
pay_ot_hours  = 0
pay_dt_hours  = 0
pay_adjustment_reason = "Day rate (N hrs)"
total_pay = dayRateHours x pay_hourly
```

Stagehand: `10 x $25 = $250`.

### Where the hours number comes from

**Today (works, with one hole):** derived on the billing side (`lib/rates/timesheet-group-pricing.ts`):

```
floor = Math.round(baseDay / baseHourly)
```

- Neon Nights labor: `330 / 33` = **10 hrs**
- Neon Nights 8/11 half day: `165 / 33` = **5 hrs**
- CCMF: `350 / 35` = **10 hrs**

Half days fall out automatically — a half-day line derives 5 hours, so a half day billed pays a half day. No separate half-day rule needed.

**The hole:** when `base_hourly` is blank on a day-rate line the division is skipped and the code falls back to a **hardcoded 10** — a number nobody entered. On this job the Crew Chief lines are exactly that (`base_day` $400, `base_hourly` 0). Tolerable while it only affects billing; not tolerable once it decides what people are paid.

**Target state (backlog, added 2026-08-30):** store the covered hours as an explicit numeric field — quote-line level, defaulted from the rate card. Derivation stays only as a backfill for legacy rows.

Per John after speaking with Connor: the field is a plain **number of hours** ("day hours" / "flat hours"), not a day/half-day enum. Connor keys in 10, 5, 8 or 6 and can sell a block of whatever size he wants. Keep **Day / Half Day** as UI labels where it helps — that is the industry phrasing and the crew understand it — but the stored value is just hours. Half day then stops being a special case; it is simply a smaller number, and 8- or 6-hour sold blocks become expressible.

Bill and pay read the same field, so they cannot drift.

### Where day-rate mode comes from

From `quote_lines.rate_mode`, carried through to the payroll run — **not** a manual toggle.

Manually-maintained fields in this system don't get maintained (44 jobs still "quoted" after being invoiced; only 6 ever reached "booked"). The quote is reliable because it's client-facing. A toggle remains as an **override** for exceptions, at job-within-run level plus per-row.

### Existing daily rules

The 5-hour minimum and whole-hour round-up are **replaced**, not stacked — the day-rate number is the answer. A no-show (0 actual hours) still pays 0.

---

## Weekly 40-hour OT — RESOLVED 2026-08-30

**Decision (John, after Connor):** the weekly 40-hour OT rule applies to **employees only**. Contractors never get it. `employees.employment_type` is being cleaned up and will be authoritative — in the real world there are roughly **6 actual employees**; the rest converted to contractors by choice.

Exceptions (state law, an individual's contract) are handled by **manually overriding hours on the payroll run**.

This resolves the mixed-week problem for almost everyone. Previously open A/B/C options only matter for the ~6 employees.

### Blocker 1 — the manual override does not exist (DEFERRED 2026-08-30)

**Pay hours cannot be edited on a payroll run today.** Verified:

- No file under `components/` or `app/` references `pay_std_hours` at all — the run detail renders it as plain text (`payroll-run-detail.tsx:922`), not an input.
- The only exported mutators on a run entry are `updatePayrollRunEntryBaseRate`, `removeEntryFromRun`, `removeZeroHourEntriesFromRun`.
- `pay_std_hours` is written only by run creation, add-entries, and the spill inside `finalizePayrollRun`.

The only lever today is the **base rate**. Using it to force a total is actively harmful: `buildRipplingCsv` exports hours and rates as separate columns, so a fudged rate sends wrong hours *and* a wrong rate to actual payroll processing, and the row then misstates the person's real rate.

**Resolution (John, 2026-08-30):** deferred. Overrides are done in **Rippling directly** for now, so this does not block the day-rate work. Moved to the backlog — see *"Payroll run: no way to override pay HOURS on an entry"*.

Tradeoff to weigh when it is picked up: an override applied only in Rippling means AOS and Rippling permanently disagree about what was paid, so AOS labour-cost and margin reporting drifts from reality with no audit trail explaining why.

### ⚠ Blocker 2 — what happens when `employment_type` is blank

Keying an OT rule off this field makes blanks dangerous, and today most rows are blank.

| Default for blank | Consequence |
|---|---|
| Treat as **contractor** (no OT) | **Silently underpays a real employee.** Wrong direction — invisible. |
| Treat as **employee** (OT applies) | Overpays a contractor. Visible and correctable. |

**Recommendation: block finalize on a blank classification**, exactly like the existing `std_rate = 0` guard. The run detail already refuses to finalize and shows a banner when any entry has no pay rate (`unratedCount`, `finalizeBlocked`). Same idiom: refuse to finalize while anyone in the run has no `employment_type`.

That keeps the field clean without relying on anyone remembering to maintain it — payroll simply cannot close until it is set. It is the one place where a "someone must set this" field is safe, because the guard forces it.

## Build scope

| Step | Work |
|---|---|
| 0 | **Add stored "day hours" field** (numeric, quote line + rate-card default; backfill from `base_day / base_hourly`). Removes the hardcoded-10 fallback and lets Connor sell 8- or 6-hour blocks. See backlog entry 2026-08-30. |
| 1 | Carry `rate_mode` + day hours from quote → payroll run entry |
| 2 | On day-rate rows, set pay buckets to day-rate hours; stamp `pay_adjustment_reason` |
| 3 | Override toggle at job-within-run + per-row |
| 4 | Gate weekly 40-hr spill on `employment_type` = employee; contractors exempt |
| — | ~~Pay-hours editor~~ — deferred 2026-08-30, overrides handled in Rippling; see backlog |
| 6 | Block finalize on blank `employment_type` (mirror the existing $0-rate guard) |
| 7 | Fix/rename "🔁 Recalculate rates" — it does *not* re-read the rate card, only recomputes OT/DT from the rate on the row (`normalizePayrollRunRates`). Misleading during this work. |

Separately, unrelated to day rates: **Lead**, **Stagehand Lead**, Heavy Equipment Op, Aerial Lift Operator, General Labor and Other have no pay rates on any rate card, so anyone booked under them pays $0 in every run.

**None of this blocks the 8/29 run** — that needs 11 blank rates filled and one zero-hour row removed.

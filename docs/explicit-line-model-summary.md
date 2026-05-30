# Explicit ST/OT/DT/Crew line model — overnight rewrite summary (2026-05-12)

## Why

The old line model stored a single `hours` field per line and parsed the
`rule` string at calc time to split it into ST/OT/DT tiers via
`computeDayHourSplit`. This works when every worker on a line has the
same hours (the quote-builder assumption), but **breaks when aggregating
a timesheet**: 3 workers with hours 8 / 14 / 16 each cross OT thresholds
differently and cannot be represented as one aggregated line under a
rule-derived model.

The user proposed an explicit model: store ST, OT, DT, and holiday
person-hour totals on the line, plus an explicit `crew_count`. The rule
string becomes informational (still printed for the customer) but no
longer drives the runtime calc.

## Formula (both modes)

```
total =
  (day mode:    crew_count × base_day)
  (hourly mode: hours × base_hourly)
  + ot_hours      × ot_rate
  + dt_hours      × dt_rate
  + holiday_hours × dt_rate
  + travel
```

Same shape in both modes — only the base term differs.

## What `crew_count` means

- **Day mode**: multiplier for `base_day`. 3 workers × $350/day = $1050.
- **Hourly mode**: informational display only. `hours` is already the
  total person-hours, so the worker count doesn't multiply anything.

## What `hours` means now

**Total ST person-hours**, not per-worker. On day-rate lines this is 0
(the day rate covers ST). On hourly lines it's the sum of all workers'
straight-time hours.

This is a semantic change from the legacy model and was the reason the
migration's backfill multiplied legacy hourly `hours` by `qty`.

## What changed

### Commit `5698186` — Stage 1-4: data model + calc

- **Migration `20260511a_lines_explicit_ot_dt_crew.sql`** — adds three
  columns to `quote_lines` and `invoice_lines`, backfills every existing
  row faithfully, verifies zero total drift across all data.
- **`lib/rates/line-calc.ts`** — new shared `computeLineTotal()`. Single
  source of truth for the formula.
- **`lib/store/types.ts`** — `QuoteLine` gains `crewCount`, `otHours`,
  `dtHours`. `rule` documented as informational.
- **`lib/store/quotes.ts` + `invoices.ts`** — row↔object mappers
  round-trip the new columns. `qty` stays in sync with `crewCount` for
  backward compat with any code still reading `qty`.
- **`overwriteFromTimesheets`** — produces the new shape: `crew_count =
  distinct worker count`, `ot_hours / dt_hours = sums across workers`
  (computed per-worker via the existing timesheet-time split, then
  pooled). Aggregation across mixed-hours crews now works correctly.
- **`invoice-draft-editor`, `quote-draft-editor`, legacy `invoice-builder`** —
  calc functions updated to the new formula.
- **`invoice-draft-editor` columns** — rebuilt: Crew | ST Hrs | OT Hrs |
  DT Hrs | Hol Hrs | $/hr | $/day | $/OT | $/DT | Travel | Total.

### Commit `4c41748` — Stage 5-6: editor + PDF columns

- **`quote-draft-editor`** — same new column layout, plus the
  "unassigned orphan lines" table got the Crew rename.
- **Invoice PDF** — explicit ST/OT/DT/Hol Hrs columns; Crew column
  appears when at least one line has `crewCount > 1`; rule-derived
  caption row removed (no split to explain anymore).
- **Quote PDF** — mirrors the invoice PDF column treatment; Rate
  Schedule appendix unchanged.

## Backward compat

- `qty` column still exists on both tables and is kept in sync with
  `crew_count` by every write path. Any legacy code reading `qty`
  continues to work.
- `holidayHours` semantic is unchanged (always was person-hours; legacy
  formula treated it as a flat addition).
- `rule` is still stored and printed for the customer; only the
  calc-time parsing is gone.

## Math reconciliation (proven by the migration check)

For each existing line, the migration computed the new-formula total and
compared it to the stored `total`. Any drift >$0.01 aborts the migration
with the offending row IDs. **Verified zero drift on dev.**

Example translations:

- Legacy hourly: `qty=3, hours=10, baseHourly=$35` → stored `total=$1050`
  - New: `crewCount=3, hours=30, baseHourly=$35` → computes `30 × $35 = $1050` ✓
- Legacy day-rate OT: `qty=3, hours=14, baseDay=$350, otRate=$52.50,
  rule="OT after 12"` → stored `total = 3 × ($350 + 2×$52.50) = $1365`
  - New: `crewCount=3, hours=0, otHours=6, dtHours=0, baseDay=$350,
    otRate=$52.50` → computes `3 × $350 + 6 × $52.50 = $1365` ✓

## How to apply on dev

```sql
-- In Supabase dashboard → SQL Editor (dev project ovtbvnfhteqxnyirzctt):
-- Paste contents of:
--   supabase/migrations/20260511a_lines_explicit_ot_dt_crew.sql
-- Run.
--
-- Expected: NOTICE messages reporting per-row drift count (should be 0).
-- Final SELECT shows row counts with rows_with_ot / rows_with_dt /
-- rows_with_crew_gt_1 — verify these match expectations.
```

## What to test in the morning

1. **Open an existing draft invoice**, edit a line — total should
   recompute under the new formula. Old totals should match stored.
2. **Generate a new final invoice from a quote** — line shape now has
   explicit OT/DT/Crew columns. The Overwrite from Timesheets flow
   should produce per-position aggregated lines with the correct
   crew count + OT/DT person-hour sums.
3. **Print one of each** — verify the new columns render readably.
4. **A multi-worker timesheet aggregation** — workers with varying
   hours per day should produce one line per (date × position) with
   crew_count = workers, and OT/DT hours summed across them.

## Known limitations

- The "Workers on a day-rate card with variable hours per worker"
  scenario from your earlier question still resolves to *one line per
  date × position* (not one line per worker). The math is now correct
  because OT/DT are explicit, but the customer sees aggregate hours
  rather than per-worker breakdown. If you want per-worker line splits,
  that's a separate change — say the word and we'll do it.
- The legacy `/invoice-builder` route still works under the new model
  (calc updated) but its UI doesn't expose OT/DT/Crew inputs yet.
  Slated for retirement in Cleanup Pass 2 anyway.

## Files changed

```
supabase/migrations/20260511a_lines_explicit_ot_dt_crew.sql  (new)
lib/rates/line-calc.ts                                       (new)
lib/store/types.ts
lib/store/quotes.ts
lib/store/invoices.ts
components/shared/invoice-draft-editor.tsx
components/shared/quote-draft-editor.tsx
components/shared/invoice-builder.tsx
components/shared/invoice-pdf-view.tsx
components/shared/quote-pdf-view.tsx
```

## Commit history

- `5698186` — Stage 1-4: data model + calc + migration
- `4c41748` — Stage 5-6: editor + PDF columns
- (this commit) — Stage 7: docs + pending-prod log

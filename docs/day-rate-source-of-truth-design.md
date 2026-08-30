# Day rate: move the source of truth to the job day record

**Status:** Design, not built · **Date:** 2026-08-30 · **Owner:** John
**Supersedes:** backlog #36 option A (store the day-rate floor) — see §8.

---

## 1. The problem

Whether a day is billed as a **day rate** or **hourly** is stored in exactly two
places, both line-level:

| Table | Columns |
|---|---|
| `quote_lines` | `rate_mode`, `base_day` |
| `invoice_lines` | `rate_mode`, `base_day` |

Nowhere else. Not on the job, not on the day, not on the rate card (which holds
a `day` *price* but no mode), not on timesheets, not on payroll.

Quote lines are keyed on **(date, specialty)**. So the only thing deciding
whether a person is paid a day rate is **which specialty they were booked under
on that date**. Nothing about the job, the day, or the person carries it.

**Consequence: if someone works a specialty that isn't on the quote for that
date, no day rate exists for them and they fall back to actual hours** — while
the crew beside them doing the same day is paid a flat block.

### It is not an edge case — from the 2026-08-29 Neon Nights run

| Who | Booked as | On the quote? | Result |
|---|---|---|---|
| Shelby Bowman | Stagehand Lead | **no** | paid 8, 7, **17**, **17** hrs while her crew got a flat 10 |
| Connor Strang | Lead | **no** | same |
| 4 rigger rows | `Up` (`spc-03-03`) | quoted as `Climber` (`spc-03-01`) | ~$490 underpaid |
| Steward 8/16 | Steward | **no** | hourly |
| 8/17 entirely | — | day not on the quote | hourly |

Crew composition drifting from what was sold is normal. The current model treats
it as an exception it cannot represent.

---

## 2. The design

**The job day record becomes the source of truth. The quote line becomes a
per-specialty override.**

```
resolve(date, specialty):
    quote line for (date, specialty)   → if present, use its mode + block
    else job_request_days for (date)   → use its mode + expected_hours
```

A day record exists for every day of the job regardless of what was sold, so
there is always an answer. A quote line only exists if someone happened to sell
that specialty.

Reading order matters: the quote stays authoritative for anything explicitly
sold (a single specialty billed hourly on an otherwise day-rate day — this
happens, see §3), and the day record answers everything else.

### What has to be added

`job_request_days` gains **one** field:

- `rate_mode` — `'day'` | `'hourly'`

**The hours are already there.** `job_request_days.expected_hours` holds exactly
the block size the derivation has been computing. Nothing new needed.

---

## 3. The quote must stay an override, not be replaced

Mode genuinely varies **within** a single day. On the Neon Nights quote,
2026-08-15 carries four lines — two day-rate, two hourly — and `spc-01-01`
(Labor) appears **both ways on the same date**: 16 crew on a day rate plus a
separate 12-crew hourly line for a 5-hour call.

So a day-level flag alone is not sufficient. It is the default; the line is the
exception. `loadQuoteRateHints` already has a documented tiebreaker for a
(date, specialty) carrying both — day wins.

---

## 4. `expected_hours` is more accurate than the derivation

Today the block is derived as `round(base_day / base_hourly)` from the quote.
Comparing that against `expected_hours` on the day record across all issued
quotes (labour only, expense pass-throughs excluded): **39 comparisons, 31
agree, 8 differ — and in all 8 the day record is right.**

Every disagreement is one job, `AES_26091720_LFT_FARMTOUR`:

| Role | base_day | base_hourly | Derived | `expected_hours` |
|---|---|---|---|---|
| Labor | $650 | **$65** | 10 ✓ | 10 |
| Telendler | $650 | **$38** | **17** ✗ | 10 |
| Steward | $650 | **$34** | **19** ✗ | 10 |

A flat $650/day was quoted across the board, but `base_hourly` was left at each
role's rate-card default instead of being raised to $65. Nobody sold a 19-hour
day. Three independent signals say the block is 10 — the day record, the quote's
own `hours` field (30 ÷ 3 crew, 10 ÷ 1 crew), and Labor on the identical $650.

The derived number is a division artifact. `expected_hours` is a number a human
entered. **⚠ See §7 — this job has not run yet.**

Neon Nights shows the same thing on the half day: `expected_hours` = 5 on
2026-08-11 and 10 on the rest, matching the quote exactly, and it also covers
2026-08-17, which the quote does not.

---

## 5. Prerequisites

**Day setup must be required.** Coverage of worked days by day records is
currently 131/174. Breaking down the 43 missing:

- **20** — `AES_270601_AES_COORDINA`, the internal coordinator job. A standing
  job with no event days by design; excluded from the count. Real event jobs
  are at ~85%.
- **15** — two jobs (`AES_26062910_RHI_20263MOP`, one unnumbered lead) with no
  day records at all.
- **8** — one or two days each across 7 jobs.

**Cause (John, 2026-08-30): job setup can currently be bypassed** — people go
straight to the quote and then to timekeeping. **The Phase 0 planned-vs-actual
work on `dev` makes setup required**, which closes this going forward. No
auto-create needed.

**Still required: a backfill for legacy jobs.** Old jobs predate the concept.

**Residual gap to decide:** required setup guarantees a record for the days
*planned*, not the days *worked*. A job set up for six days that runs seven
still has an unbacked day. Neon Nights is encouraging — it was set up with all
seven days including 8/17 — but the rule for a worked day with no record needs
stating. Suggested: fall back to hourly and surface it, rather than guessing a
block.

---

## 6. What this does NOT fix

**The pay rate.** Mode and hours are separate from what someone is paid per
hour. Shelby would get 10 hours × **$0** until `Stagehand Lead` exists on a rate
card — it and `Lead` are on none of the 28. Separate gap, separate fix.

**Per-person exceptions.** Someone genuinely called in for two hours on a
day-rate day should not get a full block. This design makes a per-row hours
override *more* necessary, not less — see the backlog entry on pay-hours
override, deferred 2026-08-30.

---

## 7. ⚠ Fix before September regardless of this design

`AES_26091720_LFT_FARMTOUR` runs **17–20 September** and is quoted entirely at
day rate. Under the code shipped in v2.4.0, payroll will derive **17-hour blocks
for Telendler and 19-hour for Steward**:

- 3 Telendlers × 4 days × 7 extra hrs = 84 hrs
- 1 Steward × 4 days × 9 extra hrs = 36 hrs

Roughly **$3,400 overpaid**, and invisible in a draft — the rows just look like
long days.

Either correct `base_hourly` to $65 on those quote lines (an issued quote, so
likely a revision), or ship this design first so payroll reads `expected_hours`
and never divides.

---

## 8. Relationship to backlog #36

#36 asks whether to store the day-rate floor or keep deriving it and warn.
**This design answers it: store it — and it is already stored**, as
`job_request_days.expected_hours`. The remaining work is not a new column on
`rate_card_profile_rows`; it is pointing billing and payroll at the day record
and adding the mode flag beside it.

Option B (warn on uneven day/hourly ratios) shipped and stays useful — it is
exactly what would have caught the FARMTOUR $650/$38 line at data-entry time.

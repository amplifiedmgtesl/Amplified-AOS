# Day Rates in Payroll — Plain English

For Connor · 2026-08-30

---

## The short version

When a job is quoted at a day rate, payroll will pay **the number of hours the day rate covers** — not the hours on the timesheet.

Stagehand day rate is $330 against a $33/hr rate, so the day covers **10 hours**. Payroll pays 10 hours at their $25/hr pay rate = **$250 for the day**. Same for everyone on that job, every day.

It doesn't matter whether the timesheet says 3 hours or 17. On a day-rate job the crew checks in and stays on call across the whole span — they're used on and off, not working straight through. That's the whole reason the job is priced as a day rate, so the clock time isn't the right number to pay from.

---

## It comes from the quote automatically

You don't have to flip anything. If you quoted the day as a day rate, payroll pays a day rate.

The reason I want it working off the quote instead of a switch: things in AOS that someone has to remember to set don't reliably get set. There are 44 jobs still sitting in "quoted" that were worked and invoiced months ago, and only 6 jobs have ever been marked "booked." Nobody's doing anything wrong — those labels don't stop anyone getting paid, so they don't get touched. But payroll is a bad place for something to silently be wrong.

Your quote is always right, because the client sees it. So that's what we read from.

The toggle you asked for still gets built — as an override, for when something's off and you need to fix it on the fly. It's just not how it normally works.

---

## Half days handle themselves

On Neon Nights, 8/11 was a 5-hour call and you quoted it as a half day — $165 instead of $330.

Because $165 against a $33/hr rate covers 5 hours, payroll pays 5 hours = $125. Charged a half day, paid a half day. Nothing special to set up, no separate rule.

---

## What I still need from you

**One question.**

Your pay week runs Sunday to Saturday. On Neon Nights, 8/11 through 8/15 all fell in the same week:

| Date | Day rate covers |
|---|---|
| Tue 8/11 | 5 hrs (half day) |
| Wed 8/12 | 10 hrs |
| Thu 8/13 | 10 hrs |
| Fri 8/14 | 10 hrs |
| Sat 8/15 | 10 hrs |
| | **45 hours — 5 over 40** |

Right now payroll has a rule that anything past 40 hours in a week gets bumped to overtime at time-and-a-half. If we leave that rule on for day-rate jobs:

| | Per stagehand, that week |
|---|---|
| Straight day rates | $1,125 |
| With the 40-hour rule applied | $1,187.50 |

About **$62.50 more per person, per week.**

> **Do you want the 40-hour overtime rule to still apply on day-rate jobs, or should a day rate just be a flat day with no weekly overtime on top?**

My read is you'd want it off — a day rate is meant to be a flat fee — but that's your call and it's real money across a full crew.

---

## One cleanup on your end

On some of the Neon Nights lines you entered a day rate but left the hourly rate blank — the Crew Chief days show $400/day with no hourly. We work out how many hours a day covers by dividing the day rate by the hourly rate, so when the hourly is blank we have to guess.

Going forward, put the hourly in alongside the day rate on day-rate lines and it'll always be right.

---

## The payroll run that's stuck

Not related to any of this. It needs two things:

- **11 rows have no pay rate** — Shelby, you, and one of Sam Shephard's days. Those two job titles, "Lead" and "Stagehand Lead", were never given pay rates on the rate card, so they came through blank.
- **1 row has zero hours** — Mike Lynch, 8/15.

Fill in the 11, remove the zero-hour row, and it'll finalize.

Heads up: adding those job titles to the rate card **won't fix this run**. The rates get locked in when the run is created, so it'll help the next one. This one still needs the 11 typed in by hand.

# Round 3 fix plan

Findings: `docs/technical-debt-backlog.md` → "Round 3 — full re-test…" (#67–#104).
Branch: `fix/phase0-round3` (off `dev`). **Not merged to dev** — the dev preview was mid-test (kiosk
midnight sign-outs) when this was built. Unattended judgement calls: `docs/round-3-review-with-john.md`.

## Guardrails for this batch

- No kiosk code (`app/timeclock/**`, `lib/timeclock/**`) — the kiosk was still under test.
- No database changes. Anything needing a migration waits.
- No change to hours/pay math.
- Typecheck + unit tests must pass before each push.

## Batch 1 — build now (decided, self-contained)

| # | Fix | Where |
|---|---|---|
| 69, 93 | Planned-time inputs show the resolved time greyed when inherited, dark when overridden; ↺ resets; only the edited field saves. Review date filters: clear visual empty state. | `job-request-crew-section.tsx`, `timesheet-review.tsx` |
| 70, 71 (print part) | Delete the dead pre-flight; print preview refuses Crew Schedule / Sign-In for a day with no time window (names the day, links to the job). | `job-print-preview.tsx`, `lib/jobs/` |
| 72 | Add Crew Member reuses an existing blank row on the day; scrolls to + focuses the new/reused row. | `job-request-crew-section.tsx` |
| 73 | No "Stagehand" literal — a position-less slot imports with a blank position. | `timekeeping.tsx` |
| 74, 75, 77, 76, 82, 84 | Shared print formatting: one range per line, `*` on override times with a key, `(+1)` on next-day ends, formatted phones, matching unassigned label, header/footer polish. | new `lib/jobs/print-format.ts`, the three docs |
| 78, 81, 99 | Landscape for Sign-In + Actuals (named `@page`), preview paper sized to match, table fits the printable width, a person's two rows never split. | print CSS |
| 80 | Sort select (Last / First / Position-Specialty) on the preview, in the URL, applied by all three docs. | `job-print-preview.tsx` + docs |
| 83 | Print via `printWithTitle` with "<Doc> — <job no> — <day>". | `job-print-preview.tsx` |
| 86 | One **Print** button on the job replaces Print PDF / Sign-In Sheet / Crew Schedule. | `job-detail.tsx` |
| 87, 89 | Planned badge in the grid; SIGN IN 2 header colour. | `timekeeping.tsx` |
| 88 | Choosing an employee no longer forces 'submitted' — status is left to `promoteWorkedStatus`. | `timekeeping.tsx` |
| 90 | Remove the Staff time filter + per-day staff-done counter (badge stays). | `timekeeping.tsx` |
| 91, 92 (reject guard) | Planned rows unselectable for bulk approve/reject; counts only actionable rows; Reject refuses planned. | `timesheet-review.tsx`, `timekeeping.tsx` |
| 94 | Review sorted by date, then last name. | `timesheet-review.tsx` |
| 96 (non-kiosk) | Move explanatory text to `title` tooltips on the screens touched above. | same files |
| 85 + seed notes | Seed: `rate_mode='hourly'` on days; fix the "7/7" comment. (Real quote seeding needs the create-from-job path — noted, not scripted.) | `supabase/seeds/kiosk-test-job.sql` |

## Batch 2 — needs a decision/design first

- **#67 / #101** stale cache + whole-timesheet writes — architectural; #101 is kiosk (after the test).
- **#68 + #71 (import/kiosk stops)** — editable days on Booked jobs; what deleting a day with timesheet
  rows does; Create Quote on locked jobs (#55).
- **#92 No Show status** — full design (kiosk promotion, report, staff app).
- **#98 Copy reason + job activity log** — new table/migration; role question.
- **#100 early/late punch policy** — John + Connor.
- **#97 kiosk rounding** — one-line fix, held only because the kiosk is under test.
- **#102–#104** ideas.

## Re-test

After review + merge to dev, re-run the full round from step 1 (same one-step-at-a-time script),
adding: sort options, `*`/`(+1)`, filenames, landscape default in Safari, one Print button, the
no-window print stop, Reject/No-Show guards, and the kiosk midnight sign-out.

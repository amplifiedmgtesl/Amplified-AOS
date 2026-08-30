# Technical Debt Backlog

Full detail for every deferred cleanup task, design note, and open follow-up. Moved here from Claude's session memory on 2026-06-12 — the memory file (`project_todo.md`) now keeps only a one-line index per item pointing at this doc. Some links below reference Claude memory files (`feedback_*.md`, `project_*.md`) that live in `~/.claude/projects/.../memory/`, not this repo.

---

## 📌 CURRENT PRIORITY RANKING (set with John 2026-07-16, updated 2026-07-21)

Working priority order for active/requested projects. The `#N` ids are stable labels from the 2026-07-16 triage (not positions) — reference them when discussing. Three buckets, mapping to a **Now / Next / Later** frame: **Ranked = Now**, **Unranked = Next**, **On hold = Later**.

**RANKED (Now):**
1. ~~**#5** — Crew Assignment export radius filter (~100 mi)~~ — ✅ SHIPPED TO PROD 7/18
2. ~~**#9** — Remove Rate Schedule from the quote PDF~~ — ✅ SHIPPED TO PROD 7/18 (as default-off "Include rate schedule" checkbox, John's call)
3. ~~**#12** — Pre-invoice client report (actual days + billing amounts) (7/14)~~ — ✅ SHIPPED TO PROD 7/22 (v2.2.0 report + v2.2.1 admin-role lock) — ⏳ **pending Connor testing** (revisions expected)
4. **#16** — Trim the Timekeeping job dropdown (added 7/18, ranked 7/18) — detail: [`docs/timekeeping-job-list-filter-todo.md`](timekeeping-job-list-filter-todo.md)
5. **#13** — Add invoice discount (amount/%) (7/14)
6. **#2** — Timekeeping planned-vs-actual (Phase 0) — verify on dev preview → promote to prod ⎫
7. **#3** — Time Clock kiosk (Phase 1) — WORKER signs at clock-in (no client signature anywhere — confirmed John 7/20; the old "client digital-sig sign-off" phrase meant *validating with the client that digital sigs are accepted*, not the client signing) → re-apply on Phase 0 → prod ⎬ **one workstream, + #4 folded in**
8. **#11** — Bulk-import ACTUAL timekeeping hours (round-trip export/import) (Connor/John, 7/16) ⎭
9. **#10** — Revamp printed timesheet PDF for legibility (Connor, 7/16)
10. ~~**#17** — Let the payroll role view the job screen~~ — ✅ SHIPPED TO PROD 7/20 (read-only: fields disabled, no quote/save/delete actions, Jobs in payroll nav)
11. **#18** — Dashboard metric-card drill-downs (added 2026-07-20, ranked 7/20). Detail section below.
12. ~~**#19** — Jobs screen calendar view toggle~~ — ✅ SHIPPED TO PROD 7/20

**Shipped 7/21 (unnumbered, same-day work — see CHANGELOG.md + v2.1.0 heading):** in-app change log page + version link under Sign out (`CHANGELOG.md`, `/changelog`, promote checklist `docs/promote-to-prod-checklist.md`); coordinator role lockdown (allowlist route guard + per-screen dollar hiding — see #27/#28 for the follow-on permission-matrix work). Prod deploy required a duplicate-commit trigger (see checklist gotcha).

**#4 + freeze-trigger fold-in:** Timesheet↔invoice linking redesign is done *inside* the #2/#3 timekeeping/billing workstream — all touch `timesheet_entries` billing/lock state; rework that area once. **The `timesheet_entries_freeze_check()` denylist refactor is also merged into this workstream:** #4 deletes the `invoice_line_id` column that the freeze trigger's DELETE guard currently keys on, so the trigger must be rewritten when #4 lands anyway — do the allowlist→denylist flip (+ fix the stale delete comment in `timekeeping.tsx`) in that same rewrite. Also relates to #14 & #15.

**UNRANKED (Next) — awaiting John's slotting:**
- **#6** — AOS Assistant in-app chat agent (spec'd)
- **#7** — De-cache 1000-row truncation — broader audit (hot-fix shipped) *(ties to #15)*. **⚠ Re-verified 2026-07-20 against prod: now ACTIVELY truncating billing data** — `quote_lines` 1,265 and `invoice_lines` 1,002 are both over the cap (were 975/812 on 7/2); cached `timesheet_entries` subset 2,560; `rate_card_profile_rows` 771 approaching. `_loadAll` on dev still unpaginated for these tables. Next step: audit which screens still read quote/invoice lines from the startup cache (legacy invoice-builder path noted at db.ts ~337) → convert to live per-view queries or paginate the cache load. Candidate for promotion into the ranked list.
- **#14** — Review invoice void process — *the void/reissue feature is BUILT; this is test/verify only*
- **#15** — Review timekeeping reset/cleanup process — *ties to #7 dedup*
- **#20** — Automated status transitions via pg_cron nightly sweep (added 2026-07-20, John). Auto-close/advance stale jobs past their event date, gated by an **inactivity timer** so operator re-opens aren't immediately re-flipped. Also the pattern-setter for future scheduled tasks. Detail section below.
- **#21** — Event-driven notifications: crew email/SMS + doc-issue emails (numbered 2026-07-20; spec: [`docs/notifications-spec.md`](notifications-spec.md), 2026-06-16). **Substantially built on dev already** — `lib/notifications/` dispatcher + log + Resend/Twilio/mock providers + crew-assigned & document-issued templates, `notification_log` migration `20260616`, notification-test screen. Remaining: wire real events into the app flows, client-owned Resend account + domain verify, Twilio 10DLC registration (start early — days–weeks of carrier wall-clock), E.164 phone normalize + `sms_opt_out` prereq, rollout per the spec's safety guards (`NOTIFICATIONS_ENABLED` log-only first).
- **#22** — App-review 2026-06-11 open items (numbered 2026-07-20; tracker: [`docs/app-review-2026-06-11.md`](app-review-2026-06-11.md) — 30+ items still OPEN, re-verified 2026-06-18 with nothing resolved). **The HIGH security cluster deserves its own urgent slice, candidate to rank above feature work:** S1 service-role key committed + still tracked in git (rotate + untrack), S2 all public tables anon-read/WRITE via the shipped anon key (one migration: `authenticated`-only policies/grants), S3 public+listable storage buckets exposing employee ID scans (private + signed URLs), S4 no server-side authorization (client-only role gating), S11 `notification_log` PII rides on S2. Rest of the tracker (data-integrity D-, financial F-, quality Q-, UX U- items) can be worked as batches from the doc.
- **#23** — Invoice: pull unapproved timesheets + drift highlighting (numbered 2026-07-20; spec: [`docs/invoice-unapproved-timesheet-pull-spec.md`](invoice-unapproved-timesheet-pull-spec.md), revised 2026-06-02 — draft for discussion with Connor). Adjacent to #12 (pre-invoice client report) but distinct work; discuss with Connor before building. **⚠ SEQUENCING (analyzed 2026-07-20): build AFTER the #2/#3/#4 workstream.** The spec predates the #4 linking redesign and its mechanism layer is written against the machinery #4 deletes (`invoice_line_id` back-pointer queries, `invoice_line_id IS NOT NULL` dedupe, `invoices_release_entries_trg`). The feature/UX layer (pull-pending badge, drift categories, re-pull button states, finalize failsafe) is mechanism-independent and survives — and improves under #4: the `invoice_line_entries` provenance rows make "source entries removed" and pending→approved drift detection exact instead of inferred. When building: keep the spec's UX sections, rewrite its mechanism sections against the link table.
- **#24** — Staff app (amplified-staff): read-only crew mode (added 2026-07-20, John). The mobile app is used by coordinators today; the crew-facing side was never rolled out. Make the crew role **read-only**: crew can see what they're scheduled for and their submitted/approved times, but cannot add/update/delete timesheet records. **Do NOT remove the write functionality — gate it, don't delete it** (we may turn crew self-entry back on later). Hooks: role field already exists in `amplified-staff/lib/types.ts` (~line 33: `staff | admin | crew_leader | coordinator`); timesheet write surfaces are `app/timesheets/new` + edit paths in `app/timesheets/[id]`. Implementation: role/feature-flag gate that hides or disables the write UI for crew, keeping code paths intact. ⚠ **Client-side gating alone is cosmetic while #22-S2/S4 stand** (the anon key can write every table regardless of UI) — real enforcement of "crew can't write timesheets" needs the RLS/authz work; pair or sequence with #22. Related context: [[timeclock-kiosk-plan]] — the kiosk exists because per-worker logins weren't rolled out; this read-only mode is complementary (view-only account, kiosk still does capture).
- **#25** — Job costing module rework — FULL PROJECT (added 2026-07-20, John). The module was never touched by the v2/normalization work and still runs on dead patterns, confirmed 2026-07-20 in [components/shared/job-costing.tsx](../components/shared/job-costing.tsx): parses the legacy `QuoteDraft["lines"]` JSONB shape (the `quotes.lines` column on the drop list), splits `" | "` composite service-key strings for position (`parseQuoteLine`, ~line 94), string-matches roles (`roleFromPosition`), uses free-text `req.client`, and keeps an `aes_active_job_costing_v1` localStorage pointer. Rework: re-plumb onto normalized `quote_lines`/`invoice_lines` + position/specialty FKs; live per-view queries (ties to #7 — `job_costing_drafts` is in the startup cache); pull **actuals** from timesheets (real labor hours × pay rates) instead of quoted-only; consume first-class expenses from #26. Scope with John before starting — decide what job costing should even answer now that actuals exist (quoted vs worked vs billed vs paid).
- **#26** — First-class expense tracking + optional invoice inclusion (added 2026-07-20, John). Today expenses have no home, so Connor created an **`ANCILLARY` position with `HOTEL`/`RENTAL`/`TRAVEL` specialties** (verified in prod 2026-07-20) purely so expenses can ride invoices as pseudo-labor lines. Problems: pollutes every labor-keyed surface (rate cards, Rippling earning-type mapping, crew counts, labor summaries) and is invisible to job costing as actual costs. Design sketch: an `expenses` table (job-linked; category, description, amount, vendor, date, receipt attachment via the canonical storage pattern; markup/billable fields), **per-expense choice of whether it lands on the invoice** ("but not always" — John), rendered as a distinct expense line kind (e.g. `source_kind='expense'`) rather than a fake position row; job costing reads expenses directly. Migration path: map existing ANCILLARY invoice/quote lines to expense records, then retire the pseudo-position/specialties. Pairs with #25; design them together even if shipped separately.

- **#27** — Role-based permission matrix, managed from Maintenance (added 2026-07-21, John). Replace the hardcoded role checks with a data-driven permission system: a new roles maintenance table (one row per role, a checkbox per app area — Dashboard, Calendar, Clients, Jobs, Quotes, Invoices, Rate Card, Timekeeping, Timesheet Review, Payroll, Job Costing, Employees, Maintenance), a Maintenance screen to edit it, and User Management's role dropdown pulling from that table. **Seed the table from today's hardcoded permissions** (admin/coordinator/payroll/crew_leader gates: the route guard + nav filter in [components/layout/app-shell.tsx](../components/layout/app-shell.tsx), plus per-component `useUserRole` gates — quote buttons in job-detail, bill columns in timekeeping + timesheet-review, pay sections in employee-profile, money tabs in client-detail). Then convert the code to check the table: nav, route guard, and screen-level gates all read the role's area flags, so unchecking "Quotes" for a role removes the nav item, blocks the route, and hides every button that leads there — instead of today's scattered `role === "x"` checks. Design notes: (a) the current model distinguishes *route access* from *dollar visibility on allowed screens* (coordinators can open Timekeeping but not see bill columns) — likely two flags per area (access / see billing), not one; (b) cache the permission row at login rather than querying per navigation; (c) pairs with **#22-S4** server-side authorization — the same table should eventually drive RLS policies so permissions are enforced in the database, not just the UI. Bigger-scope project per John; slot when ready.

- **#28 — Server-side role enforcement via Supabase RLS** (added 2026-07-21, from the 2026-07-21 coordinator-lockdown session). All role restrictions (crew_leader, payroll, coordinator) are enforced only in the app's UI — route guards + `useUserRole` gates; the database accepts reads (and per #22-S2, writes) from any holder of the shipped anon key regardless of role. Implement role-aware RLS: `profiles.role`-based policies restricting the money tables (`quotes`, `quote_lines`, `invoices`, `invoice_lines`, `rate_card_profiles`, `rate_card_profile_rows`, payroll tables, employee pay columns) to admin-tier roles. **This is the concrete implementation slice of #22-S2/S4** — work it as part of that security batch, not separately. ⚠ Prereqs/cautions: the app runs on the anon key with open-policy conventions, and startup caching (`_loadAll`, ties to #7) assumes broad read access — audit those read paths before restricting or legitimate roles break. **Sequencing with #27:** ideally the RLS policies read the #27 permission table so DB and UI enforce the same matrix; if #28 lands first, hardcode role tiers in the policies and swap to the table later. Migrations dev-first per the standard flow; plan + confirm with John before writing them.

- **#29 — Remit-to / payment-notes field on the company master screen, rendered on the invoice** (added 2026-07-21, John). Connor currently communicates ACH-only payment by **abusing the `company_settings.phone` field** — prod's `phone` literally holds the string `"ACH ONLY"` (verified 2026-07-21), so it prints in the letterhead contact line (`ACH ONLY · connor@amplifiedesl.com`) on every quote/invoice/pre-invoice report. **Preferred design (John 2026-07-21):** add a **free-text "remit-to details / payment notes" field to the company master (Company Settings / Maintenance) screen** — a new `company_settings` text column (e.g. `remit_notes` / `payment_notes`) with a textarea in the settings editor — where Connor can type "ACH Only" or any additional payment/remit text. Data-driven, no code change to edit the wording. Render it on the **invoice**, near the remit-to / balance-due block (NOT the letterhead contact line), so the `phone` field can go back to holding a real phone number (or blank). Decide: invoice only vs. also quote / pre-invoice report. Touches `company_settings` (migration: add column), `company-settings-editor.tsx` (the Maintenance editor), and `invoice-pdf-view.tsx` (+ the shared remit-to block). Small; confirm final label + placement with Connor.

- **#30 — Role-guard the quote & invoice print (`/pdf`) routes** (added 2026-07-22, John). Same gap the pre-invoice report had before v2.2.1: `app/quotes/[id]/pdf` and `app/invoices/[id]/pdf` render their views **outside AppShell**, so the AppShell route guard never runs, and neither `quote-pdf-view.tsx` nor `invoice-pdf-view.tsx` contains a `useUserRole` check (verified 2026-07-22 — 0 occurrences each). A pricing-restricted role (crew_leader/payroll/coordinator) with a direct `/quotes/<id>/pdf` or `/invoices/<id>/pdf` URL could load the priced PDF. **Lower risk than the pre-invoice case** — those roles are blocked from the `/quotes` and `/invoices` areas, so they can't browse to discover quote/invoice ids — but it's the same shape of hole. Fix: add the same in-view role gate used in `pre-invoice-report-view.tsx` (v2.2.1: `PRICING_BLOCKED_ROLES` set + early-return before any pricing renders) to both PDF views. Small, self-contained, no migration. **Note:** this is UI-only enforcement like everything else; the durable fix is #28 server-side RLS, which closes all three (quote/invoice/pre-invoice) print routes at the database layer at once. Do this quick guard now if desired, or fold into the #28 batch.

- **#31 — Payroll super-freeze is silently missing from `timesheet_entries_freeze_check()`** (added 2026-08-04, found while building the 5hr-minimum exemptions). Migration `20260528c` added a payroll super-freeze: once `timesheet_entries.payroll_run_id` is set, the row is immutable until the run is voided. Migration **`20260606d` then `CREATE OR REPLACE`d the whole function to relax the approved-status lock and did not carry the payroll clause forward** — so the guard has been gone since 2026-06-06. **Verified against PROD 2026-08-04:** the live `prosrc` checks `invoice_line_id` only; there is no `payroll_run_id` branch. Entries inside a finalized payroll run are editable at the database level. The *marker* is healthy and maintained — 1,291 of 2,848 prod entries carry `payroll_run_id`, and `payroll_runs_void_trg` still clears it on void — it's only the enforcement that lapsed. Impact: an edit to hours/rates on an already-paid entry is accepted by the DB and silently disagrees with the run's snapshot; the UI mostly doesn't offer those edits, so this is a missing backstop rather than an active bug. **Sequencing:** the `#4` fold-in note above already schedules a full allowlist→denylist rewrite of this function (because `#4` deletes the `invoice_line_id` column its DELETE guard keys on), so the cheap path is to restore the payroll clause *as part of that rewrite* rather than patching twice. Tracked separately here so it doesn't vanish if `#4` slips — if the `#2/#3/#4` workstream stretches out, restore the clause on its own (a ~15-line `CREATE OR REPLACE`, no schema change). ⚠ When the denylist flip happens, `payroll_daily_rules_exempt` (migration `20260804a`) must be explicitly EXCLUDED from protection — the late-arrival workflow depends on setting it after approval.

- **#32 — Surface clients that have no 3-character Code** (added 2026-08-04, John). `computeJobNo` needs four inputs — start date, end date, `clients.code`, and `event_abbr` — and returns null if the client has no code, so the job silently gets no job number. **29 of 53 prod clients have no code** (verified 2026-08-04); all 81 jobs that do have numbers belong to the 24 coded clients. v2.3.1 fixed the *symptom* — the Job # hint now names the missing code and points at the Clients screen — but the gap is only discovered one job at a time, at the moment someone wonders why a job looks unnumbered. Add a positive signal on the clients side: a "no code" chip or column on the clients list, and/or a nudge on the client detail form. Consider whether a code should be *required* for new active clients, and whether the ~29 existing uncoded clients are live accounts needing a backfill or dead/duplicate rows that should be deactivated (the list has obvious duplicates — several "Loud& Clear, Inc" variants, "Lighthouse Copy Copy" — so this pairs with a client-dedupe pass). Small UI change; the data cleanup is the bigger half.

- **#33 — BUG: the job screen's "Timesheet" button doesn't open that job's timesheet** (added 2026-08-05, John). Clicking **Timesheet** on a job lands on the Timekeeping screen but showing **whatever job was last open there**, not the job you came from. **Root cause verified 2026-08-05 in code:** the button navigates to a bare route with no job id — [components/shared/job-detail.tsx](../components/shared/job-detail.tsx) line 187 builds `timesheetHref` as `/lead/timekeeping` (crew leader) or `/timekeeping`, and line 781 does `window.location.href = timesheetHref` while `editingId` (the job id) sits right there unused. Timekeeping has no deep-link input at all: [components/shared/timekeeping.tsx](../components/shared/timekeeping.tsx) reads no search params, and its `initialPicker` (~line 228) falls back to `getActiveJob()` — the sticky `aes_active_*` localStorage pointer — then the first job that happens to have a timesheet. So the destination is last-visited state, and it only *looks* right when you happen to have been on the same job before. **Fix:** pass the job explicitly (e.g. `/timekeeping?job=<id>`) and have Timekeeping seed `initialPicker` from that param, falling back to the sticky pointer when absent; it should still call `setActiveJob(jobId)` so the pointer stays in sync. ⚠ Both routes render the same component ([app/timekeeping/page.tsx](../app/timekeeping/page.tsx) and [app/lead/timekeeping/page.tsx](../app/lead/timekeeping/page.tsx) with `hideBillAlways`) — one component fix covers both, but **test the crew-leader path separately** since `/lead` uses its own layout, not AppShell. Guard the param: if the id isn't in `jobRequests` (or the role can't see it), fall back rather than rendering an empty picker. This is a concrete instance of the **"Active-pointer-in-localStorage pollution"** entry below and the same explicit-deep-link pattern #18 calls for — worth fixing in that style so it's reusable. Small, self-contained, no migration.

- **#34 — VERIFY: the 5-hour-minimum exemption arithmetic has never actually run** (added 2026-08-05). Shipped to prod 2026-08-04 in v2.3.0 and still **unexercised** — verified against prod 2026-08-05: `job_requests.payroll_daily_rules_exempt` is true on exactly **1** row (the AES REMOTE / COORDINATION internal job), but `timesheet_entries.payroll_daily_rules_exempt` is true on **0** rows and `payroll_run_entries.payroll_daily_rules_exempt` on **0** rows. Five payroll runs exist (four created in August, all `draft`), so payroll IS being used — just never yet with an exempt row. The calculation path in `applyDailyRulesToCandidates` has therefore never executed against real data in any environment, and the repo has no test framework to have caught it earlier. **Checks, in priority order:** (1) *regression* — a short day on a NORMAL job still pays 5 hours (this is the risk that matters; the exempt branch sits directly in front of the floor/round-up logic every run goes through); (2) an exempt job's short day pays exact hours with `5hr min + round-up waived (exempt)` in the adjustment column; (3) the per-entry "No 5hr min" checkbox persists across a reload — **test it on a staff-submitted row specifically** (`user_id` non-null), because `syncTimesheet` skips those rows and the flag deliberately uses its own targeted write to work around that; (4) the checkbox disables once the entry is in a run. **Also open — question for Connor:** the weekly 40-hour OT spill (rule 4, applied at finalize) is currently assumed to be UNAFFECTED by an exemption — exempt hours still count toward the 40 and still spill into OT past it. That was my assumption, never confirmed; it's the FLSA-driven rule rather than a company courtesy, so waiving it would be a different kind of decision. Confirm before the first exempt run is finalized.

- **#35 — Payroll role gets no bulk actions on the Timekeeping grid** (added 2026-08-05, noticed while granting payroll Timekeeping access in v2.3.0). In [components/shared/timekeeping.tsx](../components/shared/timekeeping.tsx) the row-select checkboxes, the batch action bar and the pending-staff-entries panel are all gated on `!hideBillAlways` (~lines 261, 1198, 1939) — a flag that means "hide client billing figures". It is doing double duty as "is an admin", so granting a role bill-hiding also silently removes its bulk tools. Coordinators have had this since their lockdown; payroll inherited it in v2.3.0. Not a bug today — Timesheet Review is the real approval surface and works fully for both roles — but the two concepts should be separate flags (`hideBill` vs `canBulkEdit`), because the next role that needs bill-hiding will lose bulk actions for no stated reason. Fold into **#27** (the role/permission matrix) if that lands first — its design note already calls out access vs. dollar-visibility as two distinct axes, and this is a third: action scope.

- **#36 — OPEN (option A): store the day-rate hour floor instead of deriving it** (added 2026-08-06, found while adding unit tests for the invoicing math). **⚠ STATUS 2026-08-06: option B SHIPPED (warning only, on branch `invoicing-unit-tests`) — option A is the real fix and remains OPEN. Do not close this item.** What B delivered: the derivation moved to a single shared definition in [lib/rates/day-floor.ts](../lib/rates/day-floor.ts) (`deriveDayFloor` / `dayFloorIsExact` / `suggestedDayRate`) consumed by `priceTimesheetGroup`, a new rate-card job-health check, and both rate-card editors; uneven day/hourly rows now highlight the Day cell and explain the derived floor plus the day rate that would divide evenly. **B changes no billing arithmetic** — it only surfaces the ambiguity at data-entry time. The floor is still derived, still rounded, still unstored, and the invoice still bills against a number nobody explicitly chose. **What A still requires:** a `day_floor_hours` column on `rate_card_profile_rows` backfilled to `round(day/hourly)` (so nothing changes on day one), an editor field, and `deriveDayFloor` changed to read the stored value with the division kept only as the fallback for un-backfilled rows. Do this properly when day-mode timesheet billing goes live — see the "currently dormant" note below for why there is no rush, and the tests in `tests/rates/day-floor.test.ts` + `tests/rates/timesheet-group-pricing.test.ts` for the behavior that must be preserved or deliberately changed. In day mode, `priceTimesheetGroup` decides how many hours the day rate "covers" per worker — past that, hours bill hourly as overflow. That floor is **never stored**; [lib/rates/timesheet-group-pricing.ts](../lib/rates/timesheet-group-pricing.ts) (~line 135) infers it as `round(baseDay / baseHourly)`. It is invisible on the CCMF card because every position divides exactly (350/35, 380/38, 500/50 → 10). **Verified against PROD 2026-08-06:** 764 of 771 day/hourly rate-card rows divide evenly; the 7 that don't are Standard/Large Fork Options (43 hr, 440 day → 10.23, floor 10), Standard (legacy)/Large Fork Options (same), Standard/V1 (60, 601 → 10.02, floor 10), three HOTEL rows (ratios 38.14 / 47.12 / 514.29) and Actual/BUYOUT (34 hr, 15 day → ratio 0.44, **floor 0**). HOTEL and BUYOUT are expense pass-throughs riding the ANCILLARY pseudo-position (see **#26**), have **zero timesheet entries**, and so never reach this code — but the BUYOUT case shows the derivation has no sanity floor: every logged hour would become overflow. **Currently dormant:** no invoice line in prod has ever carried a day-mode floor rule (`rule ILIKE '%floor%'` returns 0 rows); all 285 `Timesheet actuals` lines ($626,946 billed) priced in hourly mode. So this is latent, not active. **Impact when it does fire:** silent and bidirectional — Large Fork Options at 43/440 has a true break-even of 10.23 hrs but a derived floor of 10, so a 12-hour day bills 440 + 2×43 = $526 instead of $516, ~$10/worker/day in AES's favor; a ratio that rounds *up* (e.g. 400 day / 37.50 hr → 10.67 → 11) goes the other way. Nobody chose either number. **DECIDED 2026-08-06 (John): do B now, keep A on this list to do properly later.** **(A — STILL OPEN)** store the floor explicitly, as described in the status note above. **(B — SHIPPED)** keep deriving but warn: flag non-integer day/hourly ratios in both rate-card editors and add a job-health check; changes no billing, catches the real risk (someone typing a new day rate a year from now and silently getting a floor that contradicts the contract). Behavior is pinned by tests in `tests/rates/timesheet-group-pricing.test.ts` (including the 400/37.50 → floor 11 case), so whichever way this goes, the tests document the change. ⚠ Ties to **#37** — the quote terms say "Day rates are based on ten (10) hour shifts" in prose while the code derives the number by division; that mismatch is exactly what #37 is meant to catch. **Also noted while verifying (separate question, not part of this decision):** prod has 51 day-mode HOTEL quote lines across 17 quotes (latest dated 2026-08-24) and 30 day-mode Large Fork Options lines, yet the day-mode branch has produced **zero** invoice lines ever. Plausibly explained (HOTEL has no timesheets; the Large Fork day-mode quotes may not overlap the one job that does) — but if day-rate timesheet billing is *expected* to work, it currently produces nothing. Worth confirming separately. **UPDATE 2026-08-30 (v2.4.0):** this is no longer billing-only — day-rate **PAYROLL** shipped and pays the derived floor as hours, so this number now decides real wages, not just an invoice line. Payroll consumes the same `deriveDayFloor` as billing (`lib/store/payroll-day-rate.ts`), so bill and pay cannot drift. ⚠ The **floor-of-0** edge (BUYOUT, 15/34 → 0) matters more now: on the bill side it means everything overflows to hourly, but on the pay side it would pay someone **nothing** for a day worked. Payroll therefore treats a floor of 0 as 'not a day rate' and leaves the row hourly rather than paying zero; billing arithmetic is unchanged. **John's preference for A (2026-08-30):** store it as a plain **number of hours** — 10 / 5 / 8 / 6 — not a day/half-day enum, so any block can be sold; keep Day / Half Day as UI labels only. Half-day then stops being a special case. Must cover quoting, invoicing AND payroll, which is why it was deferred out of the v2.4.0 emergency fix.

- **#37 — AI agent to verify Connor's free-text quote terms against what the system can actually do** (added 2026-08-06, John). **The problem, in John's words:** Connor buries a "rule" in the text of a quote — a promise to the client that the system cannot honor — and it isn't discovered until billing time, when it becomes a scramble to find a workaround. This has happened multiple times. **Goal:** an agent that reads the free-text on a quote, extracts any operational rule it contains, and checks each one against (a) what the app can structurally represent and (b) what this specific quote's structured fields actually say — surfacing contradictions *before* the quote is issued. **Where the text lives** (verified in PROD 2026-08-06): `quotes.terms` (130 of 135 quotes non-empty, 27 distinct values, longest 13,605 chars), `quotes.notes` (10 quotes), and per-line `quote_lines.rule`. The terms field is mostly two families of boilerplate T&C (~13.5k and ~5.8k chars) — so the agent should **diff against the standard boilerplate and reason only about the deviations**, not re-read 13k characters of legal text every time. **Real examples already in prod terms text**, each of which maps onto a structured field the system has: *"Day rates are based on ten (10) hour shifts"* → the derived day floor (**#36**); *"OT may be triggered after ten (10)"* → `rate_card_profile_rows.ot_after`; *"Overtime is billed at 1.5 times the regular hourly rate after 40 worked hours in a contiguous work week"* → `PAYROLL_WEEKLY_OT_THRESHOLD` + `PAYROLL_OT_MULTIPLIER` in [lib/store/payroll.ts](../lib/store/payroll.ts); *"The standard work week runs Sun[day]…"* → `payWeekStartFor(workDate, "sun" | "mon")`. Each is checkable: parse the claim, read the corresponding field on this quote's resolved rate card, flag a mismatch. **Two distinct failure modes to report differently:** (1) *contradiction* — the text says something the structured data disagrees with (terms say OT after 10, the rate card says `ot_after = 'none'`); (2) *unrepresentable* — the text promises a rule with no structural home at all (tiered discounts, per-client rounding, "first 4 hours free", conditional travel), which is the class that causes the billing-time scramble. **Design notes:** run it as a **check, not a blocker** — surface findings on the quote screen and/or as a job-health check (the [lib/job-health/](../lib/job-health/) registry + runner is the natural host, and its `Finding` shape with `severity`/`downstream`/`fixHref` already fits); fire on quote issue rather than on every keystroke. **Relationship to #6** (AOS Assistant in-app chat agent, spec: [docs/aos-agent-spec.md](aos-agent-spec.md)): different shape — #6 is an interactive chat with fixed tools; this is an unattended validator over one document. But they share the plumbing (Claude API access from the app, a typed tool/context layer over the same business logic), so **whichever is built first should lay that groundwork for the other**. Scope with John before starting; the highest-value slice is probably just the deviation-diff plus the four rules listed above, since those are the ones already appearing in real quotes.

- **#60 — Time columns are unvalidated free text; a date is sitting in one in PROD** (added 2026-08-12,
  John: *"how was someone able to enter a date into a time field? We need to add a tech debt to fix that
  so a user can't do that."*).
  **Answer: they can't — not through today's UI.** Every time control in the app is a `<select>` bound to
  `timeOptions()` (job header `job-detail.tsx:601/606`, day windows + both second-block fields
  `job-request-days-section.tsx:442-454/523-529`, the timekeeping grid via `LazyTimeSelect`). There is
  **no free-text time input anywhere** — verified, `type="time"` count is 0 across all three files. So
  this is not an open hole in the UI; it is unvalidated *storage* plus historic import.
  **The actual prod data** (read-only check): one job, `AES_260331_FEP_PROFOOTB` — "Pro Football Hall of
  Fame 2026 Enshrinement Week", `jobreq-1774997460467`. Its day row `..._d20260331` holds
  `start_time = '8/5/2026'`, `end_time = '8/10/2026'` — the event's real August dates, in the TIME
  columns, on a day dated 2026-03-31. Job created 2026-03-31; the day row created 2026-05-30, i.e. by the
  multi-day backfill, which carried the already-bad header values down rather than introducing them.
  Origin is the original data migration, not a user.
  **Also unvalidated and far messier:** `calendar_events` holds 83 non-time values from the uploaded
  master-calendar import — `TBD` (49), `tbd` (9), `9am-6pm`, `5-8pm`, `6:00p`, `6::00pm`, `12a`, `9:30p`,
  `out by 1:00am`, `???`, `Varies`. That is human spreadsheet text, and arguably legitimate for a
  calendar note — which is exactly why the fix has to decide *per column* rather than globally.
  **Why it matters now:** these are `text` columns with no CHECK, no trigger, and no normalization on
  write. `scripts/seed-from-export.mjs` copies `start_time` straight through (`e.startTime ?? ""`) with
  no validation, so any future import can reintroduce it. It also nearly caused a live regression:
  `formatClock` originally returned `""` for unparseable input, which would have **blanked all 87 values
  on screen** the moment the 12h display work shipped. Fixed by making `formatClock` pass junk through
  unchanged — but that is a display-layer band-aid over a storage problem.
  **Proposed fix, in order:** (1) correct the one real job's day row (its true window is unknown — ask
  Connor, don't guess); (2) normalize-on-write in `assignmentToRow`-style mappers for
  `job_request_days`/`job_requests`, rejecting or coercing anything that isn't `HH:MM`; (3) add a CHECK
  constraint on `job_request_days.start_time/end_time/start_time2/end_time2` and
  `job_requests.start_time/end_time` — `NULL OR ~ '^[0-9]{2}:[0-9]{2}$'` — once (1) is clean, so the
  constraint can actually be added; (4) validate in the importer. **Leave `calendar_events` alone** or
  give it a separate free-text-is-allowed decision; constraining it would reject `TBD`, which is
  meaningful to whoever typed it. ⚠ Do (1) before (3) or the migration fails on existing data.

- **#61 — `employees` has no audit trail; review the whole database for other gaps** (added 2026-08-29,
  John — *"The entire database should probably be reviewed and not limit our scope to just the employee
  table."*). Found while reconciling Connor's Rippling exports: asked when a phone/city value last
  changed and there is no way to know.
  **Verified against PROD 2026-08-29:** `public.employees` has **no** `created_at` / `updated_at` /
  `created_by` / `updated_by` columns (its only metadata is `is_deleted` and `source`) and **no triggers
  at all**. 25 other public tables carry an `*_audit_trg` plus the four audit columns — `clients`,
  `quotes`, `invoices`, `timesheet_entries`, `job_requests`, `payroll_runs`, etc. The tell that this is
  an oversight rather than a decision: **`employee_documents` IS audited** (`employee_documents_audit_trg`)
  while the employee record it hangs off is not. There is no audit/history table anywhere in the DB and
  no `pgaudit`; `auth.audit_log_entries` is Supabase's own login log and holds 0 rows.
  **Scope — do the survey when the work starts, not now:** enumerate every table in `public` against the
  audit convention and decide per table whether it should be covered. `employees` is the known gap and
  the reason this item exists, but it is explicitly *not* the whole scope — expect other tables to be
  missing the trigger, the columns, or both, and expect some (pure lookup/reference tables) to be
  legitimately exempt. Produce the keep/skip list before writing any migration.
  **Why it matters:** without it there is no answer to "who changed this and when" on the roster — which
  is exactly the question the duplicate-merge work will raise repeatedly (see
  [[duplicate-employee-records]] and the 37 AOS-vs-Rippling field conflicts in
  `~/amplified/rippling-reconcile-2026-08-29/05-conflicts-not-applied.csv`, where recency would have been
  the tiebreaker). ⚠ Adding the trigger is **not retroactive** — it dates nothing that already happened,
  which is an argument for doing it sooner rather than later.
  **Adjacent, worth deciding in the same pass: PITR is disabled** (`pitr_enabled: false`) on a Pro plan
  where it's available. Today's recovery window is 8 daily physical backups, so the furthest any prior
  value can be reconstructed is ~7 days, by restoring a whole snapshot elsewhere and diffing. Separate
  from audit columns, same underlying "we can't see the past" problem.
  Mechanically small per table (four columns + one trigger, the function already exists); the survey and
  the keep/skip decisions are the real work. Migrations dev-first per the standard flow.

- **#62 — Retire duplicate employees with an active/inactive flag; the picker must stop offering
  everybody** (added 2026-08-30, John). Came out of the Rippling reconciliation. John's framing:
  *"Do we have an active/inactive flag on employee records so that when adding a record it only shows
  active records? So they will still show on old jobs, but can't be picked for a new job."* That is the
  right shape — it retires a duplicate **without repointing any timesheet row**, so payroll runs stay
  consistent with their snapshots, history is untouched, and a wrong call is reversible by flipping the
  flag. Compare the alternative (merging keys) which rewrites rows that are inside finalized payroll
  runs, with no audit trail to undo it (see **#61**, and **#31** — the payroll super-freeze that should
  block those edits is currently not enforced).
  **Today the picker filters on `is_deleted` only.** [components/shared/employee-picker.tsx](../components/shared/employee-picker.tsx)
  `loadAllEmployees` selects `employee_key, full_name, first_name, last_name, email, phone, city, state`
  with `.eq("is_deleted", false)` — it never reads `status` and does not even select it. So the dropdown
  offers all **2,881** live records, including 799 marked `Terminated`.
  **⚠ The existing `status` column CANNOT be the source of the flag — verified against PROD 2026-08-30.**
  Values are `Active/Listed` 880, `Terminated` 799, `Active` 787, NULL 335, `''` 83, `Listed` 2 — four
  spellings of two concepts. But the fatal part is that status is *inversely* correlated with reality:

  | status | people | with timesheet activity |
  |---|---|---|
  | Active/Listed | 880 | 5 |
  | Terminated | 799 | 10 |
  | Active | 787 | 98 |
  | **(no status)** | **418** | **347** |

  **347 of the 460 people who have ever worked carry no status at all.** Filtering the picker on
  `status='Active'` would hide three-quarters of the real crew. Converting these values to a dropdown
  without re-deriving them just freezes bad data behind a nicer control.
  **`position_status` is a redundant mirror** — 797 of the 799 `Terminated` rows repeat it there (2
  disagree), with its own variants (`Active/Unknown` 670, `A - Active` 119, blank 883). Retire it with
  `status`; do NOT preserve both. (`worker_category` and `employment_type` are a different axis —
  worker *type*, not active-ness — leave them alone.)
  **Proposed work:** (1) add a dedicated boolean (e.g. `is_active` / `pickable`, default true) rather
  than overloading `status`; (2) **seed it from evidence, not from `status`** — active if the record has
  timesheet history OR a `rippling_employee_id` OR a matching `profiles` login. Against prod that yields
  **510 active / 2,371 inactive**, and 510 is credible against Rippling's 436-person roster; (3) make the
  maintenance UI a two-value dropdown, no free text; (4) only then flip the picker to filter on it;
  (5) retire `status` + `position_status`.
  **⚠ Cutover risk — ship in two steps.** Add the column and backfill first, have Connor review the 510
  against expectation, and flip the picker only after. Get the seed wrong and a legitimate crew member
  vanishes from the dropdown mid-job.
  **Open questions for Connor:** (a) 10 records are `Terminated` yet have timesheet activity — genuinely
  rehired, or a stale flag? (b) should terminated people be pickable for NEW jobs at all? (old jobs keep
  showing them either way, since no timesheet row is touched).
  ⚠ **Does not by itself fix duplicate creation** — see the intake gap in **#63**; and the seven
  `coordinator-backfill` records (`emp-17849124887xx`) are login-linked and must stay active regardless:
  all seven have `@amplifiedesl.com` logins in `profiles` (Andie=payroll, Brent=staff, the other five
  crew_leader). See [[duplicate-employee-records]] and [[coordinator-to-crewleader-employee-link]].

- **#63 — The employee picker's duplicate guard only catches exact prefix/substring matches** (added
  2026-08-30). The guard exists and is doing its job as written: `+ Create employee "X"` renders only
  when `results.length === 0` ([components/shared/employee-picker.tsx](../components/shared/employee-picker.tsx)),
  so a user must search before they can insert. **The hole is the match function** — every typed token
  must hit by prefix or substring:
  `if (nameWords.some(w => w.startsWith(t))) return 100; if (fullLower.includes(t)) return 50; return 0;`
  That correctly catches prefix abbreviations — "Nick Huth"→Nicholas Huth, "Tim Tanner"→Timothy Tanner,
  "Matt Muraoka"→Matthew Muraoka never became duplicates. It misses **misspellings, transpositions and
  non-prefix nicknames**, which is precisely the class that occurs: Eddie Alspaugh vs Edward **As**paugh,
  Carlos Velarde vs Carlos Ver**la**de, Griselda Sandoval vs Griselda Sando**lov**, Henry Hawkins vs
  Henry Ha**ck**ins, Bob Burke vs Robert Burke. Zero results → Create button → duplicate born.
  **This is active, not historical.** `emp-<epoch-ms>` keys decode to creation dates (the table has no
  `created_at` — see **#61**): of the duplicate/misspelled records found, 60 were created between
  2026-05-31 and 2026-08-25 — 9 in May, 18 in June, 24 in July, 9 in August.
  **Fix:** on the zero-results path only, run a fuzzy pass (edit distance and/or a phonetic key) plus a
  digits-only phone comparison, and render the closest existing people as a soft warning above the
  Create button — "closest existing: Edward Aspaugh (AES-…)" — keeping Create available but deliberate.
  Self-contained, no migration. **Do this before or alongside any merge/retire pass (#62), or the
  cleanup refills.** Note the inline-create path itself
  ([components/shared/timekeeping.tsx](../components/shared/timekeeping.tsx) `onCreateInline`, ~line 1727)
  does no checking of its own — it trusts the picker's gate, so the fix belongs in the picker.
  ⚠ `rippling_employee_id` **cannot** be used as an intake gate — confirmed with John 2026-08-29: crew
  usually work a job *before* they are added to Rippling, so AOS is always the first system to know about
  a person. The Rippling id is a reconciliation key after the fact, not an identity gate.

### 🧪 Findings from the Time Clock + Phase 0 test run, 2026-08-11 (#38–#58, plus #59 added 2026-08-12)

Full session log: driven by John against the dev preview at `aa000d9` (kiosk merged onto Phase 0), using a
purpose-seeded job `jobreq-1786821000000` — **AES_26081112_RHI_KIOSK**, Rhino Staging, 2026-08-11 (two
blocks, 7 crew) + 2026-08-12 (single block, 3 crew), two crew carrying per-worker planned overrides.
**The run stopped at kiosk sign-out by agreement — everything below gets fixed, then the whole sequence is
re-tested from the start before continuing past this point.**

**Headline result: Phase 0 itself passed.** The import left every actual time blank on all 10 rows,
including the two crew with planned overrides — the planned/actual separation works, and no-show billing
is genuinely fixed. Every serious finding below belongs to the kiosk, to the app at large, or to
presentation around Phase 0 — not to the planned/actual model.

**Blockers before Phase 0 promotion:** #38, #39, #43, #46 (schedule report at minimum).
**Blockers before kiosk rollout:** #44, #56, plus the #49–#53 screen redesign.

> **🎯 ROUND-2 FIX LIST (John, 2026-08-11) — fix these BEFORE the next test round:**
> **#38, #39, #40, #41, #42, #43, #47, #49, #50, #51, #52, #53, #54.**
>
> ✅ **ALL THIRTEEN FIXED 2026-08-11** on branch `fix/timekeeping-round-2`
> (off `dev`, pushed, **not yet merged**). Typecheck + `next build` clean; no
> local browser verification was possible (`.env.local` points at prod and the
> env-guard refuses `next dev` against it), so the Vercel preview built from
> that branch is the test surface. **Decisions made unattended are logged in
> [`docs/round-2-review-with-john.md`](round-2-review-with-john.md) — read that
> before re-testing.** Two gotchas from it that affect the re-test directly:
> **(a)** the seeded test job's ten rows still carry the OLD `status =
> 'submitted'` and will NOT retroactively become `planned` — **re-seed the job
> or #54 will look unfixed**; **(b)** #57 is still deferred, so seed a quote or
> every rate stays $35.
>
> **Deferred to after round 2 — and deliberately SKIPPED during that testing, since we know they're
> outstanding:** #44, #45, #46, #48, #55, #56, #57, #58. Do not re-report them as new findings.
>
> Practical consequences of that split, for whoever runs round 2:
> - **#56 deferred → round 2 stays on desktop.** No phone testing; the signature pad still overflows.
> - **#44/#45 deferred → round 2 stays AOS + kiosk only.** Keep the staff app out of it entirely; #44
>   cannot fire while every row's `user_id` is NULL, so avoid touching those rows from the staff app.
> - **#46 deferred → skip all printing in round 2.** The three-artifact split hasn't been built, so the
>   sign-in sheet is still the wrong document.
> - **#57 deferred → rates will still be wrong unless the test job has a quote.** Either seed a quote
>   against the intended rate card so downstream numbers are meaningful, or accept `$35` everywhere and
>   don't evaluate anything billing-related. Decide before seeding, not after.
>
> **#57 scoping note (John, 2026-08-11): "seems like it might need its own project, and only is an issue
> if a quote does not exist."** Agreed on it being its own project. ⚠ But it is **not** strictly
> quote-only: `lib/store/db.ts:1296` does `Number(r.bill_std_rate) || 35` on every read, so a stored rate
> of 0/NULL becomes $35 even when a quote exists — reachable whenever a specialty is missing from the
> resolved rate card (e.g. the Rhino card has no "Lead" row, so Lead lines legitimately have no rate).
> Scope the project as "rate resolution + no invented literals", not "handle the no-quote case".

- **#38 — Day rows can exist with no time window; every planned surface silently blanks** (2026-08-11).
  Days are already mandatory for crew (`job-request-crew-section.tsx:464` blocks the tab at zero days, and
  assignments are FK'd to `job_request_day_id`). But a day with NULL `start_time`/`end_time` is allowed and
  silently degrades: the Assigned Crew window renders empty (`:511`), planned-time placeholders vanish
  (`:711`–`:742`), the printed sign-in sheet's Expected column prints blank
  (`crew-sign-in-sheet.tsx:40`), and Copy planned → actual copies nothing. The kiosk is unaffected —
  `slotStates` reads only `timeIn1..out2` and never consults the day window. Real harm is a sign-in sheet
  going on-site with an empty Expected column. **Fix: warn, don't hard-block** — jobs legitimately exist as
  leads before the schedule is known, and a hard requirement would push people to type fake times. Add a
  `lib/job-health/` check ("day <date> has no time window", with `fixHref`), an inline hint on Assigned
  Crew, and a confirm-before-print when Expected would be blank.

- **#39 — Planned-time placeholders never render; Safari shows a plausible fake time** (2026-08-11).
  `job-request-crew-section.tsx` lines 711/721/732/742 pass `placeholder={d.startTime || ""}` to
  `<input type="time">`. **`placeholder` is not supported on time inputs in any browser**, so the
  "day window falls through as a grey placeholder" design has never worked. Chrome renders `--:-- --`
  (honest); **Safari renders `12:30 PM`** on every unset field — including pair-2 fields on a single-block
  day where no pair-2 window exists. An unset row therefore displays what looks like a real planned time.
  This is the exact override-vs-fallback conflation Phase 0 exists to prevent, arriving via the display
  layer. **Fix:** drop the dead `placeholder` props; render the fallback as adjacent muted text, formatted
  through the #41 helper.

- **#40 — "override only" is a static label on every planned row** (2026-08-11).
  `job-request-crew-section.tsx:746` renders it unconditionally, including on rows that *do* carry
  overrides, where it reads as a false status. Reword to an instruction true everywhere ("leave blank to
  use the day window"), or show an "override" chip only on rows with planned values set.

- **#41 — 24-hour vs 12-hour time display is inconsistent on the same screen** (2026-08-11).
  Daily Requirements and the day banner print stored values raw (`08:00–13:00`, 24h from the text columns);
  the per-worker planned inputs are native `type="time"` and render in the OS locale (`07:00 AM`). Storage
  should **not** change — 24h `HH:MM` is deliberate and documented in the `20260708a`/`20260708c` migration
  comments. There is no shared display formatter today (`lib/timeclock/time.ts` only *produces* storage
  strings; `pre-invoice-report-view.tsx:121` has a local one). **Recommendation: 12h AM/PM for display, 24h
  in storage** — a native time input follows the OS and can't be forced to 24h, so it's the fixed point.
  Add one `formatClock(hhmm)` and apply it to the day banner, day header, sign-in sheet Window + Expected,
  and any timekeeping/job-header display; audit for the full call-site list.

- **#42 — Confirmed column renders a checkbox AND a redundant static ✓** (2026-08-11).
  `job-request-crew-section.tsx:670-678`. Confirmed rows show both; unconfirmed rows show only the (see
  #43) squashed empty box, so the cell reads as having no control. A print-only ✓ would be defensible —
  the codebase uses that pattern via `.print-time` — but this one has no print class and the crew section
  isn't the printed artifact. **DECIDED (John): delete the ✓, keep the box.** Confirmation must be settable
  in the app; it can't depend on the import seeding it.

- **#43 — GLOBAL: every checkbox outside `.timesheet-grid` is squashed by the base input rule**
  (2026-08-11). `app/globals.css:55` styles all inputs — `width:100%;padding:10px 12px` — including
  checkboxes. In an `inline-flex` label in a table cell the control collapses to a sliver. **Observed: John
  could not focus the Confirmed checkbox to tick it; the new crew row saved `confirmed=false` because the
  control was effectively unclickable.** v2.3.1 already fixed this bug but scoped it to one table
  (`globals.css:216`). **20 checkbox inputs across 14 components are still affected**, including
  `job-detail.tsx` (the v2.3.0 job-level 5hr-exempt checkbox), `quote-pdf-view.tsx` (the v2.2.0 rate-schedule
  toggle), `invoice-draft-editor.tsx`, both rate-card editors, `payroll-new-run.tsx`, `payroll-run-detail.tsx`.
  **Fix: promote the scoped rule to global** — `input[type="checkbox"],input[type="radio"]{width:auto;min-width:0;padding:0}`
  — then delete the `.timesheet-grid` special case. ⚠ Worth checking whether this contributes to #34's
  observation that the 5hr exemption has never actually been used in prod.

- **#44 — A kiosk punch on a staff-owned row fails silently, and the signed capture record lies**
  (2026-08-11). **Most serious finding of the run.** AOS-seeded rows start `user_id` NULL. The staff app
  can see them (`amplified-staff/lib/db.ts:104` matches `user_id.eq.<me> OR employee_key.eq.<my key>`) and
  **stamps ownership permanently on first edit** (`amplified-staff/app/timesheets/[id]/edit/page.tsx:136`,
  `userId: userId ?? entry.userId`). No path in either repo clears it back. From then on `syncTimesheet`
  skips the row — `t.rows.filter((r) => !r.userId)` (`lib/store/db.ts:894`) — which governs both the
  Timekeeping grid autosave and the kiosk. The kiosk's `applyPunch` calls `upsertTimesheet` un-awaited
  (`app/timeclock/page.tsx:196`) while everything around it succeeds: signature uploads, `upsertCapture`
  writes the audit row **with that signature** via its own targeted write, the screen updates, the toast
  reports success. Net: a signed attestation to a punch that never reached `timesheet_entries`.
  Not symmetric — kiosk-only and staff-only both work; any mixed order breaks after the first staff edit.
  Practical case: worker logs shift 1 in the app, signs out shift 2 at the kiosk → lost silently.
  **Fixes (ascending):** (1) kiosk filters staff-owned rows out of its roster and labels them
  "submitted via app" — do this first regardless so nothing lies; (2) kiosk uses a targeted write like the
  payroll-exemption flag (`db.ts:821`), accepting last-write-wins; (3) ownership decided **per job**, not
  per row — which is where **#24** lands, reframing it from tidiness to a correctness fix.
  ⚠ The same silent skip affects a crew leader editing a staff-owned row in the Timekeeping grid —
  pre-existing, same root cause, fix once.

- **#45 — PLANNED: second full test cycle including the staff app** (2026-08-11, John). The staff app will
  likely need its own changes from #44, so a later cycle should drive AOS + kiosk + staff app together.
  **Confirmed feasible:** the staff dev preview serves the **same dev database** (`ovtbvnfhteqxnyirzctt`)
  as the AOS dev preview — verified by finding the dev ref in its client bundle — so both apps see the same
  seeded job and the collision can be reproduced for real. **Prerequisite:** the staff app matches rows by
  `user_id` OR `employee_key`, so the cycle needs a staff login whose profile links to a seeded employee
  (e.g. `AES-01326`). Confirm how that link is established first.

- **#46 — PRINT ARTIFACT SET: three documents, three moments** (2026-08-11, John's design call).
  **John's verdict: the current crew sign-in sheet is "worthless in its current form as a fill-in
  timesheet"** — right data, wrong format. **Why this is urgent:** before Phase 0 the import copied the
  scheduled window into actual columns, so **two surfaces accidentally doubled as the schedule** — the
  Timekeeping screen and its printed timesheet. Phase 0 correctly blanks actuals and silently removes both.
  Nothing was deleted (verified: Phase 0 has no file deletions); the schedule view was a side effect of the
  bug. Something must backfill it before Phase 0 ships.

  | Artifact | Moment | Source | Format |
  |---|---|---|---|
  | **Schedule report** | BEFORE — crew leader's pocket reference | assignments + planned | text only, no signature block, no blank time slots |
  | **Crew sign-in sheet** | DURING — on-site capture | assignments + planned | fill-in: blank Time In / Out / Signature |
  | **Printed timesheet of actuals** | AFTER — record, possibly client-facing | `timesheet_entries` | no blank signature blocks; render REAL captured kiosk signatures |

  Moves John called: (1) derive the **schedule report** from today's `crew-sign-in-sheet.tsx` by stripping
  the Signature and blank Time In/Out columns; (2) rebuild the **fill-in sign-in sheet** on the *existing
  Timekeeping printed timesheet format*, made more legible — **backlog #10 folds into this**; (3) build the
  **actuals document** rendering real signatures from `timesheet_captures` (private bucket, signed URLs) —
  **overlaps the kiosk spec's Phase 2 "PDF of the timesheet with signatures", reconcile rather than build
  twice**. Open: where the schedule report lives (job screen vs Timekeeping — Claude's instinct is
  Timekeeping, where the need surfaces; Connor question), and **write down what each document is for**, or
  three overlapping artifacts ship with no stated purpose.

- **#47 — Sign-in sheet day header prints pair 1 only** (2026-08-11). `crew-sign-in-sheet.tsx:140` renders
  `Window {d.startTime}–{d.endTime}`; the per-row Expected column handles pair 2 correctly, so a two-block
  day reads `Window 08:00–13:00` above rows saying `08:00–13:00 · 14:00–19:00`. Carry pair 2 into the
  header or drop the header window entirely.

- **#48 — Crew added directly in Timekeeping never reach any printed capture sheet** (2026-08-11, John).
  Printed sheets read from crew **assignments**; Timekeeping's "+ Add Crew Member" writes a
  `timesheet_entries` row and creates no assignment. A walk-up or last-minute replacement — exactly the
  person most likely to be added that way — is invisible on every sheet carried on site. **John's proposed
  fix:** when someone is added in Timekeeping and has no matching assignment, **create the assignment**, so
  a later-printed sheet includes them. Feasible — the row already carries `employeeKey`, `workDate`,
  `shiftId`, `positionId`, `specialtyId`. Questions to answer first: does deleting from Timekeeping delete
  the assignment; what `confirmed` state does a back-filled assignment get (probably false); what happens
  when the row's `work_date` has no matching `job_request_days` row. **Alternative:** have printed sheets
  *union* assignments with unmatched Timekeeping rows — same output, no write-back, no delete semantics,
  but the two lists stay divergent. Either way, **marking "scheduled" vs "added on the day" has real value
  on paper** — don't silently merge them.

- **#49–#53 — KIOSK PUNCH SCREEN: consolidated redesign** (2026-08-11). Five findings on one screen,
  one root cause, fix as one pass.
  **#49 the two sign-in slots are indistinguishable** — with nothing punched, `slotStates`
  (`app/timeclock/page.tsx:46`) marks both `in1` and `in2` available (deliberate, for second-shift-only
  workers), but they render as two identical primary-blue buttons both reading "Tap to sign in". A mis-tap
  puts time in `time_in2`, leaves block 1 empty, computes hours wrong — and the worker signed for it.
  **#50 no context** — no planned/expected time and no named shift on the roster or detail panel, though
  the 7 crew on 8/11 span Load In and Show. **#51 the signature modal omits the date**
  (`page.tsx:355-358`) though the kiosk spec lists showing it as a guard; matters on jobs crossing
  midnight. **#52 quoted vs recorded time can diverge** — the modal builds its text with
  `roundInstantToTimeString(new Date())` at render and `applyPunch` recomputes at confirm, so slow signing
  across a 5-minute boundary means signing "3:45 PM" while 3:50 PM is stored (*not triggered in this run*).
  **#53 "Shift" means two different things** — the kiosk's "Shift 1/2" are the two TIME PAIRS on one row;
  `job_request_shifts` are the job's NAMED shifts (Load In, Show). Dickens is on Load In and works two
  blocks. The kiosk uses the word for the thing that isn't the shift and never displays the thing that is.
  **John's direction:** rename slots to **Time In 1 / Time Out 1** and **Time In 2 / Time Out 2**; show the
  **named shift** and the **planned times** beside them; put the **live date AND time** prominently on
  screen (date explicitly, **because many jobs cross midnight**) — which also closes #51; carry across more
  of the normal timekeeping sheet data where appropriate; and **design for a phone** (see #56).
  Note that wiring planned times in is what makes #49 *safe* rather than merely relabelled — the kiosk
  could then open only the block whose window contains now.
  **✅ FIXED 2026-08-12 on `fix/timekeeping-round-2`, except the window gate. DECIDED (John,
  2026-08-13): leave block 2 open all day — the labels are enough for now.** Both sign-ins remain
  available with nothing punched (second-shift-only workers need that), but they now sit under labelled
  `BLOCK 1` / `BLOCK 2` headings each naming its scheduled window, instead of two identical
  "Tap to sign in" buttons. Verified live at 10:50 AM against a block 2 scheduled 9:00 PM–3:00 AM.
  ⚠ **The residual risk is real and knowingly accepted:** a mis-tap is less likely, not prevented — it
  still writes `time_in2`, leaves block 1 empty, and the worker signs for it. **Watch for this in round 2
  with real crew; if it happens, record who and when.** Both candidate fixes were designed and rejected
  for now: (a) render block 2 secondary outside its window + confirm on tap, (b) hard-gate on the window
  (rejected as trading a silent failure for a louder one — anyone whose call moves earlier is locked out).
  The machinery is already in place if either is wanted: `dayWindowContains()` in
  `lib/jobs/planned-times.ts` (built for the midnight-crossing fix) and the per-worker resolved pair —
  use the latter, since Dickens' block 2 is 9:00 PM–3:00 AM where the day window is 8:00 PM–2:00 AM.

- **#54 — Imported rows enter the approval queue blank** (2026-08-11, needs verification). All 10 imported
  rows carry `status = 'submitted'`, set by the import, not the punch (9 untouched rows share it). Before
  Phase 0 the import pre-filled the scheduled window so "submitted" was coherent; now rows arrive blank
  AND submitted, so ten empty zero-hour rows likely sit in Timesheet Review awaiting approval and could be
  approved as-is. Confirm what Review displays before deciding whether the import should seed a different
  status.

- **#55 — DECIDE: is a quote required to run a job?** (2026-08-11, John). Surfaced by #57. Timekeeping
  resolves the rate card **only** from the job's most recent quote (`components/shared/timekeeping.tsx:576`).
  **John's business case: there may never be a quote** — e.g. a verbal agreement with a repeat client that
  this year's job is priced about like last year's, with no new quote ever generated. **So either the app
  must run a job end-to-end without a quote, or a quote must become a documented, enforced prerequisite
  checked before the steps that depend on it** — not left as an unstated assumption that silently degrades.
  **Both paths must be covered in testing: with a quote and without.** Note the resolution chain already
  exists elsewhere (see #57) and handles this correctly, so "no quote" is likely a solved problem
  everywhere except timekeeping.

- **#56 — The kiosk has never been tested on a phone and is not built for one** (2026-08-11).
  Blocker for rollout. **Signature pad is fixed-size** — `components/shared/signature-pad.tsx` defaults
  `width = 600, height = 220` and applies them as literal px (lines 102-103) with no `maxWidth`; on a
  ~390px phone the canvas overflows its modal. It's the critical interaction on the screen. Good news: it
  already handles `devicePixelRatio`, sets `touchAction: "none"`, and maps coordinates off the rendered
  rect (line 47), so drawing works correctly once it simply fits — a sizing fix, not a rewrite.
  **Slot grid is a hardcoded `gridTemplateColumns: "1fr 1fr"`** (`page.tsx:320`) with no breakpoint.
  ⚠ **Structural trap: the kiosk has its OWN layout** (`app/timeclock/layout.tsx`), like `/lead` — so every
  mobile fix in `globals.css` `@media` blocks never reaches it, and the page is styled almost entirely with
  inline styles carrying no breakpoints. This is the shape of the v2.2.2 production bug where crew leaders
  on a phone had no navigation. Verify mobile work **in this layout**, never by inference from the main app.

- **#57 — Timekeeping invents a $35 rate instead of using the rate-card resolution chain** (2026-08-11).
  **John's rule: no hardcoded amounts anywhere, for anything.** Timekeeping resolves the rate card *only*
  from the job's most recent quote (`timekeeping.tsx:576`); with no quote it sets an empty map and every
  row falls back to literals in `blankTimeEntry` — `billStdRate: 35, billOtRate: 52, billDtRate: 70`
  (`lib/store/timekeeping.ts:199-201`). The DB read layer independently does `Number(r.bill_std_rate) || 35`
  (`lib/store/db.ts:1296`), so a null/zero rate coming *out* of the database also becomes 35. **Observed:
  all 10 seeded rows got $35/hr against true rates of $38–$65** — a plausible-looking number nobody chose,
  with no warning anywhere. **It never consults `job_requests.rate_card_profile_id`** (which WAS set on the
  test job) and never reaches `ratecard-master-default` (which exists, client-less, with all 29 rows
  priced). **The correct chain already exists and is proven** — `payroll.ts:1001-1012`: employee override →
  job's pinned card (`resolveRateCardForJob`, honoring the job_request pinned profile, else client+date) →
  master default → **and if nothing answers, returns 0 with a visible "needs rates" banner**, tagging the
  answering layer in a `source` field for UI badges. Quotes fall back to master default the same way
  (`quotes.ts:339/351/374`); job health already computes a `rateCardSource`. **Fix: make timekeeping use
  that chain, and surface an unresolved rate as zero-plus-warning (like payroll's banner and the
  pre-invoice report's "Rate TBD") rather than inventing one.** ⚠ The resolution is **mirrored in the staff
  app** at `amplified-staff/lib/calc/rate-resolution.ts` (see the SYNCED COPY comment at
  `timekeeping.tsx:572`) — audit there too. **Follow-on sweep:** hunt every remaining numeric literal
  standing in for a rate or threshold; the legacy hardcoded `8/12` OT/DT default was already found and
  fixed for this same reason in June, which suggests more remain. **Open questions, not yet answered:**
  whether entries re-snapshot when a quote lands *after* import, and whether invoicing re-prices
  independently at invoice time via `lib/rates/timesheet-group-pricing.ts` (which would limit blast
  radius considerably).

- **#58 — Default 30-minute meal break is invisible at the kiosk** (2026-08-11). `blankTimeEntry` sets
  `mealBreak1Minutes: 30` (`lib/store/timekeeping.ts:192`), applied to every imported row whether or not a
  break was taken. Confirmed harmless-but-confusing in test: an 18:00→18:05 punch computed **0 hours**
  (5 min − 30 min, clamped at `timekeeping.ts:71`) — the math is correct, the deduction is just invisible.
  The kiosk has no meal-break control and no hours display, so a worker who works straight through still
  loses 30 minutes and only the Timekeeping grid can correct it. May well be the company rule — but the
  kiosk's premise is "records identical to hand-entered ones," and this is a deduction nobody at the kiosk
  can see. Decide whether the default belongs on kiosk-captured rows.

- **#59 — The second time block stops at `job_request_days`; everything downstream sees only pair 1**
  (added 2026-08-12, found while auditing #47's fix). ⚠ **PROMOTION-GATED: harmless until `20260708c`
  is applied to prod, wrong the moment it is.** Not a someday-backlog item — it activates on the very
  promotion this work is preparing for, and midnight-crossing jobs are exactly the shape that trips it.
  `job_request_days` is the **only** table in the database carrying `start_time2`/`end_time2`; verified
  against `information_schema` on dev. Every other table with block times has a single pair:
  `job_requests`, `quotes`, `quote_lines`, `invoice_lines`, `calendar_events`.
  **The concrete failure** is the day→header sync trigger `sync_job_request_from_days()`, which sets
  `end_time = (SELECT end_time FROM job_request_days ORDER BY event_date DESC LIMIT 1)` — the last day's
  **pair-1** end, ignoring `end_time2`. A job whose final day runs `08:00–13:00` then `20:00–02:00`
  therefore records a header `end_time` of **13:00**. That header drives the master calendar's display
  **and its ICS export** (`master-calendar.tsx` `formatIcsDate(e.endDate, e.endTime …)`), so the exported
  calendar event ends at 1pm for a crew working past midnight. `start_time` has the mirror-image issue
  for a job whose FIRST day starts with a pair-2-only shape, though that is rarer.
  **Why it isn't firing today — and when it will (verified against PROD 2026-08-12, at John's prompting;
  the original write-up checked only dev, which was the wrong database to reason from):**
  **PROD has no `start_time2`/`end_time2` columns at all** — it cannot represent a second block, so no
  prod job can be wrong today. Dev has 2 such days and neither is the last day of its job. But this is
  **not permanently latent: it activates on the Phase 0 promotion.** `20260708c` adds the two columns and
  **does not touch `sync_job_request_from_days()`**, so the moment that migration lands in prod and a
  coordinator sets a second block on a final day, the header end_time and the ICS export are wrong.
  **⚠ Decide this BEFORE applying `20260708c` to prod, not after.**
  **Prod schema gap measured while checking** (prod has no `supabase_migrations` tracking table — these
  were probed directly against `information_schema`). Missing from prod, all three Phase 0 / kiosk:
  `20260708a` (assignment planned times), `20260708c` (day second block), `20260708d` (timeclock
  captures). Already in prod from the same era: `20260708b` (banking), `20260710a` (rippling earning
  type), `20260804a` (payroll daily-rules exempt). That is the migration list the promotion needs.
  **Not a display fix** — unlike #47, which was three surfaces printing pair 1 only and is now fixed.
  This needs a migration plus a genuine modelling decision: does a second block belong on quotes and
  invoices at all, or is a two-block day always billed as one span? Answer that before patching the
  trigger, or the trigger gets fixed while quoting stays blind. Cheapest correct first step is probably
  `end_time = GREATEST(end_time, end_time2)` on the last day, which fixes the calendar without touching
  the billing model — but confirm the modelling question first.

**Verified working in this run:** Phase 0 import leaves all actuals blank (10/10 rows, including the two
with planned overrides); manual planned-time entry persists (`planned_in1` NULL → `10:00`, stored 24h,
survived navigate-away); crew add persists; kiosk punch round-trips correctly —
`timesheet_entries.time_in1 = 18:00` (rounded), `timesheet_captures.actual_in1 = 17:58:58 America/New_York`
(raw instant preserved), `captured_employee_key = AES-00465`, signature 30 KB PNG in the private bucket;
sign-out enables and records correctly; rounding is nearest-5 as designed.

**Test job left in place on dev** (`jobreq-1786821000000`) for the re-test; delete or re-seed as needed.

**Closed:**
- **~~#8~~** — Full client→invoice system rewrite + Connor PDF recovery — ✅ DONE 2026-07-16 (see the ✅ DONE section below; bug class mechanically impossible + recovery executed).
- **~~#1~~** — Rippling payroll export — ✅ CLOSED 2026-07-20 per John. Export shipped to prod 2026-07-10; the held follow-ups (Connor mapping review, W-2/1099 handling, rate mismatches, real test-import, rate-card pay seeding) are closed with it — reopen individually if any resurfaces.

---

## 🧭 PROJECT: Timesheet ↔ invoice linking redesign (added 2026-07-12)

**Status:** design agreed, not started. Full write-up: [`docs/timesheet-invoice-linking-redesign.md`](timesheet-invoice-linking-redesign.md).

The single mutable `timesheet_entries.invoice_line_id` pointer (no history, last-writer-wins) lets the billing link sit on a throwaway draft while the issued invoice has none — so deleting an unneeded draft revision silently **unbills** records a live invoice still covers. Also the Timesheet Review screen doesn't show billed state at all (only Timekeeping does). Fix: derive "billed" from live invoice links backed by a `invoice_line_entries` many-to-many table (keeps provenance; partial-unique guards against double active-billing). Two cheap interim mitigations documented (show billed on Review; warn on draft-delete that would orphan records). Surfaced 2026-07-12 on job `AES_26070312_DOD_COUNTRYC` (dup Soni Nichols entries; 0 links on issued rev2, all 38 on draft rev3).

## 🔥 PROJECT: De-cache raw job data — the 1000-row cache truncation (added 2026-07-02)

**Status:** discovered + partially fixed 2026-07-02. Timekeeping hot-fix shipped to prod (commit `5e63ba4`). The broader audit below is not yet done.

### Why this exists

`_loadAll()` ([db.ts:110](lib/store/db.ts:110)) hydrates one global in-memory cache at app startup by `select("*")`-ing entire tables. **PostgREST caps every such select at `max_rows = 1000`** (confirmed via the project config). The `select()`s have **no `ORDER BY`**, so past 1000 rows PostgREST returns an arbitrary (physical/ctid-order) 1000 and **silently drops the rest** — no error, no warning.

### Confirmed impact (2026-07-02)

- **Timekeeping outage.** `timesheet_entries` has ~2,124 rows. The grid read the capped cache, so large/active jobs lost rows: **POTUS rendered 23 of its 136 entries** — proven exactly: the 23 rows that survive `select … where timesheet_id is not null limit 1000` are name-for-name identical to the 23 on Connor's printed timekeeping sheet. Morgan Wallen: 77 of 101. Review was unaffected (it orders by `updated_at desc`, keeping the newest rows inside its own 1000 cap).
- **Duplicate storm → likely bad invoices.** Because saved entries looked missing, operators re-entered them repeatedly: **82 duplicate rows on POTUS, 27 on Morgan Wallen**. Duplicates inflate the hours/crew the invoice pull (`overwriteFromTimesheets`) sums — a strong candidate for invoicing being "way off." *Not yet verified against actual invoice numbers.*

### Cached tables over the cap TODAY (silently truncated)

| Table | Rows | Cache appropriate? |
|---|---|---|
| employees | 2,743 | No — too large; needs server-side search |
| timesheet_entries | 2,124 | No — raw job data (FIXED: per-job live load) |
| quote_lines | 975 | No — raw; about to cross 1000 |
| invoice_lines | 812 | No — raw; will cross soon |
| calendar_events | 588 | No — raw/unbounded |
| positions / specialties / clients / rate cards | 18–48 | **Yes** — small, bounded, slow-changing |

### The principle (decided 2026-07-02)

Cache only **small, bounded, slowly-changing reference/lookup** tables (positions, specialties, clients, rate-card profiles, app config). **Query raw/transactional/unbounded data live, scoped to the view** (per-job, per-invoice). The real test is *bounded-and-small vs unbounded* — even a "master" table (employees, 2,743) is unsafe to fully cache.

### Work

1. **DONE** — Timekeeping: `loadTimesheetForJobLive(jobId)` queries one job's entries live ([db.ts](lib/store/db.ts), commit `5e63ba4`).
2. Audit every table in `_loadAll` (invoices/invoice_lines, quotes/quote_lines, job_sheets, calendar_events, employees) → convert raw-data reads to live, per-view queries. Or, as an interim guard, paginate cache loads with `.range()` so nothing is silently dropped.
3. **Employees:** replace the full-roster cache with server-side search/typeahead (the picker already has its own loader — consolidate on it).
4. **Verify + clean** the existing duplicate `timesheet_entries` (82 POTUS, 27 Morgan Wallen; read-only keep/remove report first) and add a dedup guard on `(employee_key, work_date, shift_id)` across all add paths.
5. Re-check whether the POTUS/Morgan invoices already went out with inflated hours.

## ✅ DONE: Full client→invoice system rewrite (incl. Connor recovery)

**Status: COMPLETE (confirmed 2026-07-16).** The structural rewrite shipped incrementally and the original overwrite bug class is now **mechanically impossible**, verified against code/migrations 2026-07-16: opaque random ids (no content-derived slug PKs), `quote_draft_workspaces` JSONB dropped, invoice generation is a pure read-then-INSERT that never writes the quote, DB freeze triggers reject any edit/delete of an issued quote or its lines, and the blind `upsertQuote()` is deleted (invoice analogue has a cross-client collision guard). The **Connor PDF recovery ran** — the lost historical quote entities were reconstructed. NOTE: the `timesheet_entries_freeze_check()` denylist refactor (separate `##` section immediately below, added 2026-07-02) is an INDEPENDENT open item and is NOT closed by this. The two trivial loose ends (INV-2026-0427-875 draft/sent status; 40-char `event_name` cap) are moot/negligible.

**Design document:** [docs/system-flow-rewrite.md](docs/system-flow-rewrite.md) — Mermaid diagrams of current vs proposed state, per-entity changes, cross-cutting concerns, open questions, phased rollout (A: quote rewrite + Connor recovery; B: rename `job_requests` → `jobs` + extend; C: invoice rewrite; D: shifts; E: client contacts/email; F: timesheet-driven invoice lines). Two findings worth memorizing: (1) `job_sheets`/`timesheet_entries` are already separate tables — only the dummy-vs-real distinction within `job_sheet_workers` uses a nullable FK; (2) `job_requests` already holds ~90% of the `jobs` master entity shape, so Phase B is a rename + additive columns, not a new table.

The quote-system-rewrite section below remains the immediate Phase A focus; the design doc covers the larger context.

## Rewrite `timesheet_entries_freeze_check()` as a denylist (trigger drift, added 2026-07-02)

**MERGED into the #2/#3/#4 timekeeping/billing workstream (2026-07-16).** #4 (timesheet↔invoice linking redesign) deletes the `invoice_line_id` column the DELETE guard keys on, forcing a trigger rewrite anyway — do the allowlist→denylist flip there. Not a standalone item. Detail below.

The freeze trigger's UPDATE guard lists frozen columns **by hand**, so migrations that add columns silently escape it. As of 2026-07-02 these columns are NOT in the freeze list: `payroll_run_id`, `staff_finalized`, `staff_finalized_at`, `job_name`. Low billing risk today (every money column — hours/rates/dates/position/specialty/meal/bill totals — is still frozen; the gaps are workflow/linkage/label fields), but it will keep drifting.

Also: on **DELETE** the trigger only blocks `invoice_line_id IS NOT NULL` — it does NOT block approved-not-invoiced or payroll-locked rows (payroll is covered separately by the `payroll_run_entries` FK's default NO ACTION). A code comment in [timekeeping.tsx](components/shared/timekeeping.tsx) falsely claims "the DB freeze trigger would reject the delete anyway" for approved rows — it doesn't. Delete safety is now enforced in `deleteTimesheetEntries()` ([db.ts](lib/store/db.ts), commit `f6f1b1b`): it checks approved/invoice-bound/payroll against the live DB and refuses locked rows, so it does not depend on the trigger.

**Fix:** flip the UPDATE freeze to a denylist — freeze ALL columns except an explicit mutable set (`sort_order`, `updated_at`/`created_at`, audit cols, and the lock pointers themselves) — so new columns are frozen by default and the trigger can't fall behind the schema. Correct the false code comment while at it.

### Quote system rewrite + Connor incident recovery (Phase A) — ✅ DONE

**✅ COMPLETE (confirmed 2026-07-16):** structural rewrite shipped incrementally (overwrite bug class now mechanically impossible — see the ✅ DONE banner at the top of this project section) AND the Connor PDF recovery was executed — the ~16–17 lost historical quote entities were reconstructed. Original design/history preserved below for reference.

**Status (as of 2026-04-29):** Designed end-to-end. Hot-fix shipped to prod 2026-04-29 (commits `02fc1bc`, `19784dd`, `1c57eee`, `cff6a6e`, `1138e17`, `23d1e5f`) covering: (1) saveInvoiceDraft no longer mutates the quote, (2) currentQuoteId recomputes fresh, (3) upsertQuote refuses cross-client overwrites, (4) "+ New Quote" button + dropdown reset properly, (5) no auto-load of saved quotes on mount, (6) **invoices now use unique ids per generation + warn on duplicate**. The deterministic-id pattern was an invoice-side analogue of Connor's bug — every "Save Invoice Draft" for the same quote overwrote prior invoice lines via syncInvoiceLines' delete-then-insert. Recovery from PDFs needs to cover invoice_lines too, not just quote headers. Awaiting dev environment, then PDF batch from Connor.

### Why this exists

Connor (admin) created a quote for Loud&Clear / Miami University Commencement / 2026-05-11 ($36,918) and generated a deposit invoice (`INV-2026-0427-875`). The signed estimate + deposit went to client. The quote then "vanished" from the quote list. Investigation found this is **not isolated** — it's a systemic data corruption pattern that has hit multiple admins multiple times.

### Root cause (validated against code + DB)

1. `quotes.id` is a slug PK derived from `client + event_name + start_date` ([quote-builder.tsx:483](components/shared/quote-builder.tsx:483)).
2. `currentQuoteId()` short-circuits to a cached `quoteId` in React state if non-empty — never recomputed when client/event/date change.
3. The cached `quoteId` is persisted in `quote_draft_workspaces.data` (JSONB), reloaded into state on draft load, and re-serialized on every autosave keystroke. So drafts both carry and preserve stale ids.
4. `saveInvoiceDraft()` calls `saveQuote()` first ([quote-builder.tsx:680](components/shared/quote-builder.tsx:680)) — every deposit invoice generation upserts the quotes row. With a stale id, this **overwrites a different quote's row**.
5. `upsertQuote()` ([db.ts:314](lib/store/db.ts:314)) is a blind upsert with no collision check — overwrites all columns.

### Audit findings (2026-04-28)

13 rows in `quotes` table currently. From the slug-vs-content audit + invoice-fossil audit:

- **3 confirmed overwrites** (Connor's case + 2 others): `rhino-staging--luke-combs---osu--2026-04-21` (now Miami U), `alive-productions--church-concert-2026-04-10` (now Chris Stewart/McCreery), `fep-live,-llc-pro-football-hall-of-fame-...` (now Loud&Clear KY Event).
- **Multiple slugs have hosted 3–4 different events each.** `loud-&-clear-...-corporate-call-...` has been Corporate Call → KY Call → KY Event → Mount St. Joseph → back to Corporate Call. `alive-productions--church-concert-2026-04-10` has been Alive Prod → Mount St. Joseph → Chris Stewart McCreery.
- **Roughly 16–17 distinct historical quote entities** are buried inside the 13 current rows.
- **Backup sources for recovery:** PDFs (Connor's library — most reliable), `snapshot_20260420_quotes_lines_jsonb` table (lines as of Apr 20, has 12 of 13 slugs, missing only Connor's because it post-dated Apr 20), invoice-row content snapshots (per-invoice headers), `export.json` localStorage cache (intermediate states from one machine).

### Designed solution

**Two physically separate tables (drafts + frozen quotes):**

- `quote_drafts` — UUID PK, all columns proper (no JSONB), `parent_quote_id` if revising. Lines in `quote_draft_lines` child table. Manual delete only (no auto-cleanup).
- `quotes` — UUID PK, `quote_no` (global Postgres SEQUENCE — internal/audit only, never displayed), `display_code` text (see naming convention below), `parent_quote_id` for revision chains, `status` enum (`issued | signed | superseded`), DB-enforced read-only on content columns via RLS/triggers. Lines stay in existing `quote_lines` child table.

### Display-code naming convention (decided 2026-05-03)

User-facing identifier across job_requests, quotes, invoices. Replaces `LNC-event-slug-00042` placeholder in this rewrite.

**Format:** `AES_YYMMDDDD_CLI_EVENT[_SUFFIX][_REVN]`

- `YYMMDD` = job start date
- Second `DD` = end-date day, **only** when the job spans multiple calendar days (overnight cross-midnight shifts are NOT multi-day per [feedback_overnight_shifts.md] / project decision 2026-05-02)
- `CLI` = `clients.code` (3 chars, already enforced unique)
- `EVENT` = new field `job_requests.event_abbr`, max 8 chars, auto-derived default with user override at creation
- Suffix: `_EST` quote, `_INV` invoice, `_DEP` deposit invoice
- `_REVN` (N ≥ 2) on revisions

Examples:
- Job request: `AES_26050212_LNC_WELCROCK`
- Quote: `AES_26050212_LNC_WELCROCK_EST`
- Quote rev 2: `AES_26050212_LNC_WELCROCK_EST_REV2`
- Invoice: `AES_26050212_LNC_WELCROCK_INV`
- Deposit invoice: `AES_26050212_LNC_WELCROCK_DEP`

**Storage rule (each entity stores its own value):**

| Field | Behavior |
|---|---|
| `job_requests.job_no` | Auto-recomputed when source fields (`request_date`, `end_date`, `event_abbr`, `clients.code`) change. **Lock window:** while `status='lead'` only — already enforced by [job-requests.tsx:212](components/shared/job-requests.tsx:212). After Lead, source fields lock so `job_no` stops moving. |
| `quotes.quote_no` | **Captured at quote creation** from parent's then-current `job_no` + suffix. Frozen forever. Survives later edits to the job_request during Lead phase, and survives any future redesigns of the convention. |
| `invoices.invoice_no` | Same: captured at invoice creation from parent's then-current value, frozen. (Field already exists — currently unused; populate properly in rewrite.) |

**Why store on each entity instead of compute-on-read:** preserves issued-document identity. Once Connor sends a signed estimate PDF named `AES_26050212_LNC_WELCROCK_EST` to a client, that string lives forever on the quote row, even if the (still-Lead) job_request was edited a few minutes after. Future search-by-name from clients always resolves.

**Revision behavior:** "Revise" on an issued quote inserts a new draft with `parent_quote_id`. On issue, new quote gets `parent.job_no + _EST_REV{N}` where N = parent's revision_no + 1. Job request is already locked by then, so the base `job_no` is stable; only the REV suffix bumps.

**Display rule:** every dropdown / reference to a job, quote, or invoice shows the entity's stored `*_no` field directly (no computation, no walking FKs at render time except for cross-doc displays — e.g. an invoice PDF showing "Quote: AES_..._EST" walks to its parent quote and prints that quote's stored `quote_no`).

**Constraints:**
- `unique` on each `*_no` field
- `event_abbr` max 8 chars, default auto-derived (consonants/initials), user can override on creation; uniqueness collisions during job_request creation get a numeric tiebreaker like `WELCROC2`
- Cross-month edge case (`2026-04-28` → `2026-05-02`) accepted as `26042802` — rare, documented quirk

### Crew quantity reconciliation (added 2026-05-04)

There are **four** potential sources of "how many crew" for a (day, position):

| Source | Means | Authority |
|---|---|---|
| `job_request_crew_needs.quantity` | What the client asked | Soft, planning |
| `quote_lines.qty` | What AES committed to deliver / bill | **Contract** |
| Confirmed `job_request_assignments` count | What was actually scheduled | Operational |
| `timesheet_entries` count for that (day, position) | What actually worked | Reality |
| `invoice_lines.qty` | What was billed | Final |

These can drift at every transition. The Assigned Crew tab today compares assignments against `crew_needs` (the only day-level target available pre-rewrite). After the quote/invoice rewrite:

1. **Quote builder pre-fills lines from `crew_needs`** — head start, save typing
2. **User can adjust quote lines** before issuing (e.g., "they need 5, we'll quote 6")
3. **Once a quote is issued, it becomes the authoritative target** — assignments compare against quote line qtys, not crew_needs
4. **`crew_needs` stays as historical "client's original ask"** for audit / sales review — or auto-syncs to match quote
5. **Dashboard understaffed widget** queries quote when one exists; falls back to crew_needs only for unquoted Leads

**Open business question (decide at rewrite time):** what does the invoice equal?
- Fixed-price: invoice = quote regardless of actual labor (AES bears variance)
- Time-and-materials: invoice = timesheet (client pays actuals)
- Hybrid: equipment fixed, labor as-actuals up to quoted (most common in event work)

**Reconciliation widgets to add post-rewrite:**
- Per-job 4-layer view: (day, position) × (needed, quoted, worked, invoiced) with deltas
- Per-job billing-posture flag: "billed at quote · 7 actual vs 6 quoted · 1 hr unbilled labor"
- Dashboard widget alongside Understaffed: "N jobs need post-event reconciliation"

**Don't build any of this now** — quote/invoice schema is too broken to support reliable per-day comparisons. Carry as scope for the rewrite.
- Sequential `quote_no` integer is internal/audit only, never user-visible

**Flow:**
- Draft phase → INSERT/UPDATE `quote_drafts` (UUID stable, no PK collision possible)
- "Issue Quote" button → transactional INSERT into `quotes` (allocates `quote_no`, computes `display_code`, status=`issued`) + INSERT lines + DELETE draft. If `parent_quote_id` set, mark parent `superseded`.
- "Revise" on a frozen quote → INSERT new draft copying source content + set `parent_quote_id`. Source quote untouched.
- Invoice generation against `quotes` only. Pure INSERT into `invoices`. Does NOT call `saveQuote()` — quote is frozen, can't be touched.

**Two new screens:**
- Quote Drafts list — filter by client, "Edit"/"Delete" buttons, "New Quote" creates fresh draft.
- Quotes list — `display_code`, client, event, start_date, status, total. "View" → read-only detail page with print/invoice/revise buttons + linked invoices via reverse FK lookup. Bidirectional nav from invoice back to source quote.

**Why the bug class disappears structurally:**
- No slug PKs anywhere → can't collide.
- No JSONB carrying stale ids between sessions.
- Frozen rows have no UPDATE path at all in the invoice generation flow — overwrite is mechanically impossible.

### Decisions confirmed during design

- **Number format:** global Postgres SEQUENCE, 5-digit zero pad, no year prefix. Display: `LNC-event-slug-00042`.
- **Dropdown row layout:** `LNC | 2026-05-11 | Miami Commencement | #00042`.
- **`event_name` field:** enforce 40-char max, helper text guiding users to keep it short (not stuff client/date/venue into it). Existing long values left alone but flagged for human shortening.
- **Existing 13 rows on migration day:** all status=`issued` (frozen). No more edits without revising.
- **Lines:** separate `quote_draft_lines` and `quote_lines` tables, mirroring parent split.
- **Abandoned drafts:** manual delete only (no auto-cleanup after N days).
- **`parent_quote_id`:** yes, for revision chain audit trail.
- **PDF extraction:** feasibility validated against Connor's two sample PDFs in `recovery/pdfs/`. `pdftotext -layout` produces parseable output; will use `pdfplumber` for the real run for table-aware extraction. Total reconciliation (sum of lines vs printed total) as integrity check.
- **Recovery sources priority:** Connor's PDFs > Apr 20 snapshot lines > invoice fossils > localStorage cache.

### Sequencing

**Prerequisite (NOT YET DONE — picking up 2026-04-29):** Execute [docs/dev-environment-setup.md](docs/dev-environment-setup.md) to stand up `amplified-aos-dev` Supabase project + `dev` git branch + Vercel Preview env vars. Runbook is committed but never executed. Steps requiring John: create Supabase dev project (Step 1), add Vercel Preview env vars (Step 5, do NOT click "All environments"), reset auth.users passwords on dev. Steps Claude can drive once given connection strings: pg_dump prod / psql restore to dev (Step 2), create dev branch + push (Step 6), verify (Step 7).

**Order of operations after dev is live:**
1. Apply schema migration to dev only. Verify cloned data still works.
2. Rewrite quote builder + build two new screens on the `dev` branch. Verify on Preview URL.
3. Connor sends complete PDF library (quotes + invoices). Place in `recovery/pdfs/{quotes,invoices}/` (gitignored).
4. Build PDF parser script in `recovery/scripts/`. Run extraction → JSON output. Run reconciliation report against dev DB. Categorize: clean / overwritten / missing / extra. Human review.
5. Recovery import on dev: create new quote rows from PDFs for the lost historical entities (~16–17). Repoint invoice `quote_id` FKs based on snapshot content match.
6. Verify dev recovery is clean end-to-end.
7. Replay on prod: same migration SQL, merge `dev → main`, run recovery script against prod.
8. Update `feedback_deployment.md` memory note for dev-first workflow.

### Open items (to address in future sessions)

- Get connection strings from John once dev Supabase project is provisioned.
- Get Connor's full PDF library.
- Confirm `recovery/` folder structure (currently: `recovery/pdfs/{quotes,invoices}/`, `recovery/scripts/`, `recovery/extracted/`) is gitignored before committing anything.
- Consider whether `clients.code` already has 3-char restriction (separate todo entry below).
- The Connor invoice `INV-2026-0427-875` is currently `status=draft` in DB — decide whether it should stay draft or be marked `sent` since the PDF went to client.

### Reference: Files we touched / read for analysis

- [components/shared/quote-builder.tsx](components/shared/quote-builder.tsx) — slug logic, draft load/save, autosave, saveQuote, saveInvoiceDraft
- [lib/store/db.ts](lib/store/db.ts) — upsertQuote, syncing, draft workspace handlers
- `recovery/pdfs/quotes/Signed_AES_26051117_EST_LNC_MIAMIU.pdf` + `recovery/pdfs/invoices/AES_26051117_DEP_LNC_MIAMIU.pdf` — Connor's samples for PDF feasibility check
- `recovery/extracted/quote_test.txt` + `recovery/extracted/invoice_test.txt` — proof-of-concept extracted text

---

## Phase 3: Add customers master table (do before further quote/invoice normalization)

**Why:** `client` is a free-text field duplicated across quotes, invoices, job_requests, calendar_events, job_sheets, job_costing_drafts, and rate_card_profiles. No contact info, billing address, or history is stored. A `customers` table would be the FK anchor for all subsequent normalization of those tables.

**How to apply:** Create `customers` table (id, name, contact info, billing address, notes, is_active). Build a Customer Maintenance UI. Migrate existing `client` text fields — deduplicate first since same client may be spelled differently across tables. Then add `customer_id` FK to each table and deprecate the `client` text columns. Rate card profiles should also link to customer_id instead of storing client_name.

**Dependency:** Do this before normalizing quote lines / invoice lines further, so those tables get customer_id from the start.

---

## Drop app_rate_state table

**Why:** Was used as a scratch pad for the working rate card rows, but caused bugs when old-format rows (no specialtyId, old position names) were loaded after Phase 2 normalization. Rate card rows now live in named profiles via `rate_card_profile_rows`. The working session state defaults to `DEFAULT_RATE_ROWS` each session.

**How to apply:** When ready: drop `rate_rows` key from app_rate_state table, then drop the table itself once `terms` and `client_name` are also migrated or dropped. The `syncRateState("rate_rows", ...)` write is already removed; read is already skipped.

## Drop quotes.lines and invoices.lines JSONB columns

**Why:** Replaced by normalized `quote_lines` and `invoice_lines` child tables. JSONB columns are now stale. Kept temporarily for safety.

## Drop rate_card_profiles.rows JSONB column

**Why:** Replaced by `rate_card_profile_rows` normalized table. JSONB kept temporarily for fallback.

## Drop quotes_lines_backup and invoices_lines_backup tables

**Why:** Created as backup during normalization migration. Safe to drop after production validation.

## Enforce client consistency across job ↔ quote ↔ rate card ↔ invoice

**Why (found 2026-06-02 on Carolina Country Music Fest, `jobreq-1779670159567`):**

| Layer | client_id | client name |
|---|---|---|
| Job (`job_requests.client_id`) | `clt-new-lnc` | Loud&Clear, Inc. |
| Quote (`quotes.client_id`) | `clt-1779804875904` | **CCMF, LLC** |
| Quote's rate card (`rate_card_profiles.client_id`) | `clt-1779804875904` | **CCMF, LLC** |
| Invoices (5 of them) | `clt-1779804875904` | **CCMF, LLC** |

The quote→rate-card→invoice chain is internally consistent (all CCMF, LLC), but the **quote is on a different client than the job it's attached to**. Real-world impact: invoices billed to one entity using another entity's rate card, with nobody noticing.

**Three sources to plug:**

1. **Quote builder picker / "new quote" flow:** when creating a quote tied to a job, the quote's client_id should be force-set from `jr.client_id`. Don't let the operator pick.

2. **Rate-card picker on the quote builder:** filter to rate cards whose `client_id` matches the quote's `client_id` (= the job's client_id), plus any system-default profiles flagged cross-client. Today the dropdown shows every active profile system-wide.

3. **Client change after the fact:** changing `job_requests.client_id` after a quote/invoice exists silently invalidates the snapshot. The job-edit UI must either (a) block client changes once a quote/invoice exists, (b) warn loudly and offer to re-snapshot from the new client, or (c) clear `quotes.rate_card_profile_id` + cascade to invoice and force a re-pick.

**Defense in depth:** add a CHECK constraint / trigger that asserts at INSERT/UPDATE:

```
quotes.client_id = (SELECT client_id FROM job_requests WHERE id = quotes.job_request_id)
rate_card_profiles.client_id = quotes.client_id  -- for any rate card a quote references
invoices.client_id = quotes.client_id            -- for any invoice generated from a quote
```

Refuse to save if mismatched.

**Audit migration:** sweep prod for all (job, quote, invoice) chains whose client_ids don't match. Flag for reconciliation before turning the constraint on. **Carolina is at least one chain (1 quote + 5 invoices) that will need to be fixed manually.** Likely more across the DB.

**Cosmetic side-note:** the quote_id text for Carolina is `ccmf,-llc-carolina-country-music-fest-2026-05-31` — so the quote was clearly created when the job was on CCMF, LLC, then somebody flipped the job's client to L&C afterwards. The quote_id pattern is a useful breadcrumb for audit (any quote_id whose client-name slug differs from its job's current client probably had a client switch).

## Introduce `timesheet_days` table — peer of `job_request_days`

**Why (decided 2026-06-02):** holiday-flag, day call time, day-level notes, etc. are currently denormalized onto each `timesheet_entries` row, which is a UX trap. The per-row Holiday checkbox UI was already removed (replaced with a read-only badge derived from `job_request_days.is_holiday`) in this session, but the schema still allows per-row divergence. Real fix: move day-level concerns to a parent record.

**Mirrors the plan side.** `job_request_days` already exists (`event_date`, `is_holiday`, `call_time`, `start_time`, `end_time`, `expected_hours`, `notes`, `sort_order`). The timesheet side should have a near-identical shape — same column set, same lifecycle, owned by the timesheet instead of the job request.

**Proposed schema:**

```
timesheet_days
  id text PK
  timesheet_id text NOT NULL → timesheets(id)
  work_date date NOT NULL
  is_holiday boolean NOT NULL DEFAULT false
  holiday_multiplier numeric                -- snapshot at row creation
  call_time text
  start_time text
  end_time text
  notes text
  sort_order int NOT NULL DEFAULT 0
  created_at/by, updated_at/by
  UNIQUE (timesheet_id, work_date)

timesheet_entries
  + timesheet_day_id text NOT NULL → timesheet_days(id) ON DELETE CASCADE
```

**Migration plan:**

1. Create `timesheet_days` with RLS + grants (see `feedback_rls_policy.md`).
2. Backfill: `INSERT INTO timesheet_days SELECT DISTINCT timesheet_id, work_date, MAX(is_holiday), MAX(holiday_multiplier) FROM timesheet_entries GROUP BY timesheet_id, work_date;`
3. Add `timesheet_entries.timesheet_day_id`, backfill from the parent.
4. Update every read site (mainly `lib/store/timekeeping.ts` summary fns + `lib/store/invoices.ts:686+` overwriteFromTimesheets) to read holiday flag from the day, not the entry.
5. Drop `timesheet_entries.is_holiday` and `holiday_multiplier` (and bill_*_rate columns from the other queued cleanup) in one denormalization-cleanup migration.
6. UI: day-separator row becomes a real day record with editable call time / notes; can support day-level approval too (approve all entries on a day).

**Reuses pattern from:** `job_request_days` shape + the holiday-handling design in `project_holiday_handling.md`.

**Sequencing:** do AFTER the bill-rates read-only display has shipped + stuck (already done 2026-06-02), so we don't have two concurrent timekeeping schema changes in flight. Probably bundle with the bill-rates column drop as one "timesheet_entries denormalization cleanup" migration.

## Drop timesheet bill rate columns; compute from rate card

**Why:** `timesheet_entries.bill_std_rate / bill_ot_rate / bill_dt_rate / bill_total` are denormalized stale defaults. `blankTimeEntry()` hardcodes 35/52/70 and operators can edit them via dropdown, but those values are **ignored at invoice time** — `lib/store/invoices.ts:686-699` builds invoice lines using the rate card snapshot keyed by `specialty_id`, not the timesheet's stored rates. Storing them creates false control (operators think they're setting billing) and staleness risk.

**Near-term fix (already spawned as a separate task 2026-06-02):** make the cells read-only with a live rate-card lookup so Connor sees the rate that will actually be billed. Keeps columns in place.

**This project:** drop the columns entirely.

**How to apply:**
1. Migration: `ALTER TABLE timesheet_entries DROP COLUMN bill_std_rate, DROP COLUMN bill_ot_rate, DROP COLUMN bill_dt_rate, DROP COLUMN bill_total;`
2. Remove from `TimeEntry` type in `lib/store/types.ts` (lines ~105-108).
3. Remove from `blankTimeEntry()` and `computeTimeEntry()` in `lib/store/timekeeping.ts`.
4. Remove from `rowToTimeEntry` / `timeEntryToRow` mappers.
5. Update any UI/summary that displays "bill total" to do the rate-card lookup at render time (the resolver from invoices.ts is reusable).
6. Sequencing: do this AFTER the near-term read-only fix has shipped and stuck for a release cycle, so there's no UI confusion mid-migration.

## Drop job_requests.client text column

**Why:** Replaced by `client_id` FK to the `clients` table. The `client` text field is kept temporarily so downstream tables (quotes, job sheets, etc.) that read `client` by name still work. Once all those tables also use `client_id`, this column can be dropped.

**How to apply:** `ALTER TABLE job_requests DROP COLUMN client;` — remove from `rowToJobRequest`, `jobRequestToRow`, and all UI references.

## Consolidate quote_draft_workspaces into quotes table

**Why:** Drafts and saved quotes are the same concept at different stages. Having two tables creates confusion ("why two lists?"), doubles the client FK maintenance, and adds complexity to deactivation/merge checks. A `status = 'draft'` field on `quotes` plus a `form_state jsonb` column for UI-specific fields (rate modes, day details, deposit %, etc.) would unify them.

**How to apply:** Add `form_state jsonb` and ensure `status = 'draft'` is valid on `quotes`. Migrate existing `quote_draft_workspaces` rows into `quotes`. Update quote builder to load/save drafts from `quotes` table. Drop `quote_draft_workspaces` table.

**Dependency:** Do after current normalization pass is complete.

## Drop quotes.client text column

**Why:** Replaced by `client_id` FK to the `clients` table. The `client` text field is auto-populated from the dropdown for backward compat but is no longer user-editable. Once all downstream references use `client_id`, this column can be dropped.

**How to apply:** `ALTER TABLE quotes DROP COLUMN client;` — remove from `rowToQuote`, `quoteToRow`, and all display references that use `q.client`.

## Bidirectional quote ↔ invoice navigation + display_code snapshot

**Why:** Invoices have `quote_id` but the UI doesn't surface "this invoice came from quote LNC-00042" prominently. With the new sequential display codes, that link becomes human-meaningful and useful. Also: invoices outlast operational data, so capturing the quote's `display_code` as a snapshot string on the invoice (separate from the FK) preserves the historical link even if anything ever reshuffles quote ids.

**How to apply:** On the invoice detail/print view, render "Source quote: <display_code>" as a clickable link to the read-only quote view. On invoice generation, snapshot `quotes.display_code` into a new `invoices.source_quote_code` text column. Keep `quote_id` FK as the canonical join. Pair this work with the invoice rewrite.

## Invoice corrections after send (workflow design)

**Why:** Once an invoice is sent (status='sent') or paid, it's effectively a legal document. Mistakes happen — wrong amount, wrong dates, wrong line items. Need a deliberate workflow for corrections that preserves audit trail.

**Discussed 2026-04-29.** Three patterns considered:
1. **Void + Reissue (Option A)** — mark original as void/superseded, create a new corrected invoice with `parent_invoice_id` chain. Audit-friendly. **Recommended for the rewrite.**
2. **Edit in place (Option B)** — flip status back to draft, edit, flip to sent. The current app supports this via the "🔒 marked paid" banner mechanism (presumably also for 'sent'). Lossy audit trail. Acceptable today as a stopgap.
3. **Credit memo (Option C)** — issue a negative invoice that cancels the original, then a new corrected invoice. Standard accounting practice. Requires a credit-memo concept the app doesn't have. Future addition after the rewrite ships.

**Today's recommendation:** train admins to use Option B (status flip on the invoice screen). Don't re-click Save Invoice Draft on the quote when an invoice is already sent (the warning prompt covers that).

**Rewrite plan (already in [docs/system-flow-rewrite.md](docs/system-flow-rewrite.md) Section 11):** Option A becomes primary — invoices freeze on issue, "Revise" button clones to a new draft with `parent_invoice_id` set, on issue the original is marked `superseded`. Add `void` to the status enum so a fully-cancelled invoice (not just superseded by revision) is distinguishable.

**Future:** Option C (credit memos) once the freeze + revise pattern is solid. Would need a new `credit_memos` table or a `kind` discriminator on invoices.

## Add invoice_type column to invoices

**Why:** Today, deposit vs. final invoice is encoded by a `-DEP` string suffix on `invoice_no`. Brittle — typos creep in, and we've already seen corruption like `INV-2026-0423-422-DEP-DEP` (a deposit of a deposit). Need a typed column so consumers (the new Quotes screen, reporting, etc.) can group/filter cleanly without regex parsing.

**How to apply:** Add `invoice_type text not null default 'final' check (invoice_type in ('deposit','final'))` to invoices. Backfill: any row whose `invoice_no` ends in `-DEP` → `'deposit'`, else `'final'`. Update `saveInvoiceDraft()` to set the type explicitly when generating a deposit. Eventually drop the `-DEP` suffix convention on `invoice_no` once the column is the source of truth.

## Active-pointer-in-localStorage pollution (system-wide)

**Why:** Every major screen stores a "currently-loaded" entity id in localStorage (`aes_active_quote_v1`, `aes_active_invoice_v2`, `aes_active_quote_draft_v1`, `aes_active_job_sheet_v2`, `aes_active_job_costing_v1`, `aes_active_employee_v1`, etc.). On screen mount, the app auto-loads that entity. There's no in-app "start fresh" affordance on any screen. Two consequences observed during 2026-04-29 hot-fix testing:

1. Stale pointers tie a user to a record long after they meant to move on. Connor's slug stayed in `aes_active_quote_v1` and `aes_active_invoice_v2` for John's session, silently auto-loading the corrupted Miami quote on every refresh — the test client's data was being layered on top of Connor's row in React state without anyone realizing.
2. A "New" / "Start Fresh" path doesn't actually reset state on most screens. The quote builder's `loadSavedQuote("")` bailed early until the 2026-04-29 fix; other screens may have similar bugs.

**How to apply:** This is part of the bigger rewrite (the Drafts/Quotes screen split addresses it for quotes specifically), but worth tracking system-wide. Either: (a) Add a "New / Start Fresh" button to every entity-edit screen that clears the relevant active pointer + resets form state. (b) Stop auto-loading from localStorage on mount — instead, route the user to a list view by default and require explicit selection. The latter is cleaner long-term but a bigger refactor. Today's fix at [components/shared/quote-builder.tsx:589](components/shared/quote-builder.tsx:589) is the pattern to extend to other screens.

**Affected pointers (audit list):** `aes_active_quote_v1`, `aes_active_invoice_v2`, `aes_active_quote_draft_v1`, `aes_active_job_sheet_v2`, `aes_active_job_costing_v1`, `aes_active_employee_v1`, `aes_active_*` (search the codebase — there may be more).

## Restrict clients.code to 3 characters

**Why:** The `code` field on clients is meant to be a 3-character short code used as a prefix in quote display codes (e.g. `LNC-00042`). Today the field accepts any length, which risks inconsistent dropdown/display formatting. Need to enforce 3-char max in both DB (CHECK constraint) and the Client Maintenance UI input.

**How to apply:** Audit existing client codes for non-3-char values first, fix them, then `ALTER TABLE clients ADD CONSTRAINT clients_code_3chars CHECK (code IS NULL OR length(code) = 3);`. Add `maxLength={3}` and uppercase styling to the input in client-maintenance.tsx.

## Drop clients.bill_to column

**Why:** Seeded from the free-text `bill_to` block on invoices for reference only. Once clients have structured address fields (address, city, state, zip) filled in manually, this column is no longer needed. Displayed as read-only "Historical Billing Address" in the UI to prevent new data entry.

**How to apply:** `ALTER TABLE clients DROP COLUMN bill_to;` — remove the field from `rowToClient`, `upsertClient`, `fetchClients`, `EMPTY_CLIENT`, and the client-maintenance form.

## Merge duplicate client records

**Why:** Validation of saved quotes (2026-04-20) found 5 quotes where the quote's `client_id` doesn't match the linked job_request's `client_id`. Root cause for most: same real-world client exists as multiple rows in `clients`. Causes dropdowns to filter out the linked item since it belongs to a "different" client_id.

**How to apply:** Use the Client Maintenance merge feature (calls `mergeClients` which reassigns FK on all 5 normalized tables). Known duplicate sets (pick a surviving record for each group):
- **Loud & Clear (3+ records):** "loud and clear" (clt-d3df2493ad264c2e0acb85cc72226865), "Loud& Clear, Inc - 10310 Julian Dr. ,  Cincinnati ,  OH  45215" (clt-b5bfd435a8357f3f22148e8791e52bf4), "Loud& Clear, Inc - 10310 Julian Dr. , Cincinnati , OH 45215" (clt-37495ca3bedde2aa86c84454ac9c8515), "Loud&Clear, Inc" (clt-e2f0bf312f3c6573b3e787e993b79920)
- **Richard Vaino / Lighthouse Immersive:** "Richard Vaino - Lighthouse Immersive Cleveland LLC " (clt-07fa6822546fa070a9346695614eaa02), "Richard Vaino - Lightouse Immersive Cleveland LLC - 850 e 72nd st, Cleveland OH" (clt-285eddd4f228e3c12f7a5cf977daf13e) — typo "Lightouse", plus "Lighthouse  Copy Copy" (clt-2fb0df2aefcfc6151bbc630c37fb20b9) — accidental duplicate
- **Rhino Staging:** " Manuel Duque - Rhino Staging" (clt-b428805e91de7f1a1d3453d2f63ff4a5) ↔ "Rhino Staging" (clt-b4a49517f9a8af53abf2f535bc300a0f), plus "Rhino Staging " trailing-space variant (clt-b4a4... is the clean one)
- **Alive Productions:** "Alive Productions, Inc - 7147 Wild Fox Run Ave NW, Massilon, OH" (clt-187fcc5e0e4987ebe12bcd65edc392e3), "Alive Productions" (clt-57ca7602eb621c0b5d49daeeb8b08e1a)

**Also judgment calls** (may or may not be same entity):
- "Susan Ferguson" (clt-5a76d52f66f14dead4acef37f83ddda3) vs "Alive Productions, Inc - 7147 Wild Fox Run Ave NW, Massilon, OH" (clt-187fcc5e0e4987ebe12bcd65edc392e3) — person vs company
- "Aaron Green - Jayson Entertainment Group" (clt-5b575f6f9c0fe2c98724ab45e76e8f91) vs "The Ohio Country Fest" (clt-5f3e5d6d06543cf07b5e04a133623d3f) — organizer vs event

## Labor Summary — add daily breakdown for quotes + invoices

**Why:** The "Labor Summary for Quotes" and "Labor Summary for Invoices" sections at the bottom of the Timekeeping page currently aggregate hours/pay across the WHOLE timesheet (one row per Position, summing across all days). For multi-day jobs this loses information — quote/invoice reconciliation needs per-day-per-position counts to validate "we billed for 4 stagehands × 8 hrs on day 1, 8 stagehands × 10 hrs on day 2", not just "12 stagehand-shifts × 9 hrs avg".

**Where:** [components/shared/timekeeping.tsx](components/shared/timekeeping.tsx) — both summary tables near the bottom (`Labor Summary for Quotes` and `Labor Summary for Invoices` sections).

**How to apply:**
- Group by (work_date, position) instead of just position
- Render: one section per day (day header), each containing the existing position-level rows
- Or: same flat table but with a Day column added before Position
- Should respect the day filter dropdown (when filtered to one day, only that day's summary shows)
- Mirror the change in both Quotes and Invoices summaries

**Sequencing:** Pairs naturally with the per-day timesheet expansion work (when "Add Crew from Job Sheet" starts generating one row per worker per day, this summary becomes more valuable). Can ship before that change too — it just makes existing multi-day timesheets more legible.

**Connor's note (2026-07-16):** Same ask, on the **invoice hours layout** specifically. Keep the total man-hours for the whole project, but **show the math for each line** — each line should display the hours breakdown that rolls up into the project total (e.g. `4 × 8 hrs`), not just a single aggregate number. This is the invoice-output side of the per-day/per-position breakdown above; carry it through to the invoice PDF ([components/shared/invoice-pdf-view.tsx](components/shared/invoice-pdf-view.tsx)), not only the on-screen Labor Summary.

## Remove the rate card (Rate Schedule) from the quote PDF (added 2026-07-16)

**BUILT 2026-07-18** on `feature/quote-pdf-rate-schedule-toggle` (commit `5d86df0`), pending dev merge + preview test. Decision (John, 7/18): gate it behind a toggle rather than delete — an "Include rate schedule" checkbox on the PDF preview next to the Print/Save button, **default OFF** (driven by a `?rates=1` URL param, same pattern as the orientation/detail toggles). The rate-card fetch is skipped entirely when off.

**Connor's note (2026-07-16):** Remove the rate card from the quote PDF — clients shouldn't get the full rate schedule on the quote they receive.

**Why:** The quote PDF rendered a "Rate Schedule" appendix built from the quote's rate card profile — every position/specialty rate — unconditionally, in [components/shared/quote-pdf-view.tsx](components/shared/quote-pdf-view.tsx).

## Revamp the printed timesheet PDF for legibility (added 2026-07-16)

**Connor's note (2026-07-16):** The PDF timesheet needs to be revamped to be a little more legible.

**Why:** The printed/exported timesheet (print mode of the Timekeeping page) is hard to read as-is. This is presentation-only — no data-model change.

**How to apply:** Improve the print layout in [components/shared/timekeeping.tsx](components/shared/timekeeping.tsx) — the `@media print` styles and the day-grouped print rows (print mode forces all days expanded, ~line 259+). Likely wins: larger/clearer type, better column spacing and alignment, clearer day separators, avoid row cramping and awkward page breaks. Get a sample print from Connor to target the specific pain points before styling.

## ~~Shifts master tables + structured shift handling~~ — DECIDED: keep freeform

**Status:** **Closed 2026-05-01.** Decision: leave `shift_label` as freeform text on quote_lines and invoice_lines. Do not normalize to `shift_types` / `job_shifts`. Design analysis preserved at [docs/shifts-design-analysis.md](docs/shifts-design-analysis.md) for context, but no work scheduled. Also closes the duplicate "Normalize Shift with a lookup table" entry below.

**Why:** Today `shift_label` is free text on `quote_lines` and `invoice_lines` only. 60% of rows are "Shift 1", 26% NULL, and the largest quote in the system (Pro Football HOF, 55 lines across 6 days) labels everything "Shift 1" — meaningful separation is by `quote_date`, not shift. The few rows with real labels (`Load In`, `SHOW`, `OVERNIGHT`, `DAY 1`) show users were reaching for AV-industry-standard shift kinds without a controlled vocabulary. Auto-numbered Shift 2..54 is junk from the UI's default-value pattern.

**Recommended design (per the doc):**
- `shift_types` org-level catalog (~10 rows: LOADIN, SETUP, SOUND_CHECK, SHOW, STRIKE, LOADOUT, OVERNIGHT, DAY) with default start/end times.
- `job_shifts` per-event instances with concrete `start_at`/`end_at`, references `shift_types` and `quotes(id)` (or `jobs(id)` post-rewrite).
- `quote_lines.shift_id` and `invoice_lines.shift_id` FKs replacing free-text `shift_label`.
- Eventually extend the FK to `job_sheet_workers` and `timesheet_entries` for end-to-end traceability ("which Load-In hours got billed?").

**Org-level for the catalog. Job-level for the times. Not client-level** — no evidence in the data that shift conventions vary by client.

**Five open questions** (in the doc, section 6): backfill aggressiveness; multi-shift days; worker-to-many-shifts assignment; sequencing vs the quote rewrite; final dropdown content.

**Sequencing recommendation:** ship `shift_types` + `job_shifts` + line FKs **before** the quote rewrite, so the rewrite incorporates shifts as a first-class concept. ~1 day of work for v1, then live with it for a week before extending to job sheets / timesheets / backfill of historical rows.

## Editable Master Default rate card (move defaults from code to DB)

**Why:** Today the `+ New Rate Card` button seeds rows from `DEFAULT_RATE_ROWS` hardcoded in [lib/rates/defaults.ts](lib/rates/defaults.ts) (29 rows: Stagehand $35, Climber $50, etc.). Changing the defaults requires a code edit + redeploy. Should be admin-editable through the same rate-card UI users already know.

**How to apply:**
1. Migration to seed a single rate card profile that represents the master default:
   - `id = 'ratecard-master-default'` (or some sentinel)
   - `client_id IS NULL`
   - `name = 'Master Default'`
   - Seed `rate_card_profile_rows` from the current `DEFAULT_RATE_ROWS` constant.
2. Editor wiring: when `startNewRateCard()` runs, read rows from this profile via `loadRateCardProfiles()` and use those instead of the hardcoded `DEFAULT_RATE_ROWS`. Fall back to the constant if the master default profile is missing (defensive).
3. Visually mark the master default row in the Saved Rate Cards dropdown (italic, prefix like "🔧 Master Default") so it's obvious that editing it changes the seed for new cards.
4. Optional: lock the `client_id` field on the master default to disallow accidentally pinning it to a client. Or hide it from selection altogether and surface it only via a separate "Edit Default Template" button.
5. Deprecate `DEFAULT_RATE_ROWS` constant once the DB-driven path is verified — leave the file as a one-time seed source then delete the export.

**Tradeoffs:** small migration + ~10 lines of editor wiring, but makes John self-sufficient on rate updates without dev/redeploy churn. Same direction as how positions/specialties moved from code to DB.

## Use rate_card_profiles.effective_date in downstream pickers

**Why:** As of 2026-04-29 rate cards have an optional `effective_date`. The intent is that a client can have multiple versions of the same named card across time (e.g. "Standard" effective 2025-01-01 and "Standard" effective 2026-06-01) and downstream sections should automatically pick the right one for the event being priced.

**How to apply:** When a screen needs a rate card for a specific event date (quote builder, invoice builder, possibly job sheet for any rate-aware view), pick the latest profile where:
- `client_id = event.client_id`
- `effective_date is null OR effective_date <= event.start_date`
- ordered by `effective_date desc nulls last`, taking the first row.

If multiple cards by name exist for that client, this filter applied per-name pick gives the right version. The UI's "rate card" dropdown should still list all of them so the user can override; the auto-pick is just a default.

**Likely entry points:**
- `components/shared/quote-builder.tsx` — rate card selector currently picks by id; default it via the rule above when client + start_date are both known.
- `components/shared/invoice-builder.tsx` — same pattern.

**Dependency:** ships after the quote system rewrite (Phase A) so we're not duplicating logic across the soon-to-be-replaced builder.

## Universal calendar export (.ics + multi-provider)

**Why:** Today the job request screen has a single "Add to Google Calendar" button that opens Google's `action=TEMPLATE` deep-link. Users on Outlook, Apple Calendar, Thunderbird etc. have no equivalent. Same screen exists on Master Calendar (`googleCalendarLink` is used in multiple places). Decision 2026-04-29: ship Google-only for now to keep scope small; revisit when there's a real non-Google user need.

**How to apply when revisited:**
1. Add a small ICS builder utility at `lib/store/calendar-ics.ts` that takes a `CalendarEvent` and returns an RFC 5545–compliant `.ics` string. Use UID = `<source>-<id>@amplified-aos` so re-imports update the same event in clients that honor UID matching (Outlook, Apple). Include DTSTAMP, DTSTART, DTEND, SUMMARY, LOCATION, DESCRIPTION at minimum; add ORGANIZER if we have an email per user.
2. Add a "Download .ics" button alongside the Google Calendar button on:
   - `components/shared/job-requests.tsx`
   - `components/shared/master-calendar.tsx` (single-event modal at line ~423 and per-event card at line ~107)
   - The bulk "all events" action at line ~278 of master-calendar.tsx becomes "download a multi-VEVENT .ics with everything."
3. Optional: Outlook deep-link (`https://outlook.live.com/calendar/0/deeplink/compose?...`) as a third button if the .ics flow proves too clunky for Outlook web users.

**Out of scope:** real two-way sync via Google Calendar API / Microsoft Graph (OAuth, store provider event id back on the row, update vs create on subsequent saves). That's a significant feature, not a button-styling task.

## Repoint fossilized job_requests.linked_quote_id values

**Why:** Same fossilization pattern as the invoice-side Connor incident. When a quote got overwritten via the slug-PK collision bug, the `job_requests.linked_quote_id` still points at the old slug — but that row's content has since been replaced by an unrelated quote. The job_request now appears to link to the wrong event/client. This is independent of the quote-system rewrite (the rewrite changes schema; this re-points existing data).

**How to apply:**
1. Audit query — find job_requests whose linked quote's content doesn't match:
   ```sql
   select jr.id as job_req_id, jr.client_id as jr_client, jr.event_name as jr_event, jr.request_date as jr_date,
          q.id as quote_id, q.client_id as q_client, q.event_name as q_event, q.start_date as q_date
     from job_requests jr
     join quotes q on q.id = jr.linked_quote_id
    where jr.linked_quote_id is not null
      and (jr.client_id is distinct from q.client_id
           or lower(trim(jr.event_name)) <> lower(trim(q.event_name))
           or jr.request_date is distinct from q.start_date);
   ```
2. For each mismatch, decide: re-point to the correct recovered quote (if Phase A recovery has run and the right quote exists), or NULL the link if the original quote is unrecoverable.
3. Bulk-update via SQL once mappings are confirmed.

**Dependency:** Easier to do *after* Phase A recovery has imported the lost historical quotes from PDFs, since some correct targets don't exist yet. But the audit query can be run today to surface the size of the problem.

## Decide on labor-pool / external-contractor client seeding

**Why:** After the historical calendar_events backfill (migrations 20260420i, 20260420j), ~62 distinct `client` text values on 2024-era calendar_events remain with no `client_id`. These are external labor-pool/contracting clients (Dance One, Encore, L!VE, Power Productions, Solotech, Nationwide Arena, etc.), most with their own variant spellings (Dance One/DanceOne, Encore/Encore Global/Encore/Norm/Encore/Brad/Encore/Moyer/Encore/Molisee, L!VE/L!ve/Live/Live Tech/Live Technologies, Mercury/Mercury Sound and Lighting/MSL, Nationwide Arena/NWA, Performance Stage/Performance Staging, Rock the House/Rock The House Ent./RTH, Smart Source/SmartSource, Solotech/Solotech Productions, Above Sound and Lighting/Above Sound and Lightning, AVPG/AVPGI).

**How to apply:** Decide with the business whether any of these are ongoing clients that need proper records with codes. If so, create canonical client rows (like JAY/LNC/etc.) and backfill calendar_events via a migration using lower(trim(client)) matching. If these are purely historical reference, leave them with NULL client_id — they still display the text name in the calendar UI.

## Drop snapshot_20260420_* backup tables

**Why:** Created on 2026-04-20 as a safety net before dropping the legacy JSONB `quotes.lines` / `invoices.lines` columns and confirming normalized line data is correct. Contents: `snapshot_20260420_quotes_lines_jsonb` (12 rows), `snapshot_20260420_invoices_lines_jsonb` (18 rows), `snapshot_20260420_quote_lines` (138 rows), `snapshot_20260420_invoice_lines` (97 rows).

**How to apply (after confidence period):**
```sql
DROP TABLE IF EXISTS snapshot_20260420_quotes_lines_jsonb;
DROP TABLE IF EXISTS snapshot_20260420_invoices_lines_jsonb;
DROP TABLE IF EXISTS snapshot_20260420_quote_lines;
DROP TABLE IF EXISTS snapshot_20260420_invoice_lines;
```

## Drop service_key column from quote_lines and invoice_lines

**Why:** `service_key` is a legacy composite text column built from date / department / position / specialty / rateMode joined by `" | "`. It predates the normalized discrete columns (department, specialty, quote_date, rate_mode) and the new FK columns (position_id, specialty_id). Every piece of data it contains is now available in proper structured columns. The UI still reads it as a last-ditch fallback when discrete columns are null, but after migration `20260420n` that case should never occur — the fallback is dead weight.

**How to apply:**
1. Confirm via a SELECT that no quote_lines/invoice_lines have non-null service_key AND null department (or any other discrete field).
2. Remove the `parseLineMeta` service_key parsing path in `components/shared/invoice-builder.tsx` and the matching 6-part / 5-part fallback in `components/shared/quote-builder.tsx` `loadSavedQuote` / `resolveIdsForLine`.
3. Remove `buildServiceKey` + `service_key` writes from quote builder `saveQuote`, `quoteLineToRow`, `invoiceLineToRow`.
4. `ALTER TABLE quote_lines DROP COLUMN service_key;`
5. `ALTER TABLE invoice_lines DROP COLUMN service_key;`

**Dependency:** after user confidence period that no edge cases still need the string fallback. Low-risk since discrete columns fully cover it.

## Consider renaming quote_lines / invoice_lines `department` text column to `position`

**Why:** The `department` text column on line items is a legacy name — it actually stores the position name (backward-compat duplicate of position, as annotated in `RateRow.department // derived = position name`). Now that `position_id` FK is the primary reference and we're doing Position/Specialty UI everywhere, the column name is misleading.

**Options:**
1. Rename `quote_lines.department` → `quote_lines.position`, same for invoice_lines. Update all mappers / UI references.
2. Leave as-is. The UI already uses `position_id`; the text column is just a snapshot label. Not worth the churn.

**Recommendation:** do #1 only if we touch line items again for another reason. Otherwise #2 — the cost outweighs the benefit.

## ~~Normalize Shift with a lookup table~~ — DECIDED: keep freeform (2026-05-01)

Closed. See the "Shifts master tables + structured shift handling" section above for the same decision.

## Re-save quotes and invoices with legacy Fork Op / Labor line items

**Why:** After migration 20260420m added `position_id` / `specialty_id` FKs to quote_lines and invoice_lines, 26 rows did not auto-seed because the text `department` on those rows uses old position names ("Fork Op" before it was renamed to "Forklift Operator") or ambiguous text ("Labor" that couldn't be disambiguated between Stagehand/Labor, General Labor, and the new Forklift Operator/Labor). The UI fallback renders these rows correctly by name match, but re-saving them through the builder will populate the FK columns.

**Records to re-save:**

Quotes (2) — open each, pick **Forklift Operator / Shop** on the "Fork Op" lines, save:
- `fep live, llc-pro football hall of fame 2026 enshrinement week-2026-08-05` — FEP Live, LLC — Pro Football Hall of Fame
- `fep-live,-llc-pro-football-hall-of-fame-2026-enshrinement-week-2026-08-05` — Loud&Clear, Inc. — KY Event

Invoices (2) — open each, pick the right Position/Specialty, save:
- `INV-2026-0401-127` — Loud&Clear / KY Event — pick **Forklift Operator / Shop** on Fork Op lines
- `INV-2026-0330-637` — Sunbelt Ground Protection Division / Flooring Install — pick **Forklift Operator / Labor** on the one Labor line

**Verification:** after all 4 are saved, re-run the unmatched-rows query from migration `20260420m` — should return zero rows.

**Note:** invoice builder UI hasn't been refactored yet to split Position + Specialty into two dropdowns (still on the follow-up task list). For invoices, pick the concatenated `"Forklift Operator | Shop"` / `"Forklift Operator | Labor"` value in the existing dropdown.

## ~~Fix mergeClients to refresh in-memory cache for all normalized tables~~ — DONE 2026-06-12

**Shipped to prod 2026-06-12** (commit `7ce0112`, verified on dev Preview first; deployed alongside the new-version refresh banner). `mergeClients` now reassigns `clientId` + denormalized name in-memory across quotes, invoiceDrafts, jobRequests, manualEvents, jobSheets, jobCostingDrafts, rateCardProfiles.

## Proper accounting-format payment tracking

**Why:** Invoices currently track `paidAmount` as a single scalar number. That's enough to compute balances but can't answer "what payments came in this month" or "which deposits match this bank statement line." Need individual payment records.

**How to apply:** Add an `invoice_payments` table (id, invoice_id FK, amount, paid_date, method, reference/memo, notes). Replace the single `paidAmount` column reads with a sum from invoice_payments. Keep `paidAmount` on the invoice for now as a denormalized cache or drop it. Build a small UI on each invoice to add/edit/delete payments. Later: a Payments dashboard and bank-statement reconciliation (match payments to imported transactions).

## #20 — Automated status transitions (pg_cron nightly sweep) + scheduled-task pattern (added 2026-07-20)

**Why:** Jobs go stale by hand today — leads/quotes whose event date passed months ago still sit "active", and booked jobs past their end date linger until someone flips them. John wants automated status transitions (first examples: job more than X days old → closed; lead/quoted past the event date → status change). This entry is also the **pattern-setter for all future scheduled tasks** in the app.

**Tool decision (settled 2026-07-20, verified against the dev project):** use **Supabase pg_cron** for deterministic data rules. It's already installed (v1.6.4) and already in use (`monitoring-capture-15m` job). Rules like these are pure SQL — no server, no HTTP, no dependency on Vercel plan or deployment. Reserve **Vercel Cron** (vercel.json `crons` → secured API route) for tasks needing app code (emails, PDFs, TS business logic); reserve **Claude agents/routines** for judgment tasks (weekly "these jobs look stalled" digest), never for deterministic rules. Rule of thumb: if the condition is a WHERE clause, it's pg_cron.

**The re-flip problem + inactivity timer (John, 2026-07-20):** if the sweep closes a job past its timeline and an operator re-opens it to keep working, a naive sweep re-closes it the next night. Fix: gate every rule on an **inactivity window in conjunction with the date rule** — only act when nothing has happened on the job since N days. A re-opened job has fresh activity, so it's excluded; if it goes dormant again for the full window, re-closing it is then the *correct* behavior.

**How to apply (sketch):**
- Nightly `aos-status-sweep` job scheduled via `cron.schedule()` in a normal SQL migration (dev first, prod at promotion — cron schedules are per-database, so each env gets the migration like any other).
- Every rule has the shape: `WHERE <status precondition> AND <date condition> AND <last_activity older than N days>`.
- **Activity definition:** v1 = `job_requests.updated_at` where the update wasn't made by the sweep itself. Better = `greatest(job.updated_at, latest related-record activity)` (timesheet entries, quotes, invoices, assignments touching that job) — decide how deep to go at build time.
- **Audit trail is mandatory:** sweep stamps a system actor (e.g. `updated_by = 'system-sweep'`) and logs old→new status + rule name + timestamp (small `status_sweep_log` table), so "why did this job close itself?" always has an answer. The system actor is also what lets the activity check exclude the sweep's own writes.
- **Split rules by confidence:** unambiguous ones auto-flip (e.g. lead/quoted, event date 60+ days past, no activity 30 days → lost/closed). Ambiguous ones (booked past end date — may still need timekeeping approval + invoicing) go to a **"needs attention" surface instead of auto-flipping** — natural fit with the #18 dashboard drill-down work. Promote a rule from "surface" to "auto-flip" only after it's proven trustworthy.
- Concrete rules + X/N day values: draft with John/Connor at build time.

## #19 — Jobs screen: calendar view toggle (added 2026-07-20)

**Why:** The Jobs screen ([components/shared/jobs-list.tsx](../components/shared/jobs-list.tsx)) is list-only. For scheduling questions ("what's on the books in May?", "which leads overlap that weekend?") a table sorted by start date is the wrong shape — the Master Calendar exists but shows everything, with its own filters, disconnected from the list the user has already narrowed down.

**Requested flow (John, 2026-07-20):** a button on the Jobs list to "View in calendar mode" — renders the same jobs as a calendar, using **whatever filter is active at the time** (the status dropdown: Active / All / Lead / Quoted / Booked / Completed / Lost, plus the search box). Flip back to list mode the same way.

**How to apply (sketch — design at build time):**
- Add a view-mode toggle (List | Calendar) next to the status filter dropdown; persist choice in component state (optionally a URL param so it survives refresh/back).
- Both views render from the same `filtered` rows already computed in the `useMemo` (statusFilter + search) — the calendar is a presentation swap, not a new query, so it always matches "N of M jobs".
- Jobs render as spans from start date through end date (multi-day jobs cover their full range); color/badge by status matching the list's status chips.
- Click a calendar entry → same navigation as clicking a row in the list (job detail screen).
- Reuse/extract the month-grid rendering from [components/shared/master-calendar.tsx](../components/shared/master-calendar.tsx) rather than building a second calendar — a shared month-grid component fed different event arrays would serve both screens.
- Master Calendar remains the everything-view (manual events, etc.); this is scoped to the Jobs screen's own rows.

## #18 — Dashboard metric cards → drill-down list screens (added 2026-07-20)

**Why:** The four top-level metric cards on the dashboard ([components/shared/dashboard.tsx](../components/shared/dashboard.tsx) ~line 305: Revenue MTD, Outstanding, Awaiting Approval, Events Next 7 Days) show only a headline number. To act on any of them (e.g. "which invoices are outstanding?", "which timesheet rows need approval?") the user has to navigate to the relevant maintenance screen and re-derive the filter by hand.

**Requested flow (John, 2026-07-20):** click a metric card → a drill-down screen listing the entries that make up that number → click a list entry → the specific maintenance screen for that record (invoice builder, Timekeeping for that job, job sheet, etc.).

**How to apply (sketch — design at build time):**
- Each card becomes clickable (whole card, with cursor/hover affordance).
- Per card, the drill-down list is exactly the rows already computed for the metric, so the list always reconciles with the card's number:
  - **Revenue MTD** → non-draft invoices issued this month (show gross/net/deposit distinction) → invoice screen for that invoice.
  - **Outstanding** → invoices with balance > 0 and status sent/partial, with aging bucket → invoice screen.
  - **Awaiting Approval** → timesheet rows with status='submitted', grouped by job/timesheet → Timekeeping loaded to that job.
  - **Events Next 7 Days** → scheduled job sheets in the window → job sheet / job detail for that event.
- Implementation options: a dedicated route per card, or one generic drill-down screen parameterized by metric — either way, extract the metric computations into shared selector functions so card and list can't drift.
- Deep-linking into maintenance screens must set the target record explicitly rather than relying on the `aes_active_*` localStorage pointers (see "Active-pointer-in-localStorage pollution" — this is a chance to extend the explicit-load pattern).
- Candidate to extend later to the smaller list cards (aging buckets, pending quotes, etc.); the top 4 metric cards are the requested scope.

## Smarter "understaffed" detection for dashboard

**Why:** Dashboard currently flags jobs as understaffed only when a worker row has `confirmed=false`. It doesn't know whether the crew size itself is sufficient — a job sheet with 2 assigned workers for a 10-person event looks fine by that check.

**How to apply:** Compare the job sheet's assigned workers to the linked quote's line-item Qty totals (sum of qty per position/specialty). Flag when `assigned < quoted`. Requires every job to have a linked quote; when a job has no quote, fall back to the unconfirmed-worker check. Optionally add an explicit "headcount needed" field on the job sheet itself.

## Client contacts sub-table with roles

**Why:** A client (law firm, production company, etc.) has multiple people — the GC who signs the contract, an AP clerk who pays invoices, a planner who approves quotes. Today the app stores only a single `contactName` / `email` per client, so there's no way to send the invoice to billing and the quote to the planner.

**How to apply:** Add a `client_contacts` table: `id`, `client_id` FK, `fullName`, `email`, `phone`, `title`, `role` (billing | quotes | sales | logistics | other), `isPrimary` boolean, `notes`, `isActive`. Build a Contacts sub-section in Client Maintenance (list + add/edit modal). When sending a quote or invoice email, default the recipient to the contact matching that role. Keep the legacy single-contact fields on the client row for back-compat until the UI and email flow cut over.

## Online quote review + e-signature (no Adobe / DocuSign)

**Why:** Connor currently emails clients a static quote PDF and chases a wet-signed scan back. Discussed 2026-05-06 — John to talk it over with Connor as a future feature. Goal: let clients review and accept quotes through a tokenized link without buying into Adobe Sign or DocuSign for ordinary commercial quotes.

**Two approaches considered:**
1. **PDF-stamp** — `signature_pad` (canvas) + `pdf-lib` stamps the captured signature into the existing quote PDF.
2. **Web-doc (preferred in conversation)** — tokenized link opens the quote as a web page rendered from the same data, "Accept & Sign" block at the bottom; on submit we record an acceptance row (signature image, typed name, timestamp, IP, user-agent) and generate a locked PDF snapshot for archive. Nicer on mobile, lets us show live status (viewed / accepted / declined).

**Legal posture:** DIY signatures are valid under US ESIGN/UETA for ordinary commercial contracts as long as we capture intent + audit trail. If a regulated/notarized signature is ever required, swap in Dropbox Sign (~$15/mo) for that document only.

**How to apply when scoped:** Build alongside the quote rewrite (Phase A) since it depends on stable, frozen quote rows. Schema sketch: `quote_signature_links` (token, quote_id, sent_at, viewed_at, expires_at) + `quote_signatures` (quote_id, signature_image storage path, signer_name, signer_email, ip, user_agent, signed_at). On accept, transition the quote to `status='signed'` and freeze contents — no silent edits after the link is sent. Storage: Supabase Storage bucket for signature images + snapshot PDFs, following the canonical attachment pattern.

## Email documents (quotes, invoices, rate cards) to customers

**Why:** PDFs are print-only today. Admins save to disk and manually attach to email. Need a "Send to client" button on each document that uses the right contact from the new client_contacts table.

**How to apply:** Generate the PDF server-side (via Supabase Edge Function using Puppeteer or similar) or let the browser generate then upload. Then use a transactional email service (Resend, Postmark, or Supabase's own SMTP) to send to the role-appropriate contact. Store an `email_log` entry per send (recipient, timestamp, doc id, status). UI: "Email to Client" button on the quote / invoice page that opens a confirmation modal with recipient pre-filled from client_contacts + editable subject/body. Depends on the client_contacts table above.

## Update deployment memory note once dev environment is live

**Why:** The existing `feedback_deployment.md` memory entry says "Push directly to main, no PRs; Vercel auto-deploys" — that describes the prod-only flow we have today. Once a dev branch + dev Supabase project + Vercel Preview env vars are wired up (per `docs/dev-environment-setup.md`), the daily workflow changes to: push to `dev` → verify on the Preview URL → merge `dev → main` for prod. The memory note should be rewritten so future sessions follow the new flow by default.

**How to apply:** After dev is verified working, edit `~/.claude/projects/.../memory/feedback_deployment.md` to describe: (1) where to push for dev vs prod, (2) migration discipline (apply to dev first, then prod), (3) the back-merge step after any prod hotfix. Keep it concise — same length as today's note.

---

## Normalize job_sheets to client_id

**Why:** `job_sheets` still stores `client` as free text only — no `client_id` FK. As of 2026-04-27 every other major table (quotes, invoices, job_requests, calendar_events, rate_card_profiles, quote_draft_workspaces) has been migrated to `client_id`. Job sheets are now the lone holdout, which makes cross-table joins fragile (e.g. filtering job sheets by selected client on the invoice screen had to fall back to case-insensitive name matching) and means downstream features that read job sheets can't trust the client linkage.

**How to apply:** Add `client_id text references clients(id)` column to `job_sheets`. Backfill via `lower(trim(client))` match against `clients.name`, plus the historical-event mapping rules already used for calendar_events. Update mappers (`rowToJobSheet` / `jobSheetToRow`), the job-sheet builder UI to use a client dropdown driven by `clients`, and any consumers (timekeeping, invoice/quote sync, dashboard, calendar) that currently read `client` text. Replace the temporary name-match in `components/shared/invoice-builder.tsx` `clientJobSheets` filter with a `client_id === invoice.clientId` comparison. Once verified, drop the `client` text column.

---

## Payroll processing (no buckets yet)

**Why:** Timesheets today just flip to `status='approved'`. Nothing rolls approved hours into pay periods, generates pay stubs, exports to a payroll provider, or tracks taxes/withholding. Coordinator (no-job) entries and crew (job-linked) entries both need to feed into whatever payroll flow we build.

**How to apply:** TBD — decide between (a) export to external payroll (Gusto/ADP/QB) via CSV or API, or (b) build in-app. At minimum need: pay periods (weekly/biweekly), per-employee rate overrides, payroll runs that aggregate approved entries by employee + period, pay stubs, and a lock so approved entries can't be edited after they're included in a run.

**Status (2026-05-31):** Phase 1 + Phase 2 shipped. Module exists with payroll_runs + payroll_run_entries. Pay rates resolve from employee override → job rate card → master. Connor's payroll rules wired in: 5hr daily minimum, round up to whole hour, Sun-Sat weekly 40hr OT spill applied at finalize across this run + other finalized runs. Pay hour buckets (pay_*_hours) live alongside billed (std/ot/dt). See migration `20260531a_payroll_weekly_ot.sql`. Future: CSV/IIF/Gusto export, pay-week-start as a company-wide setting instead of per-run column.

---

## Timesheet std/ot/dt split should derive from the job's billing rule

**Status (2026-06-06): LARGELY RESOLVED.** Migration `20260606a_ot_after_threshold.sql` shipped:
- `rate_card_profile_rows` gets `ot_after` text column (parallels existing `dt_after`).
- `timesheet_entries` gets `bill_ot_after` + `bill_dt_after` int columns. Snapshotted from the rate card at entry creation. NULL = no bucket at this tier.
- `computeTimeEntry` in `lib/store/timekeeping.ts` honors the per-entry thresholds — hardcoded 8/12 default REMOVED entirely (Connor flagged it has bitten multiple times).
- `addCrewFromJob` in `components/shared/timekeeping.tsx` populates the new threshold columns onto new entries from the rate card.
- Rate-card editor defaults `otAfter`/`dtAfter` to "none" (OT/DT premium is opt-in per role).
- CCMF backfill at `docs/data-integrity/ccmf_threshold_backfill.sql` seeds both:
  1. The CCMF rate card row's `ot_after` / `dt_after` to "none".
  2. The existing CCMF timesheet entries' `bill_ot_after` / `bill_dt_after` to 0, recomputes std/ot/dt buckets.

**Original Bruno Mars incident context (preserved for history):** the Bruno Mars job had 102 timesheet entries, all keyed with an OT-after-8 / DT-after-12 split, but the job's quote lines explicitly say OT-after-10 / DT-after-15. The timesheets predate the quote by 10+ days, so the admin had no source-of-truth threshold when entering hours — they defaulted to 8/12 convention. The new mechanism removes the implicit default; operators must set per-role thresholds on the rate card up front.

**OPEN FOLLOW-UPS:**

**1. Propagation prompt when a rate card's thresholds (or rates) change.** Current snapshot pattern means existing non-frozen timesheet entries don't reflect updates to the rate card. The system should: detect non-frozen, non-invoice-bound entries on jobs whose active quote uses the rate card being edited; prompt the operator with "This change affects N entries across M jobs. Apply and recompute their bucket splits?"; on Yes, update entries + recompute via the new `computeTimeEntry` logic. Excludes super-frozen invoice-bound rows automatically.

This is band-aid UX for the unversioned-rate-card model. The cleaner fix is rate-card versioning (see [[project_rate_card_versioning]]) — if/when that ships, this prompt becomes unnecessary. If versioning is delayed, ship the prompt; if versioning is on the near horizon, skip it.

**2. Audit historical jobs for stale 8/12 splits on non-frozen entries.** The Bruno Mars data may still be wrong. Sweep prod after the migration lands to find: entries with `bill_ot_after IS NULL` (legacy = was using the hardcoded default) that are NOT yet on an active invoice. Decide with Connor per-job whether to backfill threshold values + recompute. CCMF is already done by the backfill script above; other jobs still need review.

**3. Rate-card editor UI for the new `ot_after` column.** Today's editor has a `dt_after` cell but no `ot_after` cell. Operators set `ot_after` via SQL only until UI ships. Add the column to both `rate-card-editor.tsx` and `master-rate-card-editor.tsx`, plus default to "none" for new rate cards.

---

## Prospect table (separate from clients, with convert-to-client action)

**Why:** Every lead gets added to `clients` today, so the client list fills up with cold prospects, tire-kickers, and one-off inquiries that never convert. Real customers get buried. Sales team needs its own pipeline view.

**How to apply:** Add a `prospects` table mirroring the key client fields (name, contact info, city/state, notes, source, estimated value) plus prospect-specific fields: `status` (new | contacted | qualified | proposal_sent | won | lost), `source` (referral | website | trade show | cold outreach | other), `ownerUserId`, `lastContactDate`, `nextFollowUpDate`, `estimatedValue`, `probability`. Build a Prospects page with kanban-or-list view. On conversion: copy the prospect into `clients`, mark the prospect `status = won` with a `convertedClientId`, and link any quotes/job_requests already attached to the prospect to the new client row. Job requests should be able to attach to EITHER a prospect or a client during the open phase.

---

## Signed timekeeping document uploads (historical + ongoing)

**Why:** Field crews sign physical (or scanned) job timekeeping sheets at the venue. Today there's nowhere in the app to attach those signed PDFs/images, so the source-of-truth document for hours billed lives outside the system. Need this for both historical jobs (backfill) and going forward (dispute resolution, audits, payroll verification).

**Open question — where do they hang?** Three reasonable homes:
1. **Per-timesheet** (`timesheets` table) — most semantically accurate; one signed sheet per timesheet record. Probably right since a "timesheet" is precisely the thing being signed off on.
2. **Per-job_request** — coarser; one job can have multiple timesheets (multi-day). Loses the "which day was signed" granularity.
3. **Per-job_sheet** — middle ground; matches the document workers actually sign in the field.

User comment: "Not sure where they would go." Resolve before implementing — likely option 1.

**How to apply:** Follow the canonical attachment pattern (see [feedback_attachment_storage_pattern.md](feedback_attachment_storage_pattern.md)). New child table `timesheet_documents` (or `job_sheet_documents` depending on choice) + new Supabase Storage bucket (`timekeeping-signed` or reuse an existing one with a subfolder) + helper module under `lib/storage/`. doc_type enum: `signed_timesheet | scan | photo | other`. RLS full_access + audit trigger. UI: file input + list on the timesheet (or job sheet) detail screen, mirroring the employee-documents UI in `employee-directory.tsx`.

---

## Frozen-quote orphans without job_request_id (audit pass)

After Migration 1 of the quote rewrite (2026-05-04), 18 of 29 quote rows had no resolvable `job_request_id`. The post-flight audit categorized them:

**Test data (3 rows — safe to delete):**
- `test-client-fakeevent-2026-06-01`
- `test-client-any-event.--2026-04-29`
- `test-client-fakeevent-1777471747511`

**Slug-typo duplicates (2 rows — same job, different slug due to typo "Protection" vs "Protections"):**
- `sunbelt-ground-protection-division-flooring-install-2026-03-28`
- `sunbelt-ground-protections-division-flooring-install-2026-03-28`

**Legitimate orphans (13 rows — recovered-from-PDF + 1 legacy slug):**
- 12 `recovered-*` rows from PDF restore (Pro Football HOF, Ohio Country Fest, Scotty McCreery, 2026 Farm Tour California, Miami U Commencement, LIV Golf DC, Warrior Conference x2, OSU Stadium, Luke Combs Load Out, Mount St. Joseph, KY Event)
- 1 legacy slug: Loud&Clear corporate call 2026-03-31

These rows are frozen and display fine, but lack the FK to job_requests. They can't be Revised through the new flow until manually linked to (or have created for them) a matching job_request. Resolve case-by-case during normal operations or as a dedicated cleanup pass.

---

## Hard-delete cleanup project for bad quotes / invoices (with Connor)

**Why:** The freeze trigger blocks DELETE on frozen quotes/invoices by design — once issued, content is immutable + the row is permanent. That's right for the everyday case, but the rewrite has surfaced a lot of legacy garbage:
- Slug-overwritten quote rows (the rhino-staging Luke Combs slug now masquerading as Miami U content)
- `INV-...-DEP-DEP` corruption rows (deposit-of-deposit bug artifacts, $0 subtotals)
- Recovered duplicates that didn't fully match an existing row, plus the original
- Test data that snuck into prod
- `Test Client` rows from QA work
- Empty/cancelled artifacts

These all stay forever as `superseded` or `void` history. With the row counts low (≤50 frozen quotes + invoices on prod today), it's tractable to do a one-time forensic cleanup pass with Connor:

1. Walk every frozen row, decide: keep / supersede-with-context / hard-delete
2. For hard-delete: temporarily disable the freeze trigger, DELETE, recreate trigger
3. Audit ledger entry to track what was deleted and why

**Implementation when ready:**
- `force_delete_quote(quote_id, reason)` and `force_delete_invoice(invoice_id, reason)` SECURITY DEFINER RPCs that:
  - Verify caller is admin (auth.uid() in admin role)
  - Log the deletion + reason + caller to an audit table
  - Cascade-delete child rows (quote_lines, invoice_lines, payment_allocations, etc.)
  - Skip the freeze trigger by SET LOCAL session_replication_role = 'replica'
- Admin-only UI in Maintenance: a dangerous-zone screen listing legacy/garbage candidates with a per-row "Hard delete" button

**When to do it:** after Phase C invoice rewrite is shipped + stable, before adding more downstream tables that would FK to these rows.

---

## Free-form / non-labor line items (future version)

**Why:** Real jobs include charges that aren't crew labor — rental of a piece of equipment we had to bring in, lodging for the crew, last-minute supply purchases passed through to the client, parking, fuel surcharges, per diem, etc. The current system is built around (position × specialty × hours × rate) lines; there's no way to add a free-form line with description + amount on a quote or invoice.

**Touch points across the system:**
- Quote builder: option to add a "Misc" line that takes a description and total — no qty/hours/rate columns required
- Job request: maybe a "Pass-through expenses" section anticipating these (helps the quote builder pre-fill)
- Quote PDF: render misc lines in the daily-grouped section or as a separate "Other charges" block
- Invoice (final): same misc lines flow through; can be edited/added on the invoice draft (one-off charges that came up during the job)
- Job costing: should track these on the actuals side too — actual cost vs quoted pass-through

**Schema thoughts:**
- Could re-use `quote_lines` / `invoice_lines` with a new column like `line_kind text CHECK (line_kind IN ('labor','misc','passthrough'))` defaulting to 'labor'
- 'misc' lines would have `description text` populated, qty/hours/rates NULL or 0, and `total numeric` carrying the amount
- PDF / list / editor display branches on line_kind: labor uses the existing position/specialty/hours columns; misc uses description + amount only

**Implementation ordering:**
- Defer until the quote+invoice rewrite is fully shipped and stable
- Likely Phase G or later, after timesheet-driven invoice lines (Phase F) is settled
- May want to discuss with Connor first to enumerate the actual use cases before designing the schema

---

## ~~Holiday hours~~ — DESIGN FINALIZED 2026-05-24

**See [project_holiday_handling.md](project_holiday_handling.md)** for the day-flag + auto-recalc design (Pattern C, 2× multiplier, no calendar list, per-entity snapshot). Original analysis below kept for context.

---

## Holiday hours: zero detection, zero validation, manual-only — needs Connor discussion

**Filed 2026-05-11.** Discovered while doing the invoice-draft calc fix.

### Current behavior (audit)

The `holidayHours` field exists on every quote_line and invoice_line, drives meaningful money (`holidayHours × dtRate` added to line total), and is **entirely manual** with no system support:

1. **No holiday calendar / table.** No `company_holidays`, `recognized_holidays`, anywhere in `supabase/migrations/`. The list of recognized holidays exists only as PROSE in the master rate card terms (migration `20260504g_seed_master_rate_card_terms.sql`):
   > "Christmas Eve, Christmas Day, New Year's Eve, New Year's Day, Easter, Memorial Day, Independence Day, Thanksgiving Day"
   That text prints on the customer-facing T&Cs but is not data anywhere.

2. **No date-based detection.** Nothing anywhere reads `line.quoteDate` and asks "is this a recognized holiday?". `recomputeLineTotal` in every editor (legacy invoice-builder, legacy quote-builder, new quote-draft-editor, new invoice-draft-editor) reads `line.holidayHours` directly with no date cross-check.

3. **Legacy invoice-builder has NO input field for holidayHours.** Grep returned zero matches for "Holiday" or any `holidayHours` editor binding. The legacy invoice editor is a pure pass-through of whatever value the quote line had — Connor could not even type a number in once the quote was issued. The only edit path: revise the quote, or direct SQL on the jsonb (Connor-incident pattern).

4. **Legacy quote-builder DID have a Holiday column input** (`quote-draft-editor.tsx:472`, tooltip "Hours billed at 2x the regular hourly rate"). So Connor's only chance to enter holiday hours was while building the quote — manually, with no validation.

5. **2× multiplier is implicit, not enforced.** Calc uses `holidayHours × dtRate`. On standard rate cards `dtRate = 2 × hourly`, so this matches the T&Cs prose. On any rate card where dtRate is overridden, the math silently diverges from the printed terms.

### Risks created

- **Underbilling**: holiday work entered as regular hours → customer paid 1× when contract says 2×.
- **Overbilling**: regular hours mis-entered as holiday → customer paid 2× when not warranted.
- **No retroactive audit possible without first defining the holiday-date reference set**: the dates are on the lines but nothing exists to compare them against.
- **Connor was the sole gatekeeper** — every past invoice's holiday correctness depends on whether Connor remembered.

### Recommended fix (deferred until after Connor discussion)

1. **Define the recognized-holidays list as data**, not prose. Options:
   - Static list in `lib/rates/holidays.ts` — fixed dates + Easter via Gauss algorithm (cleanest, no DB writes needed for new years).
   - `company_holidays` table — admin-editable, allows per-year overrides if a client negotiates a custom holiday set.
   Recommend the static module unless client-by-client variation is real.

2. **In the editors**, when a line's `quoteDate` falls on a recognized holiday:
   - Show a small amber pill above the Holiday column: "⚠ Christmas Day — holiday hours?"
   - Warning only, NOT auto-fill. Some clients negotiate different terms; auto-population creates the opposite mistake.

3. **Retroactive audit script**: list every historical invoice line where `quoteDate` ∈ recognized holidays AND `holidayHours = 0`, for Connor's review.

4. **Optional, larger scope**: replace `holidayHours × dtRate` with `holidayHours × baseHourly × company_settings.holiday_multiplier` (default 2.0) so the printed terms always match the calc regardless of dtRate overrides. Decouples "holiday pay rule" from "double-time pay rule".

### Open questions for Connor

- Do all clients use the same recognized-holidays list, or are there contract-by-contract variations?
- For multi-day lines that span a holiday + non-holiday (e.g. Dec 24 → Dec 25, 16 total hours), is the expectation to manually split the line, or is there a heuristic we should encode?
- Has he ever billed at a multiplier other than 2× for holidays? If yes, the calc needs to support arbitrary multipliers, not assume DT-equivalent.
- Are there any past invoices he knows are wrong on this dimension that we should flag for the data-recovery project?

### Schema thoughts (post-discussion)

- Add `company_settings.holiday_multiplier numeric default 2.0` (small migration).
- Optionally `client.holiday_multiplier_override` for negotiated variations.
- New `lib/rates/holidays.ts` exporting `RECOGNIZED_HOLIDAYS_2026` (etc.) + `isRecognizedHoliday(date)`.
- Editors warn-on-render via `useMemo` lookup against the dates of all current lines.

**Do not implement before talking to Connor.** This is money math behavior change that needs domain validation, not a one-developer call.

---

## Bulk import: load crew assignments from a spreadsheet

**STATUS: SHIPPED to prod 2026-06-16** (merge `d179a01`) as the full crew-roster
export/import round-trip. Spec: `docs/crew-roster-spreadsheet-spec.md`. The design
below is the original stub, kept for history. **Open follow-up (deferred):** the
import-completion notice is a native `window.alert`; convert it to an in-app
dialog — nicer looking and screenshottable. Revisit after coordinators have used
the feature for a bit (per user, 2026-06-16) and roll in any other UX changes
that surface from real use.

**Why:** Building out crew assignments one-by-one through the UI is slow when a job has dozens of confirmed crew. Connor (and other coordinators) typically build the roster in a spreadsheet first — pasting names + dates + positions into the app would be much faster than the per-row form. Logged 2026-05-28 during V2 testing.

**How to apply:**
- "Import crew" button on the Job Request's Assigned Crew tab.
- Accepts CSV or .xlsx (or paste-from-clipboard TSV — that's the fastest for a one-shot from Google Sheets / Excel).
- Required columns: `employee_key` OR `(first_name, last_name)` OR `email`, `event_date`, `position` (or `position_id`), optional: `specialty`, `shift` (or `shift_id`), `notes`. Maybe `confirmed` boolean default true.
- Preview screen: parsed rows + per-row resolution status (employee matched / multiple matches / no match; date matches a day row / no day row; position/specialty resolved; shift resolved).
- Errors surface inline; operator can edit or skip rows before commit.
- Commit inserts into `job_request_assignments` with `created_by = auth.uid()`. Honors the existing partial-unique index `(job_request_day_id, COALESCE(shift_id,''), employee_key)` so a CSV with duplicate (day, shift, employee) tuples errors cleanly.
- Bonus: provide a "Download template" link that exports a properly-shaped sheet with this job's day rows + positions pre-populated as picklist hints.

**Dependencies:** none structurally — `job_request_assignments` already supports everything needed. Pure UX work: file parser + preview UI + bulk insert.

**Scope notes:**
- v1 = single job only (the import button lives on the job page).
- v2 (maybe): "import across multiple jobs" from a master scheduling sheet — needs a different entry point + a way to disambiguate jobs by job_no.

Defer until after the V2 cutover stabilizes; not blocking any current workflow.

## Bulk import: load ACTUAL timekeeping hours from a spreadsheet (one-shot, like the Rippling CSV) (added 2026-07-16)

**Connor's note (2026-07-16):** At Country Concert we kept time in a spreadsheet. Want to take a sheet in that format and **upload it into Timekeeping in one shot**, the same way the Rippling CSV import works — so the hours we tracked in the field land as timesheet entries without re-keying every row.

**Distinct from the two existing importers** — don't conflate:
- [Bulk import: load crew assignments from a spreadsheet](#bulk-import-load-crew-assignments-from-a-spreadsheet) (SHIPPED) imports **planned crew assignments** (`job_request_assignments`), not hours worked.
- The Rippling payroll export writes a CSV **out** of the app; this is the inverse — a spreadsheet of actual hours coming **in** to `timesheet_entries`.

**Why:** Field crews (e.g. Country Concert) still track hours in a spreadsheet. Today those actuals have to be hand-entered row-by-row in Timekeeping. A one-shot upload mirroring the existing CSV-import UX would remove that re-keying and reduce transcription errors.

**How to apply:**
- Get the exact Country Concert sheet format from Connor and treat it as the canonical input shape (define the column mapping against it, like the Rippling export mapping).
- "Import timekeeping" button on the Timekeeping page ([components/shared/timekeeping.tsx](components/shared/timekeeping.tsx)); accept .xlsx / CSV / paste-from-clipboard TSV.
- Resolve each row to a job + day + employee + position/specialty, then to std/ot/dt hour buckets (respect the job's billing-rule thresholds — see [Timesheet std/ot/dt split should derive from the job's billing rule](#timesheet-stdotdt-split-should-derive-from-the-jobs-billing-rule)).
- Preview screen with per-row resolution status (employee matched / date maps to a timesheet day / position resolved / hours parsed), inline errors, edit-or-skip before commit — same shape as the crew-roster import preview.
- Commit into `timesheet_entries`; honor the existing freeze/invoice-bound guards so already-billed rows can't be silently overwritten.

**Sample sheet analysis — `AES_26070312_CC26.xlsx` (received 2026-07-16).** Connor's actual Country Concert workbook. The key finding: **it is NOT a clean tabular export like the Rippling CSV — it's a hand-maintained planning/timecard workbook, and its format is not even consistent tab-to-tab.** Don't design as if "one format" exists.

Structure:
- **13 tabs:** 9 day tabs named `73, 75, 76, 77, 78, 79, 710, 711, 712` (= dates 7/3…7/12; note 7/4 is skipped), plus `2026 RosterSchedule`, `Hotel List`, `Day Schedule`, `Job Totals`.
- **Per-worker-per-day time rows live on the day tabs.** Columns drift between tabs — there is no fixed schema:
  - Most tabs: `Date | Role | (Full name?) | First Name | Last Name | IN | STOP | IN | STOP | Hrs On | Billing Rate | Billing AMT | Pay Rate | Pay AMT`. Two IN/STOP pairs = a split shift around a lunch break; `Hrs On` is the pre-computed daily total.
  - But `73` has no "Full name" column and labels the hours col `STD HRS`; `75` inserts a "Full name" column C (shifting everything right one); `77` has a **single** IN/STOP pair plus separate `Hrs`/`Hrs On` cols; `78`/`712` differ again. Header row is sometimes row 7, sometimes duplicated at row 9; data starts at row 8 on some tabs, row 10 on others.
- **Column B ("Role") is polluted with free text.** Alongside real roles (`Lead, Fork, Rigger, Audio, Video, Hand, Loader`) it contains schedule annotations and section headers used as spacers — e.g. `7:00 am CREW CALL:`, `ADD: 08) Stage Hands`, `CUT: 18 @ 1p`, `10) CREW: LEAD: 01 | RIG: 00 | HANDS: 08`, `MEAL BREAK`. A naive "ingest every row" would import garbage. Real data rows are the ones with a first/last name + at least one IN/STOP time.
- **Edge cases seen in the data:** same person, two roles, one day (Michael Cupit = Video AM 5h + Rigger PM 5h → two rows); single-punch days (only an AM pair); `Hrs On` sometimes hand-overridden vs. what IN/STOP would compute. Role vocabulary (`Fork`, `Loader`, `Special Rigging`, `Hand`) must map to app positions/specialties; `Job Totals` groups them as Lead / Fork / Rigging / Hand / Special Rigging.

**Design implication (decision needed with Connor).** Because his real sheet is freeform and inconsistent, "upload the sheet as-is like the Rippling CSV" is not realistically a clean one-shot — the Rippling CSV is a machine export, this is a living planning doc. Two viable paths:
1. **Strict template (recommended):** ship a clean "Timekeeping Import" template (one tab, fixed columns: date, first, last, role, in/out pairs OR total hours) and have Connor paste/transcribe into it — same model as the crew-roster import template. Reliable; costs Connor a copy-paste step per job.
2. **Tolerant parser for his layout:** build a parser tuned to this workbook (walk day tabs by name→date, skip non-name rows, tolerate the column drift) feeding a mandatory row-by-row review/confirm screen. More convenient for Connor, but will never be fully hands-off given the inconsistency, and breaks whenever the sheet's shape shifts.

Recommend proposing **option 1** to Connor; keep option 2 as a possible v2. Either way the preview/confirm step and the resolution-status UI below still apply.

**Direction (John, 2026-07-16): make it a round-trip — export out, then import back — like the crew-assignment export/import.** The app **exports** the timekeeping sheet (option 1's strict template, pre-populated with this job's day rows + assigned crew + roles), Connor fills in the times in the field, and re-imports the same file. Because the app authored the sheet, the import format is controlled and predictable — no guessing at his freeform layout, and the export doubles as the "Download template" mentioned below. This is the preferred build: it turns the messy-sheet parsing problem into a known-schema problem, exactly like the shipped crew-roster round-trip ([lib/storage/crew-roster-export.ts](../lib/storage/crew-roster-export.ts) + its importer). Mirror that module's structure. Connor's Country Concert workbook then becomes a *reference for which columns to include* (date, role, in/out pairs, hrs), not the thing we parse.

Sample file: `~/Downloads/AES_26070312_CC26.xlsx` (get it into the repo's gitignored samples area if we build against it).

**Open:** decide template-vs-parser with Connor (above); coordinate with the [planned-vs-actual redesign](timekeeping-planned-vs-actual-design.md) so an import targets the "actual" side.

---

## Invoice draft: re-pull from quote / merge quote + timesheets

**Why:** Today the final-invoice draft is seeded from the quote at creation, then "Overwrite from Timesheets" REPLACES every non-manual_override line with timesheet aggregates. That's right for labor — actuals beat estimates. But the wipe also takes out:
- Equipment rentals and other non-labor line items from the quote
- Quoted positions/specialties that no one ended up working (no timesheet entries for them)
- Per-day items the customer expected to be billed regardless of actuals

Connor's mental model is "merge", not "replace whole-line-item-set." Logged 2026-05-28 during V2 testing.

**Two affordances likely needed:**

1. **"Re-pull from Quote" button** on the invoice draft editor. Same blow-away pattern as the existing Overwrite-from-Timesheets, but the other direction: replace every non-manual_override line with quote_line-sourced lines. Useful when the timesheet path mangled things and the operator wants a clean reset. Honors covered_dates if set. Already-billed quote lines (on a different non-superseded invoice) excluded — same dedupe getAlreadyBilledQuoteLineIds already does.

2. **"Merge from Quote" button** — additive. For each quote_line not already represented on the draft, append a new line. Dedupe rule TBD (see open questions below). Doesn't touch timesheet- or manual-sourced lines.

**Open design questions (resolve with Connor before building):**

- **Dedupe key for merge.** If the draft already has a timesheet-sourced "Stagehand / Labor / 2026-07-04 / Load In" line and the quote also has "Stagehand / Labor / 2026-07-04 / Load In", does merge skip the quote one (timesheets win, common case), or always append (operator deduplicates manually)?
- **Equipment/fixed items.** If we add a `line_kind` discriminator (already in the todo — see "Free-form / non-labor line items"), the merge could be smart: timesheet lines for labor, quote lines for non-labor. Without that discriminator, every quote line gets the same treatment.
- **Re-pull priority.** When operator clicks "Re-pull from Quote" AFTER a timesheet pull, do we re-zero the deposit_applied / amountDue too? Probably yes — re-pull from quote treats the draft as a fresh seed.
- **UX wording.** Connor asked for "some kind of merge" — confirm whether he wants both buttons (replace + merge) or a single button with a mode picker.

**Dependencies:** Nice to land alongside or after the free-form/non-labor line items work (already in this todo). Without that, equipment rentals come through as labor-shaped lines, which is awkward.

**Scope notes:** This is editor UX, not schema. The QuoteLine shape on invoice_lines already supports both source_kinds. The createFinalDraftFromQuote helper has the seed logic already extracted — refactoring it into a public-ish `buildLinesFromQuote(quoteId)` like we did for `buildLinesFromJob` would set up either button cleanly.

---

## Refresh dev DB from prod snapshot (scheduled 2026-06-02-ish)

**Why:** Dev (`ovtbvnfhteqxnyirzctt`) has been carrying a stale clone of prod for weeks. Throughout V2 cutover work + the legacy quote/invoice backfill, prod has accumulated lots of real data state that dev doesn't have (quarantine structures, the legacy_invoice_no column populated, the RLS cleanup, the new QRX client, repaired Luke Combs job_sheets, etc.). Dev would be drifting from prod soon.

**When:** A few days after the 2026-05-30 V2 cutover settles. Picking 2026-06-02 (Tuesday) as a target — gives the team Monday to bang on prod and surface any issues, then we refresh dev with the validated state.

**How (per docs/dev-environment-setup.md):**
1. Take a fresh prod snapshot via Supabase dashboard (Database → Backups → Point-in-time copy, or use a pg_dump if Supabase tier supports it)
2. Restore the snapshot into the dev project (`ovtbvnfhteqxnyirzctt`)
3. Re-apply any dev-only changes (probably none right now since we've kept dev + prod synced via the same MCP-applied SQL all week)
4. Smoke-test dev briefly (login, open a quote, open a job)

**Cadence:** Once V2 is settled, plan to refresh dev monthly OR before any major test-heavy work session. Keeps the dev environment realistic.

**Caveat:** the legacy_quote_no / legacy_invoice_no columns + QRX quarantine data are now baked into prod. After a refresh, dev gets all of that too. If we later want a clean test environment, we'd need a separate "clean dev" project — not in scope.

---

## ⭐ EPIC: Timekeeping save + load overhaul (write + read, one project)

**Filed 2026-06-18.** Consolidates the scattered timekeeping performance items below into **one coordinated project**. They share the same files, the same root cause, and a real data-model dependency — doing them as separate branches would conflict and force rework, and they all touch a **high-risk screen** (freeze triggers, the Brent FK-race history, the 99-row Bruno Mars render cliff; a prior read-side attempt was reverted as `e02cab8` / React #301). Work them together on one branch, shipped in verifiable increments. Per-piece detail lives in the individual sections referenced below — this entry is the framing + sequencing only. (High-level for now; dig into specifics when the project starts.)

**Trigger:** the [2026-06-18 prod disk-IO outage](docs/incidents/2026-06-18-prod-disk-io-outage.md) was caused by the *write* side of this screen.

**Shared surface:** `components/shared/timekeeping.tsx` (~2,000-line grid/picker/approval/print) + `lib/store/db.ts` (`syncTimesheet` + the read helpers).

**Constituent items (already filed separately, rolled up here):**
- **WRITE** — "Timekeeping save path — upsert-all-rows-on-every-edit (write/WAL amplification)" — the outage-prevention fix; dirty-track changed rows + debounce autosave.
- **READ** — "Effect-loop re-fetching on timekeeping" (3× refetch per swap).
- **READ** — "Timekeeping page perf — fetch waterfall (21+ requests per load)" + "Repeated `positions`/`profiles`/`user` queries (no dedup)" (in-flight dedupe map / nested PostgREST selects).
- **RENDER** — "Timekeeping render perf — synchronous collapse on timesheet swap" (derive default-collapsed; mind the prior revert `e02cab8` / React #301).
- **REFACTOR** — app-review **Q1**: break up the ~2,000-line `timekeeping.tsx`.
- **RELATED (broader)** — "'Load every table upfront' architecture (initStore)" affects this page's cold start too; can fold in or stay separate.

**Why one project (the coupling):**
1. **Same files** — separate branches would all edit the same effects/handlers → conflicts + repeated review of fragile code.
2. **Same root cause** — "the picker/grid does too much work, too often." Debounce-the-save (write) and debounce/dedupe-the-fetch (read) are the *same* effect plumbing.
3. **Data-model dependency** — the write fix's mechanism is **dirty-tracking** (upsert only changed rows), which needs a clean **load baseline** (read). The two can't be designed in isolation.
4. **One QA cycle** on an operationally-central, fragile screen instead of three.

**Sequencing (incremental — one branch, NOT a big-bang merge):**
1. **Write fix first** — dirty-track + debounce autosave. Highest urgency (outage prevention) and it establishes the dirty/clean state model the read work reuses. Verify the WAL/hour drop via `monitoring.statement_snapshot` before moving on.
2. **Read fixes** — in-flight request dedupe, kill the 3× effect-loop refetch, collapse the waterfall.
3. **Render + refactor** — derive default-collapsed state; fold the behavioral fixes into the Q1 file breakup rather than drive-by edits around it.

**Owner/branch:** one owner, one branch, ship verifiable steps. Each increment can still merge dev→prod on its own once verified — "one project" means shared design + no parallel conflicts, not one massive merge.

---

## Timekeeping render perf — synchronous collapse on timesheet swap

**Filed 2026-05-30.** Selecting a multi-day timesheet with many entries (Bruno Mars: 99 entries × 5 days) takes 18-20s wall-clock even after the network fixes. Only 4 network requests fire (~2s total parallel) — the other 15-18s is React rendering time.

**Root cause:** `collapsedDays` state is synced via `useEffect` AFTER the first render. When picker swaps to Bruno Mars:
1. setTimesheet fires
2. React renders with `collapsedDays` still containing the previous timesheet's day strings (none of Bruno's)
3. With every day appearing "expanded", all 99 rows × ~10 input fields each mount to DOM (~1000 controlled inputs)
4. THEN the useEffect fires, collapsedDays gets populated, rows unmount

**Attempted fix (reverted as commit `e02cab8`):** setState during render to synchronously reset collapse state. Triggered React error #301 (infinite loop) because dayGroups recompute on every render produced new state setter calls.

**Safer pattern to try:**
- Don't store "default-collapsed" as state at all
- Track only EXPLICIT user overrides as a Set
- `isDayCollapsed(day) = explicitOverrides.has(day) ? explicitOverrides.get(day) : (dayGroups.length > 1)`
- Toggle = add/remove from overrides; default behavior derives from dayGroups synchronously
- No useEffect needed; rows never mount on initial swap

**Apply to other multi-day editors too** if they have similar accordion patterns and exhibit slowness on large jobs:
- quote-draft-editor.tsx
- invoice-draft-editor.tsx  
- job-requests.tsx (Crew Requirements tab)
- Assigned Crew

Only worth fixing where the dataset is large enough (50+ rows). Small jobs render fine today.

---

## Effect-loop re-fetching on timekeeping

**Surfaced 2026-05-30** via Supabase API logs. The same 4-query bundle (`timesheet_entries`, `job_request_days`, `quotes holiday_multiplier`, `job_request_shifts`) for a single job fires 3 times within 1.4 seconds. A useEffect dependency is causing thrash.

**Investigate:** which useEffect in `timekeeping.tsx` is running 3× per timesheet swap? Likely either the picker-effect at line ~208 or the pending-entries-fetch at line ~288. Could be React 18 double-mount in dev (Strict Mode) but the logs are from prod so something else.

Fix: dedupe, debounce, or properly memoize the dependency array.

---

## Timekeeping save path — upsert-all-rows-on-every-edit (write/WAL amplification)

**Filed 2026-06-18 after a full prod outage** — see [docs/incidents/2026-06-18-prod-disk-io-outage.md](docs/incidents/2026-06-18-prod-disk-io-outage.md). This is the **write-side** companion to the read-side timekeeping perf items above ([Effect-loop re-fetching](#effect-loop-re-fetching-on-timekeeping), [fetch waterfall](#timekeeping-page-perf--fetch-waterfall-21-requests-per-load)).

**Why:** [`syncTimesheet`](lib/store/db.ts) ([db.ts:706](lib/store/db.ts)) upserts the **entire set** of AOS-managed rows (`t.rows.filter(r => !r.userId)`) on **every edit** — the comment at [db.ts:748](lib/store/db.ts) says so explicitly (*"the entries upsert re-fires on every edit"*). The per-line **employee picker** is the edit trigger. Each `ON CONFLICT DO UPDATE` rewrites every row's tuple (even unchanged ones) and maintains all 8 of the table's indexes, producing heavy WAL + full-page images. Measured in the outage: `timesheet_entries` upserts generated **~940 MB of WAL** on a 27 MB DB — **247 KB of WAL per single-row upsert** — the dominant disk-write source that drained the Nano instance's disk-IO budget. The prior redesign moved this off delete+reinsert to upsert, but it still writes *every row on every edit*.

**Fix (priority order):**
1. **Upsert only changed rows.** Dirty-track which rows actually changed since last save and upsert just those. One changed line → 1 row write instead of ~30. Biggest win, lowest risk.
2. **Debounce the autosave** (currently per-keystroke/edit). A 1–2 s debounce collapses an edit burst into a single save.
3. Pairs with the read-side fixes above (dedup/debounce the re-fetch effects) — same screen, same root instinct (the picker triggers too much work too often).

**Verification:** the `monitoring.statement_snapshot` job (added 2026-06-18) now captures WAL per statement every 15 min — measure WAL/hour from the `timesheet_entries` upsert before vs. after to prove the drop.

**Sequencing:** independent of the quote/invoice rewrite. High value — this is what actually prevents a recurrence regardless of compute size.

---

## Revisit `timesheet_entries` index cleanup — drop truly-unused indexes

**Filed 2026-06-18. ⏰ Revisit on/after ~2026-06-23** (needs ~a week of `monitoring.index_snapshot` data — the per-index `idx_scan` counters reset at the 2026-06-18 compute resize, so "unused" is not trustworthy before then). Context: [incident doc](docs/incidents/2026-06-18-prod-disk-io-outage.md).

**Why:** `timesheet_entries` (1,863 rows) carries **8 indexes**. Every extra index is re-maintained on every upsert — and that table's upsert is the #1 WAL generator (see the save-path item above). Dropping genuinely-dead indexes is a real **write-side** win (less WAL per write) with zero app-code change, fully reversible. As of the resize, 5 of 8 showed 0 scans, but that window is too short to act on.

**Candidates to confirm dead (then drop):** `idx_timesheet_entries_is_holiday`, `idx_timesheet_entries_payroll_run_id`, `idx_timesheet_entries_position_id`, `idx_timesheet_entries_shift_id`, `timesheet_entries_invoice_line_idx`. Known-used (keep): `timesheet_entries_pkey`, `idx_timesheet_entries_job_id`.

**How to check (run after the window):**
```sql
select relname, indexrelname, max(idx_scan) - min(idx_scan) as scans_in_window
from monitoring.index_snapshot
where relname = 'timesheet_entries'
group by relname, indexrelname
order by scans_in_window;
```
Drop any `timesheet_entries` index with `scans_in_window = 0` over a representative week (must include a busy timekeeping day). Re-check the advisor afterward.

**Do NOT** add the 3 advisor-flagged missing FK indexes (`employee_key`, `timesheet_id`, `user_id`) as a "fix" — at 1,863 rows seq scans are sub-ms/cached, and new indexes *increase* write amplification on the hot path. Revisit only if/when the table grows large (tens of thousands of rows).

---

## "Load every table upfront" architecture (initStore)

**Filed 2026-05-30 after perf debugging.** Cold start fires 73+ requests in parallel to hydrate every table on app boot (lib/store/db.ts:115 initStore). With prod data sizes (2570 employees, 588 calendar_events, 615 quote_lines, 724 timesheet_entries) this transfers ~1MB and takes 10-20s on a hard refresh / first page load.

**Real fix:** switch from "load everything once" to "load per page on demand". Use TanStack Query / SWR for caching. Refactor app-store.ts to expose query hooks instead of in-memory cache reads.

**Mitigation in the meantime:** the singleton + processLock Supabase client fix made warm-cache navigation fast (1-2s). Cold start is the slow case but only happens once per session.

---

## Repeated `positions` / `profiles` / `user` queries (no dedup)

**Surfaced via Supabase API logs 2026-05-30.** `positions?select=id,name&is_active=eq.true` fires 9 times in 5 min. `profiles` and `user` queries fire 2-3× per page. No request-level caching.

**Fix:** wrap supabase client with a per-page in-flight Map<requestKey, Promise>. If a fetch with identical (table, filters, columns) is already in-flight, return the existing promise. Cheap win.

---

## Timekeeping page perf — fetch waterfall (21+ requests per load)

**Surfaced 2026-05-30** during V2 cutover. Opening a multi-day job (e.g. Bruno Mars with ~100 timesheet entries across 5 days) takes **20+ seconds** to render. Browser DevTools Performance + Network analysis showed:

- Server-side queries are FAST (10ms with proper index scans, verified via EXPLAIN ANALYZE)
- **Bottleneck is the request count + waterfall**: 21 sequential-ish fetches to Supabase REST, each taking 200ms-4s wallclock, summing to 15-24s total

**Notable duplicate / wasteful patterns:**
- `job_request_days` queried 5+ times per page load (different filter combos)
- `positions` queried twice (1.09s + 91ms — second is cache hit)
- `profiles` queried twice (716ms + 1.11s)
- `user` queried twice
- `timesheet_entries` query: 4.35s wallclock for 820 bytes (server-side: 10ms)

**Fixes to consider, in order of effort/payoff:**

1. **In-flight request dedup cache** — wrap supabase client with a per-page-load Map<requestKey, Promise>. If a fetch with identical (table, filters, columns) is already in-flight, return the existing promise. Cheap win against the positions/profiles/user duplicates. ~30 min.

2. **Parallelize independent loads via Promise.all** — current timekeeping.tsx mount fires several queries via separate useEffects. Combine into one. Saves serial waterfall time. ~1 hour.

3. **Combine job-related fetches into one round-trip** — fetch days + crew_needs + shifts + assignments + holiday_multiplier in a single Supabase query via PostgREST's nested resource selection (`select=*,days(...),shifts(...)`). Eliminates the 5x job_request_days repeats. ~2-3 hours.

4. **Prefetch on hover/route-change intent** — when operator hovers Timekeeping in the nav, start fetching the last-picked-job's data. By click time, it's ready. Nice polish.

**Don't:** add more DB indexes. Server-side queries are already fast. This is purely an application-architecture issue.

**Sequencing:** dedicated post-V2 session. Not a cutover blocker. Operators can live with the 20s load; just feels slow.

---

## Structural one-draft-per-job invariant on invoices (much later)

**Why:** The V2 design says max 1 active draft per (job, invoice_type). UI enforces this — quote-detail.tsx hides "Generate Deposit/Final" buttons and shows "View ..." instead when an active draft exists. But there's no DB-level partial unique index backstop. If two coordinators have the same quote open and both click Generate at the same instant, both inserts could succeed and produce 2 drafts.

For a small AES team this is extremely unlikely. We saw 3 Carolina drafts on prod 2026-05-30 but they were created via the merge cascade (Loud&Clear quote's invoices + CCMF quote's invoices got both bound to the same job after Block C of the legacy-quote-backfill ran), NOT by operator double-clicks.

**How to apply:** Add partial unique indices mirroring the quote side:
```sql
CREATE UNIQUE INDEX invoices_one_open_draft_per_job_type
  ON invoices(job_request_id, COALESCE(invoice_type,'final'))
  WHERE is_draft = true
    AND (status IS NULL OR status NOT IN ('superseded','void'))
    AND job_request_id IS NOT NULL
    AND job_request_id NOT LIKE 'jobreq-qrx-%';
```

Mirror for the multi-date covered_dates case if needed.

**Sequencing:** much later. Belt-and-suspenders structural hardening, not blocking any flow.

---

## User-controllable line ordering on quote + invoice editors

**Why:** `quote_lines.sort_order` and `invoice_lines.sort_order` already exist in the schema as integer columns, but there's no UI to manipulate them. Operators can't reorder lines within a day, can't pin a "Crew Chief" row to the top, etc. Surfaced 2026-05-30 during V2 cutover when operator noticed line order drifts between days after duplicate-day (Day 1 = GL/CO/L1, Day 2 = L1/GL/CO — same content, different order).

**Two related issues:**
1. Within a single day, order should be operator-controllable (e.g. always show Crew Chief / Stagehand / Forklift sequence)
2. Across days within one quote, the same set of positions should display in the same order (consistency for vertical scanning)

**How to apply:**
- Add up/down arrows on each line row in the editor (or drag handle if we adopt a DnD lib)
- Editor maintains contiguous sort_order values per day on save
- Optional: "Sort by position" button that re-orders all days to use the same canonical sequence (helps after duplicating days that drifted)
- Defaults: when seeding from job crew_needs, use crew_needs.sort_order; when "duplicating a day", preserve the source day's sort_order assignment
- PDF + display already honors sort_order — no further work there

**Touch points:**
- `components/shared/quote-draft-editor.tsx` (and invoice-draft-editor.tsx)
- `lib/store/quotes.ts` line CRUD helpers
- Sort_order assignment in `duplicateDay` / `seedLinesFromJob` / similar helpers

**Sequencing:** post-V2 polish. Don't ship before the V2 cutover settles since operators are still adjusting to the new flow. Pairs nicely with the "Fix quote line ordering + OT/DT carry on day duplicate" issue already filed as a spawned task.

---

## Duplicate Carpenter position + non-standard ANCILLARY (post-V2 cleanup)

**Surfaced 2026-05-29** during prod pre-flight audit for V2 cutover.

`SELECT id, name FROM positions` on prod shows three anomalies among the
18 rows:

1. **Two `Carpenter` positions** with same name, different IDs:
   - `pos-1780061881863` Carpenter
   - `pos-1780061922802` Carpenter

   Need to merge — same pattern as the bogus specialty drop in memory
   pending #30. Audit references first (`rate_card_profile_rows`,
   `job_request_crew_needs`, `job_request_assignments`, `quote_lines`,
   `invoice_lines`, `timesheet_entries`), pick the keeper (probably
   whichever has refs; if both, repoint older→newer), drop the loser.
   Freeze trigger disable idiom required for line tables.

2. **`ANCILLARY` (`pos-1779807822299`)** — added via UI later, non-
   standard ID format. May be legitimate (no rule says only `pos-NN`
   format is allowed). Just confirm with Connor that it's actually
   used somewhere; if not, drop. Lower priority than the Carpenter
   merge.

**When:** post-V2 cutover. Not blocking — these don't affect any V2
migration. Bundle with the specialty deduplication maintenance pattern
when next touched.

---

## Invoice: allow pulling unapproved timesheets + drift highlighting (POTENTIAL)

**Status:** Spec drafted 2026-06-02, pending Connor discussion. Full spec at [docs/invoice-unapproved-timesheet-pull-spec.md](docs/invoice-unapproved-timesheet-pull-spec.md).

**Why:** Connor regularly invoices clients before timesheets are approved (sometimes before they're filled out). Today `overwriteFromTimesheets` ([invoices.ts:553](lib/store/invoices.ts:553)) filters by `status='approved'`, so he retypes labor data manually from timekeeping. Loosening the filter saves time; back-pointer model already prevents the scary failure modes.

**Real existing model (richer than initial assumption):** Pull creates real `invoice_lines` rows with `source_kind='timesheet_entry'` + back-links via `timesheet_entries.invoice_line_id`. Manual-override lines preserved on re-pull. DB trigger `invoices_release_entries_trg` (migration 20260527b) auto-releases entries when their invoice goes to void/superseded. Double-billing structurally prevented by `invoice_line_id IS NOT NULL` filter.

**Void/revise answer:** ✅ works today. Trigger releases entries on void or superseded transition. Re-pull onto new draft picks them up immediately. No orphans.

**Double-billing answer:** ✅ structurally safe. Active invoice owns its entries via back-pointer; other pulls skip them. Extending to unapproved entries inherits this protection unchanged.

**Proposed changes:**
1. Drop the approved-only filter (or make configurable). Per-line metadata: `pulled_approved_count`, `pulled_pending_count`, `pulled_at`. Visible badge.
2. Drift detection per line: load back-linked entries → re-aggregate → compare. Categories: value changed (yellow tint), source deleted (banner on the line), new unbilled entries (ghost row).
3. Context-aware re-pull button: hidden on frozen invoices, prominent when drift exists.
4. PDF stays clean (no drift highlights); in-app detail view shows drift.
5. **Finalize failsafe** — confirmation dialog on Finalize if drift exists, with "Re-pull and review" / "Finalize anyway" options. NOT on print itself — drafts auto-watermark via [invoice-pdf-view.tsx:212](components/shared/invoice-pdf-view.tsx:212).

**Effort:** ~3.5 days. No schema migration if pull-time metadata uses jsonb on the line; ~30 min additive migration if we want it as queryable columns.

**Open questions for Connor:**
- Frequency of pre-approval invoicing (priority validation)
- Multiple invoices per job for progress billing? (affects whether `coveredDates` UI needs surfacing)
- Workflow today when drift found post-send (re-issue / annotate / credit memo)
- Drift badge in invoice list view?
- Surface "pending → approved with no value change" or silent no-op? Recommend silent.

**Sequencing:** independent of V2 cutover. Doesn't conflict with timesheet_days normalization or bill-rate column drop.

---

## Mandatory-field enforcement policy (system-wide)

**Why (added 2026-06-04, surfaced by Carolina Country Music Fest investigation):** Required-field validation today happens too late and inconsistently. On timekeeping, `specialty_id` and `shift_id` are only enforced at *approval* time ([components/shared/timekeeping.tsx:743](components/shared/timekeeping.tsx:743) and `:799`) — rows can be created and saved with both fields blank via `addRowForEmployee` ([components/shared/timekeeping.tsx:468](components/shared/timekeeping.tsx:468), which uses `blankTimeEntry` defaults). Result on Carolina (jobreq-1779670159567): 33 rows on 6/04 created via the manual picker, all missing specialty, all needing manual back-fix. Other screens likely have similar approval-gate-only patterns; quotes/invoices/job_requests/job_sheets/employees/clients haven't been audited for this. We were going to move the timekeeping enforcement from approval-time to entry-time, but it's bigger than one screen — needs a policy decision first.

**How to apply:**
1. **Catalog phase:** walk every primary entry screen and list the fields that *must* be present for the downstream flow to work. Suggested starter list:
   - Timekeeping rows (timesheet_entries): employee_key, work_date, position_id, specialty_id (when position has specialties), shift_id (when job has shifts), time_in1, time_out1
   - Quote/invoice lines: position_id, specialty_id (same conditional), quote_date, qty, rate fields
   - Job requests: client_id, event_name, request_date, end_date, state, event_abbr
   - Job sheets: client_id, source_event_id (linked job_request), date, call_time
   - Employees: full_name, employee_key, state_code
   - Clients: name, code (3-char)
   - Rate card profiles: client_id, name, effective_date
2. **Policy phase:** for each field, decide which of three gates applies and document it:
   - **Hard at creation** — can't insert the row without it (refuse save, focus the field, show inline error)
   - **Hard at submit/approve** — current pattern; row exists but can't transition to the next status
   - **Soft warning** — row saves but a yellow badge persists until filled
   The default should be **hard at creation** unless there's a documented reason to relax it (e.g. specialty when position has none defined).
3. **Implementation phase:** ship per-screen. Each screen gets the same shape: a `validateRow(row, context)` helper that returns `{ missing: string[], severity: 'block'|'warn' }`, called by every code path that creates or saves a row (manual picker, duplicate, import, bulk add). UI uses the result to either refuse save or render badges.
4. **Backfill audit:** for each table, run a query showing how many existing rows are missing each enforced field. Decide per-table whether to seed defaults, force operators to fix, or grandfather pre-policy rows.

**Sequencing:** policy catalog should land before the V2 cutover so new screens during the rewrite inherit the rules. Implementation can be incremental per screen after that.

**Reference incidents:**
- Carolina 6/04 (this session) — 33 timesheet rows missing specialty, all from manual picker
- Bruno Mars [Timesheet OT split](#timesheet-stdotdt-split-should-derive-from-the-jobs-billing-rule) — timesheets entered before the quote existed, so no rule was available to validate against
- [Enforce client consistency](#enforce-client-consistency-across-job--quote--rate-card--invoice) — quote/invoice/rate-card client mismatches happen because no cross-entity validation runs at save

---

# Crew-facing portal & mobile app (theme — added 2026-06-26)

Four related items captured from John 2026-06-26. They cluster around giving crew (and the
onsite crew leader) a way into the system without exposing the full admin app. #1–#3 share the
same auth/role foundation and the read-only-first rollout; #4 is an independent privacy fix on
the existing coordinator export. The assignment-notification half of #3 already has its own
design — see [notifications-spec.md](notifications-spec.md) (crew_assigned event, Resend/Twilio,
template at `lib/notifications/templates/crew-assigned.ts`). Build the role/auth layer once and
let all of these hang off it.

## Onsite mobile time clock — crew leader sign-in/out with on-device signature

**Why:** The crew leader onsite at a job has no way to capture shift attendance digitally. Today
hours get entered later, by an admin, from paper. Goal: a phone/tablet-friendly screen the crew
leader signs into, picks a crew member from that job's timekeeping list, and that member signs
**in** (physical signature captured on the device) and **out** for each shift. This is the
on-the-ground capture source that should feed `timesheet_entries` instead of after-the-fact
manual entry.

**How to apply:**
- Mobile-first route (its own minimal layout — big touch targets, no admin chrome). Crew-leader
  login scoped to a single job (or the jobs they lead) so the device only ever lists that job's
  crew. Reuse the assignment list already built for the job (`job_request_assignments` /
  `loadAssignmentsForRequest`), not the whole employee directory.
- Per crew member, per shift: **Sign In** and **Sign Out** buttons that each open a signature pad
  (`signature_pad` canvas — same lib already proposed for [quote e-signature](#online-quote-review--e-signature-no-adobe--docusign)).
  Capture signature image + timestamp + (optional) device geolocation.
- Persist to a new `shift_clock_events` table (or directly create/update `timesheet_entries` with
  actual in/out times). Store the two signature images in a Supabase Storage bucket following the
  canonical attachment pattern. One in/out pair per (employee, shift, day).
- Pairs with the [`timesheet_days`](#introduce-timesheet_days-table--peer-of-job_request_days)
  work — the day/shift structure this writes into should be the normalized one, not per-row
  denormalized fields.
- Offline tolerance is desirable (venues have bad signal) but can be a v2 — start online-only.
- **Sequencing:** depends on the crew role/auth layer below. Signature capture + storage pattern
  is shared with the crew e-signature feature.

## "Crew" user role — read-only login (staff app), editing later

**Why:** Baby-steps toward crew self-service. Stand up a `crew` user/role that can log in to the
staff app ([amplified-staff](../../amplified-staff)) and see **only their own information,
read-only**. Editing stays off until the read-only version is proven, then gets turned back on
selectively.

**How to apply:**
- Add a `crew` role to the user/role model (`app/api/users/route.ts`, `user-management.tsx`).
  Link the auth user to their `employees` row via `employee_key`.
- RLS: crew users can `SELECT` only rows scoped to their own `employee_key` (their assignments,
  their timesheet entries, their pay-visible hours) and nothing else. No write policies at first.
- Staff-app UI gated by role: a crew user lands on a personal read-only view, not the admin
  surfaces. Hide every nav item that isn't theirs.
- Phase 2 (later): grant narrow write access (e.g. confirm/decline an assignment, edit own
  contact info) by adding scoped write RLS + un-disabling specific fields. Keep the read-only
  rollout in production for a cycle before flipping anything to editable.

## Crew portal — notify on assignment + crew login to see assigned shifts & entered hours

**Why:** When a crew member is assigned to a job, (a) email/text them automatically, and (b) give
them a login (the read-only `crew` user from #2) to see their assigned shifts and the hours that
were entered for them. The notification half is already designed.

**How to apply:**
- **Notification on assignment:** already specced — implement per
  [notifications-spec.md](notifications-spec.md) (crew_assigned event → Resend email + Twilio SMS,
  fired from the crew-assignment server action). Prerequisite there: structured recipient phone
  data (see that doc's "Recipient phone data" section).
- **Crew portal view:** built on the #2 role/auth + RLS. A crew member logs in and sees their
  assigned shifts (from `job_request_assignments` + the job's days/shifts) and the
  `timesheet_entries` recorded against them, **read-only** — hours entered, dates, positions, and
  (if cleared for crew visibility) pay hours. Decide explicitly which columns crew may see
  (e.g. show hours; gate bill rates — those are already never crew-facing).
- This is the consumer side of the [time clock](#onsite-mobile-time-clock--crew-leader-sign-inout-with-on-device-signature):
  what the crew leader captures onsite is what the crew member later reviews here.

## Restrict crew-roster export "Employees" tab to within ~100 mi of the event

**Why:** The coordinator crew-roster export ([lib/storage/crew-roster-export.ts](../lib/storage/crew-roster-export.ts))
includes an **Employees** tab built by `loadActiveEmployeeRows()` — today the *entire* active
employee roster. A coordinator who leaves could walk off with the full employee directory.
Restricting that tab to employees within ~100 miles of the event location limits the exposure to
people plausibly relevant to that job.

**How to apply:**
- Filter `loadActiveEmployeeRows()` (or its caller in `buildRosterWorkbook`) by distance between
  the employee's location and the job's venue. Pass the `JobRequest` venue (it has
  `venueAddress` / `city` / `venueZip`) into the export so the filter has an anchor.
- **Geocoding gap:** employees store `city` / `state` / `zip` but **no lat/long**
  ([lib/store/types.ts](../lib/store/types.ts) Employee type), so there's nothing to compute
  distance from yet. Cheapest path: a static US ZIP→lat/long centroid table (bundled dataset, no
  API) and a haversine distance; ZIP-centroid accuracy (~city-level) is fine for a 100-mi cutoff.
  Geocode the venue ZIP the same way. Employees with no/blank ZIP → decide whether to include or
  exclude (recommend exclude from the trimmed tab, since they can't be confirmed in-radius).
- Make the radius a constant (default 100 mi) so it's easy to tune. Consider an admin override
  (full roster) for internal exports vs. coordinator-facing ones.
- The Crew (slots) tab and import-matching path must still resolve any already-assigned employee
  even if they're outside the radius — only the *browse-the-whole-directory* Employees tab gets
  trimmed.

**Note (2026-07-16):** Same issue, framed by who receives it — the roster export from the **Assigned Crew tab on the job profile** goes to **crew leaders**, and the **entire employee directory must not go out with it**. Crew leaders are exactly the untrusted-recipient case that makes this a priority, not just a nice-to-have. Whatever the trimming approach (radius filter above, or a leaner set of columns/rows), the full directory should never leave in a crew-leader-facing export. Confirm with Connor whether crew leaders should get a radius-trimmed list or only the already-assigned crew (no browse list at all).

# Invoicing & timekeeping follow-ups (added 2026-07-14)

Four items captured from John on 2026-07-14. Each starts on its own branch off `dev` (see [[branch-per-task]]) with a plan + OK before edits.

## Pre-invoice client report: actual days timekeeping with billing amounts

**Why:** Before an invoice is generated, we want a client-facing report that lays out the **actual** days worked (from the timesheet / actual side of timekeeping) with the billing amounts per day/line — so the numbers can be reviewed (and potentially sent to the client) before committing to an invoice. This is a review/preview artifact, not the invoice itself.

**How to apply (to scope during design):**
- Source from **actual** timekeeping (timesheet entries), not planned crew assignments — ties into the planned-vs-actual redesign and the timesheet↔invoice linking work ([`docs/timekeeping-planned-vs-actual-design.md`](timekeeping-planned-vs-actual-design.md), [`docs/timesheet-invoice-linking-redesign.md`](timesheet-invoice-linking-redesign.md)).
- Compute bill amounts the same way the invoice pull does (`overwriteFromTimesheets`) so the report and the eventual invoice reconcile. Watch the 1000-row cache truncation + duplicate-row risk (§ "De-cache raw job data") — a report that double-counts dup entries would mislead before an invoice is even cut.
- Likely overlaps with / extends the existing "Labor Summary — add daily breakdown for quotes + invoices" entry; decide whether this is the same daily-breakdown surface reused pre-invoice, or a separate report. Format: on-screen + printable/exportable (client-facing).
- Open: does Connor want this per-job, per-date-range, and does it need to be shareable to the client directly (email) vs. printed?

## Add discount amount / percent on an invoice

**Why:** Invoices currently have no discount concept. Need the ability to apply a discount to an invoice as either a flat amount or a percentage, reflected in the invoice total and any client-facing output.

**How to apply (to scope during design):**
- Decide granularity: invoice-level discount vs. per-line. Invoice-level is the simpler v1.
- Schema: add discount fields to `invoices` (e.g. `discount_kind text check in ('amount','percent')`, `discount_value numeric`) rather than baking it into a line item, so the audit trail is explicit. Confirm how it interacts with deposit vs. final invoices ([[invoice-quote-lines-position-id-bug]] area; see also "Add invoice_type column").
- Recompute totals wherever the invoice total is derived; make sure the discount shows on the printed/emailed invoice and in any pre-invoice report (item above).
- Tax interaction: N/A today if invoices aren't taxed — confirm before assuming.

## Review the invoice void process (test further)

**Why:** The void/void-status path needs more testing — confirm it behaves correctly end-to-end before relying on it. Related design is already captured under "Invoice corrections after send (workflow design)" and "Add invoice_type column" (the `void` status enum value).

**How to apply (to scope during design):**
- Exercise void end-to-end: what happens to linked timesheet entries' billed state when an invoice is voided? (This is exactly the silent-unbilling hazard in [[timesheet-invoice-linking-redesign]] — voiding must not silently strand or double-free records.)
- Confirm a voided invoice is clearly distinguishable from `superseded` (revision chain) and can't be re-sent/edited by accident.
- Verify numbering: voiding shouldn't reuse/corrupt `invoice_no` (we've seen `-DEP-DEP` style corruption before).
- Write a repro/smoke checklist (extend [`docs/end-to-end-smoke-test.md`](end-to-end-smoke-test.md)) covering draft→sent→void and void→reissue.

## Review process to reset and clean up timekeeping records

**Why:** Need a defined, safe process to reset and clean up timekeeping records — both the existing duplicate/garbage rows and an ongoing "start clean" affordance. Ties directly into the de-cache dedup work (§ "De-cache raw job data" Work item 4: verify + clean duplicate `timesheet_entries`, add a dedup guard) and [[cache-1000-row-truncation]].

**How to apply (to scope during design):**
- Read-only keep/remove report first (never bulk-delete blind), then a guarded cleanup — respecting the freeze/lock rules (approved / invoice-bound / payroll-locked rows must not be deleted; see `deleteTimesheetEntries()` safety + the freeze-trigger denylist entry).
- Add a dedup guard on `(employee_key, work_date, shift_id)` across all add paths so the mess doesn't recur.
- Define what "reset" means operationally: per-job re-import? clear-and-reload from a signed sheet? Clarify with Connor. Coordinate with the planned-vs-actual redesign so a reset doesn't wipe planned crew assignments.

## Password change kills the admin's own session silently — "Unauthorized" everywhere for up to 1 hour (added 2026-08-30)

**Why:** CONFIRMED PROD DEFECT, diagnosed 2026-08-29 against prod logs. Hit John and Connor. When an admin changes their **own** password in User Maintenance, GoTrue revokes every session that user has, server-side. The browser keeps holding the already-issued JWT, and since this project's `jwt_exp` is **3600s**, `supabase.auth.getSession()` keeps handing that token out for up to an hour without ever asking the server. The app looks fully logged in, but every server call sends a token GoTrue has already discarded → 403 → `requireAdmin()` in `app/api/users/route.ts` returns null → `401 {"error":"Unauthorized"}`.

Two compounding failures:
1. **Silent dead session, but only on the admin API routes.** A revoked JWT is still cryptographically valid and un-expired, so PostgREST (signature + `exp` only) keeps accepting it — normal app usage carries on working. Only GoTrue's `/auth/v1/user` checks whether the session still exists, and that is the call `requireAdmin()` makes. So `/api/users` and `/api/notifications` fail while the rest of the app looks perfectly healthy. **This is what makes it read as a permissions bug rather than a login bug.** Verified: in the 23:11:46 → 23:35:07 dead window there were 5 requests total — 3x `GET /auth/v1/user` 403 (the guard, rejected every time), 1x `POST /rest/v1/profiles` **200** (PostgREST accepting the same dead token), 1x failed login. Zero `PUT /auth/v1/admin/users`: no password change of any kind occurred, for any user, including the caller's own.
2. **Wrong error word.** "Unauthorized" reads as "you lack permission" when it means "your session is dead." This is what sent both John and Connor hunting for a rights problem; both were `admin` in `profiles` the whole time.

Verified sequence from prod `edge_logs` + `auth.users` (2026-08-29):
```
23:11:00  POST /auth/v1/token              200   login → JWT issued, exp 00:11:00
23:11:45  PUT  /auth/v1/admin/users/ce1c…  200   self password change SUCCEEDS
23:11:46  GET  /auth/v1/user               403   session revoked; "Unauthorized" banner
23:34:04  GET  /auth/v1/user               403   later edit of ANOTHER user dies here
                                                 ← no PUT follows. Write never happened.
```
The second attempt (changing test account `jobrien882@gmail.com`) was rejected at the guard 22 minutes into the dead-token window and **silently made no change** — the user then could not log in with the password they thought they had set. Note the first-order symptom is also misleading in the opposite direction: a *successful* self-change still paints "Unauthorized", because `handleSave()` ends with `await loadUsers()`, which refetches using the token that was just revoked.

**Confirmed 2026-08-30 (prod logs):** the other-user path is NOT broken — with a live caller token it works end to end. John logged out, logged back in at 23:41:30, and immediately changed `jobrien882@gmail.com`'s password:
```
23:41:30  POST /auth/v1/token                  200   fresh login
23:41:35  GET  /auth/v1/admin/users            200   User Maintenance loads
23:41:56  GET  /auth/v1/user                   200   requireAdmin passes
23:41:56  PUT  /auth/v1/admin/users/8f503c16   200   password change succeeds
23:41:56  GET  /auth/v1/user                   200   post-save loadUsers() SUCCEEDS
23:41:57  GET  /auth/v1/admin/users            200   list reloads - no error banner
23:42:14  POST /auth/v1/token                  200   target logs in on the NEW password
```
So scope the fix to the dead-session window only. `requireAdmin`, the admin endpoint, and the post-save refresh are all correct when the caller's token is live; do not rework them.

**How to apply (to scope during design):**
- **Route self-edits through the user endpoint, not the admin one.** For `editingId === current user`, use `supabase.auth.updateUser({ password })` — the user-scoped `PUT /user` is expected to keep the *current* session alive while revoking the others. Keep `auth.admin.updateUserById` for editing other people (revoking only the target's sessions is correct there). **Verify the session-survival behaviour on dev before relying on it** — this is the load-bearing assumption of the whole fix.
- **Treat any 401 from `apiFetch` as a dead session, not a permissions failure.** Force `supabase.auth.signOut()` and redirect to login with "Your session expired — please sign in again." Applies to the shared helper in `components/shared/user-management.tsx`, so it covers PATCH/POST/DELETE/GET uniformly.
- **Don't let a failed post-save refresh look like a failed save.** `handleSave()` currently closes the modal then calls `loadUsers()`, whose error lands in the page-level red banner — indistinguishable from the save being rejected. Separate the two error surfaces.
- Consider having `requireAdmin()` distinguish "token invalid/expired" (401, session-dead) from "valid token, not an admin" (403, genuine permissions) so the client can react correctly instead of guessing from one opaque string.
- Sweep for the same pattern elsewhere: any other route using the `requireAdmin()` + `Bearer` shape (`app/api/notifications/route.ts` has its own copy) will mislabel a dead session the same way.
- Smoke checklist to add to [`docs/end-to-end-smoke-test.md`](end-to-end-smoke-test.md): (a) admin changes own password → stays usable or is cleanly bounced to login, never silently broken; (b) admin changes another user's password → caller's session survives, target's password actually changes and the target can log in with it; (c) confirm the new password works before the old session's JWT would have expired.

---

## Store day-rate covered hours as a field — SEE #36 (added 2026-08-30, merged 2026-08-30)

**Duplicate — folded into #36** ("DECIDE: the day-rate hour floor is derived by division, not stored"), which already carries the full prod analysis and the pending A/B decision. Do not track separately.

Two things learned on 2026-08-30 that #36 should be read alongside:

1. **The derivation now drives PAY, not just billing.** Day-rate payroll (v2.4.0) pays the derived block of hours. So #36 stopped being a latent billing question and became a live payroll one — the same number now decides what people are paid.
2. **The floor-of-0 case is now guarded.** `dayRateCoveredHours` (`lib/rates/day-rate.ts`) returns the fallback of 10 rather than 0 when the ratio rounds to zero — the BUYOUT case #36 flagged. Deliberate: a 0-hour block on the pay side pays someone nothing for a day they worked, which is worse than the billing overflow. Verified harmless in billing: 0 of 363 day-rate quote lines in prod can reach it (min ratio 50/33).

**John's framing when this was raised (2026-08-30):** the stored field should be a plain **number of hours** — "day hours" / "flat hours" — not a day/half-day enum, so Connor can key 10, 5, 8 or 6 and sell any block. Keep Day / Half Day as UI labels; the stored value is just hours. That makes half-day stop being a special case. This is effectively **option A** in #36, and it needs to cover quoting and invoicing as well as payroll, which is why it was deferred out of the v2.4.0 emergency fix.

## Payroll run: no way to override pay HOURS on an entry (only the rate) (added 2026-08-30)

**Why:** A payroll run entry stores actual hours (`std_hours`/`ot_hours`/`dt_hours`) separately from paid hours (`pay_std_hours`/`pay_ot_hours`/`pay_dt_hours`), and pay is computed off the pay buckets. But **nothing in the UI can edit the pay buckets.** Verified 2026-08-30:

- No file under `components/` or `app/` references `pay_std_hours` at all. The run detail renders it as read-only text (`payroll-run-detail.tsx:922`).
- The only exported mutators on a run entry are `updatePayrollRunEntryBaseRate`, `removeEntryFromRun`, `removeZeroHourEntriesFromRun`.
- `pay_std_hours` is written only at run creation, by add-entries, and by the weekly spill inside `finalizePayrollRun`.

So the only lever is the **base rate**, and using it to force a total is harmful: `buildRipplingCsv` exports hours and rates as separate columns, so a fudged rate pushes both a wrong rate and wrong hours into actual payroll processing, and the AOS row then misstates the person's real rate.

**Why it matters now:** the 2026-08-30 decision is that the weekly 40-hour OT rule applies to **employees only**, contractors exempt, with exceptions (state law, individual contract) handled by manually overriding hours on the run. That policy has no mechanism behind it today.

**Interim workaround (John, 2026-08-30):** overrides are done in **Rippling directly**. Acceptable short-term. Note the tradeoff to evaluate when this is picked up — an override applied only in Rippling means AOS and Rippling permanently disagree about what was paid, so AOS labour-cost and margin reporting silently drifts from reality, and there is no audit trail in AOS explaining why.

**Likely shape when built:** mirror `BaseRateInput` with a `PayHoursInput`; add `updatePayrollRunEntryPayHours` recomputing through `recomputePayFromBase`; stamp `pay_adjustment_reason` (the column already exists and is already used by the 5-hour minimum / round-up reasons). Draft-only, blocked by the existing freeze trigger on finalized/exported runs.

**Analyse before building:** whether AOS should own the override at all, or whether Rippling stays the system of record for exceptions and AOS just needs to record that an override happened.

**Related:** `docs/day-rate-payroll-plan.md` (Blocker 1).

---

## Reports — new top-level nav item (added 2026-08-30)

**Why:** Needed for **tax purposes**, and Connor expects it to grow. There is no general reporting area today — reporting is scattered per-screen (crew roster export, pre-invoice report, Rippling CSV).

**Decision (John, 2026-08-30):** its own **top-level nav item**, not buried under Maintenance/Admin. Expected to grow, and **different people will need access to different reports** — so build role-gating per report from the start, rather than one blanket permission.

**First report: jobs by state, filtered by date range.** Required for **sales tax**.

Feasible with existing data — `job_requests` carries `state`, `state_code`, `city_state`, `venue_zip`, plus `request_date` / `end_date` for the range.

Open design questions, to answer when the report is designed (per John, not now):
- Venue state or client billing state?
- Which date drives the range — start, end, or any overlap? (Matters for jobs straddling a quarter boundary, which is when it will be run.)
- Job counts or **invoiced dollars**? Sales tax almost certainly needs revenue, which means joining invoices.

**Note:** `request_date` / `end_date` are stored as **text**, not dates — range filtering needs a cast or a column-type cleanup.

## Sales tax — analyse whether/how we charge it (added 2026-08-30) — LOWEST PRIORITY

**Why:** Raised alongside the jobs-by-state report. **Nothing in the system handles sales tax today.** Confirmed 2026-08-30: the only tax-related column anywhere in the schema is `clients.tax_id`. Quotes and invoices carry `subtotal`, `deposit`, `amount_due` and no tax field, no tax rate, no per-line taxability flag.

**Needs analysis before any build**, because this is a compliance question first and a software question second:
- Which states create nexus / a filing obligation, given crews travel (the jobs-by-state report is the input to answering this).
- Is labour taxable in those states? Rules differ sharply state to state and often by service type.
- Are any clients exempt, and do we need to store exemption certificates?
- Where does tax attach — per line, per invoice, per job?
- Retroactive exposure on jobs already invoiced without tax.

Do not start schema work until Connor and his accountant have answered the above.

**Priority (John, 2026-08-30): lowest.** Needs substantial analysis and input from outside sources, but must stay on the list — the jobs-by-state report is the first input to it.

---

## Payroll runs are per-job — align the whole flow around that (added 2026-08-30)

**Why:** Connor confirmed 2026-08-30 they run payroll **by job**, not by pay period. The UI still assumes generic period-based runs, so it offers filters nobody uses and makes the job-based flow clumsy.

**No hard link between run and job (John, 2026-08-30).** `payroll_runs` has no `job_id` and **is not getting one**. The run's job is **derived** from its entries (`payroll_run_entries.job_id`), which works now that they do one job per run. This avoids a schema link, a migration, and a constraint that would fight the legacy data.

**Legacy multi-job runs: leave them alone.** Measured 2026-08-30 — of 13 runs, 9 are single-job, **3 span two jobs, 1 spans four**. Those are historical; the team has since standardised on per-job. Derivation should tolerate a run resolving to more than one job rather than assuming exactly one.

Sub-items:

**a. Drop the unused run filters.** Runs are created by job; the other filter choices are noise.

**b. Add a "Payroll Complete" flag on the job.** Label confirmed by John 2026-08-30 — avoids confusion with *the client paid us*.

**Semantics are deliberately minimal: the flag does nothing except remove the job from the dropdown on the payroll run screen.** No side effects, no locking, no bearing on invoices or job status.

**Must be editable — including unchecking**, so they can run a second payroll for a job.

*Possible refinement John floated:* have it set itself when someone who worked that job is actually paid, rather than requiring a manual tick — i.e. creating a payroll run containing entries for that job marks the job complete. Still no hard link; just a side effect of the run existing. Manual uncheck brings the job back into the list, and a later run would set it again. Worth designing this way if it is cheap — a flag that maintains itself is far more reliable here than one that depends on someone remembering.

**c. Exclude the flag from edit locks.** Today `job-detail.tsx:403` sets `isLocked = (!isNew && form.status !== "lead") || isPayroll` — a job locks the moment it leaves `lead`, which is nearly all of them, and there is already an `isPayroll` term in that expression. The flag must stay editable on a locked job or requirement (b) fails.

**d. Filter the payroll job picker.** Exclude jobs marked Payroll Complete, **and filter to `booked` status** (John 2026-08-30 — same rule as the timekeeping pickers).

⚠ Watch the interaction: if a job is moved to `completed` before payroll is run, a `booked`-only filter hides it and nobody can be paid. Since moving to `completed` is manual and prompted by the weekly digest, sequence the digest's nagging so it does not push jobs out of `booked` before payroll happens.

**e. Name payroll runs.** `payroll_runs` has `notes` but no name column. Default the name to the **job name**, editable. Where a job already has a run, default subsequent ones to "2nd run", "3rd run", etc.

**Sequence number lives in the name text** (John 2026-08-30), not a separate field — and the whole name is overridable. Simple; accepts that renaming can break the numbering, which is fine because the name is free-form by design.

## Timekeeping + Timesheet Approval job pickers — show only `booked` jobs, sorted by start date (added 2026-08-30)

**Why:** Both pickers currently list **every** job, including dead leads and quotes never won, so finding a live job is slow and mis-selection is easy.

**Rule (John, 2026-08-30): show only jobs with status `booked`.** Applies to both pickers:
- `components/shared/timekeeping.tsx`
- `components/shared/timesheet-review.tsx` (approval, `app/timekeeping/review`)

Sort by **job start date**, future and current at top, oldest at the bottom.

### ⚠ HARD DEPENDENCY — do not ship before Connor's status cleanup is finished

Measured in prod 2026-08-30:

| Status | Jobs | ...with timesheets |
|---|---|---|
| quoted | 44 | **31** |
| lead | 40 | **26** |
| **booked** | **6** | **4** |
| cancelled | 4 | 0 |

**Only 4 of the 61 jobs that have timekeeping data are actually `booked`.** Filtering to `booked` today would empty both pickers and hide 57 jobs with live data — timekeeping would effectively stop working.

The filter is a one-line change; the cleanup is the whole job. Ship the filter **only after** the cleanup is verified, and confirm the count of `booked` jobs looks sane before enabling it.

### Second-order effect to accept or handle

Once a job moves off `booked` (to `completed`), it **disappears from both pickers**. Fixing a timesheet after a job completes then requires flipping the status back to `booked` temporarily — same pattern as the payroll "paid" flag. John has accepted jobs dropping off once closed; just be aware this is the consequence, and it will come up.

### Status vocabulary — for reference

Actual list (`lib/constants.ts:13`, `JOB_REQUEST_STATUSES`): `lead`, `quoted`, `booked`, `completed`, `lost`. There is **no `invoiced` and no `closed`**.

Also: **`cancelled` exists in prod data (4 jobs) but is not in the constant** — an orphan the UI cannot label. Fix or migrate as part of the cleanup.

**Note on sorting:** `request_date` / `end_date` are stored as **text**, not dates. Sorting works by luck on `YYYY-MM-DD` strings but is fragile; worth casting or migrating the column type.

---

## Weekly data-hygiene digest email to Connor ("nag report") (added 2026-08-30)

**Why:** Nothing in AOS that requires a human to advance it gets advanced. Measured in prod 2026-08-30: 44 jobs sit in `quoted` of which **38 have issued invoices**; 40 sit in `lead` of which 26 have timesheets; only **6 jobs have ever reached `booked`**; 8 of 158 invoices are marked paid; 1 payroll run has ever been finalised.

This is not a training problem — the labels do not stop anyone getting paid, so nobody touches them. But several planned features now **depend** on that data being right:
- The timekeeping / timesheet-approval / payroll job pickers filter on `booked` status.
- Jobs need to reach `completed` to fall out of those pickers.

So the data has to be nudged, on a schedule, by the system. A weekly email to Connor listing what needs attention.

**Proposed sections (John, 2026-08-30):**
- *N jobs have had no activity and should be marked completed*
- *Outstanding time awaiting approval*
- *Leads that need to be quoted*
- *A lead or quote is past its event start date — was it booked, or lost?*
- (more as patterns emerge)

Each section should be a short list with counts and direct links, not a data dump — it is a nag, and it stops working the moment it becomes noise.

### Infrastructure already exists — this is an extension, not a new build

Confirmed 2026-08-30:
- **Email sending:** `lib/notifications/providers/resend.ts` (plus a `mock` provider and a provider registry in `providers/index.ts`).
- **Logging + idempotency:** `notification_log` already carries `event_type`, `channel`, `entity_type`/`entity_id`, `to_address`, `subject`, `status`, `skip_reason`, `provider`, `provider_message_id`, `idempotency_key`, `sent_at`.
- **API route:** `app/api/notifications`.
- **Spec:** `docs/notifications-spec.md`.

Use the existing `idempotency_key` so a retry or double-trigger cannot send the digest twice.

### Scheduling — decide the mechanism

There is **no scheduler configured for the app today**: no `vercel.json`, so no Vercel Cron. The only scheduled job anywhere is `monitoring-capture-15m` in **pg_cron** on the Supabase side.

Two options:
1. **Vercel Cron** — natural fit (it calls the app route directly), but note the account is **Hobby** (see the Vercel access notes): cron frequency is limited and capped in count. A weekly digest may need a daily trigger that no-ops six days a week.
2. **pg_cron + `pg_net`** — already present and can express a weekly schedule natively, but it has to reach out to the app route, which means an auth mechanism for that call.

Pick one before building; it shapes where the digest logic lives.

### Design notes

- Make the recipient list configurable rather than hardcoding Connor — Andie and others will likely want sections of it.
- Consider suppressing empty sections entirely, and skipping the send altogether when everything is clean. A weekly "nothing to do" email trains people to ignore it.
- Each item should link straight to the record that needs fixing.

**Related:** the picker-filter entries above depend on this actually working.

---

## New employee records must default to Contractor, not blank (added 2026-08-30)

**Why:** As of 2026-08-30 the weekly 40-hour OT rule is gated on `employees.employment_type` — it applies to **employees only**, contractors never spill into overtime. Blank counts as contractor.

That makes the default on record creation a money decision. Today `lib/store/db.ts:1714` writes `employment_type: e.employmentType ?? null`, so a record created without one lands **NULL**. It happens to behave correctly under the new rule (NULL → contractor → no OT), but only by accident, and the intent is invisible to anyone reading the row.

**Wanted:** new employee records default explicitly to **Independent Contractor**. In the real world nearly everyone is one — Connor says roughly **6** people are actual employees — so contractor is the correct default and being an employee should be the deliberate, explicit act.

**Covers all creation paths**, not just the UI:
- `lib/store/db.ts` (`saveEmployee` / upsert path)
- `lib/storage/crew-roster-import.ts` — bulk import
- any future import or API route

**Consider a DB-level default** on the column as the backstop, so a path nobody remembered still lands on contractor rather than NULL.

**Related, being handled separately (John, 2026-08-30):** existing blank records are being backfilled to contractor in another session. Once that lands, `employment_type` becomes trustworthy for the first time and every blank row should be gone — after which a NOT NULL constraint is worth considering so it cannot regress.

**Note:** the rest of the codebase already reads this column the same way — `lib/store/db.ts:1413` derives `type = employment_type === "Employee" ? "staff" : "contractor"`. The payroll gate is consistent with that, not a new interpretation.

**Related:** `docs/day-rate-payroll-plan.md`.

---

## HARD BLOCK: a specialty with no pay rate must not be selectable (added 2026-08-30)

**Why:** On 2026-08-29 the payroll run for Neon Nights came out with 11 rows at **$0**, including Connor's own. Cause: `spc-11-01` (Lead) and `spc-02-01` (Stagehand Lead) exist as specialties but appear on **none of the 28 rate cards**, so payroll resolves no `pay_hourly` and snapshots zero.

**Connor did nothing wrong.** He picked the canonical entries in the structured numbering (`spc-01-01` Labor, `spc-02-01` Stagehand Lead, … `spc-11-01` Lead) and has used them consistently — 24 uses across 6 jobs, and 11 across 5, since May. The system offered a valid, correct choice that silently pays nothing and said nothing until payroll.

**No guard exists today.** `components/shared/timekeeping.tsx:191` loads every active specialty and filters only by position:

```
const allSpecialties = useMemo(() => loadSpecialties().filter((s) => s.isActive !== false), []);
```

No rate-card check anywhere in the picker path, nor on the crew-assignment side.

**Decision (John, 2026-08-30): hard blocks, not warnings.** Warnings do not work with this user base. Specialties are chosen early enough in the process — `job_request_crew_needs` and `job_request_assignments` both carry `specialty_id`, so the choice happens when crew is booked, not on the day — that a block cannot strand anyone onsite.

### Proposed layers

1. **Prevent creation.** A specialty with no `pay_hourly` on any rate card is not selectable when booking crew (`job_request_crew_needs` / `job_request_assignments`). This is the real fix — the bad state never exists.
2. **Gate the job.** A job cannot move to `booked` while any crew need references an unpayable specialty. Directly serves the goal: the job cannot go live with crew nobody can pay.
3. **Backstop at finalize.** Already exists — payroll refuses to finalize while any entry has `std_rate = 0` (`unratedCount` / `finalizeBlocked`). Keep it.

Consider also blocking a **null** specialty. The 11th zero-rate row on the 2026-08-29 run was Samuel Shephard's 8/17 entry with `specialty_id` NULL — `lib/store/payroll.ts` bails on the first line (`if (!specialtyId) return { stdRate: 0, ... }`) before it ever reaches a rate card. Same class of problem.

### Blast radius is small — this is turn-on-able

Every specialty currently in use with no pay rate on any card (measured 2026-08-30):

| Specialty | Timesheet rows | Jobs |
|---|---|---|
| `spc-02-01` Stagehand Lead | 24 | 6 |
| `spc-11-01` Lead | 11 | 5 |
| `spc-15-01` Other | 5 | 1 |
| `spc-1780061974393` Hand | 3 | 1 |
| `spc-1780061979504` Hand | 1 | 1 |

**Five specialties, 44 rows.** Three need pricing; the two "Hand" entries are duplicates to retire.

Also unpriced but never used, so harmless until someone picks them: Heavy Equipment Op, Aerial Lift Operator, General Labor, plus a further duplicate "Lead" (`spc-1780061939961`).

### Enabling cleanup — duplicate specialties

There are **six** specialties named "Lead" and **three** named "Hand". Four of the Leads (`spc-1780061932927`, `…948144`, `…953477`, `…965222`) carry pay rates but sit on only two rate cards ("Standard" `ratecard-1780062039174` and "Teddy Swims") and have **never been used on a timesheet**. The canonical `spc-11-01` — the one actually used — has no rates.

So the priced duplicates are junk and the used original is unpriced: exactly backwards. Retire the duplicates and price the canonical entries as part of this work.

**Likely mechanism worth confirming:** the rate-card editor appears to create a NEW specialty when a name is typed rather than matching an existing one — which would explain six identically-named Leads appearing on two cards on the same day. If so, that is the upstream bug and blocking selection alone will not stop it recurring.

**Related:** `docs/day-rate-payroll-plan.md`, and the entry on duplicate employee records.

---

## Move the payroll void cascade from BEFORE UPDATE to AFTER UPDATE (added 2026-08-30)

**Why:** Voiding a payroll run was broken from the day it was written and nobody had ever noticed, because nobody had ever voided a run. Discovered 2026-08-30 when Connor tried to void the 8/29 Neon Nights run and got:

```
tuple to be updated was already modified by an operation triggered by the current command
```

**The collision:**

1. `payroll_runs_void_trg` — **BEFORE UPDATE** on `payroll_runs` — deletes that run's `payroll_run_entries`.
2. `payroll_run_entries_refresh_totals` — **AFTER DELETE** on `payroll_run_entries` — runs `UPDATE payroll_runs SET entry_count/…, total_pay = … WHERE id = v_run_id`.
3. That target row is the one the outer statement is already modifying, so Postgres rejects it.

Voiding therefore only ever worked on a run with zero entries. Confirmed against prod: 12 draft, 1 finalized, **0 voided**, ever.

**What shipped in v2.4.1 is a workaround, not the fix.** `voidPayrollRun` now performs the cascade itself in separate statements — release `timesheet_entries.payroll_run_id`, delete `payroll_run_entries`, then flip status — so the BEFORE trigger's DELETE matches zero rows and nothing nests. That unblocks the app but leaves the trigger itself broken.

**The trigger is still a landmine for anyone who updates status directly** — the Supabase SQL editor, a future API route, a migration, a bulk script. Any of those will hit the original error.

**Proper fix:** split the trigger. Keep a BEFORE UPDATE that only stamps `voided_at` (it needs `NEW`), and move the cascade — the `timesheet_entries` release and the `payroll_run_entries` delete — into an **AFTER UPDATE** trigger. By then the outer statement has finished with the `payroll_runs` row, so the totals refresh can update it freely. Once that lands, the app-side cascade in `voidPayrollRun` becomes redundant and can be reduced back to a single status update.

**Also worth checking while in there:** `refresh_payroll_run_totals` is `FOR EACH ROW`, so deleting a 138-entry run fires 138 separate `UPDATE payroll_runs` statements that all compute the same (eventually zero) totals. A statement-level trigger would do it once. Not causing a problem at current volumes, but it is pure waste.

**Related:** the void path has no test coverage — it is a DB-trigger interaction, which the current pure-function test suite explicitly does not cover (see `tests/README.md`). This is the class of bug unit tests were never going to catch.

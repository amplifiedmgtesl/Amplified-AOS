# Round 3 fixes — decisions to review with John

> ## ▶ RESUME HERE (updated 2026-09-14 afternoon — review done, fixes + seed on dev)
> **State:** all round-3 fixes (batches 1 + 2) are MERGED to `dev` and on the dev preview. Kiosk
> midnight test from the previous round passed (backlog). Nothing below is browser-verified yet.
>
> **Plan for the new session, in order:**
> 1. ✅ **Judgement calls 1–19 all reviewed** (2026-09-14). Changes: 11 lock completely; 13 mirror the
>    rate lookup into the staff app; 15 Copy Planned → selection-only "Copy Planned N" button + No Show
>    without a reason box. Everything else kept as built.
> 2. ✅ **Calls 13 + 15 fixed and merged to dev** (AOS `f078b34`, staff app `d477341`).
> 3. ✅ **Test seed updated per #85** (`supabase/seeds/kiosk-test-job.sql`) — NOT run yet. Two new jobs,
>    both without a quote: **A** `jobreq-kiosktest-a` (KIOSKA, LEAD, the full fixture) and **B**
>    `jobreq-kiosktest-b` (KIOSKB, BOOKED, never quoted, no pinned card, one General Labor worker
>    who must read "Rate TBD"). The old job `jobreq-1786821000000` has a frozen issued quote, so it is
>    retired (days/crew/timesheet removed). **Test step 1 (job A):** Create Quote from Daily
>    Requirements → issue → Book.
> 4. **Re-seed dev on the morning of testing (2026-09-15)** — block 2 crosses midnight, the fixture
>    expires daily. **Ask John before running it.** DEV ONLY (`ovtbvnfhteqxnyirzctt`).
> 5. **Full re-test from step 1**, one step at a time, covering the old script plus everything in
>    "To test after merge" at the bottom of this doc.
>
> **Morning notes (written 2026-09-14 end of day):**
> - **The seed has never run.** Its columns and types were checked against the dev schema (read-only;
>    `attachment_names` fixed to `'[]'::jsonb`), but the first real run is tomorrow — watch its output.
> - **Why two new jobs:** the old job's issued quote is frozen by `quotes_freeze_check` and can't be
>    deleted, so that job can never be "no quote" again. The seed clears its days, crew and timesheet
>    (drops off the kiosk and Timekeeping) and leaves the header, shifts and frozen quote.
> - **Job A (KIOSKA)** — same fixture as before: 2 days, 2 shifts (Load In / Show), day-1 block 2
>    20:00→02:00, 7 crew day 1 (…-07 unconfirmed → "6/7 · −1 short") + 3 crew day 2, rate card pinned.
>    Starts **LEAD** because Create Quote is hidden past Lead. Step 1: Create Quote from Daily
>    Requirements → issue → Book; then grid rates should match the quote.
> - **Job B (KIOSKB)** — BOOKED, one day 09:00–17:00, no shifts, **no pinned card**, never quote it.
>    Rates come from Rhino's client card effective on the start date: **Joseph Allen Stagehand $38,
>    Ryan Anderson Head Rigger $65, Caleb Ballard General Labor = Rate TBD** (not on the card) — check in
>    AOS Timekeeping AND on a staff-app entry. Different people from job A.
> - **Re-seeding mid-test:** once job A's quote is issued it survives re-seeds (NOTICE printed), and the
>    seed keeps job A's job number and status. If job B ever gets an issued quote the no-quote test is
>    void — seed a new job id. The seed refuses to run if any test rows are approved or invoice-bound.
> - **What's on dev:** AOS `cd68a7a` (fixes `f078b34` + seed), staff app `d477341`. Tests only cover
>    arithmetic (208/208); nothing is browser-verified.
>
> **Tabled / waiting:** #105 prod day `rate_mode` (trigger: day-rate quote on a post-8/30 job, or
> Oct 13), #100 early/late flag (Connor + #109), #108 audit trail, #109 settings, #110 Review
> 1,000-row cap, #111 copy prod→dev when schemas match.

Branch `fix/phase0-round3` (off `dev`). Built unattended on 2026-09-13 while the kiosk midnight
sign-outs were still running on the dev preview. **Not pushed, not merged** — the push was blocked
pending John's OK, and merging to dev mid-test would have changed the preview under him. Batch 1
excluded the kiosk; batch 2 (below) includes it, still local only.

Typecheck clean; unit suite **196/196** (22 new, `tests/jobs/print-format.test.ts`). **No browser
verification** — the app needs a login, which I can't do — so every screen change below is
unverified until John sees it on a preview. No kiosk code, no database changes, no pay math touched.

## ⚠ Read first — a prod bug found while fixing (#105)

Nothing in the app writes a job day's `rate_mode`. All 12 days created in prod since v2.5.0 are NULL,
and payroll falls back to the old quote-line behaviour for them. No pay impact today (none of the 7
jobs has a day-rate quote), but the next day-rate job will be paid the pre-v2.5.0 way. Not fixed here —
it's a prod payroll bug and belongs on a branch off `main`. Details in the backlog.

## Judgement calls — say if any are wrong

1. **Timekeeping grid keeps planned rows selectable** (#91). Timesheet Review disables their checkboxes
   as you asked, but the grid also has **Delete**, and deleting a mistaken planned row is legitimate.
   So in the grid the Approve/Reject counts exclude planned rows and Delete counts them.
2. **Picking the day's own time in a planned-time box is not saved as an override** (#69). I'd told you
   it would be; storing nothing is better — the row keeps following the day if the window moves.
   ↺ appears only on a real override.
3. **Crew Schedule prints landscape too** (#78). You asked for landscape on the Sign-In Sheet; I made
   all three documents landscape so the set behaves the same. The Job Summary is unchanged.
4. **Landscape cause still unknown.** I didn't find why the preview route ignored the app-wide rule, so
   the route now states landscape itself. **Check the default in Safari's print dialog first.**
5. **No-time-window stop on print** (#71) blocks the Print button and names the days, but the preview
   still shows the document so you can see what's missing.
6. **Add Crew Member highlights the row instead of focusing it** (#72). At rest the employee cell is a
   click-to-open tile, so the first focusable thing in the row is the Confirmed checkbox — focusing that
   would let a stray Space tick it.
7. **Print button opens the last document used** (#86), falling back to Crew Schedule; remembered per
   browser.
8. **Text removed (#96):** Assigned Crew per-row hint + override chip (the grey/dark colour replaces
   both), the "Pick the actual people…" line, the long day-banner sentence, the print page's purpose
   and PDF-tip lines, Timekeeping's text-only "Linked Invoice / Quote Detail" card (it had no controls),
   and the "Hide Bill Columns" description. Explanations moved to hover titles. **Kept but shortened:**
   document banners ("SCHEDULE — planned times, reference only." / "RECORD OF HOURS WORKED — actual
   recorded times.").
9. **Sort default is Last name** (#80) on all three documents; the kiosk (first name) was not touched.
10. **Import with no position now imports blank** instead of "Stagehand" (#73). Approval already
    refuses rows missing position/specialty, so it can't be approved that way.

## Batch 2 (built after the review, 2026-09-13 late) — calls to check

11. ~~Rows that already carry time aren't locked by #106~~ → **REVIEWED (John, 2026-09-14): lock
    completely**, including rows with time, in the grid and at the kiosk. Prod check: of 3,038 rows with
    time, 85 unapproved ones miss position/specialty, only 2 from the last 30 days — old jobs.
12. **#71 import:** days with times import; days without are skipped and named. The whole import is only
    refused when every day lacks times — a multi-day job with one unscheduled future day still imports.
    → **REVIEWED (John, 2026-09-14): keep as built.**
13. **#57 Timekeeping rate card when the job has no quote:** now uses the job chain (pin → client card
    effective on the start date → master default). ⚠ The staff app carries a synced copy of the old
    quote-only lookup (`amplified-staff/lib/calc/rate-resolution.ts`) — **not changed**, so staff-app
    entries on a quote-less job still price the old way until mirrored.
    → **REVIEWED (John, 2026-09-14): keep, AND mirror into the staff app now** (own branch; step-2 fix).
    ✅ Built: staff app `fix/staff-rate-lookup` — same chain; unresolved rates now 0 (Rate TBD), not 35/52/70.
14. **#57 rate-card editors** refuse to save a row with neither an hourly nor a day rate (0 such rows in
    prod, so no existing card is blocked). ⚠ Prod has **143 rate-card rows** at exactly the old pre-fill
    ($35 / $350 / $52.50 / $70) — some may be real, many are probably untouched defaults. Worth a review.
    → **REVIEWED (John, 2026-09-14): keep the rule; no review of the 143 rows** — the defaults were chosen
    because they were the common real rates, so matching them is expected.
15. **Copy planned → actual dialog** defaults to "Selected rows" when rows are ticked, otherwise the
    first expanded day. No Show and Undo use simple browser prompts (reason optional).
    → **REVIEWED (John, 2026-09-14): CHANGE (fix before re-test).**
    (a) Copy planned → actual becomes a selection-only batch button beside Approve/Reject, labelled
    "Copy Planned N" like "Approve N": N counts only eligible ticked rows (skip rows with any actual
    time, approved, No Show, missing position/specialty/shift); hover "Copy planned to N of M"; disabled
    only when N = 0. Remove the toolbar button, the dialog's whole-day scope, and the day picker. Keep
    the required reason + Notes audit line.
    (b) No Show: drop the reason box — plain Yes/No confirm; Notes line still records who/when. Undo No
    Show unchanged.
    (c) Access (John): everyone who had the old button keeps it — coordinators, payroll and /lead crew
    leaders can now tick rows on a job timesheet, but their bar shows only Copy Planned.
    ✅ Built on `fix/copy-planned-selection`.
16. **#68 on Booked jobs:** days can change, which moves the job's start/end dates (DB trigger), but the
    **job number doesn't recompute** because the header is locked — a job re-dated after booking keeps
    its old number. Decide whether that's right.
    → **REVIEWED (John, 2026-09-14): keep as built** — job number is the job's permanent ID once Booked
    (issued quote/invoice numbers derive from it).
17. **#107:** office/remote time (no job) skips the position and shift checks in Review.
    → **REVIEWED (John, 2026-09-14): keep as built.**
18. **Kiosk sort default is Last name**, remembered per device.
    → **REVIEWED (John, 2026-09-14): keep as built.**
19. **#101 was overstated** — see the backlog correction: the kiosk already reloaded fresh before a
    punch, so an open tab didn't overwrite grid edits. The fix still matters (single-row, awaited save).
    → **REVIEWED (John, 2026-09-14): agreed, closed.**

Built in batch 2: #57, #68, #71 (import), #92, #97, #98, #101, #106, #107, kiosk sort, kiosk (+1),
kiosk text. Tests 208/208 (12 new). Found and logged, not fixed: #110 (Review loads ≤1,000 entries),
#111 (copy prod to dev when schemas match).

## Built (batch 1)

#69, #70, #71 (print), #72, #73, #74, #75, #76, #77, #78, #80, #81, #82, #83, #84, #86, #87, #88, #89,
#90, #91, #92 (Reject guard only), #93, #94, #96 (non-kiosk screens touched), #99, seed (`rate_mode`,
corrected crew-needs comment).

## Not built — still open

#67 stale screen data (architectural) · #100 early/late flag (waits on Connor + #109 settings) · #102–#104 ideas · #105 prod day `rate_mode`
(tabled, trigger Oct 13) · #108 audit trail project · #109 configurable business rules · #110 Review
1,000-row cap · #111 copy prod to dev · #44/#45 staff app ownership.

## To test after merge

Everything from round 3 step 1, plus: grey vs dark planned times and ↺; Add reusing a blank row;
Planned badge + counts + Reject guard; Review sort and "Any date"; Staff time filter gone; one Print
button; Sort; `*`, key and `(+1)`; phone format; `(unassigned)` on both sheets; Print blocked for a
no-window day; filenames; **landscape by default in Safari**; nothing clipped at the right edge; a
person's two rows never split across pages.

Batch 2 additions: "Rate TBD" instead of $35 (grid + Review); a job with no quote still gets rate-card
rates; rate-card editors refuse an unpriced row; time locked on rows missing position / specialty /
(2+ shifts) shift — grid AND kiosk; single-shift jobs fill the shift automatically; Review approve
refuses rows missing a role; No Show mark/undo + Notes line, Review filter, late punch lifts it, "Include
no-shows" on Actuals + pre-invoice (default off); Daily Requirements editable on a Booked job; can't
delete/re-date a day with timesheet rows; delete-day confirm names crew needs + assigned crew; Add Crew
from Job skips no-window days; kiosk rounding with seconds, "Punch NOT recorded" on a failed save,
"No position set — see your crew leader", kiosk Sort, (+1) on kiosk times.

Review-call fixes (2026-09-14): **Copy Planned N** in the selection bar — count matches eligible ticked
rows (skips rows with time, approved, No Show, missing role), hover "N of M", greyed only at 0, required
reason + Notes line, no toolbar button or day option; as coordinator / payroll / crew leader (/lead) you
can tick rows on a job but see only Copy Planned. **No Show** is a plain Yes/No. **Job B (no quote):**
Stagehand $38 and Head Rigger $65 from the client card, General Labor "Rate TBD" — in AOS Timekeeping
AND on a staff-app entry. **Job A:** Create Quote from requirements → issue → Book, then the rates on the
grid match the quote.

# Round 3 fixes — decisions to review with John

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

11. **Rows that already carry time aren't locked by #106** (grid and kiosk), so an open shift can still
    be closed and legacy rows can be corrected. The block only stops the FIRST time going in.
12. **#71 import:** days with times import; days without are skipped and named. The whole import is only
    refused when every day lacks times — a multi-day job with one unscheduled future day still imports.
13. **#57 Timekeeping rate card when the job has no quote:** now uses the job chain (pin → client card
    effective on the start date → master default). ⚠ The staff app carries a synced copy of the old
    quote-only lookup (`amplified-staff/lib/calc/rate-resolution.ts`) — **not changed**, so staff-app
    entries on a quote-less job still price the old way until mirrored.
14. **#57 rate-card editors** refuse to save a row with neither an hourly nor a day rate (0 such rows in
    prod, so no existing card is blocked). ⚠ Prod has **143 rate-card rows** at exactly the old pre-fill
    ($35 / $350 / $52.50 / $70) — some may be real, many are probably untouched defaults. Worth a review.
15. **Copy planned → actual dialog** defaults to "Selected rows" when rows are ticked, otherwise the
    first expanded day. No Show and Undo use simple browser prompts (reason optional).
16. **#68 on Booked jobs:** days can change, which moves the job's start/end dates (DB trigger), but the
    **job number doesn't recompute** because the header is locked — a job re-dated after booking keeps
    its old number. Decide whether that's right.
17. **#107:** office/remote time (no job) skips the position and shift checks in Review.
18. **Kiosk sort default is Last name**, remembered per device.
19. **#101 was overstated** — see the backlog correction: the kiosk already reloaded fresh before a
    punch, so an open tab didn't overwrite grid edits. The fix still matters (single-row, awaited save).

Built in batch 2: #57, #68, #71 (import), #92, #97, #98, #101, #106, #107, kiosk sort, kiosk (+1),
kiosk text. Tests 208/208 (12 new). Found and logged, not fixed: #110 (Review loads ≤1,000 entries),
#111 (copy prod to dev when schemas match).

## Built (batch 1)

#69, #70, #71 (print), #72, #73, #74, #75, #76, #77, #78, #80, #81, #82, #83, #84, #86, #87, #88, #89,
#90, #91, #92 (Reject guard only), #93, #94, #96 (non-kiosk screens touched), #99, seed (`rate_mode`,
corrected crew-needs comment).

## Not built — still open

#67 stale screen data (architectural) · #85 next-round seed (quote created in-app; second no-quote job)
· #100 early/late flag (waits on Connor + #109 settings) · #102–#104 ideas · #105 prod day `rate_mode`
(tabled, trigger Oct 13) · #108 audit trail project · #109 configurable business rules · #110 Review
1,000-row cap · #111 copy prod to dev · #44/#45 staff app ownership · staff-app mirror of the #57 rate
lookup.

## To test after merge

Everything from round 3 step 1, plus: grey vs dark planned times and ↺; Add reusing a blank row;
Planned badge + counts + Reject guard; Review sort and "Any date"; Staff time filter gone; one Print
button; Sort; `*`, key and `(+1)`; phone format; `(unassigned)` on both sheets; Print blocked for a
no-window day; filenames; **landscape by default in Safari**; nothing clipped at the right edge; a
person's two rows never split across pages.

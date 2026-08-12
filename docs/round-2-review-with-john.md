# Round-2 fixes — decisions to review with John

Branch: `fix/timekeeping-round-2` (off `dev`, pushed, **not merged**).
Written 2026-08-11 while working the round-2 list unattended.

Everything on the round-2 list is **done**: #38, #39, #40, #41, #42, #43, #47,
#49, #50, #51, #52, #53, #54. Typecheck and `next build` are clean. Nothing was
skipped as a stopper.

Below is every place I made a judgement call rather than following an explicit
instruction. **Each one is implemented as described** — this is a review list,
not a question list. Disagree with any of them and it's a small change.

---

## 1. #54 — a new `planned` status (you picked this option; noting the fallout)

Verified before building: `getAllStaffReviewEntries()` selects every
`timesheet_entries` row with **no status filter**, and `isPending()` counts
`'submitted'`. So the ten blank imported rows genuinely did sit in Timesheet
Review, approvable at zero hours, and inflated the dashboard's pending count.

The import now writes `status = 'planned'`; `promoteWorkedStatus()` flips it to
`'submitted'` on the first time recorded, from any of the three write paths
(kiosk punch, grid edit, Copy planned → actual).

**Judgement calls inside that:**

- **Promotion lives OUTSIDE `computeTimeEntry`.** That function is a synced
  copy mirrored in the staff app; this is AOS-side lifecycle policy, not shared
  hours math. Keeping it separate lets the mirror stay byte-identical. The cost
  is that every path writing times must remember to call it — there are three,
  all changed, and they're the same three that call `computeTimeEntry`.
- **Bulk approve now refuses planned rows** in both Timesheet Review and the
  Timekeeping grid, with a message saying why. Approving one would bless a
  zero-hour record as a reviewed fact. Reachable because the Planned/All
  filters make them selectable.
- **Planned rows are excluded from the invoice draft editor's pending bucket.**
  They'd otherwise show as "N workers / 0 hours" in the heads-up panel, which
  reads as time awaiting approval rather than time nobody has worked.
- **No migration.** `timesheet_entries.status` has no CHECK constraint, so this
  is application-enforced. Documented on the `TimeEntry` type. ⚠ If you'd
  rather it be constrained, that's a migration and a decision about what the
  legal set is (there are NULL-status legacy rows to account for).
- **⚠ Left alone deliberately: the pre-invoice report.** It reads *all*
  statuses by design and buckets by status, so planned rows will appear there
  as a `planned` bucket with zero hours. That's honest but might be noise —
  I didn't change it because the report is explicitly all-statuses. **Worth a
  look during round 2.**
- **⚠ The staff app doesn't know about `planned`.** It's out of scope for round
  2 (#44/#45 deferred), and planned rows have `user_id` NULL so it won't create
  them — but if a staff user ever edits one, the staff app won't promote the
  status. Fold into the #44/#45 work.

## 2. #41 — 12-hour display, and how far I took it

Storage stays 24h `HH:MM`. Display is 12h AM/PM via new `formatClock()` /
`formatClockRange()` in `lib/time-utils.ts`.

- **I included `master-calendar.tsx`** (3 display spots). It wasn't named in
  the finding, but it's the same raw-24h bug and the fix is display-only. **ICS
  generation and `parseHour()` are untouched** — I did not go near anything
  that feeds a calendar export. Say the word and I'll revert just that file.
- **I put the helper in `lib/time-utils.ts`** rather than a new module,
  next to `parseMinutes` which it uses. That file carries a SYNCED COPY warning,
  but the warning covers `durationMinutes` and its helpers; adding a new export
  doesn't affect the mirror.
- `pre-invoice-report-view.tsx` still has its own local `fmtClock`. I left it —
  consolidating it is a no-behavior-change tidy-up, and I'd rather not touch
  the invoicing surface in the same branch as the timekeeping round-2 work.

## 3. #38 — three warnings, no new gates

You said warn, don't block. Implemented as: a job-health check
("No time window on *date*", **warning** severity), the inline hint on the
Assigned Crew panel, and a **confirm before printing the sign-in sheet** that
lists how many crew per day would print with a blank Expected.

- The print pre-flight **fails open** — a bug in it must never stop someone
  printing a crew sheet.
- **I also extracted `lib/jobs/planned-times.ts`**, one resolver for "what
  times is this person expected to work", now used by the printed Expected
  column, the kiosk, and Copy planned → actual. This was slightly beyond the
  finding, but the three surfaces have to agree or a worker signs against one
  schedule while the office bills from another — and they *didn't* agree: Copy
  planned → actual used `??` where the others used truthiness, so an empty
  string planned value would have blocked fallback there but not elsewhere. In
  practice the columns hold NULL, so this was latent, not active.

## 4. #47 — I fixed it in three places, not one

The finding named the sign-in sheet header. The same pair-1-only bug is in the
days-section summary and the job print sheet, so I fixed all three. Low risk,
but it means two screens changed that the finding didn't mention.

## 5. #40 — the exact wording

Rows with planned values get an **"override" chip**; rows without get
**"leave blank to use *the day window*"** with the real window named. When the
day has no window at all, it says so in amber instead. Wording is a
five-second change if you'd phrase it differently.

## 6. #49–#53 — the kiosk

Followed your direction (Time In/Out 1 and 2, named shift, planned times, live
date + time). Judgement calls:

- **Block 2 still opens at the start of the day.** Second-shift-only workers
  need it, and that's why it was built that way. I made it *safe* rather than
  removing it: the two blocks are visually separated and each is labelled with
  its own scheduled window. The backlog note suggested going further — only
  opening the block whose window contains "now". **I didn't do that**, because
  it would lock out anyone whose day drifts from the schedule, which is common.
  Worth deciding explicitly.
- **A "⚠ Not today" chip** appears when the selected work day isn't the device's
  today. Not in the finding; it seemed the obvious partner to putting the date
  on screen.
- **Crew-slot loading failures degrade to "No scheduled time"** rather than
  taking the roster down. The kiosk must keep working if the schedule query
  fails.

---

## Midnight-crossing shifts (John, 2026-08-12)

**"A large percentage of jobs fall into that category," and round 1 never
tested one.** Now built into the seed rather than left as a note to remember:
day 1 (= today) block 2 runs **20:00 → 02:00**, and one crew member carries a
per-worker override that also rolls over (21:00 → 03:00), so both the
day-window and override paths get exercised. It sits on day 1 deliberately so
it can be *punched* through midnight, not just looked at.

Walking the existing code through that scenario predicted a failure, now fixed
(`71f01be`): the kiosk defaulted to `deviceLocalDate()`, so at 00:30 a crew
member signing out of the previous day's block was shown the *next* day's
roster — a different timesheet row with four empty slots. Tapping there would
open tomorrow's shift while last night's stayed open. Pre-existing, but the
"⚠ Not today" chip added earlier in round 2 stayed **silent** in exactly that
case, because the selected day genuinely was today. It now prefers the day
whose scheduled window still contains the current instant (rollover-aware, 2h
grace), and warns about open punches on other days.

**Still worth watching during the test, not fixed:**
- `formatClockRange` prints `8:00 PM – 2:00 AM` with **no next-day marker**.
  On the sign-in sheet's Expected column that is ambiguous — is 2:00 AM the
  same morning or the next? Deliberately left alone: adding "+1" everywhere is
  a display decision worth making with the printed page in front of you.
- `inferPairDatesLocal`'s `bump()` builds a local date then reads it back via
  `toISOString()`. Correct for negative UTC offsets (America/New_York), **off
  by one for positive offsets**. Not reachable for this US-only company, and
  it is a synced copy shared with the staff app, so it was not touched — but
  it is a real latent bug if the app ever runs anywhere east of Greenwich.

## Not addressed — still deferred, as agreed

#44, #45, #46, #48, #55, #56, #57, #58. Untouched, per the round-2 split.
Round 2 therefore still: stays on desktop, stays AOS + kiosk only, skips all
printing, and **needs a quote seeded on the test job** or every rate is $35.

## Testing notes

- **No local browser verification was possible.** `.env.local` on this machine
  points at the **prod** Supabase, and the `env-guard` correctly refuses
  `next dev` against it. The branch is pushed so Vercel builds a preview
  against the dev database — that's the test surface.
- **There is no test runner on this branch.** `package.json` has only
  dev/build/start; the vitest setup lives on the unmerged `invoicing-unit-tests`
  branch. `promoteWorkedStatus()` and the planned-times resolver are both pure
  functions and are the obvious first unit tests once that lands.
- The seeded test job `jobreq-1786821000000` is still on dev. Its ten rows
  carry `status = 'submitted'` from the **old** import — they will NOT
  retroactively become `planned`. **Re-seed the job before round 2** or #54
  will look unfixed.

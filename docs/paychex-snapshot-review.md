# Paychex snapshot + profile Paychex section: build review with John

Built 2026-10-20 (unattended) on `feature/profile-paychex`, off main. Plan: `docs/paychex-snapshot-plan.md`.

## What's built

- **Migration `20261020c_paychex_snapshot.sql`** (applied to dev only): table `paychex_workers` (the copy), table `paychex_snapshot_runs` (each refresh and what it did), and function `fill_paychex_worker_ids()`.
- **`lib/paychex/snapshot.ts`:** reads and saves the copy. `refreshSnapshot()` is the full refresh with automatic changes; `refreshSnapshotData()` saves the copy only (used by Send).
- **Two steps (John, 10/20):** **pull** reads Paychex and saves the copy (reads only, always completes); **process** applies the changes from the copy (no Paychex calls).
- **`/api/paychex/snapshot?step=pull|process`:** GET for the weekly schedule (`vercel.json`: pull `0 3 * * 2` UTC, process `30 3 * * 2`), POST for **Refresh now** (admins), which runs pull then process.
- **Reading the copy instead of Paychex:**
  - Onboarding's check: no Paychex calls, except **one per person AOS sent who's still waiting** (by worker ID);
  - Sync from Paychex (Payroll page);
  - the profile Paychex section.
- **Send to Paychex:** re-reads Paychex only when the copy is **over an hour old**, and saves the newly sent worker into the copy.
- **"Paychex as of <when> · Refresh now"** on Onboarding (replaces **Check Paychex**), in the Sync from Paychex panel, and on the profile.
- **"Sent … · waiting":**
  - Onboarding: "Sent Oct 20 · waiting";
  - profile: "Sent to Paychex … · waiting for them";
  - Payroll run: amber "sent to Paychex Oct 20, waiting" instead of red "no Payroll ID";
  - crew/timekeeping flags: the same.
- **Profile Paychex section** (admins only): duplicates with Merge / Not same, Paychex matches with Use ID, **Add to Paychex** (greyed out with the reason as a hover hint), and a one-person **Sync from Paychex** for people with a Payroll ID.
- **Onboarding order:** oldest job date first (crew assignment or timesheet, whichever is earlier), future bookings at the bottom. Each row shows the first date worked "to" the last.
- **Shared code:** `lib/paychex/sync-server.ts` holds the sync's apply, log and clear-link code (moved out of the sync route unchanged). `automaticChanges()` in `sync-plan.ts` is the auto-apply rule, with a test.

Tests: 268 pass, typecheck clean. The DB writes, the refresh and the pages haven't run yet; that's the preview test.

## Judgement calls (approve or overturn)

1. **Auto-applied on each refresh:** contact/status updates, new hires, clear links and worker IDs. **Held:** unclear links, plus changing or clearing a Payroll ID (`reid` / `clear`). New hires are only proposed by the sync when there's no possible AOS match (a similar name is held), so adding them automatically is safe.
2. **Send's over-an-hour check saves the copy but applies nothing.** Applying changes inside a send could run past Vercel's 60 seconds. The Monday refresh and **Refresh now** do the applying.
3. **Process stops applying at 45 s;** any rest goes to the next run, and the run log records how many were left. The first run should have little to apply (sync was 0 diffs on 10/14). Process is its own step, so this never affects the pull.
4. **Schedule: pull `0 3 * * 2` UTC, process `30 3 * * 2`.** That's Monday 11 pm / 11:30 pm Eastern in daylight time, 10 pm / 10:30 pm in winter. Vercel cron runs in UTC with no time zone setting.
5. **Needs `CRON_SECRET` in Vercel (Production).** Without it, the weekly run is refused (401) and only Refresh now works.
6. **Onboarding's Check Paychex button became "Refresh now":** a re-check against the copy would show nothing new.
7. **Before the first refresh there's no copy:** Onboarding shows "No copy of Paychex yet"; **Add to Paychex** is greyed out with "click Refresh now"; Sync from Paychex says to click Refresh now.
8. **The light profile check from the first build** (`fetchPaychexWorkerList`) was removed; the profile reads the copy like everything else.
9. **Contact info is only in the copy for active workers,** as before; inactive and terminated workers have names and status only.

## Needed from John

1. Add **`CRON_SECRET`** in Vercel → amplified-aos → Settings → Environment Variables, Production. I can generate the command, like the webhook secret.
2. Preview test: open Onboarding, click **Refresh now** (about 30 s), and check the as-of time, worker IDs, profile, Payroll run and Sync panel.
3. OK to release: the prod migration is run by John, then main and dev.

## Help text (HELP.md on dev, at merge)

- **Onboarding:** "AOS keeps a copy of Paychex, refreshed every Monday night. **Paychex as of …** shows how old it is; **Refresh now** reads Paychex again (about 30 seconds). Opening the page checks everyone against the copy. Someone already sent is looked up in Paychex directly, so their Payroll ID is linked as soon as they finish setup." Rows: "oldest job date first; people only booked ahead are at the bottom." Sent rows: "**Sent … · waiting**: Paychex emailed them; their Payroll ID comes when they finish setup."
- **Employees (profile):** the Paychex section: **Add to Paychex** (greyed out until there are no possible duplicates, no possible Paychex matches and an email; hover to see why), and **Sync from Paychex** for people with a Payroll ID.
- **Payroll:** "**sent to Paychex …, waiting**" in amber means the invite went out; they're left out of the file until their Payroll ID arrives. Sync from Paychex reads the copy; the Monday refresh already applies email, phone, address, status, new hires and clear links, so the list is what's left to decide.

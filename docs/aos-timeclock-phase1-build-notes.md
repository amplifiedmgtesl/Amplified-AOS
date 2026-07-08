# Time Clock — Phase 1 Build Notes

Branch: `feature/timeclock-phase1`. Built unattended 2026-07-08. Spec: [aos-timeclock-spec.md](./aos-timeclock-spec.md).

## What's built (Phase 1)

New **`/timeclock`** kiosk (name: **"Time Clock"**). Crew leader opens it on a shared on-site device (admin/crew_leader only), picks a Job + day, and workers self-serve sign-in/out with a captured signature. Each punch writes the same `timesheet_entries.time_in1..out2` a crew leader would type, plus a raw-instant + signature audit row.

### Files
- `supabase/migrations/20260708a_timeclock_captures.sql` — `timesheet_captures` table, `job_requests.timezone` column, private `timeclock-signatures` bucket + RLS. **Additive only.**
- `lib/timeclock/time.ts` — round instant → nearest-5-min "HH:MM"; device zone/date helpers.
- `lib/storage/timesheet-captures.ts` — signature upload + `upsertCapture` (partial patch) + `loadCaptures`.
- `components/shared/signature-pad.tsx` — dependency-free canvas signature pad (pointer events; PNG blob).
- `app/timeclock/layout.tsx` — role guard (admin/crew_leader) + kiosk shell.
- `app/timeclock/page.tsx` — job/day picker, roster, four-slot action panel, signature modal, punch logic.

### Design decisions honored
- Writes go through the existing `loadTimesheetForJobLive` + `computeTimeEntry` + `upsertTimesheet` path → records are **identical to crew-leader entries**, hours/pay recompute correctly.
- Four-slot state machine derived from `time_in1..out2` (so crew-leader/no-signal backfills enable the right buttons). In 2 opens at start (second-shift-only) or after Out 1.
- Sign-in requires a signature; sign-out is one tap. No notes/override on the kiosk (corrections → timekeeping screen).
- Raw instant + `capture_tz` stored per punch; signatures in a **private** bucket (PNG for Phase 1; vector deferred to the Phase 2 PDF).

## Verification done
- ✅ Migration applied to **DEV** (`ovtbvnfhteqxnyirzctt`) via Management API; objects confirmed present.
- ✅ `npx tsc --noEmit` clean.
- ✅ `npm run build` succeeds; `/timeclock` route compiles.
- ⏳ **Interactive preview not run** — see below.

## ⚠️ Two things for you in the morning

1. **`.env.local` points at PRODUCTION** (`wmssllfmahotppoyxxrr`), not dev. So a plain `npm run dev` runs the app against **prod**. The Phase 1 migration was applied to **DEV only**; prod does NOT have `timesheet_captures`/the bucket. To preview safely, point the dev server at dev by creating `.env.development.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://ovtbvnfhteqxnyirzctt.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev anon key>
   ```
   I did **not** fetch the dev anon key (a credential-materialization guardrail blocked it, correctly — it wasn't something you'd explicitly asked me to pull). Grab it from the dev project's API settings. `.gitignore` now ignores `.env*.local`. Then `npm run dev` → open `/timeclock`, log in as a crew_leader/admin, pick a job with seeded crew, and exercise sign-in/out.
   - Separately: `.env.local` (with a prod service-role key) has historically been committed — worth rotating that key.

2. **When you're ready to ship to prod**, apply `20260708a_timeclock_captures.sql` to the prod project too.

## Known Phase-1 limitations / notes
- Rounded time uses the **device** (on-site) timezone; `job_requests.timezone` is stored but not yet threaded into the picker (device zone is correct on-site). ZIP→timezone auto-derivation deferred.
- `upsertTimesheet` only syncs crew-leader rows (`user_id IS NULL`) — kiosk-seeded rows qualify. A staff-app-submitted row (`user_id` set) would not persist via this path (not expected on the kiosk).
- Job picker lists all jobs (sorted by event date desc); no search yet.

## Phase 2 / 3 (not built)
- **Phase 2:** provenance badge on the timekeeping screen (derive from `timesheet_captures` vs `time_*`); PDF of the timesheet with signatures (signed URLs from the private bucket; consider vector signatures).
- **Phase 3:** admin view of capture data + maintenance (delete a mistaken capture, etc.).

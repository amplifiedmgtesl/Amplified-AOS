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
- ✅ Migration applied to **dev** (`amplified-aos-dev` / `ovtbvnfhteqxnyirzctt`) via Management API; objects confirmed present.
- ✅ `npx tsc --noEmit` clean.
- ✅ `npm run build` succeeds; `/timeclock` route compiles.
- ✅ Committed and pushed to **`origin/dev`** → Vercel builds a dev preview against `amplified-aos-dev`.
- ⏳ **Interactive preview to be checked in the Vercel dev deployment** (`/timeclock`, logged in as crew_leader/admin, on a job with seeded crew).

## Environment notes

- **Dev flow (confirmed):** Supabase `amplified-aos-dev` + GitHub `dev` branch → Vercel preview → promote to prod. The migration correctly targets `amplified-aos-dev`, and Vercel's dev env vars point there — so the pushed code should preview correctly.
- **Before promoting to prod:** apply `20260708a_timeclock_captures.sql` to the prod project (`amplified-aos` / `wmssllfmahotppoyxxrr`) — it does **not** have `timesheet_captures` / the bucket yet.
- **Local-only footgun:** this Mac's `Amplified-AOS/.env.local` points at **prod** (`amplified-aos`), so a local `npm run dev` would hit live data. Not part of the Vercel flow, but avoid local dev runs without repointing that file. (Also: `.env.local` reportedly carries a prod service-role key — worth rotating. `.gitignore` now ignores `.env*.local`.)

## Known Phase-1 limitations / notes
- Rounded time uses the **device** (on-site) timezone; `job_requests.timezone` is stored but not yet threaded into the picker (device zone is correct on-site). ZIP→timezone auto-derivation deferred.
- `upsertTimesheet` only syncs crew-leader rows (`user_id IS NULL`) — kiosk-seeded rows qualify. A staff-app-submitted row (`user_id` set) would not persist via this path (not expected on the kiosk).
- Job picker lists all jobs (sorted by event date desc); no search yet.

## Phase 2 / 3 (not built)
- **Phase 2:** provenance badge on the timekeeping screen (derive from `timesheet_captures` vs `time_*`); PDF of the timesheet with signatures (signed URLs from the private bucket; consider vector signatures).
- **Phase 3:** admin view of capture data + maintenance (delete a mistaken capture, etc.).

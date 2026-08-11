# AOS Timeclock — On-Site Crew Sign-In Kiosk — Spec

Status: **Draft v1** (2026-07-07) — design analyzed, not started.
Owner: jobrien

## Goal

Replace the printed paper daily timesheet + physical sign-in sheet with a **simple, shared-device "timeclock"** inside **Amplified-AOS**. On-site, a crew member taps their name, **signs on the device** when they sign in for a shift, and taps to clock out. The system captures the actual times and the signature, filling in the existing timesheet records so the crew lead no longer hand-enters everyone's times.

Concretely it must:

1. **Show the day's scheduled crew** for a job (the rows that already come from crew assignments).
2. Let a worker **sign in for each shift** (up to two shift-starts per row) with a **captured signature**, and **clock out**.
3. **Write actual times + signatures** into the existing `timesheet_entries` rows, leaving the crew lead's review/approval flow unchanged.
4. Let the client **see, on-site, who is working/signed in today** (live view + printable sheet with signatures filled in).

This is **not** the full timekeeping editor. It is a stripped-down, kiosk-friendly capture surface. The crew lead still reconciles no-shows and approves in the existing timekeeping screen.

## Why a kiosk in AOS (not the Staff Portal)

Decision record — settled:

- A worker-facing time-entry app already exists (`amplified-staff` / Staff Portal), where workers log in as `profiles.role='staff'` and feed the same `timesheet_entries`. **But no one uses it for crew timekeeping** — Connor is hesitant to roll out per-worker logins to everyone.
- The kiosk's entire value is capturing worker times + signatures **without provisioning a login per crew member**. The crew lead initiates the screen, so it runs under **the crew lead's existing `crew_leader` session**. Workers are `employees` (by `employee_key`), not auth users.
- Identity on the kiosk = **tap your name + sign**. Because there's no login behind it, the **signature is the accountability / anti-buddy-punch artifact** — which the client wants anyway.

## Scope

**In scope (v1):**
- Crew-lead-initiated, **job-scoped** kiosk: pick a job → the day's roster.
- Tap-to-sign-in (with signature) and tap-to-clock-out, mapping to `time_in1/out1/time_in2/out2`.
- Signature capture + storage, linked to the specific shift-start.
- Live on-site "Today" read view (who's scheduled vs. signed in).
- Printable signature sheet (existing print path, signatures filled in).

**Out of scope (later phases):**
- **Email the filled-in timesheet to the client as a PDF** (Phase 2).
- Offline / poor-signal buffering — **explicitly not handled**. If a venue has no connectivity, the crew reverts to the printed paper timesheet for that day.
- Per-worker PIN as an extra anti-buddy-punch control.
- Any change to the Staff Portal.

## How it fits the existing system (verified in code)

- **Times already have the right shape.** `timesheet_entries` stores each worker-row as `time_in1, time_out1, lunch_minutes, time_in2, time_out2` — exactly the two-shift-per-day sign-in/out structure. **No schema change for the times.**
- **A worker can appear more than once per day.** Each `timesheet_entries` row is per **position/specialty/shift** (`position_id`, `specialty_id`, `shift_id`). So a crew member working **shift A as a rigger and shift B as a stagehand** = **two rows on the same job's timesheet**, differing by position/specialty/shift. The kiosk lists their name once per row.
- **Scheduled crew already flows into timesheet rows.** `loadJobCrewSlots()` ([lib/storage/job-request-assignments.ts:104](lib/storage/job-request-assignments.ts)) → `addCrewFromJob()` ([components/shared/timekeeping.tsx:588](components/shared/timekeeping.tsx)) seeds one planned row (`status='submitted'`) per `(employee, day, shift)` slot, de-duped on `employeeKey|workDate|shiftId`. The kiosk reads these same rows.
- **Approval/lock is already enforced.** A freeze trigger locks `timesheet_entries` content once `status='approved'` (super-frozen once billed). The kiosk stays **advisory** — it fills planned rows; the crew lead still reviews and approves.
- **Print path exists.** `printWithTitle` (`@/lib/print-with-title`, used in the shared timekeeping component) is the basis for the signature sheet.
- **Storage pattern exists.** Supabase Storage buckets + `lib/storage/*` helpers (upload / getPublicUrl / remove) are the model for signature files.

## Signatures — data model & storage

**Capture points:** signatures are taken at **sign-in for each shift-start** only (`time_in1`, `time_in2`). So **up to two signatures per row**. **Clock-out is also self-service** — the worker returns to the roster, picks the same row, and taps **Sign Out**, which captures `time_out1`/`time_out2` (a timestamp only, **no signature**). This removes out-time entry from the crew lead too; their only residual role is exceptions (a missed punch) + approval.

**New table** — **one capture row per `timesheet_entries` row** (a child table, so it does not touch the freeze trigger's locked-column list). Holds the four **raw ground-truth timestamps** (audit) plus the two signature paths:

```sql
create table if not exists timesheet_captures (
  timesheet_entry_id    text primary key references timesheet_entries(id) on delete cascade,
  -- raw timestamps captured on tap (audit); ROUNDED values live on timesheet_entries.time_*
  actual_in1            timestamptz,
  actual_out1           timestamptz,
  actual_in2            timestamptz,
  actual_out2           timestamptz,
  -- signatures (sign-ins only)
  signature_in1_path    text,   -- path in the private signatures bucket
  signature_in2_path    text,
  captured_employee_key text,   -- denormalized for audit
  capture_tz            text,   -- IANA zone the device captured in (e.g. 'America/Chicago') — self-describing audit
  updated_at            timestamptz not null default now()
);
```

The 1:1 grain (keyed on `timesheet_entry_id`, not the person) is what makes the rigger/stagehand two-row case work with no special handling, and gives the print sheet + live view a single join.

**Alternative considered — one row per punch** (`slot in ('in1','out1','in2','out2')`, `actual_ts`, `signature_path`): more normalized, better *if* per-punch device/IP/geo audit is ever wanted. Deferred; the single-capture-row above is simpler for v1 and easy to migrate to later.

### Time capture, rounding & audit

- **Raw first.** On every tap, store the true `timestamptz` in `timesheet_captures.actual_*`. This is the ground-truth audit record.
- **Rounded for pay.** The pay-/bill-facing value is the rounded time-of-day written to `timesheet_entries.time_in1..out2` (text) — same field the crew lead edits today.
- **Increment = 5 minutes**, mirroring the existing timekeeping grid (`timeOptions()` in `lib/store/timekeeping.ts` steps `m += 5`). At 5-min granularity a tap is at most ~2 min from a slot, so rounding rarely changes pay — the 8:05 → 8:00/8:15 dilemma only exists at coarser 15-min buckets, which we are **not** using.
- **Rule = round to nearest increment** (symmetric/neutral). **Do not** round clock-in up + clock-out down — under US FLSA, timeclock rounding must be neutral or favor the employee; consistently employer-favorable rounding is a wage-and-hour liability. Because the raw timestamp is always retained, the rounded value is a convenience layer, not the source of truth, and can be re-derived or defended in a dispute.

### Timezone

**Store absolute instants, display in the job's local timezone.** Decision record:

- `actual_*` are `timestamptz` = an **absolute instant** (Postgres stores UTC internally; the type name is misleading — it does not store a zone). The value is unambiguous regardless of where it was captured or viewed, so **the Supabase server's timezone (Eastern) is irrelevant** to correctness — it only affects default rendering, which we always override.
- **Capture** = store the absolute instant on tap. **Display** = always render in the **job's local timezone** (where the work happened), never the viewer's or server's, and **always show a zone label** ("Tue 8:05 PM CDT"). A labeled local time is what makes raw data non-confusing when someone in Eastern views a Central job.
- **All existing timesheet entries are already local time** (assumed **job-site local** — the crew signs the on-site wall clock; confirm this isn't office/Eastern-normalized). The pay-facing fields (`time_in1..out2` local wall-clock text + `work_date`/`end_date`) are unchanged — the `timestamptz` layer sits underneath as absolute-instant audit.
- **Job timezone is the source of truth.** Add `job_requests.timezone` (IANA, e.g. `'America/Chicago'`), **auto-derived from the venue address** (the job already stores `venueZip`, `stateCode`, `city`, `state`):
    - Primary: **ZIP → IANA** via a static offline lookup (~42k US ZIPs shipped as a data file — no geocoding API, no new runtime service). Derive the IANA name (not a fixed offset) so DST is automatic.
    - Fallback: **state → IANA** when ZIP missing/unrecognized (backstop only — ~a dozen states split across two zones, so ZIP is preferred).
    - **Derive to *suggest*, store to *trust*:** derivation pre-fills an **editable** field; staff confirm/override. Boundary-ZIP/bad-address errors are corrected here.
- **Derive wall-clock from the JOB timezone, not the device.** A device's tz *setting* only affects display — it does NOT change the absolute instant `new Date()` returns (NTP clock). So rendering the captured instant in `job_requests.timezone` yields correct local time **even if the device tz is misconfigured** (e.g. a tablet on Eastern in Dallas). Store absolute `timestamptz`; derive `time_in1..out2` by rendering it in the job zone. Fall back to device-local only if job tz is unset.
- **Stamp the capture timezone** at tap (`Intl.DateTimeFormat().resolvedOptions().timeZone`) into `capture_tz` — self-describing audit + input to the warning.
- **Device-vs-job warning.** At kiosk open (per job), compare device zone vs `job_requests.timezone`. On mismatch show a **non-blocking** banner: *"This device is set to Eastern but this job's venue is Central. Times record in the job's timezone — verify the device clock."* Non-blocking because either side could be wrong; flag it, let the crew lead decide.
- **Cross-midnight resolves itself**: e.g. shift 1 Tue 8:00 PM → Wed 1:00 AM Central = two instants; rendered in job zone the out correctly rolls to Wed (handled by existing `end_date`). No special midnight logic. Storing bare local strings ("01:00" with no date) would be the ambiguous case — which is why the audit layer is absolute.
- **No new dependency**: native `Intl.DateTimeFormat({ timeZone })` for rendering job-local wall clock; ZIP→IANA is a bundled data file.

**Storage format:** prefer **vector stroke paths (SVG, ~2–5 KB)** over PNG (~10–25 KB) — smaller *and* prints crisp at any size (better for the print/PDF requirement). Store in a **private** Supabase Storage bucket; render via **short-lived signed URLs** generated in the crew lead's authenticated session. Signatures are more sensitive than the existing public buckets warrant.

**Storage footprint:** `worker-rows/day × ~1.5 sigs × size × ~250 days/yr`. ≈ **0.75–2 GB/yr** at PNG, **~150–400 MB/yr** at vector — pennies/month on object storage. Critically, files live in **object storage, not Postgres**: the DB only holds the ~40-byte `storage_path`, so this adds **nothing** to DB size, backups, or the existing monitoring-driven DB bloat.

## Kiosk flow

```
Crew lead (crew_leader session, on a shared tablet/phone/computer)
  │
  ├─ Opens /timeclock  →  picks the Job + day (job-scoped)
  │
  ▼
Roster screen  (read of the job's timesheet_entries rows for the day)
  • one entry per (employee, position/specialty, shift)
  • each list item shows: NAME + POSITION/SPECIALTY (+ shift) + current state
      [ Not signed in ] → [ On shift 1 ] → [ Shift 1 done ] → [ On shift 2 ] → [ Done ]
  • REQUIRED: because a person can appear more than once (e.g. rigger on shift A,
    stagehand on shift B), the list must display position/specialty (and shift)
    next to the name so the worker taps the correct row. Name alone is ambiguous.
  │
  ▼  worker taps their name/row  (self-service, every event — in AND out)
Action screen for that row — FOUR slots, each Available / Greyed(done) / Disabled:
        [ Sign In → time_in1 ]   [ Sign Out → time_out1 ]
        [ Sign In → time_in2 ]   [ Sign Out → time_out2 ]
  • Sign In opens the signature pad → capture → save  (signature required)
  • Sign Out is a single tap, no signature
  • no note/override UI on the kiosk — corrections happen on the timekeeping screen
  │  worker leaving → returns to the SAME roster, picks the SAME row, taps the next Sign Out
  ▼
Row updated live; roster reflects new state.
Crew lead only handles exceptions (missed punches) & approves in the normal screen.
```

### Button state machine (four slots, "enable the next legal one")

**State is derived from `timesheet_entries.time_in1..out2`** — the pay-facing fields — **not** from the kiosk's own capture data, and there is no status column. This is deliberate: those fields are the *same* whether a time arrived via a kiosk tap **or** the crew leader typing it on the timekeeping screen, so both entry paths drive the buttons identically (see "No-service / manual backfill" below). Each slot is Available, Greyed (filled, shows the time), or Disabled:

| Slot | Available when… |
|---|---|
| **In 1** (Sign In + signature) | nothing captured yet |
| **Out 1** (Sign Out) | In 1 captured, Out 1 not |
| **In 2** (Sign In + signature) | Out 2 not captured **and** not mid-shift-1 → i.e. at the very start *or* after Out 1 |
| **Out 2** (Sign Out) | In 2 captured, Out 2 not |

- **Both sign-ins are live at the start** so a **second-shift-only** worker (or one whose shift-1 was a different position → a different record) can go straight to **In 2**; picking In 2 first greys out In 1/Out 1. Normal workers tap In 1 → Out 1 → In 2 → Out 2 in order, each step exposing only the next slot.
- **A second shift is always the same position/specialty** (a different position = a separate record with its own four slots), so In 2/Out 2 are always the same row as In 1/Out 1 — no ambiguity.
- **Records are identical to crew-lead-entered ones** — the kiosk writes the same `time_in1..out2`; the `timesheet_captures` layer is invisible to the timekeeping screen. **Corrections happen on the timekeeping screen**, not the kiosk (kiosk is capture-only).

### Corrections & notes → the timekeeping screen (kiosk is capture-only)

The kiosk has **no note or override UI** — the happy path is a single tap (phone-friendly, nothing to navigate past ~90% of the time). All exceptions — forgot-to-sign-out, wrong time, no-service backfill, notes — are handled by the crew lead on the **timekeeping screen**, which already has the 5-min picker and notes.

- **Why not an on-kiosk override:** on a shared device the kiosk can't distinguish the crew lead from a worker (everyone just taps names in the crew lead's session — no per-person login), so an override would need a crew-leader gate (PIN / "leader mode"). Removing it removes the misuse risk entirely.
- **Trade-off accepted:** the "override the displayed time but keep the real press-instant" audit trail only exists for kiosk taps; a correction typed on the timekeeping screen is plain manual entry (no press-instant) — same as today, no regression.
- **Notes** live on the timekeeping screen (existing row-level `notes` to start; per-field notes can be added *there* later if needed). No note columns on `timesheet_captures`.

### Per-slot provenance indicator (timekeeping screen)

The timekeeping screen shows, per slot (in1/out1/in2/out2), how that time was entered. **Derived** — no new columns — by comparing the two layers we already store:

| Indicator | Condition | Meaning |
|---|---|---|
| **⌨️ Timekeeping (manual)** | no `actual_slot` | typed on the timekeeping screen; kiosk never tapped for this slot |
| **🕒 Timeclock** | `actual_slot` exists **and** `time_slot` == round(`actual_slot`) | kiosk tap, unchanged |
| **✏️ Timeclock · overridden** | `actual_slot` exists **and** `time_slot` ≠ round(`actual_slot`) | kiosk tap, later edited on the timekeeping screen |

- **Override tooltip** shows both times from `actual_*`: *"Captured 5:03 PM via timeclock, adjusted to 5:00 PM"* — a free audit hover.
- **Derive, don't store:** a small join to `timesheet_captures` + comparison on render. Avoids 4 `source_*` columns on `timesheet_entries` (freeze-trigger churn + write-path flag maintenance) and can't drift out of sync.
- Doesn't conflict with "records look identical" — the pay data is unchanged; the badge is an overlay on the cell.
- Benign edge: overriding back to *exactly* the rounded capture reads as "Timeclock" (displayed value == captured value, so the distinction is moot).

### No-service / manual backfill

Because button state reads `time_in1..out2`, a time entered by the crew lead on the timekeeping screen enables the next slot on the kiosk automatically — no "kiosk entry?" flag anywhere:

1. No service at shift start → nobody can clock in on the app.
2. During the shift the crew lead enters everyone's `time_in1` on the timekeeping screen.
3. Service returns; a worker opens the kiosk → **In 1 is greyed/done**, **Out 1 is enabled** (as if they'd tapped Sign In) → they Sign Out normally.

- A manually-entered `time_in1` has **no digital signature** (no sign-in tap happened) — expected, and why paper is the no-service fallback (the paper sheet holds the physical signature that day). Partial-service days = partial digital signatures.
- If the crew lead later edits/clears a time, the kiosk buttons follow — the kiosk always reflects the current record.

**Tap → time mapping:** a punch captures the absolute instant (→ `actual_*`), rounded to the nearest 5-min slot in the job timezone and written to `time_in*/out*` (see Time capture & Timezone above).

## Client visibility (on-site)

The paper sheet is a *living document* the client can glance at any time; digitizing turns it into a snapshot, so we provide both:

- **(A) Live "Today" view** — read-only screen (kiosk tablet or a shared display): roster with scheduled position/shift, signed-in ✓/✗, and the captured signature. Shows **scheduled vs. actual** at a glance — more useful than paper. Always current.
- **(B) Printable signature sheet** — the existing print path, with signature cells per shift-start rendering the stored signatures. Point-in-time; an **end-of-day print** captures everyone. Matches the current physical deliverable.

No client login — the crew lead shows the tablet or hands over the printout. Both are just reads of `timesheet_entries` + `timesheet_captures`; no new data.

## Open decisions / gating assumptions

Two **non-engineering** calls to resolve **before building** (each gates the project's value):

1. **Connor** accepting the kiosk approach (no per-worker logins). *Settled in favor of the kiosk, pending his confirmation.*
2. **The client** accepting a **digital signature** (on tablet / printed from stored image) as equivalent to wet ink. If they specifically value watching a physical signature on physical paper, digital may need to run **alongside** paper for a transition. Validate with the client first.

Engineering details:
- Signature storage format (vector vs raster) — **recommend vector**. *(open)*
- ~~Timezone for tap→time conversion~~ **settled** (store absolute `timestamptz`, display in job-local via new `job_requests.timezone`; rounding = 5-min nearest, raw retained).
- ~~Explicit "Done for the day" / `staff_finalized`~~ **settled: none.** "Done" is implicit (all needed slots filled); the record looks identical to a crew-leader entry and provenance is read from `timesheet_captures`. The `staff_finalized` flag is not used by this feature.
- ~~Poor-signal handling~~ **settled: not handled** — revert to the printed paper timesheet when a venue has no connectivity.
- Whether the kiosk device stays on one job all day, or the crew lead switches jobs. *(open)*

## Phasing

- **Phase 1** — Kiosk capture (sign-in/out + signature), `timesheet_captures` table + private bucket, live "Today" view, printable signature sheet.
- **Phase 2** — Email the filled-in timesheet to the client as a PDF.
- **Later** — offline buffering, per-worker PIN.

## Related

- `docs/aos-agent-spec.md` — sibling in-app feature (fixed-tool Claude agent).
- `docs/shifts-design-analysis.md` — the `job_request_shifts` / `shift_id` model this relies on.
- Freeze trigger & `timesheet_entries` schema — `supabase/migrations/` (base `20260415…`, freeze `20260525d`, staff-finalized `20260614a`).

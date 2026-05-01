# Shifts: design analysis

Written 2026-04-29 by Claude for John's morning review. Goal: figure out the right shape of a `shifts` master table — given how shifts are used in this app today and how the AV-staging industry actually thinks about them.

---

## TL;DR — Recommendation up front

**Build TWO tables, not one:**

1. **`shift_types`** — small org-level master table of named shift kinds (Load-In, Set-Up, Show Call, Strike, Load-Out, Overnight, plus a few generic Day 1 / Day 2 entries for multi-day events). Has default start/end times, color, sort order. Edited rarely. ~10 rows.

2. **`job_shifts`** — per-job instances. One row per concrete shift on a specific event date with concrete start/end datetimes. References `shift_types` so reporting can group by kind. References `job_id` (or `quote_id` until the rewrite renames it) so a job can have N shifts.

Then `quote_lines.shift_id` and `invoice_lines.shift_id` become FKs to `job_shifts`, replacing today's free-text `shift_label`. Existing `Shift 1` / `Shift 2` strings get dropped — they don't carry information that survives normalization.

**Org-level for the type catalog. Job-level for the actual times.** Don't normalize at the client level — there's no real evidence clients have client-specific shift conventions; what looks like "this client always does an overnight" is really "this kind of event always does an overnight."

---

## 1. How shifts are used in the app today

### Schema

`shift_label` is a free-text column on exactly two tables:

- `quote_lines.shift_label`
- `invoice_lines.shift_label`

Nothing else has a shift column — not `job_sheets`, not `timesheet_entries`, not `calendar_events`, not `job_requests`. So shifts only exist in the pricing/billing flow.

### UI behavior (quote-builder.tsx)

- New line defaults to `shiftLabel: "Shift 1"`.
- "Add line" button auto-increments: `shiftLabel: \`Shift ${lines.length + 1}\`` (line 453).
- "Copy line" appends " Copy" to the existing label (line 477).
- The cell is a free-text `<input>` — no constraint, no dropdown, no autocomplete.

### Data on dev (taken 2026-04-29)

```
Shift 1 × 77        ← 60% of all rows
(NULL)  × 42        ← 26% of all rows
Shift 2 × 9
Load In × 3, Load IN × 1   ← case inconsistency
Load Out × 2, Load OUT × 1 ← same
DAY 1 .. DAY 5 × 2 each
SHOW × 2, OVERNIGHT × 1
Shift 3 .. Shift 54 × 2 each   ← single quote auto-numbered
```

### What the largest real quote looks like

The Pro Football Hall of Fame 2026 quote (55 lines, biggest in the system):

| event date | shift_label | lines |
|---|---|---|
| 2026-08-05 | Shift 1 | 7 |
| 2026-08-06 | Shift 1 | 7 |
| 2026-08-07 | Shift 1 | 7 |
| 2026-08-08 | Shift 1 | 7 |
| 2026-08-09 | Shift 1 | 20 |
| 2026-08-10 | Shift 1 | 7 |

**Every single line in the largest quote in the system is labeled "Shift 1".** The day separation is carried by `quote_date`, not by `shift_label`. So the column is doing zero real work in the data — it's a placeholder users have ignored.

### Findings

1. **The Shift 1…Shift 54 auto-numbering is data noise.** It's an artifact of the UI's default-value pattern. Nobody is meaningfully labeling lines as "Shift 1 vs Shift 2" — they either leave them all "Shift 1" or use date as the separator.
2. **The few rows with real labels (`Load In`, `Load Out`, `SHOW`, `OVERNIGHT`, `DAY 1..5`) are the actual signal.** Users who care about shifts type the AV-industry-standard names by hand. The case drift (`Load In` vs `Load IN` vs `Load OUT`) shows there's no controlled vocabulary.
3. **Shifts only exist on quotes/invoices.** They don't propagate to job sheets, calendar, or timesheets. That's a gap if we want to use shifts for crew scheduling or payroll grouping later.
4. **No start/end times are captured per shift.** The only times in the data are the line-level `start_time` / `end_time` (when present), and the `quote_date`. There's no notion of "Shift A starts at 6am, Shift B starts at 2pm."

---

## 2. How the AV / event-staging industry actually thinks about shifts

The industry has a controlled vocabulary that this app's `Load In` / `SHOW` / `Load Out` / `OVERNIGHT` users were reaching for. The standard shift kinds, roughly in order of an event lifecycle:

| Code | Common name | Typical timing | What it covers |
|---|---|---|---|
| `LOADIN` | Load-In | Day before / morning of event | Trucks unload; gear staged; rough placement. Heavy labor. |
| `SETUP` | Set-Up | Same day, after Load-In | Rigging, audio, video, lighting positioned and patched. |
| `SOUND_CHECK` | Sound Check / Rehearsal | Hours before show | Artist rehearsal, focus, levels. Smaller crew. |
| `SHOW` | Show Call | Doors → end of show | Smallest crew, highest-skill (A1, V1, LD, stage manager). |
| `STRIKE` | Strike / Load-Out | Immediately after show | Reverse of Load-In. Often runs into overnight. |
| `OVERNIGHT` | Overnight | After hours | Premium-rate; common for one-day rebuilds. |
| `DAY_N` | Day 1 / Day 2 / … | Per calendar day | Multi-day events (festivals, conferences) usually use this. |

Cross-cutting modifiers (not separate shift kinds, but commonly tracked):
- **Call time** — when a worker has to physically be on-site, distinct from when their billable hours start.
- **Meal break** — typically a 30 min unpaid break after 5 hours; doesn't end the shift.
- **OT trigger** — after N hours, hourly rate flips to OT rate (already in the rate card).

### What other tools do

From the research: LASSO, Mertzcrew, When I Work, Celayix, Nextcrew, Armada — every event-crew scheduler has the same primitive concept: **named shift kinds at the org level, plus per-event instances with real start/end times**. Workers see "Load-In Tuesday 8am–noon" not "Shift 1." Reports group by kind ("how many Load-In hours this quarter?").

### What other tools DON'T do

- They don't number shifts ("Shift 1, Shift 2"). The auto-incrementing pattern in this app is unusual.
- They don't expose the underlying shift catalog as free text. It's always picked from a dropdown.
- They don't usually scope shift kinds to clients. If Loud&Clear and Rhino both run multi-day festivals, they both use the same "Day 1 / Day 2" kinds.

---

## 3. Where should the master live? Org / Client / Job?

### Org-level (recommended for the catalog)

The kinds themselves (`LOADIN`, `SETUP`, `SHOW`, `STRIKE`, etc.) are universal AV-industry terms. They don't vary by client. Editing them once at the org level keeps them clean across every quote and invoice.

### Client-level (rejected)

Tempting because clients sometimes have idiosyncratic event styles, but:
- Maintenance burden: the same "Load-In" kind would have to be defined N times for N clients.
- Reporting cost: "show me all Load-In hours" becomes a multi-table join.
- The data we have doesn't support client-specific shift conventions — Loud&Clear's quotes and Rhino's quotes use the same words when they use any.
- Real client-specific tweaks (e.g. "this client requires a 10am call instead of 8am") are job-level facts, not shift-kind facts.

### Job-level (recommended for instances)

The actual concrete shifts for a real event need real timestamps and live on the job:
- "Pro Football HOF 2026-08-05 Load-In 06:00–14:00"
- "Pro Football HOF 2026-08-05 Set-Up 14:00–22:00"
- "Pro Football HOF 2026-08-09 Show 17:00–23:00"

Each shift instance points back to a `shift_type` for the kind, plus the job and the concrete start/end. This is where reporting like "how many crew-hours of Load-In on the HOF event?" gets answered.

---

## 4. Proposed schema

```sql
-- 1. The catalog of kinds. Small, edited rarely.
create table shift_types (
  id              text primary key,           -- e.g. 'sht-loadin'
  code            text not null unique,       -- 'LOADIN', 'SHOW', 'STRIKE', …
  name            text not null,              -- 'Load-In', 'Show Call', …
  description     text,
  default_start   time,                       -- e.g. '06:00' for LOADIN; nullable
  default_end     time,                       -- e.g. '14:00'; nullable
  default_duration_hours numeric,             -- alternative to start/end if start floats
  sort_order      int  not null default 0,
  color           text,                       -- '#2563eb' etc., for calendar UI
  is_active       boolean not null default true
);

-- Seed:
--   sht-loadin   LOADIN  Load-In       06:00-14:00  (10)
--   sht-setup    SETUP   Set-Up        nullable     (sort 20)
--   sht-show     SHOW    Show Call     17:00-23:00  (sort 30)
--   sht-strike   STRIKE  Strike        nullable     (sort 40)
--   sht-loadout  LOADOUT Load-Out      nullable     (sort 50)
--   sht-overnight OVERNIGHT Overnight  22:00-06:00  (sort 60)
--   sht-day      DAY     Day           nullable     (sort 70, used as catch-all)


-- 2. Per-job instances. Has the real datetimes.
-- Note: until the quote rewrite renames job_requests → jobs, the FK below
-- points at quotes(id). After rewrite it should point at the jobs table.
create table job_shifts (
  id              text primary key,           -- e.g. 'jsh-…'
  quote_id        text references quotes(id), -- swap for jobs(id) post-rewrite
  shift_type_id   text not null references shift_types(id),
  label           text,                       -- override of shift_type.name (rare)
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create index job_shifts_quote_id_idx on job_shifts(quote_id);
create index job_shifts_shift_type_idx on job_shifts(shift_type_id);


-- 3. Lines reference the instance, not the type.
-- Replaces today's free-text shift_label.
alter table quote_lines    add column shift_id text references job_shifts(id);
alter table invoice_lines  add column shift_id text references job_shifts(id);
```

**Why job_shifts has its own start_at/end_at instead of inheriting from shift_types.default_start/default_end:** real events shift these around constantly (load-in pushed to 5am instead of 6am because of a venue restriction; show runs short; strike doesn't actually start until 1am because tear-down is gnarly). The defaults seed the form; the instance carries reality.

**Why not put shift_id on job_sheets and timesheet_entries too:** I'd recommend that as a follow-up after the quote rewrite. Today those tables don't reference shifts at all — adding them in this round would be scope creep. Once the quote rewrite ships, the natural pattern is:
- `quote_lines.shift_id` → priced
- `job_shifts` → scheduled
- `job_sheet_workers.shift_id` → assigned
- `timesheet_entries.shift_id` → tracked
- `invoice_lines.shift_id` → billed

All five hang off the same `job_shifts` row, giving end-to-end traceability for "this Load-In on Tuesday."

---

## 5. Migration / rollout plan

1. **Migration A — seed the catalog.** Create `shift_types`, insert ~10 standard rows. Pure additive. No app code changes needed yet.
2. **Migration B — instance table.** Create `job_shifts`. Pure additive.
3. **Migration C — line columns.** Add `shift_id text` to `quote_lines` and `invoice_lines`. Nullable for now. Pure additive.
4. **Backfill (optional, can defer).** For each existing quote, look at distinct `(quote_date, shift_label)` pairs in its lines, create one `job_shifts` row per pair (best-guess `shift_type_id` from string-match: "Load In*" → LOADIN, "Show*" → SHOW, "Shift 1"/NULL → DAY), set `start_at`/`end_at` from the line's `start_time`/`end_time` if available else NULL, then populate `quote_lines.shift_id`. Same on invoices. About 218 quote_lines + 117 invoice_lines, manageable in one migration.
5. **UI rollout.**
   - Quote builder: replace the free-text `shiftLabel` input with a two-step pick: "Shift type" dropdown (Load-In, Show, etc.) + "Shift instance" select that lets you reuse an existing `job_shifts` row on this quote or create a new one inline. Same on invoice builder.
   - Add a "Shifts" section near the top of the quote (like the dates row): list of this quote's `job_shifts` with start/end times, edit-in-place. Lines pick from this list.
6. **Drop legacy.** Once UIs read shift_id and ignore shift_label, drop `quote_lines.shift_label` and `invoice_lines.shift_label` in a final cleanup migration.

This sequencing is safe at every step — the new columns are additive and ignored by legacy code paths until you're ready to flip the UI.

---

## 6. Open questions for John

These need your call before I'd start coding:

1. **Backfill aggressiveness.** Do we backfill the 218+117 existing rows (per step 4 above)? Or accept that pre-rollout quotes/invoices keep their `shift_label` text and only new ones use the FK? Backfill is a few hundred rows of best-guess matching; not hard, but introduces ambiguity ("Shift 1" → which instance?).
2. **Multi-shift days.** A heavy event day (e.g. HOF 2026-08-09 with 20 lines) might have Load-In in the morning AND Strike at night on the same date. Do we represent that as 2 `job_shifts` rows (recommended) or compress into one "Day 1" instance? Recommendation says 2.
3. **Workers vs. shifts.** When we do tie `job_sheet_workers.shift_id` and `timesheet_entries.shift_id`, can a worker be assigned to multiple shifts on the same day (Load-In + Show)? Almost certainly yes — payroll groups by shift kind for billing breakdown.
4. **Sequencing vs the quote rewrite.** Phase A (quote rewrite) is the active project. Should shifts wait until after Phase A so we can build them on top of the rewritten schema, or land before so the rewrite picks up shifts as a first-class concept? My vote: **land shift_types + job_shifts + line FKs BEFORE the rewrite**, and have the rewrite incorporate them natively. The rewrite is going to have to deal with how lines reference shifts anyway; might as well do it once.
5. **Dropdown content.** Do you want the catalog seeded with the AV-industry standard set (LOADIN/SETUP/SOUND_CHECK/SHOW/STRIKE/LOADOUT/OVERNIGHT/DAY) or something narrower based on what Connor & team actually need to track? I recommend the standard set; add/remove by editing one row in `shift_types`.

---

## 7. What I'd build first (if you say go)

A small, contained 3-migration cluster:
1. `shift_types` catalog + seed.
2. `job_shifts` instance table.
3. `quote_lines.shift_id` / `invoice_lines.shift_id` columns (nullable).

Followed by a "Shifts" UI section on the quote builder that lets you add/edit shifts on an event with concrete start/end times. Lines inherit from there. No backfill in v1; existing rows keep `shift_label` text until they're touched. Total scope: ~1 day of work.

Then I'd pause and let you live with it for a week before doing backfill or extending to job_sheet/timesheet.

---

## Sources

- [LASSO — Live Events Software](https://www.lasso.io)
- [AV Crew Scheduling: How to Facilitate a Smooth Live Event — Mertzcrew](https://pages.mertzcrew.com/blog/av-crew-scheduling-smooth-live-event)
- [Best Event Staff Management Software — Everhour](https://everhour.com/blog/event-staff-management-software/)
- [Common Event Terms — Encompass Event Group](https://encompasseventgroup.com/2022/10/19/common-event-terms/)
- [Guide to Event Production Terminology and Jargon — Creative Day](https://www.creativeday.com/blog/event-production-terminology)
- [Strategic Database Design For Shift Management Reporting — myshyft.com](https://www.myshyft.com/blog/reporting-database-design/)
- [Database Design for Scheduling System (paripex)](https://www.worldwidejournals.com/paripex/recent_issues_pdf/2014/July/July_2014_1405422184__25.pdf)
- Existing project memory: `lib/store/types.ts`, `components/shared/quote-builder.tsx`, `components/shared/invoice-builder.tsx`, dev DB `quote_lines` / `invoice_lines` shape and content as of 2026-04-29.

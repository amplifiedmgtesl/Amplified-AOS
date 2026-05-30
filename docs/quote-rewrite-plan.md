# Quote Rewrite — Build Plan (Phase A)

**Status:** Ready to execute on `dev`. Prod deferred per user decision.
**Date drafted:** 2026-05-04 (revised 2026-05-04 after design review)
**Companion docs:**
- [system-flow-rewrite.md](system-flow-rewrite.md) — overall architecture across the client→invoice chain
- `project_todo.md` ⭐ Active project — locked-in design summary + display-code convention + crew reconciliation
- `feedback_attachment_storage_pattern.md` — canonical pattern for any file-upload features touched along the way

This plan only covers **Phase A: the quote rewrite**. (Connor recovery already complete in an earlier session.) Invoice rewrite (Phase C) and `job_requests → jobs` rename (Phase B) come later, in that order.

---

## What the rewrite is solving

1. **Slug-PK overwrite class of bug** (Connor incident). `quotes.id` is a slug derived from client+event+date. `saveInvoiceDraft` calls `saveQuote` as a side effect. With a stale cached slug, generating an invoice against quote A silently overwrites the row of unrelated quote B. Already happened ≥3 times we know of.
2. **Drafts living in JSONB.** `quote_draft_workspaces.data` is an opaque blob carrying stale slugs across sessions.
3. **No identity discipline.** No revision chain, no freeze on issued quotes, no separation between draft and frozen states. "Edit" silently mutates a sent document.

Everything else (display codes, multi-contact clients, shifts normalization, timesheet-driven invoices) is downstream and not in this phase.

---

## Decisions (locked 2026-05-04 review)

| # | Question | Decision |
|---|---|---|
| 1 | Where do new quotes start from? | **Always from an existing job_request.** No "+ New Quote" entry point on the quotes screen. First quote spawns from the job request detail page; subsequent quotes spawn as revisions of an existing frozen quote. No auto-create of job_requests. |
| 2 | One table or two? | **One table** (`quotes`). The existing schema is already one table mixing draft + issued + signed; we fix it rather than split it. Aligns with `job_requests` and the unified-list UI. |
| 3 | Draft separator: status enum or boolean? | **Boolean `is_draft`** is the single source of truth for the draft/frozen axis. `status` enum is restricted to issued-document lifecycle: `issued / signed / superseded`. NULL while draft. CHECK constraint pins the relationship. |
| 4 | UI shape | **One unified Quotes screen** with status badges (Draft / Issued / Signed / Superseded). Click routes by `is_draft`: draft → editable, frozen → read-only with Revise button. No "Drafts" navigation sibling. |
| 5 | Numbering | `quote_no` snapshot = `<job_request.job_no>_EST` for the first issued quote; `_EST_REV{N}` for revisions. Stored on the quote row, frozen on issue. `revision_no int` column added alongside for sort/filter. |
| 6 | Job request status on first issue | Issuing first quote advances `job_requests.status` from `lead → quoted`, locking source fields and freezing `job_no`. Done inside the issue RPC. |
| 7 | Invoice generation behavior | **Out of scope for this rewrite.** All invoice-related buttons (Generate Invoice, Generate Deposit) are removed from the quote UI in Phase A. Invoice flow gets rebuilt in Phase C. |
| 8 | UUID PKs on `quotes`? | **No.** Keep text PKs. The bug is slug *derivation*, not text PKs. New rows get `q-{ulid}` (collision-free, time-sortable, no content-derived). Avoids rewriting every FK that points at `quotes.id`. |
| 9 | Connor invoice format / shifts / timesheet→invoice rates | All deferred to later phases. Quote rewrite touches none of these. |

Plus structural decisions:

- **Drafts: manual delete only.** No auto-cleanup.
- **One open draft per (job_request, parent_quote_id) pair.** Enforced by partial unique index. Two simultaneous drafts on the same job/revision are an error.
- **Freeze enforced via BEFORE UPDATE trigger** on `quotes` and `quote_lines`. Postgres can't do column-level RLS natively, and the trigger is structural — application code can't bypass it.
- **Quotes pull live event info from job_request.** Decided in `system-flow-rewrite.md`. Schema-wise, we keep the legacy denormalized columns for now (`client`, `event_name`, `venue`, etc.) but the issue RPC populates them from the job_request snapshot at issue time. Drop columns later in a follow-up once UI reads via join. (This avoids breaking every existing quote PDF / list / export at once.)

---

## Schema changes

All migrations run on `dev` via Supabase SQL Editor. RLS full_access policy + `set_audit_columns()` trigger on every new structure where applicable.

### Pre-flight (run first, eyeball the output)

```sql
-- 1. What status values exist? Anything outside ('draft','issued','signed') needs explicit
--    handling before we add the new CHECK.
SELECT status, count(*) FROM quotes GROUP BY status ORDER BY status;

-- 2. Any quotes with linked_job_request_id pointing at a deleted job_request?
SELECT count(*) FROM quotes q
  LEFT JOIN job_requests jr ON jr.id = q.linked_job_request_id
 WHERE q.linked_job_request_id IS NOT NULL AND jr.id IS NULL;

-- 3. Any rows that would violate the planned (job_request_id, parent_quote_id) draft
--    uniqueness once we backfill?
SELECT linked_job_request_id, count(*) FROM quotes
 WHERE status = 'draft' GROUP BY linked_job_request_id HAVING count(*) > 1;
```

Adjust the migration's normalization step based on what these return. If pre-flight #1 surfaces an unknown status, decide whether to map it to `'issued'`, `'superseded'`, or NULL+draft before adding the CHECK.

### Migration 1: Extend `quotes` table

```sql
-- Identity + revision wiring
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS job_request_id text REFERENCES job_requests(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS parent_quote_id text REFERENCES quotes(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_no text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS revision_no int NOT NULL DEFAULT 1;

-- Draft/frozen separator
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT true;

-- Lifecycle audit (per feedback_audit_column_convention.md — {event}_at + {event}_by pairs)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS issued_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS issued_by uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS superseded_by uuid;

-- Existing signed_at is text — convert to timestamptz and add the missing _by half.
ALTER TABLE quotes ALTER COLUMN signed_at TYPE timestamptz
  USING NULLIF(signed_at, '')::timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_by uuid;
-- signature_name (existing text column) stays — that's the customer's typed name, distinct from signed_by.

-- Standard row-level audit (quotes was NOT in the 20260503d first-pass batch)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS quotes_audit_trg ON quotes;
CREATE TRIGGER quotes_audit_trg
  BEFORE INSERT OR UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Normalize any out-of-enum status values surfaced by pre-flight #1. Default mapping is
-- 'issued' (history was sent), but any rows surfaced should be reviewed before the
-- migration runs; tweak this UPDATE per environment.
UPDATE quotes SET status = 'issued'
 WHERE status IS NOT NULL AND status NOT IN ('draft','issued','signed','superseded');

-- Backfill is_draft from status, then null out the legacy 'draft' status value.
UPDATE quotes SET is_draft = false WHERE status IN ('issued','signed','superseded');
UPDATE quotes SET is_draft = true,  status = NULL WHERE status = 'draft';

-- Tighten status: NULL while draft, enum-restricted otherwise.
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IS NULL OR status IN ('issued','signed','superseded'));

ALTER TABLE quotes ADD CONSTRAINT quotes_draft_status_consistency
  CHECK (
    (is_draft = true  AND status IS NULL) OR
    (is_draft = false AND status IN ('issued','signed','superseded'))
  );

-- Indices
CREATE UNIQUE INDEX IF NOT EXISTS quotes_quote_no_idx
  ON quotes(quote_no) WHERE quote_no IS NOT NULL;

-- One open draft per (job, parent) at a time. NULL job_request_id excluded so any
-- pre-rewrite orphan drafts (no FK match) don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_open_draft_per_job_idx
  ON quotes(job_request_id, COALESCE(parent_quote_id, ''))
  WHERE is_draft AND job_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quotes_job_request_id_idx ON quotes(job_request_id);
CREATE INDEX IF NOT EXISTS quotes_parent_quote_id_idx ON quotes(parent_quote_id);
CREATE INDEX IF NOT EXISTS quotes_is_draft_idx ON quotes(is_draft);

-- Backfill job_request_id from existing linked_job_request_id, but ONLY where the
-- target row exists. Orphan references (target deleted in earlier cleanup) stay NULL
-- and surface in the post-flight audit.
UPDATE quotes q
   SET job_request_id = q.linked_job_request_id
  FROM job_requests jr
 WHERE q.job_request_id IS NULL
   AND q.linked_job_request_id = jr.id;

-- Post-flight audit: which frozen quotes have no resolvable job_request? Surface for
-- human review, not automatic action.
SELECT id, client, event_name, start_date, status, linked_job_request_id
  FROM quotes
 WHERE NOT is_draft AND job_request_id IS NULL;
```

### Migration 2: Freeze trigger on `quotes` + `quote_lines`

```sql
-- Allowed-to-change columns on a frozen quote:
--   status, signed_at, signed_by, signature_name (signature workflow)
--   superseded_at, superseded_by (when a new revision supersedes this row)
--   updated_at, updated_by (audit)
-- Everything else is content and must not change post-issue.
CREATE OR REPLACE FUNCTION quotes_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT OLD.is_draft THEN
      RAISE EXCEPTION 'Cannot delete a frozen quote (id=%). Use Void/Supersede via the app.', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NOT OLD.is_draft THEN
    IF NEW.client                IS DISTINCT FROM OLD.client
      OR NEW.client_id           IS DISTINCT FROM OLD.client_id
      OR NEW.event_name          IS DISTINCT FROM OLD.event_name
      OR NEW.venue               IS DISTINCT FROM OLD.venue
      OR NEW.city_state          IS DISTINCT FROM OLD.city_state
      OR NEW.start_date          IS DISTINCT FROM OLD.start_date
      OR NEW.end_date            IS DISTINCT FROM OLD.end_date
      OR NEW.start_time          IS DISTINCT FROM OLD.start_time
      OR NEW.end_time            IS DISTINCT FROM OLD.end_time
      OR NEW.expected_hours_per_day IS DISTINCT FROM OLD.expected_hours_per_day
      OR NEW.total               IS DISTINCT FROM OLD.total
      OR NEW.deposit             IS DISTINCT FROM OLD.deposit
      OR NEW.notes               IS DISTINCT FROM OLD.notes
      OR NEW.terms               IS DISTINCT FROM OLD.terms
      OR NEW.rate_card_profile_id  IS DISTINCT FROM OLD.rate_card_profile_id
      OR NEW.linked_job_request_id IS DISTINCT FROM OLD.linked_job_request_id
      OR NEW.linked_job_sheet_id   IS DISTINCT FROM OLD.linked_job_sheet_id
      OR NEW.timesheet_summary     IS DISTINCT FROM OLD.timesheet_summary
      OR NEW.job_request_id        IS DISTINCT FROM OLD.job_request_id
      OR NEW.quote_no              IS DISTINCT FROM OLD.quote_no
      OR NEW.parent_quote_id       IS DISTINCT FROM OLD.parent_quote_id
      OR NEW.is_draft              IS DISTINCT FROM OLD.is_draft
      OR NEW.revision_no           IS DISTINCT FROM OLD.revision_no
      OR NEW.issued_at             IS DISTINCT FROM OLD.issued_at
      OR NEW.issued_by             IS DISTINCT FROM OLD.issued_by
      OR NEW.created_at            IS DISTINCT FROM OLD.created_at
      OR NEW.created_by            IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION
        'Cannot modify content of a frozen quote (id=%). Use Revise to create a new revision.',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_freeze_trg ON quotes;
CREATE TRIGGER quotes_freeze_trg
  BEFORE UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION quotes_freeze_check();

CREATE OR REPLACE FUNCTION quote_lines_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q_is_draft boolean;
BEGIN
  SELECT is_draft INTO q_is_draft FROM quotes
    WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF NOT q_is_draft THEN
    RAISE EXCEPTION 'Cannot modify lines of a frozen quote (id=%). Use Revise.',
      COALESCE(NEW.quote_id, OLD.quote_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS quote_lines_freeze_iud_trg ON quote_lines;
CREATE TRIGGER quote_lines_freeze_iud_trg
  BEFORE INSERT OR UPDATE OR DELETE ON quote_lines
  FOR EACH ROW EXECUTE FUNCTION quote_lines_freeze_check();
```

### Migration 3: `issue_quote_draft` RPC

```sql
CREATE OR REPLACE FUNCTION issue_quote_draft(p_quote_id text)
RETURNS text  -- the quote id (unchanged)
LANGUAGE plpgsql AS $$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_job          job_requests%ROWTYPE;
  v_quote_no     text;
  v_revision_no  int;
BEGIN
  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR NOT v_quote.is_draft THEN
    RAISE EXCEPTION 'Quote not found or already issued: %', p_quote_id;
  END IF;

  SELECT * INTO v_job FROM job_requests WHERE id = v_quote.job_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote % has no valid job_request_id', p_quote_id;
  END IF;
  IF v_job.job_no IS NULL OR v_job.job_no = '' THEN
    RAISE EXCEPTION 'Cannot issue quote: job_request % has no job_no yet', v_quote.job_request_id;
  END IF;

  -- Compute quote_no from job's current job_no + revision marker. Lock the parent
  -- (if any) so two simultaneous revisions of the same parent serialize.
  IF v_quote.parent_quote_id IS NOT NULL THEN
    SELECT revision_no INTO v_revision_no
      FROM quotes WHERE id = v_quote.parent_quote_id FOR UPDATE;
    v_revision_no := v_revision_no + 1;
    v_quote_no := v_job.job_no || '_EST_REV' || v_revision_no::text;

    UPDATE quotes
       SET status = 'superseded', superseded_at = now(), superseded_by = auth.uid()
     WHERE id = v_quote.parent_quote_id;
  ELSE
    v_revision_no := 1;
    v_quote_no := v_job.job_no || '_EST';
  END IF;

  -- Snapshot the fields that appear on the quote PDF / list view, then flip to frozen.
  -- Fields NOT snapshotted (start_time, end_time, expected_hours_per_day,
  -- linked_job_sheet_id, timesheet_summary) are dropped from the new flow — read live
  -- from the join when the rare consumer needs them.
  UPDATE quotes
     SET is_draft     = false,
         status       = 'issued',
         quote_no     = v_quote_no,
         revision_no  = v_revision_no,
         issued_at    = now(),
         issued_by    = auth.uid(),
         client       = v_job.client,
         client_id    = v_job.client_id,
         event_name   = v_job.event_name,
         venue        = v_job.venue,
         city_state   = v_job.city_state,
         start_date   = v_job.request_date,
         end_date     = v_job.end_date
   WHERE id = p_quote_id;

  -- Advance job_request lifecycle if still in lead.
  UPDATE job_requests
     SET status = 'quoted'
   WHERE id = v_quote.job_request_id AND status = 'lead';

  RETURN p_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION issue_quote_draft FROM public;
GRANT EXECUTE ON FUNCTION issue_quote_draft TO authenticated;
```

### Migration 4: Drop `quote_draft_workspaces` (deferred)

Wait until new quote-builder code is shipping and zero readers remain. Then:
```sql
DROP TABLE IF EXISTS quote_draft_workspaces;
```

### Migration 5: Drop legacy / redundant columns (deferred)

After the new code is shipping and no readers remain:

```sql
-- These were either redundant with job_request fields, or reference job_sheets
-- (a concept being phased out in favor of job_request_assignments).
ALTER TABLE quotes DROP COLUMN IF EXISTS start_time;             -- read live from job_request
ALTER TABLE quotes DROP COLUMN IF EXISTS end_time;               -- read live from job_request
ALTER TABLE quotes DROP COLUMN IF EXISTS expected_hours_per_day; -- recompute from lines
ALTER TABLE quotes DROP COLUMN IF EXISTS linked_job_sheet_id;    -- phasing out job_sheets
ALTER TABLE quotes DROP COLUMN IF EXISTS linked_job_request_id;  -- replaced by job_request_id FK
ALTER TABLE quotes DROP COLUMN IF EXISTS timesheet_summary;      -- recompute from join
-- 'lines' jsonb was already deferred-drop in 20260420q; verify and drop here if still present.

-- Denormalized reverse-link on job_requests, superseded by quotes.job_request_id FK.
ALTER TABLE job_requests DROP COLUMN IF EXISTS linked_quote_id;

-- Denormalized name snapshots on quote_lines, superseded by specialty_id FK
-- lookup. quote_lines.position_id likewise redundant (specialty FK implies it).
ALTER TABLE quote_lines DROP COLUMN IF EXISTS department;
ALTER TABLE quote_lines DROP COLUMN IF EXISTS specialty;
ALTER TABLE quote_lines DROP COLUMN IF EXISTS position_id;
```

Rationale:
- **`start_time` / `end_time` / `expected_hours_per_day`** — never appeared on the quote PDF; redundant with job_request which is the single source of truth.
- **`linked_job_sheet_id`** — `job_sheets` is being phased out (Phase B). Quote should reference the `job_request` directly via the new `job_request_id` FK.
- **`linked_job_request_id`** — text column without FK enforcement. The new `job_request_id` is a real FK; this is its replacement.
- **`timesheet_summary` jsonb** — display-only computed snapshot. Recompute live from joined timesheet_entries when the rare consumer needs it.

Snapshot fields kept on `quotes` (populated at issue, frozen):
- `client`, `client_id`, `event_name`, `venue`, `city_state`, `start_date`, `end_date`

These are what appears on the quote PDF and what list views display directly. They're snapshotted so historical PDFs remain bit-perfect even if the underlying job_request is later edited via some path the freeze pattern didn't catch.

---

## Code changes

### New module: `lib/store/quotes.ts`

Single source of truth for quote operations. **Replaces and fully retires** the following from `lib/store/db.ts`:

- `upsertQuote` (with its 2026-04-29 collision guard — obsolete once `q-{ulid}` ids replace slugs)
- `setQuotes` / `saveQuotes` bulk setters
- `upsertQuoteDraftWorkspace`, `setQuoteDraftWorkspaces`, `getQuoteDraftWorkspaces` (the entire workspace-JSONB layer)
- The reverse-link write to `job_requests.linked_quote_id` — denormalization superseded by `quotes.job_request_id` FK

Re-exports in `lib/store/app-store.ts` for these functions are removed in lockstep. Any caller that survived the rewrite surfaces as a TS error during typecheck — not as silent runtime fallback to legacy paths.

**Add to deferred-drop list (Migration 5):**
- `job_requests.linked_quote_id` — replaced by reverse lookup via `quotes.job_request_id` FK

Operations:
- `loadQuotes(filters?)` — returns rows with computed `displayStatus` (Draft / Issued / Signed / Superseded)
- `loadQuote(id)` — full record + lines
- `createDraftFromJob(jobRequestId)` — INSERT with `id = q-{ulid}`, `is_draft=true`, `job_request_id` set, rate card chosen by effective date, lines seeded per the rules below.
- `createDraftFromRevision(parentQuoteId)` — clones the parent quote's content into a new draft with `parent_quote_id` set. Carries forward the parent's `rate_card_profile_id` and the parent's snapshotted line rates — does NOT re-pick a rate card or re-look-up rates. Revision = tweak, not reprice.

#### Rate card selection (used by `createDraftFromJob` and by the rate-card-change handler)

```ts
async function pickRateCardForJob(clientId: string | null, jobStartDate: string) {
  // 1. Most recent client-specific card effective on or before the job start date.
  if (clientId) {
    const clientCard = await supabase
      .from('rate_card_profiles')
      .select('*')
      .eq('client_id', clientId)
      .lte('effective_date', jobStartDate)
      .order('effective_date', { ascending: false })
      .limit(1).maybeSingle();
    if (clientCard.data) return clientCard.data;
  }
  // 2. Fall back to master default, also filtered by effective date.
  const master = await supabase
    .from('rate_card_profiles')
    .select('*')
    .eq('id', 'ratecard-master-default')
    .lte('effective_date', jobStartDate)
    .order('effective_date', { ascending: false })
    .limit(1).single();
  return master.data;
}
```

#### Line seeding rules (`createDraftFromJob`)

After picking the rate card and inserting the draft row, populate `quote_lines` per these rules:

**If `job_request_crew_needs` exist for any day of the job:**
- Seed exactly the (day × position × specialty) entries that crew_needs specifies. Skip rate-card rows that aren't represented.
- For each seeded line, look up the matching row in the chosen rate card profile by `(position_id, specialty_id)` and copy `base_hourly`, `base_day`, `ot_rate`, `dt_rate`, and the OT trigger / rule string.
- `qty` comes from `crew_needs.quantity`. `quote_date` comes from the day's `event_date`. `start_time` / `end_time` from the day row.
- Lines for positions outside crew_needs can be added manually via the existing "+ Add Line" affordance — when added, rates pull from the same rate card profile.

**If no `job_request_crew_needs` exist anywhere:**
- Seed day 1 with every row from the rate card profile (matches today's behavior). `qty=0`, user fills in.
- Days 2+ start empty. User uses the **"Copy from Day N-1"** button to duplicate the previous day's lines (exact copy of qty + hours + rates), then trims.
- Single-day jobs: this is exactly today's behavior.

#### Rate card change on the quote header

The quote builder header has a rate card profile dropdown. If the user changes it on a draft:

- Confirm dialog: "Recalculate all lines using the new rate card?"
- On confirm: walk every `quote_lines` row for this draft, look up the matching `(position_id, specialty_id)` in the new profile, and overwrite `base_hourly` / `base_day` / `ot_rate` / `dt_rate` / `rule`. Recompute `total` per line. Recompute draft `total`.
- Lines whose `(position_id, specialty_id)` doesn't exist in the new profile keep their existing rates and get a visual flag (e.g., yellow background) so the user knows those rates didn't update. Or offer to delete them.
- Frozen quotes: dropdown is read-only — the rate card is locked once the quote is issued.

#### "Copy from previous day" affordance

UI button at the top of each day's section in the quote builder (visible only on multi-day jobs, day 2 onward). Click → INSERT new `quote_lines` rows for this day, deep-copying the previous day's lines:
- `qty`, `hours`, `holiday_hours`, `travel`, `position_id`, `specialty_id`, `base_hourly`, `base_day`, `ot_rate`, `dt_rate`, `rule`, `rate_mode` — copied verbatim
- `quote_date` set to this day's date
- `start_time` / `end_time` set to this day's times (from `job_request_days`)
- New `id = ql-{ulid}` per line
- `saveDraft(quote)` — UPDATE for `is_draft=true` rows. Throws if called on a frozen row (defense-in-depth; the trigger also blocks)
- `issueDraft(quoteId)` — calls `supabase.rpc('issue_quote_draft', { p_quote_id })`
- `markSigned(quoteId, signatureName)` — narrow UPDATE the freeze trigger allows
- `deleteDraft(quoteId)` — only if `is_draft=true`

### `components/shared/quote-builder.tsx` rewrite

- Drop slug derivation entirely. Generate `q-{ulid}` once at draft creation.
- Drop `quote_draft_workspaces` autosave. Autosave writes directly to `quotes` + `quote_lines` while `is_draft=true`.
- Pull event info read-only from the job_request via embedded join (Supabase `select('*, job_requests(*)')`). The form shows client/event/venue/dates as a read-only header panel; only quote-specific fields are editable.
- Rename `saveQuote()` → `saveDraft()`, route through `lib/store/quotes.ts`. Button at line 937 becomes "Save Draft."
- "Issue Quote" button calls `issueDraft()`; redirects to read-only detail.
- **Remove all invoice-generation buttons** from quote-builder.tsx and quote-detail. "Generate Invoice" / "Generate Deposit Invoice" / any related side-effect paths are deleted from the quote rewrite. They get rebuilt as part of Phase C.
- Drop the `activeSavedQuoteId` state — it was a band-aid for the slug-cache bug. URL `/quotes/[id]/edit` is the identity now.

### `components/shared/invoice-builder.tsx`

**Untouched in this phase.** The hot-fix 2026-04-29 already removed the `saveQuote()` side effect. The freeze trigger from Migration 2 is the new structural backstop — any code (including the existing invoice flow) that tries to UPDATE a frozen quote gets a clean DB error.

Anything else about invoice-builder is Phase C scope.

### Routes

```
/quotes              → unified list (drafts + frozen)
/quotes/[id]         → frozen detail (read-only)
/quotes/[id]/edit    → draft editor (editable)
```

**Separate routes for edit vs view, not one page that flips modes.** Cleaner URL semantics (bookmarkable), simpler component boundaries, list-row click handler routes deterministically by `is_draft`. Cross-route accidents (frozen quote at `/edit` URL or vice versa) redirect to the correct route.

#### `/quotes` — unified list

- Columns: Status | Quote # | Job # | Client | Event | Start Date | Total | Updated
- Status badge: Draft / Issued / Signed / Superseded (computed from `is_draft` + `status`)
- Filter bar: status (default hides Superseded), client (active only), free-text search across quote_no / client / event
- Orphan drafts (no valid `job_request_id` from legacy data) render with ⚠ badge + Delete button only
- **No "+ New Quote" button** — entry points are job-request detail page (first quote) or frozen-quote Revise (subsequent)

#### `/quotes/[id]` — frozen detail

- Header: quote_no, status badge, "Revision N of M" with chain links, issued by/on, signed by/on (if signed), source job link, parent quote link
- Body: read-only display matching PDF — client, event, venue, dates, lines, totals, terms
- Actions: Print PDF / Email / Revise / Mark Signed
- No Edit button — Revise is the only edit path
- **No Generate Invoice button in this phase** — invoice flow is rebuilt in Phase C; the quote rewrite stays scoped to quote operations only

#### `/quotes/[id]/edit` — draft editor

- Header: "Draft for `<job_no>`" + link to job, rate card dropdown, autosave indicator
- Read-only event panel (live join to job_requests): client / event / venue / date range / "Edit on Job →"
- Lines grouped by day for multi-day jobs; each day has "Copy from Day N-1" + "+ Add Line"
- Footer: Save Draft / Issue Quote / Delete Draft
- Issue redirects to `/quotes/[id]` (now frozen)

### Job request detail page additions

New Quotes section showing all quotes for this job (drafts + frozen, newest first).

- **"Create Quote" button** visible only when there's no open draft AND no active issued quote (`is_draft=false AND status != 'superseded'`).
- If hidden because of an open draft → link reads "Continue draft →"
- If hidden because of an active issued quote → link reads "Revise →" pointing at that quote's detail page

### Files touched (rough)

- `components/shared/quote-builder.tsx` — major rewrite
- `components/shared/quotes-list.tsx` — unified list, status badges, draft+frozen union
- `components/shared/invoice-builder.tsx` — drop `saveQuote` side effect
- `components/shared/job-requests.tsx` — add Quotes section + Create Quote button
- `lib/store/quotes.ts` (NEW)
- `lib/store/db.ts` — **delete** all quote-shaped functions (`upsertQuote`, `setQuotes`, `saveQuotes`, `upsertQuoteDraftWorkspace`, `setQuoteDraftWorkspaces`, `getQuoteDraftWorkspaces`). All quote operations move to `lib/store/quotes.ts`.
- `lib/store/app-store.ts` — drop the corresponding re-exports.
- `app/quotes/page.tsx` (NEW or revise)
- `app/quotes/[id]/page.tsx` (NEW or revise)

### What stays unchanged

- Rate card profile snapshot logic — `base_hourly`/`base_day`/`ot_rate`/`dt_rate` copied at draft creation, frozen on issue.
- Line math, rule strings (`OT after 12 / DT after 15` etc.) — Phase D may revisit.
- Quote PDF rendering — reads from `quotes` + `quote_lines`. Same shape.
- Calendar event sync, job request linkage — additive `job_request_id` FK, legacy `linked_job_request_id` still populated for compat.

---

## Connor recovery — already complete

The PDF restore was done in an earlier session. No recovery work is part of this phase.

Existing recovered rows in `quotes` get the same migration treatment as everything else: `is_draft` backfilled from current status, status normalized to the new enum, quote_no preserved, FK columns populated where resolvable. Pre-flight queries (Migration 1) will surface any rows that need manual attention.

---

## Migration / rollout sequence

### Order of application (dev)

Strict order — each depends on the previous:

```
pre-flight queries (Migration 1)  →  1: extend quotes
                                  →  2: freeze trigger
                                  →  3: issue_quote_draft RPC
                                  →  new code on dev branch
                                  →  smoke tests on Preview
                                  →  verify end-to-end
```

Migrations land first, code second. Old code keeps running against the extended schema because the changes are additive and backward-compatible (new columns are nullable, freeze trigger only fires on `is_draft=false` which the backfill sets correctly).

### Prod replay (deferred)

Per standing instruction, prod push waits for the full quote+invoice rewrite. The three new migrations queue in `project_pending_prod_migrations.md` alongside existing entries 1–9. When prod is ready they apply as a single batch, then `dev → main` merge.

Deferred-drop migrations (4, 5) wait even longer — applied after the rewrite has been on prod long enough to confirm zero readers of the legacy columns/tables.

### After applying each migration to dev

Add an entry to `project_pending_prod_migrations.md` with:
- Migration number + filename
- Brief description
- Any pre-flight required (status audit for #1, etc.)
- Cross-reference to this plan doc

### Rollback

Each migration is independently reversible without data loss:

| Migration | Rollback |
|---|---|
| 1: extend quotes | DROP added columns, DROP added CHECKs, DROP added indices. The `is_draft` + status backfill is reversible by restoring the old `status='draft'` text from the new boolean. |
| 2: freeze trigger | `DROP TRIGGER ... ON quotes; DROP FUNCTION quotes_freeze_check();` (same for `quote_lines`). Quotes become freely mutable again. |
| 3: issue RPC | `DROP FUNCTION issue_quote_draft;` — app falls back to inline issue logic. |

Practical rollback strategy: revert from the failure point rather than piece-by-piece restore. Migrations are small enough to re-derive cleanly.

---

## Verification checklist

- [ ] Job request detail page shows "Create Quote" button when no quote exists.
- [ ] Clicking it creates a `quotes` row with `is_draft=true`, `status=NULL`, `id=q-{ulid}`, `job_request_id` set.
- [ ] Draft autosaves write directly to `quotes` + `quote_lines`. No JSONB blob.
- [ ] Editing the source job_request's venue/dates → reflects on the draft on next reload (live read).
- [ ] Issue Quote → row flips to `is_draft=false`, `status='issued'`, `quote_no` populated as `<job_no>_EST`. Job request advances `lead → quoted`.
- [ ] Try to UPDATE a frozen row's content via dashboard → trigger errors.
- [ ] Updating only `signed_at` / `signature_name` on a frozen row → succeeds.
- [ ] Existing invoice flow (untouched in this phase) attempting to update a frozen quote → trigger errors with clean message; no silent overwrite. (Real invoice rebuild is Phase C.)
- [ ] Revise → new draft with `parent_quote_id` set. Issue → original flips to `superseded`, new row has `revision_no=2`, `quote_no` ends `_REV2`.
- [ ] Two browser tabs, same job, both try to create a new draft → second errors on the unique index.
- [ ] Multi-day job: "Copy from Day N-1" duplicates lines verbatim with the new day's date and times.
- [ ] Rate card change on draft header → confirm dialog → all lines recalculate against the new profile; lines without a matching position+specialty in the new profile keep old rates with a visual flag.
- [ ] Deleting a draft → row gone; freeze trigger does NOT block (drafts are deletable).
- [ ] Deleting a frozen quote via dashboard → trigger errors.
- [ ] Effective-date rate card lookup: job starting before v2's effective date uses v1; job starting after uses v2.
- [ ] Crew-needs seeding: job with crew_needs entered → draft has only those positions; job without → draft has full rate card on day 1, empty on day 2+.
- [ ] Existing dashboard / calendar / quote list pages render with no console errors.

---

## Out of scope (explicit)

- `job_requests → jobs` rename (Phase B).
- Invoice rewrite, sequential invoice_no, deposit-as-its-own-invoice (Phase C).
- Shifts normalization (Phase D).
- Multi-contact `client_contacts` (Phase E).
- Timesheet-driven invoice lines (Phase F).
- UUID-PK migration on `quotes` — text PKs aren't broken.
- Dropping legacy denormalized event-info columns on `quotes` — happens after UI reads via join.

---

## Critical files

- [components/shared/quote-builder.tsx](../components/shared/quote-builder.tsx)
- [components/shared/invoice-builder.tsx](../components/shared/invoice-builder.tsx)
- [components/shared/quotes-list.tsx](../components/shared/quotes-list.tsx)
- [components/shared/job-requests.tsx](../components/shared/job-requests.tsx)
- [lib/store/db.ts](../lib/store/db.ts)
- `lib/store/quotes.ts` (NEW)
- `supabase/migrations/` — three new migration files (plus the deferred drop of `quote_draft_workspaces`)

# Timesheet ↔ Invoice Linking Redesign — kill the single-pointer `invoice_line_id`

Status: **Design — agreed direction, not started** (2026-07-12)
Owner: jobrien

---

## TL;DR

A timesheet entry's "billed" state is stored as a single mutable column,
`timesheet_entries.invoice_line_id` (FK → `invoice_lines.id`, `ON DELETE SET NULL`).
That one slot has **no memory** and is asked to answer two different questions
at once — *"is this entry billed/locked?"* and *"which invoice line owns it?"*.
Every "pull actuals" rewrites it; supersede-release and draft-delete null it.

Because there is only one slot and no history:

- the pointer can sit on a **draft** invoice while the **issued** (customer-facing)
  invoice has *no* linked entries;
- deleting that draft nulls the pointer with **nothing to fall back to** → the
  entries silently become **unbilled**, even though a legitimately issued invoice
  still covers them;
- an issued invoice can't reliably answer "which timekeeping records did I bill?"

**Fix direction:** make "billed" a **derived fact** computed from live invoice
links, backed by a **link/junction table that keeps history**
(`invoice_line_entries`, many-to-many). Deleting a throwaway draft can then never
orphan a record that a live invoice still covers, both the Timekeeping and
Timesheet Review screens read one shared definition of "billed," and provenance
(which invoices an entry ever fed) is preserved. A partial-unique guard prevents
the same entry being billed on two *active* invoices at once.

This is a real project (schema migration + backfill + dual-write transition +
rework of the freeze/release triggers and the invoice pull), not a one-liner.
Two cheap interim mitigations (below) de-risk it in the meantime.

---

## How it surfaced (2026-07-12)

Investigating a support issue on job `AES_26070312_DOD_COUNTRYC`
(`jobreq-1782224873347`): two duplicate **Soni Nichols** timekeeping records for
2026-07-11 (both 14h Stagehand — import row `dup-1783739865951-24` and manual row
`manual-1783828139533`) were accidentally approved and needed one deleted / the
other corrected. The operator couldn't reject/edit/delete them: both showed
**🔒 Billed** on the Timekeeping screen.

Two things came out of it:

1. **The Timesheet Review screen doesn't show billed state.** It shows the rows
   as just "Approved" with no billed indicator, and lets the operator *try*
   reject/edit actions that silently can't succeed. Only the Timekeeping screen
   renders the 🔒 Billed lock. So an operator on Review has no idea why nothing
   works.

2. **Creating an unneeded draft revision and then deleting it silently unbills
   everything.** Revising an issued invoice moves the billing pointer onto the
   new draft's lines. If that draft turns out to be unnecessary, the obvious move
   is to delete it — which nulls `invoice_line_id` on every attached entry and
   leaves them unbilled, with no link back to the still-issued invoice.

### Confirming evidence from prod

The invoice thread for this job at the time:

| id | invoice_no | rev | status | is_draft |
|---|---|---|---|---|
| `i-mrhby66q-r1c4puca` | INV_20260711 | 1 | superseded | false |
| `i-mrhgdk5a-q5w4ntq1` | INV_20260711_REV1 | 2 | **issued** | false |
| `i-mrhvnj2g-rq45rlvw` | *(none)* | 3 | *(draft)* | **true** |

- All **38** Stagehand entries for 7/11 (incl. both Soni rows) were bound to a
  single aggregate line `il-mrhvnj51-ezmr75yv` on the **draft** rev 3.
- **Zero** entries were bound to any line on the **issued** rev 2. The drift had
  *already happened*: the live customer-facing invoice had no timekeeping links;
  a disposable draft held them all. Deleting the draft would have unbilled all 38
  and left rev 2 still linked to nothing.

---

## Root cause / mechanism (code refs)

Schema — `supabase/migrations/20260510a_timesheet_entries_invoice_line_fk.sql`:

```
invoice_line_id text REFERENCES invoice_lines(id) ON DELETE SET NULL
```

Cascade chain (confirmed live in prod):
- `invoice_lines.invoice_id → invoices(id)` = **ON DELETE CASCADE**
- `timesheet_entries.invoice_line_id → invoice_lines(id)` = **ON DELETE SET NULL**

So deleting a draft invoice (`deleteDraft`, [invoices.ts:1330](../lib/store/invoices.ts))
cascades to its lines, which SET NULLs every attached entry in one transaction.

Where the pointer moves / clears:
- **Pull actuals** (`overwriteFromTimesheets`, [invoices.ts:647](../lib/store/invoices.ts))
  writes `invoice_line_id` on the entries it consumes (~lines 1106–1129), and its
  dedupe (line 779) excludes entries already billed to an *active* invoice unless
  they're bound to *this* draft's replaceable lines. So the binding tracks
  whatever draft/invoice most recently pulled them.
- **Supersede/void release** (`20260527b_release_entries_on_invoice_supersede.sql`)
  nulls `invoice_line_id` when a parent invoice goes superseded/void.
- **Draft delete** nulls it via the cascade above.

Freeze rules that make it a hard lock — `20260525d_timesheet_entries_freeze.sql`:
- Approved rows: content is frozen; DELETE blocked.
- Approved **and** `invoice_line_id IS NOT NULL`: *status* is also frozen
  ("super-freeze") — can't reject/unlock until unlinked. This is the 🔒 Billed
  state.

The column conflates **guard** (locked?) and **link** (owned by which line?), is
last-writer-wins, and keeps no history — so a delete can't restore prior state.

---

## Recommended design

### 1. Link table (many-to-many, with history)

```
invoice_line_entries (
  invoice_line_id     text  references invoice_lines(id) on delete cascade,
  timesheet_entry_id  text  references timesheet_entries(id) on delete cascade,
  created_at          timestamptz default now(),
  primary key (invoice_line_id, timesheet_entry_id)
)
```

- Creating a draft revision **adds** links to the draft's lines; it does **not**
  remove the issued invoice's links.
- Deleting a draft cascades away *its* links only; the issued invoice's links
  remain → the entry is still billed. **Problem 2 solved by construction.**
- Full provenance retained: every invoice an entry ever fed. Makes "restore the
  previous binding" and audit trivial.

### 2. "Billed / locked" becomes derived, not stored

An entry is **billed** iff it has a link to a line on an **active** invoice —
`is_draft = false` AND status not in (`superseded`, `void`). Draft-only links are
a separate, softer state ("in a pending draft").

Compute on read via a join, or maintain a denormalized boolean via trigger on
`invoice_line_entries` + invoice status changes. Prefer derive-on-read (a view or
computed helper) unless profiling says otherwise — it cannot drift. **Both**
screens consume this one definition → **Problem 1's root** goes away.

Decision to make during build: should a **draft-only** link hard-lock the source
entry (today it does)? Leaning: a draft should *soft*-flag ("in draft invoice —
finalize or discard to edit") but not super-freeze, since discarding the draft is
a normal, reversible action. The hard lock belongs to *active issued* links.

### 3. Guardrail against double-billing

Partial unique index so an entry has at most **one** link to an *active issued*
invoice at a time:

```
-- pseudo; needs the active-invoice predicate resolved (likely via a trigger or a
-- generated column, since partial-unique can't span a join directly)
unique (timesheet_entry_id) where <linked line's invoice is active issued>
```

Draft links and superseded/void history don't count against it. This is the
safety valve for the "multiple links" worry: history + one pending draft are
fine; two *live* bills are not.

### 4. What this replaces / reworks

- **`release_entries_on_invoice_lifecycle` trigger** — largely obsolete: links to
  superseded/void invoices simply stop counting as "active." Keep the table rows
  for provenance instead of deleting the link.
- **`timesheet_entries_freeze_check` super-freeze** — change the
  `invoice_line_id IS NOT NULL` condition to "has an active-issued link."
- **`overwriteFromTimesheets` dedupe** (`getAlreadyBilledTimesheetEntryIds`,
  invoices.ts ~250) — "already billed" becomes "has an active-issued link on
  another invoice"; the "own draft's entries" re-include path reads the link
  table.
- **Timekeeping + Timesheet Review screens** — both read the derived billed flag.

---

## Interim mitigations (no schema change — ship first)

1. **Show billed state on the Timesheet Review screen.** Surface the same
   🔒 Billed indicator and disable reject/edit there with a tooltip ("billed on
   an invoice — unlink first"). Self-contained UI fix; directly kills Problem 1's
   day-to-day confusion. (Files: `components/shared/timekeeping.tsx` has the
   existing lock rendering to mirror; the Review screen component is the target.)
2. **Make the silent failure loud on draft delete.** When deleting a draft
   revision, if any attached entry is **not** covered by an active issued invoice,
   warn: *"Deleting this draft will leave N timekeeping records unbilled."* One
   guard in `onDelete` ([invoice-draft-editor.tsx:696](../components/shared/invoice-draft-editor.tsx))
   turns a silent trap into a visible decision.

Optionally: on draft-discard, offer to **re-link** attached entries back to the
parent issued invoice's matching lines. This is the "restore previous binding"
behavior; it's fuzzy with the single-pointer model (match by the 5-tuple), but
trivial once the link table exists.

---

## Migration / rollout sketch

1. Add `invoice_line_entries`; backfill one row per current non-null
   `invoice_line_id`.
2. Dual-write: keep `invoice_line_id` in sync while new code writes the link
   table (safety net + easy rollback).
3. Move reads to the derived billed flag; migrate the two triggers and the pull
   dedupe.
4. Flip both screens to the derived flag.
5. Once stable, drop `invoice_line_id` (or leave it as a denormalized
   "primary active link" cache, trigger-maintained).

Apply to **dev** first, verify on the Vercel dev preview, then promote to prod on
merge (see the dev workflow notes). This touches invoicing *and* timekeeping *and*
payroll-adjacent reads — sequence it deliberately and audit prod link state before
and after the backfill.

---

## Related

- `docs/invoice-rewrite-plan.md` — the Phase-C invoice/freeze-trigger model this
  builds on.
- `docs/timekeeping-planned-vs-actual-design.md` — adjacent timekeeping redesign.
- `docs/technical-debt-backlog.md` — index pointer to this doc.

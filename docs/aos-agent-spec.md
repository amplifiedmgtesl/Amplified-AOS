# AOS Assistant — In-App Claude Agent (Chat) — Spec

Status: **Draft v1** (2026-06-28) — design agreed, not started.
Owner: jobrien

## Goal

Add a **chat box inside AOS** backed by a Claude agent that can:

1. **Answer questions about live data** — e.g. *"How many timesheets need approval?"*,
   *"Do we have all the needed crew assigned for Job 1042?"*, *"Which jobs next week are
   short on riggers?"*
2. **Take actions** — e.g. *"Create a new job for Acme, Jul 8–10, with 4 riggers and
   6 stagehands"* — by creating the necessary records, **with a confirmation step before
   any write**.

The agent reaches data and actions through a **fixed set of typed tools** (function/tool
calling), not ad-hoc SQL. This keeps answers correct (tools reuse existing business logic),
keeps the system secure and auditable, and keeps writes inside the validation we already
built (freeze triggers, delete-protection FKs, audit columns).

## Why fixed tools, not ad-hoc SQL

Decision record — this was deliberated and settled:

- **The schema doesn't contain our business semantics.** "Needs approval" is not a column;
  it's a rule (staff-finalized, not yet admin-approved, not yet invoiced). "All crew assigned"
  is the `crew_needs` vs `job_request_assignments` comparison already encoded in
  `lib/job-health/`. Ad-hoc SQL re-derives this logic and gets it plausibly-but-subtly wrong.
  Fixed tools reuse the tested logic.
- **Security.** Ad-hoc SQL needs broad DB access; via the service-role client
  (`lib/supabase/admin.ts`) that bypasses RLS, so any sentence — including a malicious string
  read back from a record — becomes a live data path. Fixed tools bound the blast radius to a
  known set of operations.
- **Auditability & testability.** ~15 fixed tools = a knowable, loggable, testable universe of
  operations. Ad-hoc SQL is a novel, unverifiable query every time.

**Reads** are correct *and* safe through fixed tools. **Writes** stay on fixed, validated tools
with no exceptions. A read-only `SELECT` escape hatch for the rare long-tail question is a
possible **future** addition (see Future), not part of v1.

## Agreed behaviors

These are the behaviors the agent MUST exhibit (settled in design):

1. **Graceful "I can't" fallback.** If no tool matches the question, the agent says so plainly
   and names what it *can* help with. It does **not** crash and does **not** invent an answer.
2. **Never estimate or guess.** Hard system-prompt rule: only answer questions about company
   data using values returned by tools. If no tool provides the answer, say so. No estimates,
   no made-up numbers.
3. **Compose tools.** The agent may chain/sequence the tools it has to answer questions we
   didn't explicitly build (e.g. `list_jobs(filters)` + `get_job_crew_status(jobId)` →
   "which jobs next week are short on riggers?"). Tools are building blocks, not canned answers.
4. **Log unanswerable questions.** Every time the agent can't answer (no matching tool), log the
   question to a review table. This backlog is the roadmap for which tools to build next.

## Architecture

```
Chat box  (React client component, e.g. components/assistant/)
      │  POST /api/agent   — user's Supabase JWT in Authorization header
      ▼
/api/agent  (Next.js route handler, server-side)
      │   • Holds ANTHROPIC_API_KEY (never sent to client)
      │   • Reuses the existing auth guard pattern from app/api/users/route.ts
      │     (Bearer token → supabaseAdmin.auth.getUser → profiles.role check)
      │   • Runs the Anthropic tool-use loop
      ▼
Tools (server functions — wrap Supabase queries / existing RPCs / lib logic)
   READ:  query_timesheets({ status, dateRange, employee })
          get_job_crew_status(jobId)          ← wraps lib/job-health crew check
          list_jobs({ client, dateRange, status })
          find_client(name)
          ... (broad, parameterized — not one-per-question)
   WRITE: create_job({ clientId, startDate, endDate, crewNeeds:[{position, specialty, count}] })
          ... (each validates, stamps created_by, goes through existing insert/RPC paths)
```

### Request/response loop

1. Client POSTs the conversation (message history) to `/api/agent`.
2. Route guards auth + role, then calls the Anthropic Messages API with the tool definitions
   and system prompt.
3. If the model returns a `tool_use` block, the route executes the corresponding server
   function, appends the `tool_result`, and loops.
4. When the model returns final text, the route streams/returns it to the chat box.
5. If a turn ended with no matching tool for a data question, log to `agent_unanswered_log`.

### Auth & permissions

- The chat runs **as the logged-in user**. The route resolves their identity and role exactly
  like `requireAdmin` in `app/api/users/route.ts` (Bearer token → `supabaseAdmin.auth.getUser`
  → `profiles.role`).
- Tools enforce role: write tools (e.g. `create_job`) require the same permission a human would
  need for that action. Reads are scoped to what the user is allowed to see.
- Writes stamp `created_by` (audit columns already exist across the schema) so agent-created
  records are traceable.

### Model choice

- Default to **Sonnet 4.6** (`claude-sonnet-4-6`) — fast, cost-effective, strong at tool use,
  which is the bulk of this workload (routine data queries + record creation).
- Keep the model configurable; escalate specific paths to **Opus 4.8** (`claude-opus-4-8`) only
  if reasoning over messy data proves to need it.
- `@anthropic-ai/sdk` is **not yet a dependency** — add it.

## Write actions: propose-then-confirm

No silent mutations. For any write (e.g. create job):

1. The agent restates what it will do in plain English with the concrete values:
   *"I'll create a job for Acme Corp, Jul 8–10, with 4 riggers and 6 stagehands. Confirm?"*
2. The user confirms (button or explicit yes).
3. Only then does the write tool execute — through the existing insert/RPC path, respecting
   freeze triggers, delete-protection FKs, and audit columns; stamping `created_by`.

This gives a human checkpoint and keeps agent writes inside the same guardrails as the UI.

## How the named examples map

| Question / request | Tool(s) | Notes |
|---|---|---|
| "How many timesheets need approval?" | `query_timesheets({status:'pending_approval'})` | Encodes the real rule (staff-finalized, not admin-approved, not invoiced) — uses `timesheet_entries.staff_finalized` etc. |
| "Do we have all needed crew assigned?" | `get_job_crew_status(jobId)` | Wraps the existing `lib/job-health/` crew check (`crew_needs` − `job_request_assignments`). |
| "Which jobs next week are short on riggers?" | `list_jobs({dateRange})` → `get_job_crew_status` per job | Composition (behavior #3) — not a tool we build explicitly. |
| "Create a job for these dates + client + X riggers + Y stagehands" | `create_job(...)` | Write — propose-then-confirm. Riggers/stagehands map to `positions`/`specialties`. |

## Data model touch points (existing)

- `job_requests` (+ `job_no`), `job_request_days`, `job_request_shifts`
- `crew_needs`, `job_request_assignments`
- `timesheets`, `timesheet_entries` (`staff_finalized`, approval/invoice linkage)
- `positions`, `specialties` (riggers / stagehands)
- `clients`, `profiles` (role)
- Existing logic to reuse: `lib/job-health/` (completeness + crew checks),
  `lib/store/*`, job-number generation `lib/jobs/job-no.ts`

## New persistence

### `agent_unanswered_log` (new table)

Captures questions the agent couldn't answer, for backlog review.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `asked_by` | uuid | FK → profiles/auth user |
| `question` | text | The user's message (or the turn that found no tool) |
| `context` | jsonb (nullable) | Optional: recent turns / detected intent |
| `created_at` | timestamptz | default now() |
| `reviewed` | boolean | default false — flips when triaged into a tool to build |

Optional later: a general `agent_message_log` for all turns (audit/QA), gated on need.

## Tool inventory (v1 starting set — broad & parameterized)

Read:
- `query_timesheets({ status?, dateRange?, employeeKey? })`
- `get_job_crew_status(jobId)`
- `list_jobs({ clientId?, dateRange?, status? })`
- `find_client(nameOrCode)`
- `list_employees({ position?, specialty?, active? })`

Write (propose-then-confirm):
- `create_job({ clientId, startDate, endDate, venue?, crewNeeds:[{positionId, specialtyId?, count, hours?}] })`

Design tools **broad, not narrow** — one parameterized `query_timesheets` covers many phrasings.
The tool count is not the question count; composition + parameters cover far more.

## System prompt (key rules — to refine at build time)

- You are the AOS Assistant. You help staff with company operations data and actions.
- Only answer questions about company data using values returned by tools. **Never estimate,
  guess, or fabricate numbers or records.** If no tool provides the answer, say so plainly and
  list what you can help with.
- You may call multiple tools and chain them to answer a question.
- For any action that creates or changes data, restate exactly what you will do with concrete
  values and wait for explicit confirmation before calling the write tool.
- Respect the user's role; do not attempt actions they aren't permitted to perform.

## Build phases (estimate)

1. **Read-only Q&A (~1 day):** `/api/agent` route + auth guard, Anthropic SDK + tool-use loop,
   ~5 read tools, chat component, system prompt with the "never guess / graceful fallback" rules,
   `agent_unanswered_log` table + logging.
2. **Write with confirmation (~1–2 days):** `create_job` tool, propose-then-confirm UI, permission
   checks, audit stamping; test against freeze triggers / delete-protection.
3. **Iterate from the log:** review `agent_unanswered_log`, build the 3–4 most-asked missing tools.

## Future (explicitly out of v1)

- **Read-only `SELECT` escape hatch** for the long tail: a sandboxed, read-only Postgres role +
  schema in context, for one-off questions no fixed tool covers. Writes stay on fixed tools.
- General `agent_message_log` for full-conversation audit/QA.
- Streaming responses in the chat UI.
- More write actions (assign crew, edit job, etc.) once create-job is proven.

## Open questions

- Where does the chat box live — global (header/launcher) or per-page (e.g. dashboard)?
- Which roles get the assistant at all? Which roles get write actions?
- Confirmation UX: dedicated confirm button vs. typed "yes"?
- Cost ceiling / rate limiting per user.

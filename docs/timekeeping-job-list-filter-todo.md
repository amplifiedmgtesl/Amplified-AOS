# TODO: Trim the Timekeeping job dropdown

**Status:** Not started — design later
**Created:** 2026-07-12

## Problem

The Timekeeping screen's job dropdown lists every job that isn't cancelled, so it
grows without bound. Nothing ages off: leads, quoted, confirmed, and long-finished
`completed` jobs all remain in the list forever, making it hard to find the job
you actually want.

## Current behavior (as-is)

The only filter is an exact-string status check in
[`components/shared/timekeeping.tsx:1122`](../components/shared/timekeeping.tsx):

```js
.filter((j) => j.status !== "cancelled")
```

- Jobs are sorted by `requestDate` (event start date) descending.
- The upstream data load (`loadJobRequests` → `db.getJobRequests`) pulls **all**
  `job_requests` rows with no WHERE clause — no filtering happens server-side.
- `status` is a free-form string, so only the literal `"cancelled"` is hidden;
  variants like `"Cancelled"` / `"canceled"` would still show.

## Things to decide during design

- What should drop a job off the list? Candidate rules (not mutually exclusive):
  - Hide `completed` jobs (or only completed jobs older than N days).
  - Only show jobs whose event date is within the last N days / next N days.
  - Only show jobs that actually have (or could have) timesheet activity.
- Should there be a "show all / include completed" toggle so old jobs are still
  reachable when needed (e.g. late timesheet corrections)?
- Normalize the `status` comparison (case-insensitive, trimmed) and/or clean up
  legacy status spellings so the filter is reliable.
- Consider filtering server-side (in the query) vs. client-side for performance.

## Files involved

- `components/shared/timekeeping.tsx` — dropdown filter (line ~1122) and default
  job selection (lines ~217-223).
- `lib/store/app-store.ts` — `loadJobRequests()`.
- `lib/store/db.ts` — `getJobRequests()` / the `job_requests` select (~line 143).

## Notes

- Per usual workflow: start on its own branch off `dev`, plan + get sign-off
  before editing.

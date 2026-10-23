# Onboarding: new applicants section (backlog #122): plan

**Status:** plan only, 2026-10-23. Branch `feature/onboarding-applicants` (off main, v2.13.0). Nothing built yet.

## Why

Connor expected website applicants to show up on Onboarding. They don't. Onboarding only lists people with **no Payroll ID who are on a confirmed crew or timesheet from 30 days back to 30 days ahead** (#120). Someone who just applied isn't on a job yet, so they never appear.

The webhook works. Prod log from 10/20 to 10/22: 18 applications, 8 created as new and 10 matched existing records, with no errors. On 10/22 alone there were 9 (5 new, 4 matched).

Prod today: **79** people applied in the last 30 days and still have no Payroll ID. **56** of them were already sent to Paychex (53 of those on 10/21) and are waiting. **23** were never sent. Some of the 79 are on a job and already show in the current list.

## What we're building

1. **A second section on Onboarding: "Applicants"**, below the current list. It shows:
   - people whose website application (`employees.applied_at`) is **within the last 30 days**;
   - with **no Payroll ID**;
   - not deleted;
   - **and not already in the top section**, so nobody is listed twice.

   Heading: "N applicants · no job yet".
2. **Newest application first.** Under the name: "Applied Oct 22 · Stagehand", the position they typed.
3. **Same row as the top section:** email/phone editing with "Applied with:", Employee/Contractor toggle, AOS duplicates with Merge / Not same, Paychex matches with Use ID, Sent · waiting, and Send to Paychex.
4. **The Paychex check covers both sections.** It's the same snapshot lookup when the page opens, so clear Paychex matches link automatically and the person drops off the list, as they do now.
5. **Select-all is per section**, so selecting everyone in the top list can't pick applicants by accident. "Send selected" sends whatever is ticked in either section.
6. **When an applicant is booked** on a confirmed crew, they move to the top section on the next load. Once they get a Payroll ID they drop off. After 30 days without either, they drop off the screen. They are **never hidden or deleted from the Employee list** (worker-pool rule).
7. **No new database fields.** `applied_at`, `application_contact` and the position on the log are all there already. No migration.

## How (code)

- `lib/onboarding/plan.ts`: new pure `buildApplicantRows(today, all, topKeys, notSame)` that applies the filters above, sorts newest first and finds duplicates the same way. **Unit tests** go in `tests/store/onboarding-plan.test.ts`, covering the 30-day edge, excluding top-section people, excluding Payroll IDs and the sort.
- `lib/onboarding/server.ts`: add `applied_at` to the employee columns, and add the position from the latest `jotform_application_log` row for those people. `loadOnboardingRows` returns `{ rows, applicants }`.
- `components/shared/onboarding.tsx`: render the second table with the same row component (the row markup moves into a small function both sections share).
- `/api/onboarding`: returns both lists. The Paychex check gets both sets of keys.
- Help: Onboarding section on dev (HELP.md) gets one paragraph about the Applicants section. CHANGELOG entry and version bump to **v2.14.0** on promotion.

## Not included

- The 10/20 applicant who matched **two** AOS records by name (AES-02004 and emp-1792371199415). The webhook updated neither record, so they won't appear here. Those two look like a duplicate to merge; the merge is Connor's call.
- No "not hiring / dismiss" button. They leave the screen after 30 days on their own. Add a button only if Connor asks.

## Open questions for John

1. **Send to Paychex for applicants who aren't booked yet:** allow it, same as the top section? Plan assumes **yes**. Connor already sent about 53 on 10/21, so he onboards ahead of booking.
2. **30 days** for applicants. Is that the right window? A person who re-applies starts the clock again.

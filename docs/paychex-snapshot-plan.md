# Paychex snapshot: plan

**Status:** agreed with John 2026-10-20, not built yet. Branch `feature/profile-paychex` (off main), which already has the profile Paychex section on a preview.

## Why

Every time someone opens Onboarding, or clicks Sync from Paychex or Send to Paychex, AOS reads Paychex live. That's the worker list (about 10 calls, 50 per page) plus contact details for each active worker (about 143 calls), so about 155 calls each time. Paychex has no search and no "changed since" date (both checked 10/20), so a live check can only re-read everyone. Paychex doesn't publish its rate limits.

What AOS needs from Paychex changes rarely: Payroll IDs, new hires and status. Email, phone and address are minor (John, 10/20).

## What we're building

1. **A Paychex snapshot in AOS:** the worker list (IDs, names, status, hire date) and contact details for active workers. No SSN, date of birth or sex, which are dropped as today.
2. **Refreshed automatically Monday ~11 pm Eastern** (weekend jobs, Monday onboarding, payroll due Wednesday 5 pm). Plus a **Refresh now** button, and **"Paychex as of <date and time>"** shown wherever the snapshot is used.
3. **Each refresh applies on its own** (Paychex is the source of truth):
   - email, phone, address and status (Terminated, or Active for active and inactive);
   - new Paychex hires, added to AOS;
   - clear Payroll ID links (same rule as Onboarding today);
   - the **Paychex worker ID** on every linked record. Prod has 0 today; the first refresh fills all 430.
4. **Held for a person to decide**, under Sync from Paychex on the Payroll page: anything unclear. That means a Paychex worker matching two AOS records, a similar name that may be the same person, or anything that would change or clear an existing Payroll ID.
5. **Onboarding and the employee profile read the snapshot,** so opening them makes no Paychex calls. People who were sent and are waiting for a Payroll ID are looked up by worker ID, one call each.
6. **Send to Paychex** adds the new worker to the snapshot. It does a live check before sending only if the snapshot is **more than 1 hour old** (John, 10/20); that check also refreshes the snapshot.
7. **"Sent to Paychex <date> · waiting for them"** wherever someone has no Payroll ID. It's worked out from **worker ID present, Payroll ID missing**, with the date from `paychex_invited_at`. No new status field. It shows:
   - on **Onboarding** (already shows "Sent <date>");
   - on the **employee profile's** Paychex section;
   - on the **Payroll** page, wherever someone with hours is flagged for having no Payroll ID.

   It disappears once the refresh links their Payroll ID.
8. **Profile Paychex section** (on the preview now): switched from its own light live check to the snapshot.

## Learned 10/20

- First real send (Brody Fournier): Paychex returned 201 with the worker In progress, email on file, and **no Payroll ID at send time**. The Payroll ID comes after they finish setup.
- Worker ID (Paychex's internal key, e.g. `004WOH…`) is not the Payroll ID (`#109`, Paychex's employee ID). AOS stores both.
- Paychex today: 472 workers, 143 active, 319 inactive, 10 terminated. 7 active workers have no AOS record. Every AOS Payroll ID exists in Paychex.

## Build order

1. Migration: snapshot table(s) and a last-refreshed time (dev first).
2. Refresh job: read Paychex, save the snapshot, apply the automatic changes, log everything (same log as Sync from Paychex).
3. Weekly schedule (Vercel cron, Monday 11 pm Eastern) and the Refresh now button.
4. Onboarding, the profile and Send to Paychex switched to the snapshot, with the 1-hour rule.
5. "Sent · waiting" on the profile and the Payroll page.
6. Help, changelog, version. Preview test, then release with John's OK.

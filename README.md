# Amplified Entertainment — Platform Infrastructure Guide

## System Overview

Three separate Next.js 15 applications share a single **Supabase (PostgreSQL)** backend. Each app has its own GitHub repository, its own login URL, and its own set of allowed roles. All apps read and write to the same Supabase project — no data is duplicated.

```
Amplified Operations Suite (AOS)
  ├── /dashboard, /job-sheets, /timekeeping, etc.   → admin role
  └── /lead/job-sheets, /lead/timekeeping           → crew_leader role
                        ↕
                   Supabase Backend
          https://wmssllfmahotppoyxxrr.supabase.co
                        ↕
             Amplified Staff Portal
         /dashboard, /timesheets, /schedule, /profile → staff role
```

---

## Applications & URLs

### Amplified Operations Suite (AOS)
| | |
|---|---|
| **Production** | https://amplified-aos.vercel.app |
| **Login** | https://amplified-aos.vercel.app/login |
| **GitHub** | https://github.com/amplifiedmgtesl/Amplified-AOS |
| **Allowed roles** | `admin`, `crew_leader` |
| **Tech** | Next.js 15, Supabase, TypeScript |

Full operations management — calendar, quotes, invoices, job sheets, timekeeping, job costing, employee directory, job requests, call sheets, and user management.

### Crew Leader Portal *(within AOS — no separate deployment)*
| | |
|---|---|
| **Login** | https://amplified-aos.vercel.app/login (same as AOS) |
| **Entry point after login** | /lead/job-sheets |
| **Available pages** | /lead/job-sheets, /lead/timekeeping |

A restricted section of AOS for crew leaders. Job sheets and timekeeping only — pay rates, pricing columns, Total Pay, and the Invoice/Quote Detail section are never visible.

### Amplified Staff Portal
| | |
|---|---|
| **Production** | https://amplified-staff.vercel.app |
| **Login** | https://amplified-staff.vercel.app/login |
| **GitHub** | https://github.com/amplifiedmgtesl/amplified-staff |
| **Allowed roles** | `staff` only |
| **Tech** | Next.js 15, Supabase, TypeScript |

Staff-facing portal for submitting timesheets, viewing assigned job schedules, and viewing their profile.

---

## User Roles

All roles are stored in the `profiles` table in Supabase.

| Role | App | Post-Login Redirect | Description |
|------|-----|-------------------|-------------|
| `admin` | AOS | `/dashboard` | Full access to all AOS pages |
| `crew_leader` | AOS | `/lead/job-sheets` | Job Sheets + Timekeeping only (no pay data) |
| `staff` | Staff Portal | `/dashboard` | Timesheets, schedule, profile |

### admin
Full access to all pages in AOS: Dashboard, Master Calendar, Quote Builder, Invoices, Rate Card, Job Sheets, Timekeeping (with pay columns), Job Costing, Employee Directory, Job Requests, Call Sheets, and User Management. Only admins can create, edit, and delete users.

### crew_leader
Limited access within AOS — only `/lead/job-sheets` and `/lead/timekeeping`. The timekeeping view never shows pay rates, rate columns, Total Pay, or the Hide/Show Pay toggle. Attempting to access any admin URL while logged in as a crew leader signs them out and redirects to `/login`.

### staff
Staff Portal only. Cannot log into AOS (blocked at login with *"Access denied. Staff members must use the Staff Portal."*). Can submit timesheets, view their assigned job schedule, and view their profile (read-only contact info pulled from their linked employee record).

---

## Access Matrix

| Feature / Page | Admin | Crew Leader | Staff |
|---|:---:|:---:|:---:|
| Dashboard | ✓ | | |
| Master Calendar | ✓ | | |
| Quote Builder | ✓ | | |
| Invoices | ✓ | | |
| Rate Card | ✓ | | |
| Job Sheets | ✓ | ✓ | |
| Timekeeping — full (with pay) | ✓ | | |
| Timekeeping — hours only (no pay) | | ✓ | |
| Job Costing | ✓ | | |
| Employee Directory | ✓ | | |
| Job Requests | ✓ | | |
| Call Sheets | ✓ | | |
| Maintenance (Users + Positions) | ✓ | | |
| Approve / Reject Staff Timesheets | ✓ | | |
| Submit Timesheet (Staff Portal) | | | ✓ |
| Edit Submitted Timesheet (Staff Portal) | | | ✓ |
| View My Schedule (Staff Portal) | | | ✓ |
| My Profile (Staff Portal) | | | ✓ |
| View Pay Rates / Pricing | ✓ | | |

---

## How to Add Users

All user management is done in **AOS → Maintenance → Users tab** (left sidebar, ⚙️ Maintenance). You must be logged in as an `admin`.

### Adding an Admin
1. Navigate to **⚙️ Maintenance → Users tab** → click **+ Add User**
2. Enter Full Name, Email, and Password (min 6 characters)
3. Set **Role** → `Admin`
4. Optionally link to an Employee Record
5. Click **Create User**
6. The new admin logs in at https://amplified-aos.vercel.app/login

### Adding a Crew Leader
1. Navigate to **⚙️ Maintenance → Users tab** → click **+ Add User**
2. Enter Full Name, Email, and Password
3. Set **Role** → `Crew Leader`
4. Optionally link to an Employee Record
5. Click **Create User**
6. The crew leader logs in at https://amplified-aos.vercel.app/login
7. After login they are automatically redirected to `/lead/job-sheets` — they will only ever see Job Sheets and Timekeeping with no pay data

### Adding a Staff Member
1. Navigate to **⚙️ Maintenance → Users tab** → click **+ Add User**
2. Enter Full Name, Email, and Password
3. Set **Role** → `Staff`
4. **Link to an Employee Record** — this is important. The staff portal reads the employee record to display the staff member's contact info (phone, address, city, state) on their profile page
5. Click **Create User**
6. The staff member logs in at **https://amplified-staff.vercel.app/login** (not AOS)
7. After login they are redirected to `/dashboard` on the staff portal

> ⚠️ Staff users who attempt to log in at the AOS URL will be blocked: *"Access denied. Staff members must use the Staff Portal."*

---

## Managing Positions

Positions are the controlled vocabulary used in Timekeeping, Job Sheets, Job Costing, the Rate Card, and the Staff Portal. They are stored in the `positions` table and managed through the UI — no code changes required.

**To add, rename, reorder, or deactivate a position:**
1. Navigate to **⚙️ Maintenance → Positions tab**
2. Use the **▲ / ▼** buttons to reorder the list (controls the order positions appear in all dropdowns)
3. Click **Edit** on any row to rename it — press Enter or Save to confirm
4. Click **Delete** on any row to soft-delete it (sets `is_active = false`; existing records are not affected)
5. Use the **Add Position** form at the bottom to create a new entry

Changes take effect immediately for new entries across all dropdowns in the system.

> ℹ️ Deleting a position does not remove it from any existing timesheet entries, job sheets, or rate card rows — it only removes it from future dropdown selections.

---

## Timesheet Approval Workflow

Every `timesheet_entry` row that is linked to an employee must be approved by an admin before it is considered final.

### How it works

| Status | Meaning |
|--------|---------|
| `null` | Entry has no linked employee — typically an AOS-entered row for an unlinked worker. No approval needed. |
| `submitted` | Linked to an employee (either staff-submitted or AOS-entered for a known employee). Editable by the employee; pending admin review. |
| `approved` | Admin approved. Locked — neither the employee nor AOS can modify it. |
| `rejected` | Admin rejected. Locked. |

### Staff Portal — submitting & editing
- Staff members submit timesheets at **Staff Portal → Timesheets → Submit New**
- The entry is created with `status = "submitted"` and is immediately visible to the linked admin in AOS Timekeeping
- The staff member can **edit** any `submitted` entry until an admin approves or rejects it
- AOS-entered entries for a linked employee also appear in the staff portal (the employee can see and edit them until approved)

### AOS — approving submissions
- Open a job sheet and navigate to the **Timekeeping** tab
- Staff-submitted entries appear in a **"Staff Submissions Pending Review"** panel at the bottom of the page
- Click **Approve** to accept — the entry moves into the main timesheet and is locked
- Click **Reject** to decline — the entry is locked with `status = "rejected"` and remains visible to the staff member

### Employee autocomplete in Timekeeping
When adding a worker row directly in AOS Timekeeping, start typing a name or email in the **Employee** column search box. Selecting a match auto-fills the name, contact info, and employee key. Once linked, the entry becomes visible to that employee in the Staff Portal with `status = "submitted"`.

---

## Backfilling Employee Links on Existing Entries

For entries created before the employee-linking feature was added, run the backfill SQL script in the Supabase SQL Editor.

**File:** `supabase/migrations/20260417b_backfill_employee_keys.sql`

**Steps:**
1. Open the Supabase project → **SQL Editor**
2. Paste and run the **preview SELECT** (commented at the top of the file) to verify what will be matched
3. If the matches look correct, paste and run the two **UPDATE** statements in the same file
4. Refresh the AOS Timekeeping page — linked entries will now have a `submitted` status

**Match priority:**
1. **Email** — exact match (case-insensitive) between `timesheet_entries.email` and `employees.email`
2. **Full name** — `first_name + ' ' + last_name` matches `employees.full_name` (only runs on rows not matched by email)

Any entries that cannot be matched automatically must be updated manually via a direct SQL UPDATE using the employee's `employee_key`.

---

## Data Model

All tables live in the shared Supabase project at `https://wmssllfmahotppoyxxrr.supabase.co`. Every table has Row Level Security (RLS) enabled with an open policy allowing access by both `anon` and `authenticated` roles (single-tenant app — auth is enforced at the application layer).

### Table Summary

| Table | Purpose |
|-------|---------|
| `profiles` | One row per Supabase auth user — role, name, email, and optional employee link |
| `employees` | Master people table for internal staff and labor pool contractors |
| `positions` | Controlled vocabulary for worker positions used across all dropdowns |
| `calendar_events` | Master calendar — events, shows, and gigs |
| `job_requests` | Incoming client job requests / leads |
| `job_sheets` | Per-event crew call sheets |
| `job_sheet_workers` | Individual worker assignments for a job sheet (normalized rows) |
| `timesheets` | Timesheet header — linked to a job sheet |
| `timesheet_entries` | Individual time entries per worker per timesheet (normalized rows) |
| `quotes` | Saved client quotes built in Quote Builder |
| `quote_draft_workspaces` | Auto-saved quote builder working drafts (named workspaces) |
| `invoices` | Invoice drafts generated from quotes |
| `rate_card_profiles` | Saved client-specific rate cards (rows + terms) |
| `app_rate_state` | Active working rate card state (`rate_rows`, `terms`, `client_name`) |
| `job_costing_drafts` | Job costing analysis drafts with labor, expenses, and margin calculations |
| `app_records` | General-purpose key/value document store for miscellaneous app data |
| `app_state` | Simple key/value store for global app state flags |

---

### `profiles`
One row per Supabase auth user. Shared across AOS and the Staff Portal.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Matches `auth.users.id` |
| `role` | text | `"admin"`, `"crew_leader"`, or `"staff"` |
| `employee_key` | text | FK → `employees.employee_key` (nullable) |
| `full_name` | text | Display name |
| `email` | text | Login email |

> Contact info (phone, address, city, state) was removed from `profiles` — it lives on the linked employee record.

### `employees`
Unified people table for both internal staff and bookable contractors.

| Column | Description |
|--------|-------------|
| `employee_key` | Primary key (e.g. `AES-00001`) |
| `full_name`, `first_name`, `last_name` | Name fields |
| `email`, `phone`, `address`, `city`, `state` | Contact info |
| `employment_type` | Determines staff vs. contractor classification |
| `status`, `worker_category`, `position_status` | HR classification fields |
| `is_deleted` | Soft delete flag |

### `positions`
Controlled vocabulary for worker roles. Single source of truth — feeds position dropdowns in Timekeeping, Job Sheets, Job Costing, Rate Card, and the Staff Portal. Managed via **⚙️ Maintenance → Positions**.

| Column | Description |
|--------|-------------|
| `id` | Text primary key (e.g. `pos-01`) |
| `name` | Display name (e.g. "Stagehand", "Audio Technician") |
| `sort_order` | Integer — controls dropdown order |
| `is_active` | Soft delete — `false` hides from dropdowns |

### Profile ↔ Employee Relationship
A user profile can optionally be linked to an employee record via `employee_key`. This link:
- Displays the employee's phone number (read-only) in the AOS User Management screen
- Shows the staff member's full contact info (read-only) on their Staff Portal profile page
- Is **required** for staff portal users to see their contact details and for the timesheet approval workflow to function
- Is **optional** for `admin` and `crew_leader` users

When a staff user's `employee_key` matches an `employee_key` on a `timesheet_entry`, that entry becomes visible to the staff member in the Staff Portal — regardless of whether the entry was submitted through the portal or entered directly in AOS Timekeeping.

### `calendar_events`
Master calendar entries. Each row represents a show, event, or gig. Fields include client, venue, address, dates, times, status, crew lead, and hands count. Also stores event profile notes and attachment filenames. Soft-deleted via `is_deleted`.

### `job_requests`
Incoming client inquiries and bookings pipeline. Tracks client, event details, dates, times, expected hours, status (lead / quoted / booked / lost), notes, and packet notes. Can be promoted to a Quote or a Job Sheet from within AOS.

### `job_sheets`
Per-event crew call sheets. Linked to a calendar event via `source_event_id`. Stores venue, date, call time, notes, and attachment filenames. Individual worker assignments are stored separately in `job_sheet_workers`.

### `job_sheet_workers`
Normalized worker roster — one row per worker per job sheet. Stores name, contact info, role/position, confirmed status, and sort order. Links back to `employees` via `employee_key` (nullable for manually entered workers). Cascades on job sheet delete.

### `timesheets`
Timesheet header record linked to a job sheet. Stores the `hide_pay_columns` flag (used by the crew leader view). Individual time entries are stored in `timesheet_entries`.

### `timesheet_entries`
One row per worker per timesheet. Stores clock-in/out times, lunch break, standard/OT/DT hours and pay rates, total hours, and total pay. Links to both `timesheets` and `employees`.

| Column | Description |
|--------|-------------|
| `timesheet_id` | FK → `timesheets.id` (nullable — null until approved for staff-submitted rows) |
| `employee_key` | FK → `employees.employee_key` (nullable) |
| `user_id` | Supabase auth user ID — set when submitted via the Staff Portal |
| `job_sheet_id` | FK → `job_sheets.id` |
| `job_name` | Denormalized job label for display in the Staff Portal |
| `work_date` | The specific date worked |
| `first_name`, `last_name`, `email`, `phone` | Denormalized worker contact info |
| `position` | Position/role for this entry |
| `time_in1`, `time_out1` | First shift in/out |
| `time_in2`, `time_out2` | Second shift in/out (optional) |
| `lunch_minutes` | Lunch deduction in minutes |
| `std_hours`, `ot_hours`, `dt_hours`, `total_hours` | Calculated hour buckets |
| `std_rate`, `ot_rate`, `dt_rate`, `total_pay` | Pay rates and computed total |
| `notes` | Worker notes |
| `status` | `null` = no linked employee; `submitted` = pending approval; `approved` = locked; `rejected` = locked |

> `status` controls the approval workflow. Entries where `status` is `null` have no linked employee and require no approval. Entries with `status = "submitted"` are visible and editable by the linked employee in the Staff Portal until an admin approves or rejects them.

### `quotes`
Saved quote documents built in Quote Builder. Stores all event details, line items (as JSONB), totals, deposit, terms, and signature info. Linked to a job request and/or job sheet. Referenced by invoices.

### `quote_draft_workspaces`
Named auto-save workspaces for the Quote Builder. The entire in-progress quote state (including line items, dates, and settings) is stored as JSONB in `data`. Multiple named drafts can be saved simultaneously.

### `invoices`
Invoice drafts generated from quotes. Mirrors quote line items with added invoice metadata (invoice number, issue/due dates, PO number, paid amount, status). Supports deposit invoices and final invoices.

### `rate_card_profiles`
Saved client-specific rate cards. Each profile stores a client name, the full rate rows array (JSONB), and terms text. Multiple profiles can be saved — one per client or contract type. Referenced by quotes and invoices.

### `app_rate_state`
Key/value rows holding the current working rate card state: `rate_rows` (the active row array), `terms` (billing terms text), and `client_name`. Acts as the "unsaved working copy" before a rate card is saved as a named profile.

### `job_costing_drafts`
Job costing analysis records. Stores all cost model parameters (payroll burden %, overhead per hour, target margin, OT/DT multipliers, minimum hours), actuals (travel, hotels, per diem, equipment, other), billed revenue, and per-position line items as JSONB. Linked to a job request, quote, job sheet, and timesheet.

### `app_records`
General-purpose document store — `(dataset, record_id)` compound primary key with a JSONB `payload`. Used for miscellaneous app data that doesn't warrant a dedicated table.

### `app_state`
Simple single-row-per-key state store. Used for global flags and settings (e.g. active selections) that need to persist across browser sessions.

---

## Repositories

| Repo | URL | Purpose |
|------|-----|---------|
| `Amplified-AOS` | https://github.com/amplifiedmgtesl/Amplified-AOS | Operations suite + crew leader portal |
| `amplified-staff` | https://github.com/amplifiedmgtesl/amplified-staff | Staff timesheet & schedule portal |

---

*Last updated: April 2026 — positions maintenance; full DB documentation; timesheet approval workflow; staff portal edit + AOS visibility; employee autocomplete in timekeeping; backfill SQL script*

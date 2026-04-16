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
| User Management | ✓ | | |
| Submit Timesheet (Staff Portal) | | | ✓ |
| View My Schedule (Staff Portal) | | | ✓ |
| My Profile (Staff Portal) | | | ✓ |
| View Pay Rates / Pricing | ✓ | | |

---

## How to Add Users

All user management is done in **AOS → User Management** (left sidebar). You must be logged in as an `admin`.

### Adding an Admin
1. Navigate to **User Management** → click **+ Add User**
2. Enter Full Name, Email, and Password (min 6 characters)
3. Set **Role** → `Admin`
4. Optionally link to an Employee Record
5. Click **Create User**
6. The new admin logs in at https://amplified-aos.vercel.app/login

### Adding a Crew Leader
1. Navigate to **User Management** → click **+ Add User**
2. Enter Full Name, Email, and Password
3. Set **Role** → `Crew Leader`
4. Optionally link to an Employee Record
5. Click **Create User**
6. The crew leader logs in at https://amplified-aos.vercel.app/login
7. After login they are automatically redirected to `/lead/job-sheets` — they will only ever see Job Sheets and Timekeeping with no pay data

### Adding a Staff Member
1. Navigate to **User Management** → click **+ Add User**
2. Enter Full Name, Email, and Password
3. Set **Role** → `Staff`
4. **Link to an Employee Record** — this is important. The staff portal reads the employee record to display the staff member's contact info (phone, address, city, state) on their profile page
5. Click **Create User**
6. The staff member logs in at **https://amplified-staff.vercel.app/login** (not AOS)
7. After login they are redirected to `/dashboard` on the staff portal

> ⚠️ Staff users who attempt to log in at the AOS URL will be blocked: *"Access denied. Staff members must use the Staff Portal."*

---

## Data Model

### `profiles` table
One row per Supabase auth user. Shared across all apps.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Matches `auth.users.id` |
| `role` | text | `"admin"`, `"crew_leader"`, or `"staff"` |
| `employee_key` | text | FK → `employees.employee_key` (nullable) |
| `full_name` | text | Display name |
| `email` | text | Email address |

> Phone, address, city, and state were intentionally removed from `profiles` — contact info lives on the employee record.

### `employees` table
Unified people table for internal staff and contractors.

| Column | Description |
|--------|-------------|
| `employee_key` | Primary key |
| `full_name`, `first_name`, `last_name` | Name fields |
| `email`, `phone`, `address`, `city`, `state` | Contact info |
| `employment_type` | Determines staff vs. contractor |
| `status`, `worker_category`, `position_status` | Classification |

### Profile ↔ Employee Relationship
A user profile can be optionally linked to an employee record via `employee_key`. This link:
- Displays the employee's phone number (read-only) in AOS User Management
- Shows the staff member's full contact info (read-only) on their Staff Portal profile page
- Is **required** for staff portal users to see their contact details
- Is **optional** for `admin` and `crew_leader` users

---

## Repositories

| Repo | URL | Purpose |
|------|-----|---------|
| `Amplified-AOS` | https://github.com/amplifiedmgtesl/Amplified-AOS | Operations suite + crew leader portal |
| `amplified-staff` | https://github.com/amplifiedmgtesl/amplified-staff | Staff timesheet & schedule portal |

---

*Last updated: April 2026*

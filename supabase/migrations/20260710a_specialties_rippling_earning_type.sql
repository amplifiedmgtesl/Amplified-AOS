-- Add rippling_earning_type to the positions AND specialties master tables.
--
-- Rippling has no concept of a rate card. Its custom-earnings CSV import is
-- per-employee, and each earning type (Rigger, Fork, Lead, Day Rate 1,
-- Climber, Coordinator, Contractor Hourly, Missed Pay) is a fixed column with
-- a flat company-wide pay rate. Our taxonomy uses positions/specialties with
-- our own names (e.g. Stagehand, not "Day Rate 1"). This column stores the
-- Rippling earning-type name each maps to, so it does double duty:
--
--   1. Seeding — tells the rate-card pay-field seeder which earning-type rate
--      to pull into the mapped pay rate.
--   2. Export — tells the Rippling CSV exporter which column to drop hours into.
--
-- On BOTH tables because payroll_run_entries carries a `position` text and an
-- optional `specialty_id` but NO position_id — and many real entries have a
-- position with no specialty. So resolution is:
--     specialty.rippling_earning_type   (override, when the entry has one)
--  ?? position.rippling_earning_type    (default for the position)
--  ?? 'Day Rate 1'                      (catch-all in the exporter)
--
-- Master-only: a property of the canonical taxonomy, NOT copied onto per-client
-- rate_card_profile_rows.
--
-- NULL = unmapped → the exporter's Day Rate 1 catch-all handles it, and seeding
-- skips it (e.g. ANCILLARY expense lines). Values are populated by a follow-up
-- data migration once the mapping is confirmed with Connor.

alter table positions
  add column if not exists rippling_earning_type text;

alter table specialties
  add column if not exists rippling_earning_type text;

comment on column positions.rippling_earning_type is
  'Default Rippling earning type for this position (Rigger/Fork/Lead/Day Rate 1/Climber/Coordinator). Overridden per-specialty by specialties.rippling_earning_type. NULL → exporter Day Rate 1 catch-all.';
comment on column specialties.rippling_earning_type is
  'Rippling earning type override for this specialty. NULL → falls back to positions.rippling_earning_type, then the exporter Day Rate 1 catch-all. Master-only.';

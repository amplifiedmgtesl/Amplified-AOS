-- ============================================================================
-- Migration: 2026-04-15c
-- Drop contact columns from profiles table.
--
-- Contact info (phone, address, city, state) belongs on the employee record,
-- not on the profile. Profiles are for app access only (role + employee link).
-- ============================================================================

alter table profiles drop column if exists phone;
alter table profiles drop column if exists address;
alter table profiles drop column if exists city;
alter table profiles drop column if exists state;

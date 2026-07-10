-- Seed rate-card PAY rates from the Rippling earning-type flat rates.
--
-- Rippling pays each earning type at a flat company-wide rate (the same for
-- every employee — individual differences live as per-employee overrides).
-- Those rates are: base / OT (1.5x) / DT (2.0x):
--     Rigger 35, Fork 30, Lead 30, Day Rate 1 25, Climber 30, Coordinator 25.
--
-- Each rate_card_profile_row maps (via its specialty's rippling_earning_type)
-- to one of those, so we can seed pay_hourly / pay_ot_rate / pay_dt_rate on
-- every rate card at once. Pay is NOT per-client, so all 24 cards get the same
-- values.
--
-- Guarded: only fills rows where pay_hourly is still 0/NULL ("not set"), so we
-- never clobber a rate someone entered by hand. Rows whose specialty has no
-- Rippling mapping (e.g. ANCILLARY) are left untouched.
--
-- Note: pay_hourly = 0 currently blocks payroll finalize; seeding real values
-- unblocks it. Rates trace to Rippling, so AOS payroll totals + job costing
-- now reflect actual pay. Employees who differ from the flat rate carry a
-- per-employee override (employees.pay_std_rate) — not seeded here.

update rate_card_profile_rows r
set pay_hourly  = b.base,
    pay_ot_rate = round((b.base * 1.5)::numeric, 2),
    pay_dt_rate = round((b.base * 2.0)::numeric, 2)
from specialties s
join (values
  ('Rigger', 35), ('Fork', 30), ('Lead', 30),
  ('Day Rate 1', 25), ('Climber', 30), ('Coordinator', 25)
) as b(etype, base) on s.rippling_earning_type = b.etype
where r.specialty_id = s.id
  and coalesce(r.pay_hourly, 0) = 0;

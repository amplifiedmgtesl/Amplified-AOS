-- Seed the initial Rippling earning-type mapping onto positions + specialties.
--
-- Best-guess starting values (Connor reviews/corrects on the Position
-- Maintenance screen). Keyed by NAME so it applies identically across dev and
-- prod despite their different position/specialty ids.
--
-- Idempotent: every update is guarded by `rippling_earning_type is null`, so
-- re-running never clobbers a value that's already been set (whether by an
-- earlier run of this seed or by a later hand-edit in the UI).
--
-- ANCILLARY (HOTEL/BUYOUT/FUEL/RENTAL/FLIGHT/TRAVEL) is intentionally left
-- unmapped — those are expense lines, not wages.

-- 1. Position-level defaults (used when an entry has a position but no specialty).
update positions set rippling_earning_type = case name
  when 'Stagehand'            then 'Day Rate 1'
  when 'Stagehand Lead'       then 'Lead'
  when 'Rigger'               then 'Rigger'
  when 'Head Rigger'          then 'Rigger'
  when 'Audio Technician'     then 'Day Rate 1'
  when 'Lighting Technician'  then 'Day Rate 1'
  when 'Video Technician'     then 'Day Rate 1'
  when 'Forklift Operator'    then 'Fork'
  when 'Camera Operator'      then 'Day Rate 1'
  when 'Operations'           then 'Coordinator'
  when 'Lead'                 then 'Lead'
  when 'Heavy Equipment Op'   then 'Day Rate 1'
  when 'Aerial Lift Operator' then 'Day Rate 1'
  when 'General Labor'        then 'Day Rate 1'
  when 'Other'                then 'Day Rate 1'
  else rippling_earning_type  -- handled by the catch-all below
end
where rippling_earning_type is null;

-- 1b. Catch-all for any other labor position (e.g. Carpenter, or a future
--     position) — default to Day Rate 1. ANCILLARY stays unmapped (expenses).
update positions set rippling_earning_type = 'Day Rate 1'
where name <> 'ANCILLARY' and rippling_earning_type is null;

-- 2. Specialty values: default to the position's type, with the two known
--    per-specialty overrides (Rigger/Climber, Operations/Crew Chief).
update specialties s set rippling_earning_type =
  case
    when p.name = 'Rigger'     and s.name = 'Climber'    then 'Climber'
    when p.name = 'Operations' and s.name = 'Crew Chief' then 'Lead'
    else p.rippling_earning_type
  end
from positions p
where s.position_id = p.id
  and p.name <> 'ANCILLARY'
  and s.rippling_earning_type is null;

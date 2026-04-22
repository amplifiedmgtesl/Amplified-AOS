-- Backfill timesheet_entries computed fields for rows saved before the
-- midnight-crossover fix in computeTimeEntry.
--
-- Replicates the TypeScript logic in lib/store/timekeeping.ts:
--   * pair 1 crosses midnight when time_out1 < time_in1
--   * pair 2 crosses midnight when time_out2 < time_in2
--   * end_date advances 1 day per crossing pair
--   * total minutes = pair1 + pair2 − meal1 − meal2 (floor at 0)
--   * std = min(8, total), ot = min(4, max(0, total − 8)), dt = max(0, total − 12)
--   * total_pay = std·std_rate + ot·ot_rate + dt·dt_rate
--
-- Idempotent: running it multiple times on already-correct rows is a no-op.

WITH parsed AS (
  SELECT
    id,
    work_date,
    std_rate,
    ot_rate,
    dt_rate,
    COALESCE(meal_break_1_minutes, lunch_minutes, 0) AS meal1,
    COALESCE(meal_break_2_minutes, 0) AS meal2,
    CASE WHEN time_in1  ~ '^\d{1,2}:\d{2}$' THEN split_part(time_in1,  ':', 1)::int * 60 + split_part(time_in1,  ':', 2)::int END AS in1,
    CASE WHEN time_out1 ~ '^\d{1,2}:\d{2}$' THEN split_part(time_out1, ':', 1)::int * 60 + split_part(time_out1, ':', 2)::int END AS out1,
    CASE WHEN time_in2  ~ '^\d{1,2}:\d{2}$' THEN split_part(time_in2,  ':', 1)::int * 60 + split_part(time_in2,  ':', 2)::int END AS in2,
    CASE WHEN time_out2 ~ '^\d{1,2}:\d{2}$' THEN split_part(time_out2, ':', 1)::int * 60 + split_part(time_out2, ':', 2)::int END AS out2
  FROM public.timesheet_entries
),
paired AS (
  SELECT
    id, work_date, std_rate, ot_rate, dt_rate, meal1, meal2,
    CASE WHEN in1 IS NULL OR out1 IS NULL THEN 0
         WHEN out1 < in1 THEN (24*60 - in1) + out1
         ELSE out1 - in1
    END AS p1_min,
    (in1 IS NOT NULL AND out1 IS NOT NULL AND out1 < in1)::int AS p1_cross,
    CASE WHEN in2 IS NULL OR out2 IS NULL THEN 0
         WHEN out2 < in2 THEN (24*60 - in2) + out2
         ELSE out2 - in2
    END AS p2_min,
    (in2 IS NOT NULL AND out2 IS NOT NULL AND out2 < in2)::int AS p2_cross
  FROM parsed
),
computed AS (
  SELECT
    id, work_date, std_rate, ot_rate, dt_rate,
    GREATEST(0, p1_min + p2_min - meal1 - meal2) AS total_min,
    p1_cross + p2_cross AS days_to_add
  FROM paired
),
final AS (
  SELECT
    id,
    CASE WHEN work_date IS NULL THEN NULL
         ELSE (work_date::date + days_to_add * INTERVAL '1 day')::date
    END AS end_date_new,
    ROUND((total_min / 60.0)::numeric, 2) AS total_hours_new,
    ROUND(LEAST(8.0, total_min / 60.0)::numeric, 2) AS std_hours_new,
    ROUND(
      CASE WHEN total_min / 60.0 > 8 THEN LEAST(4.0, total_min / 60.0 - 8) ELSE 0 END ::numeric,
      2
    ) AS ot_hours_new,
    ROUND(
      CASE WHEN total_min / 60.0 > 12 THEN total_min / 60.0 - 12 ELSE 0 END ::numeric,
      2
    ) AS dt_hours_new,
    std_rate, ot_rate, dt_rate
  FROM computed
)
UPDATE public.timesheet_entries t
SET
  end_date    = f.end_date_new,
  std_hours   = f.std_hours_new,
  ot_hours    = f.ot_hours_new,
  dt_hours    = f.dt_hours_new,
  total_hours = f.total_hours_new,
  total_pay   = ROUND(
                  (f.std_hours_new * f.std_rate
                 + f.ot_hours_new  * f.ot_rate
                 + f.dt_hours_new  * f.dt_rate)::numeric,
                  2
                )
FROM final f
WHERE t.id = f.id
  AND (
       COALESCE(t.end_date,    '1970-01-01'::date) IS DISTINCT FROM COALESCE(f.end_date_new, '1970-01-01'::date)
    OR COALESCE(t.std_hours,   -1) IS DISTINCT FROM f.std_hours_new
    OR COALESCE(t.ot_hours,    -1) IS DISTINCT FROM f.ot_hours_new
    OR COALESCE(t.dt_hours,    -1) IS DISTINCT FROM f.dt_hours_new
    OR COALESCE(t.total_hours, -1) IS DISTINCT FROM f.total_hours_new
  );

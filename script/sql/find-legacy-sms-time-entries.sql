-- SMS time entries saved before commit 47536fe stored the instant the text
-- arrived. Texts sent 8pm–midnight New York time therefore sit on the next
-- UTC day. This lists those rows with the day they should have been logged on
-- and any payroll that already covers either day. Read-only; changes nothing.
--
-- Assumes stored timestamps are UTC (the app has only run on UTC servers).
--
-- Usage: psql "$DATABASE_URL" -f script/sql/find-legacy-sms-time-entries.sql

BEGIN READ ONLY;

WITH legacy AS (
  SELECT
    te.id,
    te.employee_id,
    te.job_id,
    te.hours_worked,
    te.description,
    te.date AS stored_value,
    te.date::date AS stored_day,
    ((te.date AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York') AS sent_ny_time,
    ((te.date AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date AS correct_day
  FROM time_entries te
  WHERE te.source = 'sms'
    -- New-style entries are stored at midnight; anything else is a raw instant.
    AND te.date <> date_trunc('day', te.date)
)
SELECT
  l.id AS time_entry_id,
  e.name AS employee,
  j.title AS job,
  l.hours_worked,
  to_char(l.sent_ny_time, 'Dy Mon DD YYYY HH12:MI am') AS sent_new_york,
  l.stored_day AS shows_as,
  l.correct_day AS should_be,
  -- Local payroll records covering either day.
  (
    SELECT string_agg(DISTINCT pr.status || ' ' || pr.period_start::date || '..' || pr.period_end::date, '; ')
    FROM payroll_records pr
    WHERE pr.employee_id = l.employee_id
      AND (l.stored_day BETWEEN pr.period_start::date AND pr.period_end::date
        OR l.correct_day BETWEEN pr.period_start::date AND pr.period_end::date)
  ) AS payroll_records,
  -- Gusto payroll runs covering either day, other than drafts.
  (
    SELECT string_agg(DISTINCT gr.status || ' ' || gr.period_start || '..' || gr.period_end, '; ')
    FROM gusto_payroll_runs gr
    WHERE gr.status <> 'draft'
      AND (l.stored_day BETWEEN gr.period_start AND gr.period_end
        OR l.correct_day BETWEEN gr.period_start AND gr.period_end)
  ) AS gusto_runs,
  l.description
FROM legacy l
JOIN employees e ON e.id = l.employee_id
LEFT JOIN jobs j ON j.id = l.job_id
WHERE l.stored_day <> l.correct_day
ORDER BY l.sent_ny_time;

-- Totals, for a quick sense of scale.
SELECT
  count(*) FILTER (WHERE stored_day <> correct_day) AS wrong_day_entries,
  coalesce(sum(hours_worked) FILTER (WHERE stored_day <> correct_day), 0) AS wrong_day_hours,
  count(*) AS legacy_sms_entries_total
FROM (
  SELECT
    te.hours_worked,
    te.date::date AS stored_day,
    ((te.date AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date AS correct_day
  FROM time_entries te
  WHERE te.source = 'sms' AND te.date <> date_trunc('day', te.date)
) t;

ROLLBACK;

-- Seed client_id on the 2 job_requests that are missing it
UPDATE job_requests jr
SET client_id = c.id
FROM clients c
WHERE lower(trim(jr.client)) = lower(trim(c.name))
  AND jr.client_id IS NULL;

-- Show any that still couldn't be matched (will need manual review)
SELECT id, client FROM job_requests WHERE client_id IS NULL;

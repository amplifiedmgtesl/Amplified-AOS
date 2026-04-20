-- Check quotes where linked job_request has a DIFFERENT client_id
SELECT
  q.id             AS quote_id,
  q.client         AS quote_client,
  q.client_id      AS quote_client_id,
  jr.id            AS job_request_id,
  jr.client        AS jr_client,
  jr.client_id     AS jr_client_id
FROM quotes q
JOIN job_requests jr ON jr.id = q.linked_job_request_id
WHERE q.linked_job_request_id IS NOT NULL
  AND (q.client_id IS DISTINCT FROM jr.client_id);

-- Check quotes where linked rate_card_profile has a DIFFERENT client_id
SELECT
  q.id             AS quote_id,
  q.client         AS quote_client,
  q.client_id      AS quote_client_id,
  rcp.id           AS rate_card_id,
  rcp.client_name  AS rc_client_name,
  rcp.client_id    AS rc_client_id
FROM quotes q
JOIN rate_card_profiles rcp ON rcp.id = q.rate_card_profile_id
WHERE q.rate_card_profile_id IS NOT NULL
  AND (q.client_id IS DISTINCT FROM rcp.client_id);

-- Summary counts
SELECT
  (SELECT count(*) FROM quotes WHERE client_id IS NULL)               AS quotes_no_client,
  (SELECT count(*) FROM job_requests WHERE client_id IS NULL)         AS job_requests_no_client,
  (SELECT count(*) FROM rate_card_profiles WHERE client_id IS NULL)   AS rate_cards_no_client;

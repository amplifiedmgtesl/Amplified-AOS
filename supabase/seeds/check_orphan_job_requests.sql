-- Check if the two blank-client job requests are referenced anywhere

SELECT 'quote' AS source, id, client, linked_job_request_id
FROM quotes
WHERE linked_job_request_id IN ('jobreq-1776229712651', 'jobreq-1775064576002')

UNION ALL

SELECT 'job_request' AS source, id, client, NULL
FROM job_requests
WHERE id IN ('jobreq-1776229712651', 'jobreq-1775064576002');

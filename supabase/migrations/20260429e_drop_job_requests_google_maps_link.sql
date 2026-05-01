-- Drop the obsolete job_requests.google_maps_link column.
--
-- The Job Request editor now embeds an interactive map iframe whose wrapper
-- <a> tag computes the Google Maps URL from venue_address / city / state /
-- venue_zip on the fly. Nothing in the app needs the URL persisted. Calendar
-- event mapping (lib/store/calendar.ts) is being updated to compute the URL
-- from address fields too, removing the last reader of this column.

alter table job_requests
  drop column if exists google_maps_link;

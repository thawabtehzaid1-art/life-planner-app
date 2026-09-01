-- Schedules nudge-scan to run every hour.
--
-- Manual step first (can't be done from SQL alone): in the Supabase
-- dashboard, go to Database -> Extensions, and enable both "pg_cron" and
-- "pg_net". Then run this file: Project -> SQL Editor -> New query -> paste
-- -> Run.
--
-- Replace the two placeholders below before running:
--   <PROJECT_REF>   e.g. mwumyhdilnwnlpjmszjk (from the Supabase project URL)
--   <SERVICE_ROLE_KEY>  Project Settings -> API -> service_role key
-- The service role key is required here since nudge-scan is deployed with
-- --no-verify-jwt but still expects to be called by something trusted, not
-- literally anyone on the internet.

select cron.schedule(
  'nudge-scan-hourly',
  '0 * * * *', -- every hour, on the hour
  $$
  select net.http_post(
    url := 'https://mwumyhdilnwnlpjmszjk.supabase.co/functions/v1/nudge-scan',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
  );
  $$
);

-- To stop it later: select cron.unschedule('nudge-scan-hourly');

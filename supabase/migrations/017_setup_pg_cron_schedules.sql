-- Enable required extensions for scheduled edge function calls
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Weekly full sync: Sunday 2AM UTC (fetches 35 days of data)
SELECT cron.schedule(
  'qb-weekly-sync',
  '0 2 * * 0',
  $$SELECT net.http_post(
    url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/qb-sync-scheduled',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
    body := '{"schedule": "weekly"}'::jsonb
  )$$
);

-- Daily incremental sync: Mon-Sat 6AM UTC (fetches 3 days of data)
SELECT cron.schedule(
  'qb-daily-sync',
  '0 6 * * 1-6',
  $$SELECT net.http_post(
    url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/qb-sync-scheduled',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
    body := '{"schedule": "daily"}'::jsonb
  )$$
);

-- Weekly integrity check: Sunday 4AM UTC (after sync completes)
SELECT cron.schedule(
  'qb-integrity-check',
  '0 4 * * 0',
  $$SELECT net.http_post(
    url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/qb-integrity-check',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
    body := '{}'::jsonb
  )$$
);

-- Weekly email digest: Sunday 9AM UTC (after sync + integrity check)
SELECT cron.schedule(
  'weekly-digest-email',
  '0 9 * * 0',
  $$SELECT net.http_post(
    url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/send-weekly-digest',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
    body := '{}'::jsonb
  )$$
);

-- Hourly auto-sync. Reads the project URL and CRON_SECRET from Supabase Vault, so no secret is in git.
-- Before running, add two Vault secrets once (SQL Editor, values NOT committed):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('exchange-sync-hourly')
where exists (select 1 from cron.job where jobname = 'exchange-sync-hourly');

select cron.schedule(
  'exchange-sync-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

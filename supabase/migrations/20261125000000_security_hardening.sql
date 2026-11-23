-- Security hardening from the Nov 2026 audit.

-- 1) Trades: logged-out visitors get no table access at all (RLS already returned nothing;
--    this removes the grant too, matching every other table).
revoke all on public.trades from anon;

-- 2) Screenshot storage: enforce the same limits the upload button uses, on the server.
update storage.buckets
set file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'charts';

-- 3) Rate-limit log: keep one day (the longest window used is 15 minutes).
select cron.unschedule('rate-limits-cleanup')
where exists (select 1 from cron.job where jobname = 'rate-limits-cleanup');
select cron.schedule(
  'rate-limits-cleanup',
  '17 3 * * *',
  $$ delete from public.rate_limits where at < now() - interval '1 day' $$
);

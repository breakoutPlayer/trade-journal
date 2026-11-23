-- Security Advisor fixes (Nov 2026).

-- 1) "Extension in Public": move pg_net out of the public schema. pg_net can't be relocated, so it is
--    reinstalled into `extensions`. Its functions stay in the `net` schema, so the hourly sync job
--    (net.http_post) keeps working unchanged.
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;

-- 2) "RLS Enabled No Policy" on rate_limits: intentional (server-only table). Make it explicit.
drop policy if exists "No client access to rate limits" on public.rate_limits;
create policy "No client access to rate limits" on public.rate_limits
  for all to anon, authenticated using (false) with check (false);

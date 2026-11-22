-- This project doesn't auto-grant new tables to API roles, so grant exactly what's needed.
-- RLS still applies to `authenticated`; service_role is used only inside Edge Functions.

grant usage on schema public to authenticated, service_role;

-- Browser (signed-in user): read own connections, pause/resume, read own sync history.
grant select on public.exchange_connections to authenticated;
grant update (enabled) on public.exchange_connections to authenticated;
grant select on public.sync_runs to authenticated;
-- No grants at all on exchange_secrets or rate_limits for anon/authenticated.

-- Edge Functions.
grant select, insert, update, delete on
  public.exchange_connections, public.exchange_secrets, public.sync_runs, public.rate_limits
  to service_role;
grant usage, select on all sequences in schema public to service_role;

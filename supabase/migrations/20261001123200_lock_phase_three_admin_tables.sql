revoke all on public.platform_admins from anon, authenticated;
revoke all on public.company_status_history from anon, authenticated;

grant select on public.platform_admins to authenticated;
grant select on public.company_status_history to authenticated;

create table if not exists public.platform_integrations (
  key text primary key,
  display_name text not null,
  description text not null,
  connected boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.platform_integrations enable row level security;

drop policy if exists platform_integrations_platform_admin_only on public.platform_integrations;
create policy platform_integrations_platform_admin_only
  on public.platform_integrations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.platform_admins admin
      where admin.user_id = (select auth.uid())
    )
  );

revoke all on public.platform_integrations from anon, authenticated;
grant select on public.platform_integrations to authenticated;

insert into public.platform_integrations (key, display_name, description, connected, sort_order)
values
  ('places_provider', 'Apify / Google Maps', 'Fonte principal do radar de estabelecimentos', true, 10),
  ('google_places', 'Google Places API oficial', 'Integração opcional para uma etapa futura', false, 20),
  ('meta', 'Instagram / Meta', 'Preparado para integração futura', false, 30),
  ('database', 'Supabase', 'Autenticação, persistência e funções protegidas', true, 40),
  ('crm', 'CRM externo', 'Exportação de oportunidades priorizadas', false, 50)
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  connected = excluded.connected,
  sort_order = excluded.sort_order,
  updated_at = now();

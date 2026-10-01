-- LeadScope Fase 3: funil auditável, histórico comercial e acesso administrativo.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

drop policy if exists platform_admins_read_own_marker on public.platform_admins;
create policy platform_admins_read_own_marker
  on public.platform_admins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

-- Administrador inicial da plataforma. Novos superadministradores devem ser
-- incluídos apenas por uma migração ou pelo painel seguro do Supabase.
insert into public.platform_admins (user_id)
select id
from auth.users
where lower(email) = 'felipe@quantisgrowth.com.br'
on conflict (user_id) do nothing;

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

create table if not exists public.company_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  status_anterior text,
  status_novo text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_company_status_history_user_company_date
  on public.company_status_history (user_id, empresa_id, changed_at desc);
create index if not exists idx_company_status_history_company
  on public.company_status_history (empresa_id);
create index if not exists idx_company_status_history_changed_by
  on public.company_status_history (changed_by);

alter table public.company_status_history enable row level security;

drop policy if exists company_status_history_read_own on public.company_status_history;
create policy company_status_history_read_own
  on public.company_status_history
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.empresas company
      where company.id = empresa_id
        and company.user_id = (select auth.uid())
    )
  );

revoke all on public.company_status_history from anon, authenticated;
grant select on public.company_status_history to authenticated;

insert into public.company_status_history
  (user_id, empresa_id, status_anterior, status_novo, changed_by, changed_at)
select company.user_id, company.id, null, coalesce(company.status, 'Nova'), null,
       coalesce(company.analisado_em, company.created_at, now())
from public.empresas company
where not exists (
  select 1 from public.company_status_history history
  where history.empresa_id = company.id
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.log_company_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.company_status_history
      (user_id, empresa_id, status_anterior, status_novo, changed_by)
    values
      (new.user_id, new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function private.log_company_status_change() from public, anon, authenticated;

drop trigger if exists empresas_status_history_trigger on public.empresas;
create trigger empresas_status_history_trigger
after update of status on public.empresas
for each row
execute function private.log_company_status_change();

-- Nomes de fornecedores ficam apenas nos metadados internos. A interface
-- recebe uma descrição neutra da origem pública utilizada na evidência.
update public.evidencias
set fonte = 'Perfil comercial público'
where tipo_fonte in ('apify_google_maps', 'google_places')
   or fonte ilike '%Apify%'
   or fonte ilike '%Google Maps%';

comment on table public.platform_admins is
  'Marcadores de superadministradores da plataforma; usuários não podem promover a si próprios.';
comment on table public.platform_integrations is
  'Catálogo técnico visível somente a superadministradores da plataforma.';
comment on table public.company_status_history is
  'Histórico imutável das mudanças de etapa comercial de cada oportunidade.';

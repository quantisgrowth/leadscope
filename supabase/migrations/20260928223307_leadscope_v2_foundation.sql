-- LeadScope v2: onboarding enxuto, radares reais e base de enriquecimento.
-- Migração aditiva: preserva os registros existentes.

alter table public.account_settings add column if not exists onboarding_step smallint not null default 1;
alter table public.radares
  add column if not exists query text, add column if not exists localizacao text,
  add column if not exists raio_metros integer not null default 15000,
  add column if not exists limite_resultados smallint not null default 20,
  add column if not exists status text not null default 'pendente',
  add column if not exists fonte text not null default 'google_places',
  add column if not exists iniciado_em timestamptz, add column if not exists concluido_em timestamptz,
  add column if not exists erro text;
alter table public.empresas
  add column if not exists google_place_id text, add column if not exists business_status text,
  add column if not exists google_maps_url text, add column if not exists latitude double precision,
  add column if not exists longitude double precision, add column if not exists dados_google jsonb not null default '{}'::jsonb,
  add column if not exists coletado_em timestamptz;
alter table public.evidencias
  add column if not exists tipo_fonte text, add column if not exists url_fonte text,
  add column if not exists coletado_em timestamptz, add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'account_settings_onboarding_step_check') then
    alter table public.account_settings add constraint account_settings_onboarding_step_check check (onboarding_step between 1 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresas_user_google_place_key') then
    alter table public.empresas add constraint empresas_user_google_place_key unique (user_id, google_place_id);
  end if;
end $$;

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null, resultado text, descricao text, ticket_min numeric(12,2), ticket_max numeric(12,2),
  ativo boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ticket_min is null or ticket_min >= 0), check (ticket_max is null or ticket_max >= 0),
  check (ticket_min is null or ticket_max is null or ticket_max >= ticket_min)
);
create table if not exists public.target_profiles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null default 'Cliente ideal principal', segmentos text[] not null default '{}', regioes text[] not null default '{}',
  portes text[] not null default '{}', palavras_chave text[] not null default '{}',
  limite_resultados smallint not null default 20 check (limite_resultados between 1 and 20),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.radar_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  radar_id uuid not null references public.radares(id) on delete cascade,
  status text not null default 'processando' check (status in ('processando','concluido','falhou')),
  consulta text not null, localizacao text not null, limite_resultados smallint not null default 20 check (limite_resultados between 1 and 20),
  encontrados integer not null default 0, erro text, iniciado_em timestamptz not null default now(), concluido_em timestamptz
);
create table if not exists public.company_channels (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('google_maps','site','telefone','whatsapp','instagram','facebook','linkedin','tiktok','email','outro')),
  valor text not null, url text, fonte text not null default 'google_places', principal boolean not null default false,
  verificado_em timestamptz not null default now(), unique (empresa_id, tipo, valor)
);
create table if not exists public.score_components (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  radar_run_id uuid references public.radar_runs(id) on delete set null,
  versao_modelo text not null default 'google-v1', dimensao text not null, pontos numeric(5,2) not null,
  maximo numeric(5,2) not null, explicacao text not null, evidencias integer not null default 0,
  calculado_em timestamptz not null default now(), check (pontos >= 0 and maximo > 0 and pontos <= maximo)
);

create index if not exists idx_radares_user_id on public.radares(user_id);
create index if not exists idx_empresas_user_id on public.empresas(user_id);
create index if not exists idx_empresas_radar_id on public.empresas(radar_id);
create index if not exists idx_evidencias_empresa_id on public.evidencias(empresa_id);
create index if not exists idx_offers_user_id on public.offers(user_id);
create index if not exists idx_target_profiles_user_id on public.target_profiles(user_id);
create index if not exists idx_radar_runs_user_radar on public.radar_runs(user_id, radar_id);
create index if not exists idx_company_channels_user_empresa on public.company_channels(user_id, empresa_id);
create index if not exists idx_score_components_user_empresa on public.score_components(user_id, empresa_id);

alter table public.offers enable row level security;
alter table public.target_profiles enable row level security;
alter table public.radar_runs enable row level security;
alter table public.company_channels enable row level security;
alter table public.score_components enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists settings_self on public.account_settings;
create policy settings_self on public.account_settings for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists radares_self on public.radares;
create policy radares_self on public.radares for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists empresas_self on public.empresas;
create policy empresas_self on public.empresas for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists evidencias_self on public.evidencias;
create policy evidencias_self on public.evidencias for all to authenticated
  using (exists (select 1 from public.empresas e where e.id = empresa_id and e.user_id = (select auth.uid())))
  with check (exists (select 1 from public.empresas e where e.id = empresa_id and e.user_id = (select auth.uid())));
do $$ declare t text; begin
  foreach t in array array['offers','target_profiles','radar_runs','company_channels','score_components'] loop
    execute format('drop policy if exists %I on public.%I', t || '_self', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_self', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.account_settings, public.radares, public.empresas,
  public.evidencias, public.offers, public.target_profiles, public.radar_runs, public.company_channels,
  public.score_components to authenticated;

create or replace function public.handle_new_leadscope_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  insert into public.account_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_leadscope_user() from public, anon, authenticated;
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- Auditorias técnicas de sites executadas sob demanda via Apify.
create table if not exists public.site_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente','processando','concluido','falhou')),
  provider text not null default 'apify_website_content_crawler',
  provider_run_id text,
  provider_dataset_id text,
  url text not null,
  final_url text,
  http_status integer,
  checks jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  score smallint check (score between 0 and 100),
  confidence text check (confidence in ('Alta','Média','Baixa')),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_site_audits_user_empresa_created
  on public.site_audits(user_id, empresa_id, created_at desc);
create index if not exists idx_site_audits_empresa_id
  on public.site_audits(empresa_id);
create unique index if not exists idx_site_audits_provider_run
  on public.site_audits(provider_run_id) where provider_run_id is not null;

alter table public.site_audits enable row level security;

drop policy if exists site_audits_select_self on public.site_audits;
create policy site_audits_select_self on public.site_audits for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists site_audits_insert_self on public.site_audits;
create policy site_audits_insert_self on public.site_audits for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.empresas e
      where e.id = empresa_id and e.user_id = (select auth.uid())
    )
  );

drop policy if exists site_audits_update_self on public.site_audits;
create policy site_audits_update_self on public.site_audits for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update on public.site_audits to authenticated;

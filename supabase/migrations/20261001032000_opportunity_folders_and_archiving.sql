-- Phase 2: organização de oportunidades em pastas e arquivamento reversível.

alter table public.empresas
  add column if not exists archived_at timestamptz;

create table if not exists public.opportunity_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  cor text not null default '#10a37f' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_opportunity_folders_user_name
  on public.opportunity_folders (user_id, lower(btrim(nome)));
create index if not exists idx_opportunity_folders_user_updated
  on public.opportunity_folders (user_id, updated_at desc);

create table if not exists public.opportunity_folder_companies (
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid not null references public.opportunity_folders(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (folder_id, empresa_id)
);

create index if not exists idx_opportunity_folder_companies_user_company
  on public.opportunity_folder_companies (user_id, empresa_id);
create index if not exists idx_opportunity_folder_companies_company
  on public.opportunity_folder_companies (empresa_id);
create index if not exists idx_empresas_user_archived
  on public.empresas (user_id, archived_at);

alter table public.opportunity_folders enable row level security;
alter table public.opportunity_folder_companies enable row level security;

drop policy if exists opportunity_folders_self on public.opportunity_folders;
create policy opportunity_folders_self on public.opportunity_folders
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists opportunity_folder_companies_self on public.opportunity_folder_companies;
create policy opportunity_folder_companies_self on public.opportunity_folder_companies
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.opportunity_folders folder
      where folder.id = folder_id and folder.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.empresas company
      where company.id = empresa_id and company.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.opportunity_folders folder
      where folder.id = folder_id and folder.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.empresas company
      where company.id = empresa_id and company.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.opportunity_folders to authenticated;
grant select, insert, update, delete on public.opportunity_folder_companies to authenticated;

comment on column public.empresas.archived_at is
  'Data de arquivamento da oportunidade; null mantém a empresa nas visualizações ativas.';
comment on table public.opportunity_folders is
  'Pastas livres criadas pelo proprietário para organizar oportunidades.';
comment on table public.opportunity_folder_companies is
  'Relação muitos-para-muitos entre oportunidades e pastas do mesmo proprietário.';

alter table public.empresas
  add column if not exists analisado_em timestamptz;

update public.empresas
set analisado_em = coalesce(coletado_em, created_at)
where analisado_em is null;

create index if not exists idx_empresas_user_created_at
  on public.empresas (user_id, created_at desc);

create index if not exists idx_empresas_user_analisado_em
  on public.empresas (user_id, analisado_em desc);


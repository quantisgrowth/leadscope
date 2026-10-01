-- Validação cadastral de empresas brasileiras a partir de um CNPJ informado.
-- Armazena somente os campos empresariais necessários para qualificação B2B.

alter table public.empresas
  add column if not exists cnpj text,
  add column if not exists cnpj_status text,
  add column if not exists cnpj_active boolean,
  add column if not exists cnpj_legal_name text,
  add column if not exists cnpj_trade_name text,
  add column if not exists cnpj_cnae_code text,
  add column if not exists cnpj_cnae_description text,
  add column if not exists cnpj_size text,
  add column if not exists cnpj_opening_date date,
  add column if not exists cnpj_identity_score smallint,
  add column if not exists cnpj_validated_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'empresas_cnpj_format_check') then
    alter table public.empresas add constraint empresas_cnpj_format_check
      check (cnpj is null or cnpj ~ '^[0-9A-Z]{14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresas_cnpj_identity_score_check') then
    alter table public.empresas add constraint empresas_cnpj_identity_score_check
      check (cnpj_identity_score is null or cnpj_identity_score between 0 and 100);
  end if;
end $$;

create index if not exists idx_empresas_user_cnpj
  on public.empresas (user_id, cnpj)
  where cnpj is not null;

-- Catálogo de produtos e esteira de ofertas do LeadScope.
-- Mantém a oferta legada e permite relacionar produtos aos radares e empresas.

alter table public.offers
  add column if not exists tipo text not null default 'servico',
  add column if not exists etapa text not null default 'principal',
  add column if not exists modelo_cobranca text not null default 'unico',
  add column if not exists publico_alvo text,
  add column if not exists categorias text[] not null default '{}',
  add column if not exists sinais text[] not null default '{}',
  add column if not exists prioridade smallint not null default 50,
  add column if not exists posicao integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'offers_tipo_check') then
    alter table public.offers add constraint offers_tipo_check
      check (tipo in ('servico','produto','software','recorrencia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'offers_etapa_check') then
    alter table public.offers add constraint offers_etapa_check
      check (etapa in ('entrada','principal','expansao','recorrencia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'offers_modelo_cobranca_check') then
    alter table public.offers add constraint offers_modelo_cobranca_check
      check (modelo_cobranca in ('unico','mensal','anual','sob_consulta'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'offers_prioridade_check') then
    alter table public.offers add constraint offers_prioridade_check
      check (prioridade between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'offers_posicao_check') then
    alter table public.offers add constraint offers_posicao_check check (posicao >= 0);
  end if;
end $$;

create table if not exists public.radar_offers (
  radar_id uuid not null references public.radares(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (radar_id, offer_id)
);

create table if not exists public.company_offer_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  radar_id uuid references public.radares(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  compatibilidade smallint not null default 0 check (compatibilidade between 0 and 100),
  motivo text not null,
  principal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, radar_id, offer_id)
);

create index if not exists idx_offers_user_stage_order on public.offers(user_id, etapa, posicao);
create index if not exists idx_radar_offers_user on public.radar_offers(user_id);
create index if not exists idx_radar_offers_offer on public.radar_offers(offer_id);
create index if not exists idx_company_offer_matches_user_empresa on public.company_offer_matches(user_id, empresa_id);
create index if not exists idx_company_offer_matches_radar on public.company_offer_matches(radar_id);
create index if not exists idx_company_offer_matches_offer on public.company_offer_matches(offer_id);

alter table public.radar_offers enable row level security;
alter table public.company_offer_matches enable row level security;

drop policy if exists radar_offers_self on public.radar_offers;
create policy radar_offers_self on public.radar_offers for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.radares r where r.id = radar_id and r.user_id = (select auth.uid()))
    and exists (select 1 from public.offers o where o.id = offer_id and o.user_id = (select auth.uid()))
  );

drop policy if exists company_offer_matches_self on public.company_offer_matches;
create policy company_offer_matches_self on public.company_offer_matches for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.empresas e where e.id = empresa_id and e.user_id = (select auth.uid()))
    and exists (select 1 from public.offers o where o.id = offer_id and o.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.radar_offers, public.company_offer_matches to authenticated;

-- Converte a oferta única do cadastro inicial em um produto da nova esteira.
insert into public.offers (user_id, nome, resultado, descricao, etapa, tipo, modelo_cobranca, prioridade, posicao)
select s.user_id, trim(s.servico), nullif(trim(s.problema), ''), nullif(trim(s.descricao), ''),
       'principal', 'servico', 'sob_consulta', 80, 0
from public.account_settings s
where nullif(trim(s.servico), '') is not null
  and not exists (select 1 from public.offers o where o.user_id = s.user_id);

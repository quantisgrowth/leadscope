-- Aplicar no SQL Editor antes de publicar as funções atualizadas.
-- Não remove empresas nem altera o estágio comercial existente.
begin;
alter table public.empresas add column if not exists merged_into uuid references public.empresas(id) on delete restrict;
alter table public.company_offer_matches add column if not exists analysis_batch timestamptz not null default now();
update public.company_offer_matches set analysis_batch=created_at;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.company_offer_matches'::regclass and contype='u'
    and pg_get_constraintdef(oid)='UNIQUE (empresa_id, radar_id, offer_id)' loop
    execute format('alter table public.company_offer_matches drop constraint %I',c.conname);
  end loop;
end $$;
create index if not exists company_matches_analysis_identity on public.company_offer_matches(empresa_id,analysis_batch desc);
revoke update,delete on public.score_components,public.company_offer_matches from authenticated;
create table if not exists public.company_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  snapshot jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  captured_at timestamptz not null default now()
);
create index if not exists company_versions_company_date on public.company_versions(empresa_id,captured_at desc);
alter table public.company_versions enable row level security;
create policy versions_owner_read on public.company_versions for select to authenticated using(user_id=(select auth.uid()));
grant select on public.company_versions to authenticated;
revoke insert,update,delete on public.company_versions from authenticated,anon;

create table if not exists public.company_radar_history (
  user_id uuid not null references auth.users(id),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  radar_id uuid not null references public.radares(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(empresa_id,radar_id)
);
alter table public.company_radar_history enable row level security;
create policy radar_history_owner on public.company_radar_history for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid())
and exists(select 1 from public.empresas e where e.id=empresa_id and e.user_id=company_radar_history.user_id)
and exists(select 1 from public.radares r where r.id=radar_id and r.user_id=company_radar_history.user_id));
grant select,insert,update on public.company_radar_history to authenticated;
revoke delete on public.company_radar_history from authenticated,anon;
insert into public.company_radar_history(user_id,empresa_id,radar_id)
select user_id,id,radar_id from public.empresas where radar_id is not null on conflict do nothing;
insert into public.company_versions(user_id,empresa_id,snapshot)
select e.user_id,e.id,to_jsonb(e) from public.empresas e
where not exists(select 1 from public.company_versions v where v.empresa_id=e.id);

create schema if not exists leadscope_private;
revoke all on schema leadscope_private from public;
-- Definer somente para gravar um histórico imutável; nunca recebe dados do cliente.
create or replace function leadscope_private.capture_company_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' or to_jsonb(OLD) is distinct from to_jsonb(NEW) then
    insert into public.company_versions(user_id,empresa_id,snapshot,changed_by)
    values(NEW.user_id,NEW.id,to_jsonb(NEW),auth.uid());
  end if;
  return NEW;
end $$;
revoke all on function leadscope_private.capture_company_version() from public;
create or replace function leadscope_private.guard_company_merge() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if OLD.merged_into is not null and NEW.merged_into is distinct from OLD.merged_into then
    raise exception 'Vínculo de mesclagem protegido. Solicite revisão administrativa';
  end if;
  if NEW.merged_into is not null then
    if NEW.archived_at is null then raise exception 'Um cadastro mesclado deve permanecer arquivado'; end if;
    if NEW.merged_into is distinct from OLD.merged_into then
      if auth.uid() is distinct from NEW.user_id then raise exception 'Somente o titular pode mesclar'; end if;
      if not exists(select 1 from public.empresas e where e.id=NEW.merged_into and e.user_id=NEW.user_id and e.id<>NEW.id and e.merged_into is null) then
        raise exception 'Cadastro principal inválido';
      end if;
    end if;
  end if;
  return NEW;
end $$;
revoke all on function leadscope_private.guard_company_merge() from public;
drop trigger if exists guard_company_merge on public.empresas;
create trigger guard_company_merge before update on public.empresas for each row execute function leadscope_private.guard_company_merge();
drop trigger if exists capture_company_version on public.empresas;
create trigger capture_company_version after insert or update on public.empresas
for each row execute function leadscope_private.capture_company_version();

-- Whitelist de dados públicos. O status e campos comerciais nunca entram no UPDATE.
create or replace function public.save_company_collection(p_payload jsonb)
returns setof public.empresas language plpgsql security invoker set search_path='' as $$
declare p public.empresas; existing public.empresas; result public.empresas;
begin
  p:=jsonb_populate_record(null::public.empresas,p_payload);
  if p.user_id is null or p.nome is null or coalesce(p.source_place_id,p.google_place_id) is null then
    raise exception 'Identificação incompleta da coleta';
  end if;
  -- Serializa coletas da mesma conta: cobre concorrência entre identificadores alternativos.
  perform pg_advisory_xact_lock(hashtextextended(p.user_id::text,0));
  if (select count(*) from public.empresas e where e.user_id=p.user_id
    and ((p.google_place_id is not null and e.google_place_id=p.google_place_id)
      or (e.source_provider=p.source_provider and e.source_place_id=p.source_place_id)))>1 then
    raise exception 'Identificadores apontam para cadastros diferentes. Revise as possíveis duplicidades';
  end if;
  select * into existing from public.empresas e where e.user_id=p.user_id
    and ((p.google_place_id is not null and e.google_place_id=p.google_place_id)
      or (e.source_provider=p.source_provider and e.source_place_id=p.source_place_id))
    order by created_at limit 1 for update;
  if found then
    if existing.merged_into is not null then
      select * into existing from public.empresas where id=existing.merged_into and user_id=p.user_id for update;
      if not found or existing.merged_into is not null then raise exception 'Vínculo de mesclagem inválido'; end if;
    end if;
    update public.empresas e set
      nome=coalesce(nullif(p.nome,''),e.nome), segmento=coalesce(nullif(p.segmento,''),e.segmento),
      cidade=coalesce(nullif(p.cidade,''),e.cidade), endereco=coalesce(nullif(p.endereco,''),e.endereco),
      telefone=coalesce(nullif(p.telefone,''),e.telefone), site=coalesce(nullif(p.site,''),e.site),
      nota=coalesce(p.nota,e.nota),avaliacoes=coalesce(p.avaliacoes,e.avaliacoes),
      score=coalesce(p.score,e.score),confianca=coalesce(p.confianca,e.confianca),potencial=coalesce(p.potencial,e.potencial),
      google_place_id=coalesce(e.google_place_id,p.google_place_id),
      source_provider=coalesce(e.source_provider,p.source_provider),source_place_id=coalesce(e.source_place_id,p.source_place_id),
      source_url=coalesce(nullif(p.source_url,''),e.source_url),source_payload=coalesce(nullif(p.source_payload,'{}'),e.source_payload),
      dados_google=coalesce(nullif(p.dados_google,'{}'),e.dados_google),google_maps_url=coalesce(p.google_maps_url,e.google_maps_url),
      latitude=coalesce(p.latitude,e.latitude),longitude=coalesce(p.longitude,e.longitude),
      business_status=coalesce(p.business_status,e.business_status),
      ultima_atualizacao=coalesce(p.ultima_atualizacao,e.ultima_atualizacao),
      coletado_em=coalesce(p.coletado_em,e.coletado_em),analisado_em=coalesce(p.analisado_em,e.analisado_em),
      servico_recomendado=coalesce(p.servico_recomendado,e.servico_recomendado),sinais_keys=coalesce(p.sinais_keys,e.sinais_keys)
    where e.id=existing.id returning * into result;
  else
    insert into public.empresas(user_id,radar_id,nome,segmento,cidade,endereco,telefone,site,nota,avaliacoes,
      score,confianca,potencial,google_place_id,source_provider,source_place_id,source_url,source_payload,
      dados_google,google_maps_url,latitude,longitude,business_status,ultima_atualizacao,coletado_em,analisado_em,servico_recomendado,sinais_keys)
    values(p.user_id,p.radar_id,p.nome,p.segmento,p.cidade,p.endereco,p.telefone,p.site,p.nota,p.avaliacoes,
      coalesce(p.score,0),p.confianca,p.potencial,p.google_place_id,p.source_provider,p.source_place_id,p.source_url,
      coalesce(p.source_payload,'{}'),coalesce(p.dados_google,'{}'),p.google_maps_url,p.latitude,p.longitude,p.business_status,
      p.ultima_atualizacao,p.coletado_em,p.analisado_em,p.servico_recomendado,p.sinais_keys) returning * into result;
  end if;
  if p.radar_id is not null then
    insert into public.company_radar_history(user_id,empresa_id,radar_id) values(p.user_id,result.id,p.radar_id)
    on conflict(empresa_id,radar_id) do update set last_seen_at=now();
  end if;
  return next result;
end $$;
revoke all on function public.save_company_collection(jsonb) from public,anon;
grant execute on function public.save_company_collection(jsonb) to authenticated;
-- A reanálise é uma transação: recomendações, componentes e cadastro juntos.
create or replace function public.save_company_analysis(p_company uuid,p_matches jsonb,p_components jsonb,p_update jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare company public.empresas; begin
  select * into company from public.empresas where id=p_company for update;
  if not found then raise exception 'Empresa não encontrada'; end if;
  if exists(select 1 from jsonb_array_elements(p_matches) m where (m->>'empresa_id')::uuid<>p_company or (m->>'user_id')::uuid<>company.user_id)
    or exists(select 1 from jsonb_array_elements(p_components) c where (c->>'empresa_id')::uuid<>p_company or (c->>'user_id')::uuid<>company.user_id) then
    raise exception 'Dados de análise inconsistentes';
  end if;
  insert into public.company_offer_matches(user_id,empresa_id,radar_id,offer_id,compatibilidade,motivo,principal,analysis_batch)
  select user_id,empresa_id,radar_id,offer_id,compatibilidade,motivo,principal,analysis_batch
  from jsonb_populate_recordset(null::public.company_offer_matches,p_matches);
  insert into public.score_components(user_id,empresa_id,radar_run_id,versao_modelo,dimensao,pontos,maximo,explicacao,calculado_em)
  select user_id,empresa_id,radar_run_id,versao_modelo,dimensao,pontos,maximo,explicacao,calculado_em
  from jsonb_populate_recordset(null::public.score_components,p_components);
  update public.empresas set score=(p_update->>'score')::int,confianca=p_update->>'confianca',potencial=p_update->>'potencial',
    servico_recomendado=p_update->>'servico_recomendado',analisado_em=(p_update->>'analisado_em')::timestamptz where id=p_company;
  if not found then raise exception 'Sem permissão para reanalisar'; end if;
end $$;
revoke all on function public.save_company_analysis(uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_company_analysis(uuid,jsonb,jsonb,jsonb) to authenticated;
create or replace function public.merge_company_records(p_target uuid,p_source uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare target public.empresas; source public.empresas; begin
  if p_target=p_source then raise exception 'Selecione cadastros diferentes'; end if;
  -- Bloqueio por conta evita deadlocks com coleta e outras mesclagens.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into target from public.empresas where id=p_target and user_id=auth.uid() for update;
  if not found then raise exception 'Somente o titular pode mesclar cadastros'; end if;
  select * into source from public.empresas where id=p_source and user_id=auth.uid() for update;
  if not found then raise exception 'Cadastro de origem não encontrado'; end if;
  if target.merged_into is not null or source.merged_into is not null or target.archived_at is not null then
    raise exception 'Revise os registros: cadastro já mesclado ou principal arquivado';
  end if;
  if target.cnpj is not null and source.cnpj is not null and target.cnpj<>source.cnpj then
    raise exception 'CNPJs diferentes: não mescle possíveis filiais';
  end if;
  if exists(select 1 from public.empresas where merged_into=source.id) then
    raise exception 'Origem já é cadastro principal de uma mesclagem anterior';
  end if;
  insert into public.opportunity_folder_companies(user_id,folder_id,empresa_id)
  select user_id,folder_id,target.id from public.opportunity_folder_companies where empresa_id=source.id
  on conflict(folder_id,empresa_id) do nothing;
  insert into public.company_radar_history(user_id,empresa_id,radar_id,first_seen_at,last_seen_at)
  select user_id,target.id,radar_id,first_seen_at,last_seen_at from public.company_radar_history where empresa_id=source.id
  on conflict(empresa_id,radar_id) do update set first_seen_at=least(company_radar_history.first_seen_at,excluded.first_seen_at),last_seen_at=greatest(company_radar_history.last_seen_at,excluded.last_seen_at);
  update public.empresas set merged_into=target.id,archived_at=now() where id=source.id;
  -- IDs, contatos, notas e diagnósticos da origem permanecem intactos no arquivo.
end $$;
revoke all on function public.merge_company_records(uuid,uuid) from public,anon;
grant execute on function public.merge_company_records(uuid,uuid) to authenticated;
-- Exclusão definitiva fica desativada; use archived_at para restaurar depois.
revoke delete on public.empresas,public.offers,public.radares from authenticated;
commit;

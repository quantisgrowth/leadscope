-- Aplicar após os SQLs 01 a 04. Não apaga empresas nem reconstrói descartes antigos.
begin;
alter table public.radar_runs add column if not exists processing_until timestamptz;
create table if not exists public.radar_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  run_id uuid not null references public.radar_runs(id) on delete restrict,
  item_index integer not null check(item_index between 0 and 999),
  decision text not null check(decision in ('accepted','discarded','duplicate','error')),
  reasons jsonb not null default '[]' check(jsonb_typeof(reasons)='array'),
  preferences jsonb not null default '[]' check(jsonb_typeof(preferences)='array'),
  unknowns jsonb not null default '[]' check(jsonb_typeof(unknowns)='array'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=20000),
  analysis_payload jsonb not null default '{}' check(jsonb_typeof(analysis_payload)='object' and octet_length(analysis_payload::text)<=80000),
  company_id uuid references public.empresas(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz, reviewed_by uuid references auth.users(id),
  recovered_company_id uuid references public.empresas(id) on delete restrict,
  unique(run_id,item_index)
);
create index if not exists radar_results_account_date on public.radar_results(user_id,created_at desc,id);
create index if not exists radar_results_company on public.radar_results(company_id) where company_id is not null;
create index if not exists radar_results_recovered on public.radar_results(recovered_company_id) where recovered_company_id is not null;
alter table public.radar_results enable row level security;
drop policy if exists radar_results_read on public.radar_results;
create policy radar_results_read on public.radar_results for select to authenticated
using(user_id=(select public.current_account_id()));
drop policy if exists radar_results_insert on public.radar_results;
create policy radar_results_insert on public.radar_results for insert to authenticated
with check(user_id=(select public.current_account_id()) and (select public.current_account_can_write())
  and exists(select 1 from public.radar_runs r where r.id=run_id and r.user_id=radar_results.user_id)
  and (company_id is null or exists(select 1 from public.empresas e where e.id=company_id and e.user_id=radar_results.user_id)));
drop policy if exists radar_results_review on public.radar_results;
create policy radar_results_review on public.radar_results for update to authenticated
using(user_id=(select public.current_account_id()) and (select public.current_account_can_write()))
with check(user_id=(select public.current_account_id()) and (select public.current_account_can_write())
  and exists(select 1 from public.empresas e where e.id=recovered_company_id and e.user_id=radar_results.user_id));
revoke all on public.radar_results from public,anon,authenticated;
grant select,insert on public.radar_results to authenticated;
grant update(reviewed_at,reviewed_by,recovered_company_id) on public.radar_results to authenticated;

-- Original imutável; revisão é um evento separado, nunca troca o descarte original.
create or replace function leadscope_private.guard_radar_result() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (to_jsonb(NEW)-array['reviewed_at','reviewed_by','recovered_company_id']) is distinct from
     (to_jsonb(OLD)-array['reviewed_at','reviewed_by','recovered_company_id'])
    or OLD.reviewed_at is not null or NEW.reviewed_by is distinct from auth.uid()
    or NEW.reviewed_at is null or NEW.recovered_company_id is null
    or OLD.decision<>'discarded' then raise exception 'Resultado original protegido'; end if;
  return NEW;
end $$;
drop trigger if exists guard_radar_result on public.radar_results;
create trigger guard_radar_result before update on public.radar_results for each row
execute function leadscope_private.guard_radar_result();
revoke all on function leadscope_private.guard_radar_result() from public;

create or replace function public.claim_radar_run(p_run uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or public.current_account_can_write() is distinct from true then raise exception 'Sem permissão'; end if;
  update public.radar_runs set processing_until=now()+interval '5 minutes'
  where id=p_run and user_id=public.current_account_id() and status<>'concluido'
    and (processing_until is null or processing_until<now());
  return found;
end $$;

-- Uma empresa e suas evidências/análise são gravadas na mesma transação.
create or replace function leadscope_private.save_radar_company(p_run uuid,p_analysis jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.radar_runs; c public.empresas; payload jsonb; item jsonb; existed boolean;
begin
  if auth.uid() is null or public.current_account_can_write() is distinct from true then raise exception 'Sem permissão'; end if;
  if jsonb_typeof(p_analysis) is distinct from 'object' or octet_length(p_analysis::text)>80000
    or jsonb_array_length(coalesce(p_analysis->'matches','[]'))>5
    or jsonb_array_length(coalesce(p_analysis->'components','[]'))>10
    or jsonb_array_length(coalesce(p_analysis->'channels','[]'))>40
    or jsonb_array_length(coalesce(p_analysis->'evidence','[]'))>10 then raise exception 'Análise inválida'; end if;
  select * into r from public.radar_runs where id=p_run and user_id=public.current_account_id();
  if not found then raise exception 'Pesquisa não encontrada'; end if;
  payload=(p_analysis->'company')||jsonb_build_object('user_id',r.user_id,'radar_id',r.radar_id);
  perform pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
  existed=exists(select 1 from public.empresas e where e.user_id=r.user_id and
    ((e.source_provider=payload->>'source_provider' and e.source_place_id=payload->>'source_place_id')
      or (e.google_place_id is not null and e.google_place_id=payload->>'google_place_id')));
  select * into c from public.save_company_collection(payload);
  if c.id is null then raise exception 'Empresa não gravada'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_analysis->'matches','[]')) loop
    if not exists(select 1 from public.offers o join public.radar_offers ro on ro.offer_id=o.id
      where o.id=(item->>'offer_id')::uuid and o.user_id=r.user_id and ro.radar_id=r.radar_id) then raise exception 'Oferta inválida'; end if;
    insert into public.company_offer_matches(user_id,empresa_id,radar_id,offer_id,compatibilidade,motivo,principal,analysis_batch)
    values(r.user_id,c.id,r.radar_id,(item->>'offer_id')::uuid,(item->>'compatibilidade')::int,item->>'motivo',(item->>'principal')::boolean,(payload->>'analisado_em')::timestamptz);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_analysis->'components','[]')) loop
    insert into public.score_components(user_id,empresa_id,radar_run_id,versao_modelo,dimensao,pontos,maximo,explicacao,calculado_em)
    values(r.user_id,c.id,r.id,'erp-public-fit-v4',item->>'dimensao',(item->>'pontos')::int,(item->>'maximo')::int,item->>'explicacao',(payload->>'analisado_em')::timestamptz);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_analysis->'channels','[]')) loop
    insert into public.company_channels(user_id,empresa_id,tipo,valor,url,principal,fonte,verificado_em)
    values(r.user_id,c.id,item->>'tipo',item->>'valor',item->>'url',coalesce((item->>'principal')::boolean,false),'Perfil comercial público',(payload->>'coletado_em')::timestamptz)
    on conflict(empresa_id,tipo,valor) do update set verificado_em=excluded.verificado_em;
  end loop;
  -- Evidências anteriores permanecem no histórico; nunca são apagadas pela coleta.
  for item in select value from jsonb_array_elements(coalesce(p_analysis->'evidence','[]')) loop
    insert into public.evidencias(empresa_id,texto,fonte,confianca,data,tipo_fonte,url_fonte,coletado_em,metadata)
    values(c.id,item->>'texto','Perfil comercial público','Alta',(payload->>'coletado_em')::date,'apify_google_maps',payload->>'source_url',(payload->>'coletado_em')::timestamptz,jsonb_build_object('run_id',r.id));
  end loop;
  return jsonb_build_object('company',to_jsonb(c),'existing',existed);
end $$;

create or replace function public.persist_radar_result(p_run uuid,p_index int,p_entry jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.radar_runs; stored public.radar_results; saved jsonb; decision text; prior_company uuid;
begin
  if auth.uid() is null or public.current_account_can_write() is distinct from true then raise exception 'Sem permissão'; end if;
  select * into r from public.radar_runs where id=p_run and user_id=public.current_account_id() for update;
  if not found then raise exception 'Pesquisa não encontrada'; end if;
  select * into stored from public.radar_results where run_id=r.id and item_index=p_index;
  if found then return to_jsonb(stored); end if;
  if r.status='concluido' then raise exception 'Pesquisa já concluída'; end if;
  decision=p_entry->>'decision';
  if decision='accepted' then
    select company_id into prior_company from public.radar_results
    where run_id=r.id and company_id is not null and
      analysis_payload->'company'->>'source_place_id'=p_entry->'analysis'->'company'->>'source_place_id'
    order by item_index limit 1;
    if found then
      saved=jsonb_build_object('company',jsonb_build_object('id',prior_company),'existing',true);
    else
      saved=leadscope_private.save_radar_company(r.id,p_entry->'analysis');
    end if;
    if (saved->>'existing')::boolean then decision='duplicate'; end if;
  end if;
  insert into public.radar_results(user_id,run_id,item_index,decision,reasons,preferences,unknowns,snapshot,analysis_payload,company_id)
  values(r.user_id,r.id,p_index,decision,coalesce(p_entry->'reasons','[]'),coalesce(p_entry->'preferences','[]'),coalesce(p_entry->'unknowns','[]'),
    p_entry->'snapshot',coalesce(p_entry->'analysis','{}'),(saved->'company'->>'id')::uuid) returning * into stored;
  return to_jsonb(stored);
end $$;

create or replace function public.recover_radar_result(p_result uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare item public.radar_results; c public.empresas; payload jsonb; saved jsonb;
begin
  if auth.uid() is null or public.current_account_can_write() is distinct from true then raise exception 'Sem permissão'; end if;
  select * into item from public.radar_results where id=p_result and user_id=public.current_account_id() for update;
  if not found or item.decision<>'discarded' or item.reasons @> '["invalid_profile"]' or item.reasons @> '["permanently_closed"]' then raise exception 'Resultado não pode ser aproveitado'; end if;
  if item.reviewed_at is not null then return item.recovered_company_id; end if;
  payload=item.analysis_payload->'company';
  -- Não substitui dados novos por uma fotografia antiga ao aproveitar um descarte.
  perform pg_advisory_xact_lock(hashtextextended(item.user_id::text,0));
  select * into c from public.empresas e where e.user_id=item.user_id and
    ((e.source_provider=payload->>'source_provider' and e.source_place_id=payload->>'source_place_id')
      or (e.google_place_id is not null and e.google_place_id=payload->>'google_place_id')) order by e.created_at limit 1;
  if found then
    if c.merged_into is not null then select * into c from public.empresas where id=c.merged_into and user_id=item.user_id; end if;
  else
    saved=leadscope_private.save_radar_company(item.run_id,item.analysis_payload);select * into c from public.empresas where id=(saved->'company'->>'id')::uuid;
  end if;
  if c.id is null then raise exception 'Cadastro não encontrado'; end if;
  update public.radar_results set reviewed_at=now(),reviewed_by=auth.uid(),recovered_company_id=c.id where id=item.id;
  return c.id;
end $$;
revoke all on function public.claim_radar_run(uuid),leadscope_private.save_radar_company(uuid,jsonb),public.persist_radar_result(uuid,int,jsonb),public.recover_radar_result(uuid) from public,anon;
grant execute on function public.claim_radar_run(uuid),leadscope_private.save_radar_company(uuid,jsonb),public.persist_radar_result(uuid,int,jsonb),public.recover_radar_result(uuid) to authenticated;

create table if not exists public.approach_message_versions (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  body text not null check(length(body) between 1 and 5000),
  tone text not null check(tone in ('direto','consultivo','informal')),
  origin text not null check(origin in ('template','edited','legacy')),
  used boolean not null default false,created_by uuid references auth.users(id),captured_at timestamptz not null default now()
);
create index if not exists approach_versions_company_date on public.approach_message_versions(empresa_id,captured_at desc);
create index if not exists approach_versions_account_date on public.approach_message_versions(user_id,captured_at desc);
alter table public.approach_message_versions enable row level security;
drop policy if exists approach_versions_read on public.approach_message_versions;
create policy approach_versions_read on public.approach_message_versions for select to authenticated using(user_id=(select public.current_account_id()));
drop policy if exists approach_versions_insert on public.approach_message_versions;
create policy approach_versions_insert on public.approach_message_versions for insert to authenticated
with check(user_id=(select public.current_account_id()) and (select public.current_account_can_write()) and created_by=auth.uid()
  and exists(select 1 from public.empresas e where e.id=empresa_id and e.user_id=approach_message_versions.user_id));
revoke all on public.approach_message_versions from public,anon,authenticated;
grant select,insert on public.approach_message_versions to authenticated;
create or replace function public.save_approach_message(p_company uuid,p_text text,p_tone text,p_origin text,p_used boolean,p_expected text) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.empresas;
begin
  if auth.uid() is null or public.current_account_can_write() is distinct from true then raise exception 'Sem permissão'; end if;
  if p_text is null or length(trim(p_text)) not between 1 and 5000 or p_tone not in ('direto','consultivo','informal') or p_tone is null
    or p_origin not in ('template','edited') or p_origin is null then raise exception 'Mensagem inválida'; end if;
  select * into c from public.empresas where id=p_company and user_id=public.current_account_id() for update;
  if not found then raise exception 'Empresa não encontrada'; end if;
  if coalesce(c.mensagem_gerada,'') is distinct from coalesce(p_expected,'') then raise exception 'Outra pessoa alterou a mensagem. Atualize antes de salvar'; end if;
  if nullif(c.mensagem_gerada,'') is not null and not exists(select 1 from public.approach_message_versions where empresa_id=c.id) then
    insert into public.approach_message_versions(user_id,empresa_id,body,tone,origin,used,created_by)
    values(c.user_id,c.id,c.mensagem_gerada,coalesce(c.mensagem_tom,'consultivo'),'legacy',coalesce(c.mensagem_utilizada,false),auth.uid());
  end if;
  insert into public.approach_message_versions(user_id,empresa_id,body,tone,origin,used,created_by)
  values(c.user_id,c.id,p_text,p_tone,p_origin,coalesce(p_used,false),auth.uid());
  update public.empresas set mensagem_gerada=p_text,mensagem_tom=p_tone,
    mensagem_utilizada=case when p_used then true when p_text is distinct from c.mensagem_gerada then false else coalesce(c.mensagem_utilizada,false) end where id=c.id;
end $$;
revoke all on function public.save_approach_message(uuid,text,text,text,boolean,text) from public,anon;
grant execute on function public.save_approach_message(uuid,text,text,text,boolean,text) to authenticated;
commit;

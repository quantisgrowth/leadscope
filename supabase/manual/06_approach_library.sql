-- Aplicar após o SQL 05. Não altera mensagens ou pesquisas anteriores.
begin;
create table if not exists public.approach_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  offer_id uuid not null references public.offers(id) on delete restrict,
  name text not null check(length(trim(name)) between 1 and 120),
  niches text not null default '' check(length(niches)<=500),
  channel text not null check(channel in ('whatsapp','email')),
  tone text not null check(tone in ('direto','consultivo','informal')),
  body text not null check(length(trim(body)) between 1 and 3500),
  active boolean not null default true,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists approach_models_account_offer on public.approach_models(user_id,offer_id);
create index if not exists approach_models_offer on public.approach_models(offer_id);
alter table public.approach_models enable row level security;
drop policy if exists approach_models_read on public.approach_models;
create policy approach_models_read on public.approach_models for select to authenticated
  using(user_id=(select public.current_account_id()));
drop policy if exists approach_models_create on public.approach_models;
create policy approach_models_create on public.approach_models for insert to authenticated
  with check(user_id=(select public.current_account_id()) and (select public.current_account_can_write())
    and exists(select 1 from public.offers o where o.id=offer_id and o.user_id=approach_models.user_id));
drop policy if exists approach_models_edit on public.approach_models;
create policy approach_models_edit on public.approach_models for update to authenticated
  using(user_id=(select public.current_account_id()) and (select public.current_account_can_write()))
  with check(user_id=(select public.current_account_id()) and (select public.current_account_can_write())
    and exists(select 1 from public.offers o where o.id=offer_id and o.user_id=approach_models.user_id));
revoke all on public.approach_models from public,anon,authenticated;
grant select,insert,update on public.approach_models to authenticated;

create or replace function public.validate_approach_model() returns trigger
language plpgsql security invoker set search_path='' as $$
declare token text;
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.user_id<>old.user_id) then raise exception 'Identificação imutável'; end if;
  for token in select (regexp_matches(new.body,'\{([^{}]*)\}','g'))[1] loop
    if token not in ('empresa','cidade','segmento','produto','beneficio') then raise exception 'Campo desconhecido: %',token; end if;
  end loop;
  if position('{produto}' in new.body)=0 then raise exception 'Inclua {produto} no texto'; end if;
  new.revision=case when tg_op='INSERT' then 1 else old.revision+1 end;
  new.updated_at=now();return new;
end $$;
drop trigger if exists validate_approach_model on public.approach_models;
create trigger validate_approach_model before insert or update on public.approach_models
  for each row execute function public.validate_approach_model();
revoke all on function public.validate_approach_model() from public,anon;

create table if not exists public.radar_approach_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  radar_id uuid not null references public.radares(id) on delete restrict,
  model_id uuid not null references public.approach_models(id) on delete restrict,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(radar_id,model_id)
);
create index if not exists radar_approach_account on public.radar_approach_models(user_id,radar_id);
create index if not exists radar_approach_model on public.radar_approach_models(model_id);
alter table public.radar_approach_models enable row level security;
drop policy if exists radar_approach_read on public.radar_approach_models;
create policy radar_approach_read on public.radar_approach_models for select to authenticated
  using(user_id=(select public.current_account_id()));
drop policy if exists radar_approach_create on public.radar_approach_models;
create policy radar_approach_create on public.radar_approach_models for insert to authenticated
  with check(user_id=(select public.current_account_id()) and (select public.current_account_can_write()));
revoke all on public.radar_approach_models from public,anon,authenticated;
grant select,insert on public.radar_approach_models to authenticated;

-- Sempre captura o modelo verdadeiro no servidor; ignora snapshots enviados pelo navegador.
create or replace function public.capture_radar_approach() returns trigger
language plpgsql security invoker set search_path='' as $$
declare m public.approach_models;o public.offers;
begin
  if not exists(select 1 from public.radares r where r.id=new.radar_id and r.user_id=new.user_id)
    or exists(select 1 from public.radar_runs r where r.radar_id=new.radar_id) then raise exception 'Pesquisa inválida ou já iniciada'; end if;
  select * into m from public.approach_models where id=new.model_id and user_id=new.user_id and active for share;
  if not found then raise exception 'Modelo indisponível'; end if;
  select * into o from public.offers where id=m.offer_id and user_id=new.user_id and ativo for share;
  if not found or not exists(select 1 from public.radar_offers r where r.radar_id=new.radar_id and r.offer_id=m.offer_id and r.user_id=new.user_id) then raise exception 'Produto não selecionado nesta pesquisa'; end if;
  new.snapshot=jsonb_build_object('model_id',m.id,'revision',m.revision,'name',m.name,'niches',m.niches,
    'channel',m.channel,'tone',m.tone,'body',m.body,'offer_id',o.id,'product',o.nome,'benefit',o.resultado);
  new.created_at=now();return new;
end $$;
drop trigger if exists capture_radar_approach on public.radar_approach_models;
create trigger capture_radar_approach before insert on public.radar_approach_models
  for each row execute function public.capture_radar_approach();
revoke all on function public.capture_radar_approach() from public,anon;

alter table public.approach_message_versions add column if not exists model_context jsonb;
create or replace function public.save_library_approach(p_company uuid,p_text text,p_origin text,p_used boolean,p_expected text,p_selection uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.empresas;s public.radar_approach_models;
begin
  if auth.uid() is null or public.current_account_can_write() is distinct from true then raise exception 'Sem permissão'; end if;
  if p_text is null or length(trim(p_text)) not between 1 and 5000 or p_origin is null or p_origin not in ('template','edited') then raise exception 'Mensagem inválida'; end if;
  select * into c from public.empresas where id=p_company and user_id=public.current_account_id() for update;
  if not found then raise exception 'Empresa não encontrada'; end if;
  if coalesce(c.mensagem_gerada,'') is distinct from coalesce(p_expected,'') then raise exception 'Outra pessoa alterou a mensagem. Atualize antes de salvar'; end if;
  select * into s from public.radar_approach_models where id=p_selection and user_id=c.user_id;
  if not found or (s.radar_id is distinct from c.radar_id and not exists(select 1 from public.company_offer_matches m
    where m.empresa_id=c.id and m.radar_id=s.radar_id and m.offer_id=(s.snapshot->>'offer_id')::uuid and m.user_id=c.user_id)) then raise exception 'Modelo não pertence às pesquisas desta empresa'; end if;
  if nullif(c.mensagem_gerada,'') is not null and not exists(select 1 from public.approach_message_versions where empresa_id=c.id) then
    insert into public.approach_message_versions(user_id,empresa_id,body,tone,origin,used,created_by)
      values(c.user_id,c.id,c.mensagem_gerada,coalesce(c.mensagem_tom,'consultivo'),'legacy',coalesce(c.mensagem_utilizada,false),auth.uid());
  end if;
  insert into public.approach_message_versions(user_id,empresa_id,body,tone,origin,used,created_by,model_context)
    values(c.user_id,c.id,p_text,s.snapshot->>'tone',p_origin,coalesce(p_used,false),auth.uid(),s.snapshot||jsonb_build_object('selection_id',s.id,'radar_id',s.radar_id));
  update public.empresas set mensagem_gerada=p_text,mensagem_tom=s.snapshot->>'tone',
    mensagem_utilizada=case when p_used then true when p_text is distinct from c.mensagem_gerada then false else coalesce(c.mensagem_utilizada,false) end where id=c.id;
end $$;
revoke all on function public.save_library_approach(uuid,text,text,boolean,text,uuid) from public,anon;
grant execute on function public.save_library_approach(uuid,text,text,boolean,text,uuid) to authenticated;
commit;

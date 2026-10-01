-- Aplicar depois de 01_history_and_collection.sql. Nenhum e-mail é enviado pelo SQL.
begin;
create table public.account_members (
  account_id uuid not null references auth.users(id),
  member_id uuid not null unique references auth.users(id),
  role text not null check(role in ('editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key(account_id,member_id),check(account_id<>member_id)
);
alter table public.account_members enable row level security;
create policy members_read on public.account_members for select to authenticated
using(account_id=(select auth.uid()) or member_id=(select auth.uid()));
grant select on public.account_members to authenticated;
revoke insert,update,delete on public.account_members from anon,authenticated;

grant usage on schema leadscope_private to authenticated;
create or replace function leadscope_private.account_access(owner_id uuid,writing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (owner_id=auth.uid() or exists(
    select 1 from public.account_members m where m.account_id=owner_id and m.member_id=auth.uid()
    and (not writing or m.role='editor')))
$$;
revoke all on function leadscope_private.account_access(uuid,boolean) from public;
grant execute on function leadscope_private.account_access(uuid,boolean) to authenticated;
create or replace function public.current_account_id() returns uuid language sql stable security invoker set search_path='' as $$
  select coalesce((select account_id from public.account_members where member_id=auth.uid()),auth.uid())
$$;
revoke all on function public.current_account_id() from public,anon;
grant execute on function public.current_account_id() to authenticated;
create or replace function public.current_account_can_write() returns boolean language sql stable security invoker set search_path='' as $$
  select leadscope_private.account_access(public.current_account_id(),true)
$$;
revoke all on function public.current_account_can_write() from public,anon;
grant execute on function public.current_account_can_write() to authenticated;

-- Existing owner-only policies remain; collaborators gain only the following access.
create or replace function leadscope_private.guard_record_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if NEW.user_id is distinct from OLD.user_id or (to_jsonb(NEW)->'id') is distinct from (to_jsonb(OLD)->'id') then
    raise exception 'Identidade e titularidade do registro são imutáveis';
  end if;
  return NEW;
end $$;
revoke all on function leadscope_private.guard_record_identity() from public;
do $$ declare t text; p text; checks text; begin
  foreach t in array array['empresas','radares','radar_runs','offers','target_profiles','radar_offers',
    'company_channels','score_components','company_offer_matches','site_audits','opportunity_folders',
    'opportunity_folder_companies','company_radar_history','company_versions','company_status_history','account_settings'] loop
    execute format('create trigger guard_record_identity before update on public.%I for each row execute function leadscope_private.guard_record_identity()',t);
    execute format('create policy team_read on public.%I for select to authenticated using(leadscope_private.account_access(user_id,false))',t);
    if t not in ('company_versions','company_status_history','account_settings') then
      checks:=format('leadscope_private.account_access(%I.user_id,true)',t);
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='empresa_id') then
        checks:=checks||format(' and exists(select 1 from public.empresas e where e.id=%I.empresa_id and e.user_id=%I.user_id)',t,t);
      end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='radar_id') then
        checks:=checks||format(' and (%I.radar_id is null or exists(select 1 from public.radares r where r.id=%I.radar_id and r.user_id=%I.user_id))',t,t,t);
      end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='offer_id') then
        checks:=checks||format(' and exists(select 1 from public.offers o where o.id=%I.offer_id and o.user_id=%I.user_id)',t,t);
      end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='folder_id') then
        checks:=checks||format(' and exists(select 1 from public.opportunity_folders f where f.id=%I.folder_id and f.user_id=%I.user_id)',t,t);
      end if;
      execute format('create policy team_insert on public.%I for insert to authenticated with check(%s)',t,checks);
      if t not in ('score_components','company_offer_matches') then
        execute format('create policy team_update on public.%I for update to authenticated using(leadscope_private.account_access(user_id,true)) with check(%s)',t,checks);
      end if;
      if t in ('opportunity_folders','opportunity_folder_companies','radar_offers') then
        execute format('create policy team_delete on public.%I for delete to authenticated using(leadscope_private.account_access(user_id,true))',t);
      end if;
    end if;
  end loop;
end $$;
create policy team_evidence_read on public.evidencias for select to authenticated using(exists(
  select 1 from public.empresas e where e.id=empresa_id and leadscope_private.account_access(e.user_id,false)));
create policy team_evidence_insert on public.evidencias for insert to authenticated with check(exists(
  select 1 from public.empresas e where e.id=empresa_id and leadscope_private.account_access(e.user_id,true)));

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id), email text not null,
  role text not null check(role in ('editor','viewer')),
  token_hash text not null unique,
  status text not null default 'sending' check(status in ('sending','sent','failed','accepted','revoked')),
  expires_at timestamptz not null, created_at timestamptz not null default now(),
  sent_at timestamptz, accepted_at timestamptz, provider_message_id text,
  check(email=lower(trim(email)))
);
create unique index invitations_pending_email on public.team_invitations(account_id,email)
where status in ('sending','sent','failed');
create index invitations_account_date on public.team_invitations(account_id,created_at desc);
alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from anon,authenticated;
grant all on public.team_invitations,public.account_members to service_role;

-- Somente a função de servidor pode aceitar; ela fornece e-mail verificado no Auth.
create or replace function public.accept_team_invitation(p_hash text,p_user uuid,p_email text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare invitation public.team_invitations; begin
  select * into invitation from public.team_invitations where token_hash=p_hash for update;
  if not found or invitation.email<>lower(trim(p_email)) or invitation.expires_at<=now()
    or invitation.status not in ('sent','accepted') then raise exception 'Convite inválido, expirado ou destinado a outro e-mail'; end if;
  if invitation.account_id=p_user then raise exception 'O titular já pertence à conta'; end if;
  if invitation.status='accepted' then
    if exists(select 1 from public.account_members where member_id=p_user and account_id=invitation.account_id) then return invitation.account_id; end if;
    raise exception 'Convite já utilizado';
  end if;
  if exists(select 1 from public.account_members where member_id=p_user) then raise exception 'Usuário já vinculado a outra conta'; end if;
  -- Não mudar silenciosamente a conta de um titular com dados próprios.
  if exists(select 1 from public.empresas where user_id=p_user) or exists(select 1 from public.radares where user_id=p_user) then
    raise exception 'Usuário possui dados em outra conta. Solicite uma migração assistida';
  end if;
  insert into public.account_members(account_id,member_id,role) values(invitation.account_id,p_user,invitation.role);
  update public.team_invitations set status='accepted',accepted_at=now() where id=invitation.id;
  return invitation.account_id;
end $$;
revoke all on function public.accept_team_invitation(text,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_team_invitation(text,uuid,text) to service_role;
commit;

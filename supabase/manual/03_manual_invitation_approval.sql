-- Cadastro por convite não comprova a propriedade do e-mail.
begin;
alter table public.team_invitations add column candidate_user_id uuid references auth.users(id),
  add column candidate_name text, add column approved_by uuid references auth.users(id);
alter table public.team_invitations drop constraint team_invitations_status_check;
alter table public.team_invitations add constraint team_invitations_status_check
  check(status in ('sending','sent','failed','registering','awaiting_approval','accepted','revoked'));
drop index public.invitations_pending_email;
create unique index invitations_pending_email on public.team_invitations(account_id,email)
  where status in ('sending','sent','failed','registering','awaiting_approval');
create or replace function public.approve_manual_invitation(p_id uuid,p_owner uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare i public.team_invitations; begin
  select * into i from public.team_invitations where id=p_id and account_id=p_owner for update;
  if not found or i.candidate_user_id is null then raise exception 'Cadastro pendente não encontrado'; end if;
  if i.status='accepted' and i.approved_by=p_owner then
    if exists(select 1 from public.account_members where member_id=i.candidate_user_id and account_id=p_owner) then
      return i.candidate_user_id;
    end if;
    raise exception 'Acesso removido; não reativar automaticamente';
  end if;
  if i.status<>'awaiting_approval' or i.expires_at<=now() then raise exception 'Convite inválido ou expirado'; end if;
  if not exists(select 1 from auth.users u where u.id=i.candidate_user_id and lower(u.email)=i.email
    and u.raw_app_meta_data->>'leadscope_invitation_id'=i.id::text
    and u.raw_app_meta_data->>'leadscope_activation'='pending_manual') then
    raise exception 'Identidade do cadastro não corresponde ao convite';
  end if;
  if i.candidate_user_id=p_owner or exists(select 1 from public.account_members where member_id=i.candidate_user_id)
    or exists(select 1 from public.empresas where user_id=i.candidate_user_id)
    or exists(select 1 from public.radares where user_id=i.candidate_user_id) then raise exception 'Usuário já possui outra conta ou vínculo'; end if;
  insert into public.account_members(account_id,member_id,role) values(p_owner,i.candidate_user_id,i.role);
  update public.team_invitations set status='accepted',accepted_at=now(),approved_by=p_owner where id=i.id;
  return i.candidate_user_id;
end $$;
revoke all on function public.approve_manual_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_manual_invitation(uuid,uuid) to service_role;
commit;

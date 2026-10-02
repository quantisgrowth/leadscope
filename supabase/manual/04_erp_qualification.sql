-- Apply AFTER SQLs 01, 02 and 03. Does not call external services.
begin;
alter table public.empresas add column if not exists commercial_qualification jsonb not null default '{}'::jsonb;
alter table public.empresas drop constraint if exists commercial_qualification_shape;
alter table public.empresas add constraint commercial_qualification_shape
  check (jsonb_typeof(commercial_qualification)='object' and octet_length(commercial_qualification::text)<=12000);

-- Invoker preserves existing account RLS. Lock + expected snapshot prevents lost edits.
create or replace function public.save_commercial_qualification(p_company uuid,p_values jsonb,p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_value jsonb; saved jsonb; k text; v jsonb;
begin
  if auth.uid() is null or public.current_account_can_write() is not true then
    raise exception 'Acesso somente leitura ou sessão inválida.';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object' or octet_length(p_values::text)>10000 then
    raise exception 'Qualificação inválida.';
  end if;
  for k,v in select key,value from jsonb_each(p_values) loop
    if k not in ('system','equipment','users','monthlyOrders','spreadsheets','need','decisionMaker','timing','notes') then
      raise exception 'Campo de qualificação inválido.';
    end if;
    if k in ('equipment','users','monthlyOrders') then
      if v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or (v::text)::numeric<0 or (v::text)::numeric>1000000 or trunc((v::text)::numeric)<>(v::text)::numeric) then
        raise exception 'Quantidade inválida.';
      end if;
    elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>(case when k='notes' then 2000 else 500 end) then
      raise exception 'Texto de qualificação inválido.';
    end if;
    if k='spreadsheets' and (v#>>'{}') not in ('','sim','nao','parcial') then raise exception 'Opção inválida.'; end if;
  end loop;
  select commercial_qualification into current_value from public.empresas
    where id=p_company and user_id=public.current_account_id() and merged_into is null for update;
  if not found then raise exception 'Empresa não encontrada ou sem permissão.'; end if;
  if current_value is distinct from p_expected then
    raise exception 'Outra pessoa alterou esta qualificação. Atualize a página antes de salvar novamente.';
  end if;
  saved=p_values||jsonb_build_object('_updatedAt',now(),'_updatedBy',auth.uid());
  update public.empresas set commercial_qualification=saved where id=p_company;
  -- SQL 01's existing trigger records the entire NEW row in company_versions.
  return saved;
end; $$;
revoke all on function public.save_commercial_qualification(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_commercial_qualification(uuid,jsonb,jsonb) to authenticated;
commit;

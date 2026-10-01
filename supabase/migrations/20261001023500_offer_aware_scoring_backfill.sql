create temporary table tmp_offer_fit_backfill on commit drop as
with source as (
  select
    e.id as empresa_id, e.user_id, e.radar_id, o.id as offer_id, o.nome as offer_name,
    o.resultado, o.prioridade, o.etapa,
    lower(translate(concat_ws(' ', e.nome, e.segmento, e.source_payload::text),
      'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) as company_text,
    lower(translate(concat_ws(' ', o.publico_alvo, array_to_string(o.categorias, ' ')),
      'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) as offer_text
  from public.empresas e
  join public.offers o on o.user_id = e.user_id and o.ativo = true
  where e.radar_id is not null
), token_overlap as (
  select source.*,
    count(distinct left(company_token, 5)) filter (
      where offer_token is not null
        and length(company_token) >= 5
        and company_token not in ('empre', 'servi', 'produ', 'siste')
    )::int as token_matches
  from source
  left join lateral regexp_split_to_table(source.company_text, '[^a-z0-9]+') company_token on true
  left join lateral regexp_split_to_table(source.offer_text, '[^a-z0-9]+') offer_token
    on left(company_token, 5) = left(offer_token, 5) and length(offer_token) >= 5
  group by source.empresa_id, source.user_id, source.radar_id, source.offer_id,
    source.offer_name, source.resultado, source.prioridade, source.etapa,
    source.company_text, source.offer_text
), ranked as (
  select token_overlap.*,
    least(100, 10 + round(coalesce(prioridade, 50) * 0.15)::int
      + least(35, token_matches * 9)
      + case when etapa = 'principal' then 5 else 0 end) as compatibility,
    row_number() over (
      partition by empresa_id
      order by token_matches desc, prioridade desc nulls last, offer_id
    ) as position
  from token_overlap
)
select * from ranked where position = 1 and token_matches > 0;

insert into public.radar_offers (radar_id, offer_id, user_id)
select distinct radar_id, offer_id, user_id from tmp_offer_fit_backfill
on conflict (radar_id, offer_id) do nothing;

update public.company_offer_matches match
set principal = false, updated_at = now()
where match.empresa_id in (select empresa_id from tmp_offer_fit_backfill);

insert into public.company_offer_matches
  (user_id, empresa_id, radar_id, offer_id, compatibilidade, motivo, principal)
select user_id, empresa_id, radar_id, offer_id, compatibility,
  concat('Aderência baseada na atividade e no público-alvo cadastrados. Resultado a validar: ', resultado),
  true
from tmp_offer_fit_backfill
on conflict (empresa_id, radar_id, offer_id) do update set
  compatibilidade = excluded.compatibilidade,
  motivo = excluded.motivo,
  principal = true,
  updated_at = now();

create temporary table tmp_neutral_scores on commit drop as
select
  e.id as empresa_id, e.user_id,
  least(20, 7 + case when e.endereco is not null then 4 else 0 end
    + case when coalesce(e.business_status, 'OPERATIONAL') = 'OPERATIONAL' then 4 else 0 end
    + case when coalesce(e.nota, 0) > 0 then 5 else 0 end)::int as profile_points,
  case when fit.empresa_id is null then 15 else round(fit.compatibility * 0.30)::int end as compatibility_points,
  least(15, round((coalesce(e.nota, 0) / 5) * 9)::int
    + least(6, floor((ln(coalesce(e.avaliacoes, 0) + 1) / ln(10)) * 3)::int)) as reputation_points,
  (case when e.telefone is not null then 10 else 0 end
    + case when e.site is not null then 5 else 0 end)::int as contact_points,
  least(20, 5
    + case when e.endereco is not null then 3 else 0 end
    + case when e.telefone is not null then 3 else 0 end
    + case when coalesce(e.nota, 0) > 0 then 3 else 0 end
    + case when e.source_url is not null then 3 else 0 end
    + case when e.site is not null then 3 else 0 end)::int as confidence_points,
  fit.offer_name, fit.resultado, fit.compatibility
from public.empresas e
left join tmp_offer_fit_backfill fit on fit.empresa_id = e.id;

update public.empresas e
set
  score = scores.profile_points + scores.compatibility_points + scores.reputation_points
    + scores.contact_points + scores.confidence_points,
  potencial = case
    when scores.profile_points + scores.compatibility_points + scores.reputation_points
      + scores.contact_points + scores.confidence_points >= 70 then 'alto'
    when scores.profile_points + scores.compatibility_points + scores.reputation_points
      + scores.contact_points + scores.confidence_points >= 45 then 'medio'
    else 'baixo' end,
  servico_recomendado = case
    when scores.offer_name is not null then scores.offer_name
    when e.servico_recomendado ~* 'cria[cç][aã]o de site|presen[cç]a digital|otimiza[cç][aã]o da presen[cç]a' then null
    else e.servico_recomendado end,
  analisado_em = now(),
  ultima_atualizacao = current_date
from tmp_neutral_scores scores
where scores.empresa_id = e.id;

delete from public.score_components component
where component.empresa_id in (select empresa_id from tmp_neutral_scores)
  and component.versao_modelo in ('apify-google-v1', 'offer-fit-v2');

insert into public.score_components
  (user_id, empresa_id, versao_modelo, dimensao, pontos, maximo, explicacao)
select scores.user_id, scores.empresa_id, 'offer-fit-v2', component.dimensao,
  component.pontos, component.maximo, component.explicacao
from tmp_neutral_scores scores
cross join lateral (values
  ('Perfil público', scores.profile_points::numeric, 20::numeric, 'Completude e situação pública do estabelecimento.'),
  ('Compatibilidade com a oferta', scores.compatibility_points::numeric, 30::numeric,
    case when scores.offer_name is null
      then 'Nenhuma oferta compatível foi vinculada; a necessidade comercial ainda não foi avaliada.'
      else concat('Aderência estimada a ', scores.offer_name, '. Resultado a validar: ', scores.resultado) end),
  ('Reputação', scores.reputation_points::numeric, 15::numeric, 'Nota e volume de avaliações públicas.'),
  ('Contato', scores.contact_points::numeric, 15::numeric, 'Canais públicos de contato encontrados.'),
  ('Confiança', scores.confidence_points::numeric, 20::numeric, 'Quantidade de campos verificáveis coletados na fonte pública.')
) as component(dimensao, pontos, maximo, explicacao);

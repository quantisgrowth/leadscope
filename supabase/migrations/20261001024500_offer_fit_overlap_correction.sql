create temporary table tmp_correct_offer_fit on commit drop as
with source as (
  select
    e.id as empresa_id, e.user_id, e.radar_id, o.id as offer_id,
    o.nome as offer_name, o.resultado, o.prioridade, o.etapa,
    lower(translate(concat_ws(' ', e.nome, e.segmento, e.source_payload::text),
      'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) as company_text,
    lower(translate(concat_ws(' ', o.publico_alvo, array_to_string(o.categorias, ' ')),
      'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) as offer_text
  from public.empresas e
  join public.radar_offers ro on ro.radar_id = e.radar_id and ro.user_id = e.user_id
  join public.offers o on o.id = ro.offer_id and o.user_id = e.user_id and o.ativo = true
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
select * from ranked where position = 1;

update public.company_offer_matches match
set
  compatibilidade = fit.compatibility,
  motivo = case
    when fit.token_matches > 0 then concat(
      'Aderência baseada na atividade e no público-alvo cadastrados. Resultado a validar: ',
      fit.resultado
    )
    else concat(
      'Produto selecionado para validação neste radar comercial. Resultado a validar: ',
      fit.resultado
    )
  end,
  principal = true,
  updated_at = now()
from tmp_correct_offer_fit fit
where match.empresa_id = fit.empresa_id
  and match.radar_id = fit.radar_id
  and match.offer_id = fit.offer_id;

create temporary table tmp_correct_scores on commit drop as
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
left join tmp_correct_offer_fit fit on fit.empresa_id = e.id;

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
  servico_recomendado = scores.offer_name,
  analisado_em = now(),
  ultima_atualizacao = current_date
from tmp_correct_scores scores
where scores.empresa_id = e.id;

delete from public.score_components component
where component.empresa_id in (select empresa_id from tmp_correct_scores)
  and component.versao_modelo = 'offer-fit-v2';

insert into public.score_components
  (user_id, empresa_id, versao_modelo, dimensao, pontos, maximo, explicacao)
select scores.user_id, scores.empresa_id, 'offer-fit-v2', component.dimensao,
  component.pontos, component.maximo, component.explicacao
from tmp_correct_scores scores
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

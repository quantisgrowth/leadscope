-- ============================================================
-- LeadScope — Schema inicial legado
-- Para a versão atual, execute também as migrações em supabase/migrations
-- usando `supabase db push`. O fluxo antigo abaixo é mantido apenas para
-- compatibilidade com instalações já existentes.
-- Rode este script inteiro no SQL Editor do seu projeto Supabase
-- (Dashboard > SQL Editor > New query > colar > Run)
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- PERFIS (1 linha por usuário autenticado) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text default 'Novo usuário',
  email text,
  cargo text default 'Head Comercial',
  empresa text default 'Minha Empresa',
  plano text default 'Plano Piloto',
  created_at timestamptz default now()
);

-- ---------- CONFIGURAÇÕES DA CONTA (empresa, oferta, cliente ideal, pesos do score) ----------
create table if not exists public.account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  empresa text default '',
  site text default '',
  segmento text default '',
  cidade text default '',
  servico text default '',
  ticket text default '',
  descricao text default '',
  problema text default '',
  segmentos_desejados text default '',
  regiao text default '',
  porte text default 'Pequeno e médio porte',
  palavras_chave text default '',
  qtd_oportunidades text default '20',
  pesos jsonb default '{"google":70,"site":80,"reputacao":60,"contato":70,"presenca":50,"compatibilidade":75,"urgencia":65}'::jsonb,
  onboarded boolean default false,
  updated_at timestamptz default now()
);

-- ---------- RADARES ----------
create table if not exists public.radares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  nome text,
  segmento text,
  cidade text,
  criado_em date default current_date
);

-- ---------- EMPRESAS (oportunidades) ----------
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  radar_id uuid references public.radares(id) on delete set null,
  nome text not null,
  segmento text,
  cidade text,
  bairro text,
  endereco text,
  telefone text,
  site text,
  redes text[] default '{}',
  nota numeric(2,1),
  avaliacoes int default 0,
  score int not null default 0,
  confianca text,
  potencial text,
  status text default 'Nova',
  resultado text,
  monitorada boolean default false,
  ultima_atualizacao date default current_date,
  servico_recomendado text,
  sinais_keys text[] default '{}',
  mensagem_gerada text,
  mensagem_tom text default 'consultivo',
  mensagem_utilizada boolean default false,
  created_at timestamptz default now()
);

-- ---------- EVIDÊNCIAS ("Encontramos") ----------
create table if not exists public.evidencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete cascade,
  texto text not null,
  fonte text,
  data date,
  confianca text
);

-- ============================================================
-- SEGURANÇA (RLS) — cada usuário só enxerga e altera seus próprios dados
-- ============================================================
alter table public.profiles enable row level security;
alter table public.account_settings enable row level security;
alter table public.radares enable row level security;
alter table public.empresas enable row level security;
alter table public.evidencias enable row level security;

drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "settings_self" on public.account_settings;
create policy "settings_self" on public.account_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "radares_self" on public.radares;
create policy "radares_self" on public.radares
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "empresas_self" on public.empresas;
create policy "empresas_self" on public.empresas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "evidencias_self" on public.evidencias;
create policy "evidencias_self" on public.evidencias
  for all using (exists (select 1 from public.empresas e where e.id = empresa_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.empresas e where e.id = empresa_id and e.user_id = auth.uid()));

-- ============================================================
-- AUTO-SEED: quando alguém cria uma conta, já nasce com o
-- perfil, as configurações padrão e as 20 empresas de demonstração
-- (mesmos dados do protótipo — nenhum dado real é raspado).
-- ============================================================
create or replace function public.handle_new_leadscope_user()
returns trigger as $$
declare
  v_radar_id uuid;
  v_emp1 uuid;
  v_emp2 uuid;
  v_emp3 uuid;
  v_emp4 uuid;
  v_emp5 uuid;
  v_emp6 uuid;
  v_emp7 uuid;
  v_emp8 uuid;
  v_emp9 uuid;
  v_emp10 uuid;
  v_emp11 uuid;
  v_emp12 uuid;
  v_emp13 uuid;
  v_emp14 uuid;
  v_emp15 uuid;
  v_emp16 uuid;
  v_emp17 uuid;
  v_emp18 uuid;
  v_emp19 uuid;
  v_emp20 uuid;
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)), new.email);

  insert into public.account_settings (user_id) values (new.id);

  -- radar padrão de demonstração
  v_radar_id := gen_random_uuid();
  INSERT INTO public.radares (id, user_id, nome, segmento, cidade, criado_em)
  VALUES (v_radar_id, NEW.id, 'Clínicas odontológicas — Sorocaba, SP', 'Clínica Odontológica', 'Sorocaba, SP', now());

  -- Clínica Sorriso Sorocaba
  v_emp1 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp1, NEW.id, v_radar_id, 'Clínica Sorriso Sorocaba', 'Clínica Odontológica', 'Sorocaba, SP', 'Campolim', 'Rua das Flores, 102 - Campolim, Sorocaba, SP', '(15) 98000-1000', 'www.clinicasorrisoso.com.br', ARRAY['Instagram','Facebook'], 4.6, 12, 92, 'Alta', 'alto', 'Nova', 'venda', CURRENT_DATE - 1, 'Implementação de agendamento online integrado ao WhatsApp', ARRAY['agendamento','formulario']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp1, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-09-22', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp1, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-09-18', 'Média');

  -- OdontoVida Sorocaba
  v_emp2 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp2, NEW.id, v_radar_id, 'OdontoVida Sorocaba', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim Vergueiro', 'Rua Barão de Suruí, 119 - Jardim Vergueiro, Sorocaba, SP', '(15) 98137-1231', 'www.odontovidasoroca.com.br', ARRAY['Instagram','Facebook'], 4.6, 24, 88, 'Alta', 'alto', 'Nova', NULL, CURRENT_DATE - 2, 'Revisão da jornada de agendamento e página de conversão', ARRAY['formulario','perfilIncompleto']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp2, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-09-20', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp2, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-09-16', 'Média');

  -- Dental Excellence
  v_emp3 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp3, NEW.id, v_radar_id, 'Dental Excellence', 'Clínica Odontológica', 'Sorocaba, SP', 'Éden', 'Rua Fernando Prestes, 136 - Éden, Sorocaba, SP', '(15) 98274-1462', 'www.dentalexcellence.com.br', ARRAY['Instagram','Facebook'], 4.6, 36, 85, 'Alta', 'alto', 'Em análise', NULL, CURRENT_DATE - 3, 'Plano de conteúdo e presença em redes sociais', ARRAY['perfilIncompleto','avaliacaoDemora']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp3, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-09-18', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp3, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-09-14', 'Média');

  -- Clínica Bem Estar Odonto
  v_emp4 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp4, NEW.id, v_radar_id, 'Clínica Bem Estar Odonto', 'Clínica Odontológica', 'Sorocaba, SP', 'Vila Hortência', 'Rua Fabrício Vampré, 153 - Vila Hortência, Sorocaba, SP', '(15) 98411-1693', 'www.clinicabemestaro.com.br', ARRAY['Instagram','Facebook'], 4.6, 33, 81, 'Alta', 'alto', 'Priorizada', NULL, CURRENT_DATE - 4, 'Gestão de reputação e resposta a avaliações', ARRAY['avaliacaoDemora','semResposta']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp4, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-09-16', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp4, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-09-12', 'Média');

  -- Sorocaba Odonto Center
  v_emp5 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp5, NEW.id, v_radar_id, 'Sorocaba Odonto Center', 'Clínica Odontológica', 'Sorocaba, SP', 'Centro', 'Rua Doutor Salles, 170 - Centro, Sorocaba, SP', '(15) 98548-1924', 'www.sorocabaodontoce.com.br', ARRAY['Instagram','Facebook'], 4.1, 45, 78, 'Alta', 'alto', 'Nova', NULL, CURRENT_DATE - 5, 'Gestão de reputação e resposta a avaliações', ARRAY['semResposta','mobileRuim','semWhats']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp5, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-09-14', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp5, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-09-10', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp5, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-09-06', 'Média');

  -- Espaço Dental Premium
  v_emp6 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp6, NEW.id, v_radar_id, 'Espaço Dental Premium', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim Simus', 'Rua Padre Antônio Vieira, 187 - Jardim Simus, Sorocaba, SP', '(15) 98685-2155', 'www.espacodentalprem.com.br', ARRAY['Instagram','Facebook'], 4.1, 57, 74, 'Alta', 'alto', 'Abordagem preparada', NULL, CURRENT_DATE - 6, 'Redesign do site com foco em dispositivos móveis', ARRAY['mobileRuim','semWhats','semPublicacao']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp6, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-09-12', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp6, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-09-08', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp6, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-09-04', 'Média');

  -- OdontoMais
  v_emp7 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp7, NEW.id, v_radar_id, 'OdontoMais', 'Clínica Odontológica', 'Sorocaba, SP', 'Vila Barão', 'Rua Riachuelo, 204 - Vila Barão, Sorocaba, SP', '(15) 98822-2386', 'www.odontomais.com.br', ARRAY['Instagram','Facebook'], 4.1, 54, 71, 'Alta', 'alto', 'Contatada', NULL, CURRENT_DATE - 7, 'Implementação de agendamento online integrado ao WhatsApp', ARRAY['semWhats','semPublicacao','agendamento']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp7, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-09-10', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp7, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-09-06', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp7, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-09-02', 'Média');

  -- Clínica Dr. Ricardo Fontes
  v_emp8 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp8, NEW.id, v_radar_id, 'Clínica Dr. Ricardo Fontes', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim Santa Rosália', 'Rua Ipanema, 221 - Jardim Santa Rosália, Sorocaba, SP', '(15) 98959-2617', 'www.clinicadrricardo.com.br', ARRAY['Instagram','Facebook'], 4.1, 66, 68, 'Alta', 'medio', 'Nova', NULL, CURRENT_DATE - 8, 'Plano de conteúdo e presença em redes sociais', ARRAY['semPublicacao','agendamento','formulario']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp8, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-09-08', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp8, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-09-04', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp8, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-08-31', 'Média');

  -- Sorriso Perfeito Odontologia
  v_emp9 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp9, NEW.id, v_radar_id, 'Sorriso Perfeito Odontologia', 'Clínica Odontológica', 'Sorocaba, SP', 'Zona Norte', 'Rua Coronel Aureliano, 238 - Zona Norte, Sorocaba, SP', '(15) 99096-2848', 'www.sorrisoperfeitoo.com.br', ARRAY['Instagram','Facebook'], 4.1, 78, 65, 'Alta', 'medio', 'Respondeu', NULL, CURRENT_DATE - 9, 'Implementação de agendamento online integrado ao WhatsApp', ARRAY['agendamento','formulario','perfilIncompleto']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp9, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-09-06', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp9, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-09-02', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp9, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-08-29', 'Média');

  -- Vitalle Odonto
  v_emp10 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp10, NEW.id, v_radar_id, 'Vitalle Odonto', 'Clínica Odontológica', 'Sorocaba, SP', 'Parque Campolim', 'Rua Doutor Aureliano Barbosa, 255 - Parque Campolim, Sorocaba, SP', '(15) 99233-3079', 'www.vitalleodonto.com.br', ARRAY['Instagram','Facebook'], 4.1, 75, 61, 'Alta', 'medio', 'Priorizada', NULL, CURRENT_DATE - 10, 'Revisão da jornada de agendamento e página de conversão', ARRAY['formulario','perfilIncompleto','avaliacaoDemora']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp10, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-09-04', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp10, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-08-31', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp10, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-27', 'Média');

  -- Clínica Odontológica Santa Fé
  v_emp11 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp11, NEW.id, v_radar_id, 'Clínica Odontológica Santa Fé', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim Maria Eugênia', 'Rua das Flores, 272 - Jardim Maria Eugênia, Sorocaba, SP', '(15) 99370-3310', 'www.clinicaodontolog.com.br', ARRAY['Instagram','Facebook'], 3.5, 87, 58, 'Média', 'medio', 'Em análise', NULL, CURRENT_DATE - 11, 'Plano de conteúdo e presença em redes sociais', ARRAY['perfilIncompleto','avaliacaoDemora','semResposta','mobileRuim']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp11, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-09-02', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp11, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-29', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp11, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-08-25', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp11, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-08-21', 'Baixa');

  -- OdontoPrime
  v_emp12 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp12, NEW.id, v_radar_id, 'OdontoPrime', 'Clínica Odontológica', 'Sorocaba, SP', 'Vila Fiori', 'Rua Barão de Suruí, 289 - Vila Fiori, Sorocaba, SP', '(15) 99507-3541', 'www.odontoprime.com.br', ARRAY['Instagram','Facebook'], 3.5, 99, 55, 'Média', 'medio', 'Nova', NULL, CURRENT_DATE - 12, 'Gestão de reputação e resposta a avaliações', ARRAY['avaliacaoDemora','semResposta','mobileRuim','semWhats']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp12, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-31', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp12, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-08-27', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp12, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-08-23', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp12, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-08-19', 'Baixa');

  -- Dental Care Sorocaba
  v_emp13 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp13, NEW.id, v_radar_id, 'Dental Care Sorocaba', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim América', 'Rua Fernando Prestes, 306 - Jardim América, Sorocaba, SP', '(15) 99644-3772', 'www.dentalcaresoroca.com.br', ARRAY['Instagram','Facebook'], 3.5, 96, 52, 'Média', 'medio', 'Reunião agendada', NULL, CURRENT_DATE - 13, 'Gestão de reputação e resposta a avaliações', ARRAY['semResposta','mobileRuim','semWhats','semPublicacao']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp13, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-08-29', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp13, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-08-25', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp13, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-08-21', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp13, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-08-17', 'Baixa');

  -- Clínica Odonto União
  v_emp14 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp14, NEW.id, v_radar_id, 'Clínica Odonto União', 'Clínica Odontológica', 'Sorocaba, SP', 'Alto da Boa Vista', 'Rua Fabrício Vampré, 323 - Alto da Boa Vista, Sorocaba, SP', '(15) 99781-4003', 'www.clinicaodontouni.com.br', ARRAY['Instagram','Facebook'], 3.5, 108, 48, 'Média', 'medio', 'Nova', NULL, CURRENT_DATE - 14, 'Redesign do site com foco em dispositivos móveis', ARRAY['mobileRuim','semWhats','semPublicacao','agendamento']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp14, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-08-27', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp14, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-08-23', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp14, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-08-19', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp14, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-08-15', 'Baixa');

  -- Espaço Sorriso Odontologia
  v_emp15 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp15, NEW.id, v_radar_id, 'Espaço Sorriso Odontologia', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim Faculdade', 'Rua Doutor Salles, 340 - Jardim Faculdade, Sorocaba, SP', '(15) 99918-4234', 'www.espacosorrisoodo.com.br', ARRAY['Instagram','Facebook'], 3.5, 120, 45, 'Média', 'medio', 'Contatada', NULL, CURRENT_DATE - 15, 'Implementação de agendamento online integrado ao WhatsApp', ARRAY['semWhats','semPublicacao','agendamento','formulario']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp15, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-08-25', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp15, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-08-21', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp15, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-08-17', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp15, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-08-13', 'Baixa');

  -- OdontoLife
  v_emp16 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp16, NEW.id, v_radar_id, 'OdontoLife', 'Clínica Odontológica', 'Sorocaba, SP', 'Vila Haro', 'Rua Padre Antônio Vieira, 357 - Vila Haro, Sorocaba, SP', '(15) 910055-4465', 'www.odontolife.com.br', ARRAY['Instagram','Facebook'], 2.7, 117, 38, 'Média', 'baixo', 'Descartada', NULL, CURRENT_DATE - 16, 'Plano de conteúdo e presença em redes sociais', ARRAY['semPublicacao','agendamento','formulario','perfilIncompleto','avaliacaoDemora']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp16, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-08-23', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp16, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-08-19', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp16, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-08-15', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp16, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-08-11', 'Baixa');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp16, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-07', 'Baixa');

  -- Clínica Dental Nova Aliança
  v_emp17 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp17, NEW.id, v_radar_id, 'Clínica Dental Nova Aliança', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim Pagliato', 'Rua Riachuelo, 374 - Jardim Pagliato, Sorocaba, SP', '(15) 910192-4696', 'www.clinicadentalnov.com.br', ARRAY['Instagram','Facebook'], 2.7, 129, 34, 'Média', 'baixo', 'Nova', NULL, CURRENT_DATE - 17, 'Implementação de agendamento online integrado ao WhatsApp', ARRAY['agendamento','formulario','perfilIncompleto','avaliacaoDemora','semResposta']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp17, 'Site não possui sistema de agendamento online visível', 'Site institucional', '2026-08-21', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp17, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-08-17', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp17, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-08-13', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp17, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-09', 'Baixa');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp17, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-08-05', 'Baixa');

  -- Sorriso & Saúde Odontologia
  v_emp18 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp18, NEW.id, v_radar_id, 'Sorriso & Saúde Odontologia', 'Clínica Odontológica', 'Sorocaba, SP', 'Vila Trujillo', 'Rua Ipanema, 391 - Vila Trujillo, Sorocaba, SP', '(15) 910329-4927', 'www.sorrisosaudeodon.com.br', ARRAY['Instagram','Facebook'], 2.7, 141, 29, 'Média', 'baixo', 'Cliente', NULL, CURRENT_DATE - 18, 'Revisão da jornada de agendamento e página de conversão', ARRAY['formulario','perfilIncompleto','avaliacaoDemora','semResposta','mobileRuim']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp18, 'Formulário de contato apresentou erro ao ser testado', 'Site institucional', '2026-08-19', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp18, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-08-15', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp18, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-11', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp18, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-08-07', 'Baixa');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp18, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-08-03', 'Baixa');

  -- OdontoBem
  v_emp19 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp19, NEW.id, v_radar_id, 'OdontoBem', 'Clínica Odontológica', 'Sorocaba, SP', 'Jardim Represa', 'Rua Coronel Aureliano, 408 - Jardim Represa, Sorocaba, SP', '(15) 910466-5158', 'www.odontobem.com.br', ARRAY['Instagram','Facebook'], 2.7, 138, 22, 'Média', 'baixo', 'Nova', NULL, CURRENT_DATE - 19, 'Plano de conteúdo e presença em redes sociais', ARRAY['perfilIncompleto','avaliacaoDemora','semResposta','mobileRuim','semWhats']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp19, 'Perfil comercial possui informações incompletas (horário ou categoria)', 'Perfil comercial', '2026-08-17', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp19, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-13', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp19, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-08-09', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp19, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-08-05', 'Baixa');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp19, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-08-01', 'Baixa');

  -- Clínica Odontológica Nova Era
  v_emp20 := gen_random_uuid();
  INSERT INTO public.empresas (id, user_id, radar_id, nome, segmento, cidade, bairro, endereco, telefone, site, redes, nota, avaliacoes, score, confianca, potencial, status, resultado, ultima_atualizacao, servico_recomendado, sinais_keys)
  VALUES (v_emp20, NEW.id, v_radar_id, 'Clínica Odontológica Nova Era', 'Clínica Odontológica', 'Sorocaba, SP', 'Vossoroca', 'Rua Doutor Aureliano Barbosa, 425 - Vossoroca, Sorocaba, SP', '(15) 910603-5389', 'www.clinicaodontolog.com.br', ARRAY['Instagram','Facebook'], 2.7, 150, 15, 'Média', 'baixo', 'Em análise', NULL, CURRENT_DATE - 20, 'Gestão de reputação e resposta a avaliações', ARRAY['avaliacaoDemora','semResposta','mobileRuim','semWhats','semPublicacao']);

  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp20, 'Foram encontradas avaliações recentes mencionando demora no atendimento', 'Avaliações públicas', '2026-08-15', 'Alta');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp20, 'Empresa não responde às avaliações recebidas', 'Avaliações públicas', '2026-08-11', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp20, 'Site apresenta baixa qualidade de navegação em dispositivos móveis', 'Site institucional', '2026-08-07', 'Média');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp20, 'Canal de WhatsApp não está visível no site', 'Site institucional', '2026-08-03', 'Baixa');
  INSERT INTO public.evidencias (empresa_id, texto, fonte, data, confianca) VALUES (v_emp20, 'Última publicação em redes sociais ocorreu há vários meses', 'Redes sociais', '2026-07-30', 'Baixa');


  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_leadscope on auth.users;
create trigger on_auth_user_created_leadscope
  after insert on auth.users
  for each row execute function public.handle_new_leadscope_user();

-- Fim do script.

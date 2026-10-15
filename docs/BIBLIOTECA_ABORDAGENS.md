# Biblioteca de abordagens por produto

## Instalação

1. No Supabase, abra SQL Editor, crie uma consulta, cole todo o arquivo `supabase/manual/06_approach_library.sql` e execute. Requer o SQL 05 já aplicado.
2. Atualize o LeadScope após a publicação do frontend. Não é necessário republicar Edge Functions. Não há coleta paga, IA ou envio automático nesta atualização.

## Cadastrar modelos

Configurações › Abordagens › Novo modelo abre o modal. Preencha nome, produto, nichos, canal (WhatsApp/e-mail), tom e mensagem. Use `{empresa}`, `{cidade}`, `{segmento}`, `{produto}` e `{beneficio}`. O campo `{produto}` é obrigatório para evitar abordagens sem identificação da oferta. A prévia usa empresa e cidade ilustrativas, nunca dados inventados sobre um lead.

Você pode criar cinco modelos para Fluency AI, dois para Quantis Lift, ou outras quantidades. Duplicar cria um novo cadastro; editar incrementa a versão. Desmarcar “ativo” retira o modelo de novas pesquisas, sem apagar o histórico. Colaboradores com escrita podem cadastrar e editar; acessos somente leitura não podem. Modelos não são compartilhados entre contas.

## Selecionar no Radar

Na primeira etapa, selecione os produtos. Os modelos ativos aparecem agrupados por produto. Pesquise pelo nome ou nicho e marque um ou vários. Nichos são etiquetas para orientar a seleção humana, não regras automáticas sobre a empresa coletada. Desmarcar um produto remove os modelos dele da seleção. A revisão final lista as abordagens escolhidas. Sem seleção, permanecem os modelos gerais.

Antes de iniciar a coleta, o servidor preserva uma cópia do texto, versão, produto, benefício, canal e tom. Se esta gravação falhar, a coleta não é iniciada. Atualizações posteriores não alteram as cópias já usadas nas pesquisas.

## Usar no diagnóstico

Em Como abordar, escolha um dos modelos vinculados às pesquisas da empresa. O texto é preenchido com dados disponíveis e os dados do produto preservados na pesquisa. Modelos de produtos distintos não são combinados. O modelo autoral não é reescrito pelos botões de tom ou pelo gerador geral; edite a mensagem ou selecione outro modelo.

Campos sem informação permanecem entre chaves e são indicados para revisão. Preencha-os manualmente antes de salvar. Cada modelo mantém seu próprio rascunho na sessão. A opção “Texto salvo / modelos gerais” volta ao conteúdo anterior sem sobrescrever versões.

Salvar versão ou Marcar como utilizada registra o texto final e a referência ao modelo, versão, produto e canal. Marcar utilizada não significa envio nem resposta. Não há métricas de conversão por modelo nesta etapa.

Pesquisas anteriores à biblioteca não recebem modelos retroativamente. Mensagens e histórico existentes não são alterados pelo SQL.

## Verificação local

`node tests/approach-library.mjs` verifica interpolação, isolamento por produto e preservação de rascunhos. Com `LEADSCOPE_PGLITE` apontando para uma instalação de PGlite, também testa o SQL em PostgreSQL isolado: permissões por conta/equipe, somente leitura, campos inválidos, cópias imutáveis, conflitos de edição e instalação repetida. Nenhum teste consome créditos ou altera dados reais.

# Radar e qualificação para ERP

## Instalar

1. Com os SQLs 01, 02 e 03 já instalados, execute **somente** `supabase/manual/04_erp_qualification.sql` no SQL Editor. É transacional e pode ser reaplicado. Não repita os scripts antigos.
2. Execute **Actions → Publicar funções do LeadScope → Run workflow**, na `main`. Atualiza `search-places`, `audit-site` e `reanalyze-opportunities` (o fluxo publica também as demais funções existentes). Não executa SQL nem consome Apify.
3. Atualize a página. Abra uma empresa → **Operação e qualificação**. Preencha e salve; atualize novamente para conferir persistência.

O SQL foi testado em PostgreSQL isolado com dados sintéticos: função real, permissões, validações, preservação da versão e conflito de edição. A instalação e os testes no projeto real ficam a cargo do titular. Não acessamos dados de clientes nem executamos consultas pagas nesta entrega.

## O que muda

- Radar mostra perfil herdado das ofertas, localização por cidade ou região/estado/país e critérios avançados recolhidos. A busca usa a área definida pela localização, não um raio de quilômetros (esse campo anterior não era aplicado pelo provedor).
- Exclusões por nome, descrição e categorias são filtros locais após a coleta, não filtros que economizam créditos. Podem resultar em menos empresas do que a quantidade pedida.
- Contatos do site e amostra de até 5 avaliações recentes são opcionais e começam desligados. Mantido teto de US$ 0,50 por execução. Não altera plano/limite mensal no Apify. O teto não garante cobertura mensal: acompanhe o saldo na conta e não inicie novas execuções sem crédito disponível. O provedor pode interromper a execução antes de completar a quantidade.
- Perfis sociais detalhados, fotos, concorrentes e enriquecimento de pessoas continuam desligados. A coleta de identidade dos avaliadores também foi desativada; textos podem conter dados pessoais publicados pelos autores e precisam ser tratados com cuidado.
- Links de contatos já armazenados passam a aparecer na presença digital, com origem da coleta separada da auditoria. A existência de contato não comprova titularidade ou autorização para marketing.
- Auditoria identifica **menções** na página inicial a locação, máquinas, frota, manutenção, contratos, operador, filiais e orçamento. Cada sinal tem trecho e URL. Não navega páginas internas e não estima frota, faturamento ou dores. Auditorias anteriores precisam ser refeitas para trazer os novos sinais; o cache de 7 dias continua em uso.
- A reanálise cruza também descrições, atividade cadastral com correspondência validada e sinais da auditoria. Não usa as avaliações como prova de dor. É baseada em regras, sem chamada a IA.
- Nova ficha: sistema atual, equipamentos/veículos, usuários, volume mensal, planilhas, necessidade, decisor, prazo e observações. Vazios ficam desconhecidos. Editor/titular podem salvar; acesso somente leitura não pode. Conflito entre editores exige atualizar antes de salvar; a versão anterior permanece no histórico existente.
- A ficha não se mistura aos sinais públicos e não é substituída por uma nova coleta. Mesclagens mantêm os cadastros de origem e suas versões; qualificações de registros mesclados **não são combinadas automaticamente**.

## Score v4

Encaixe tem até 60 pontos; perfil 10, reputação 5, contato 10 e cobertura 15. Prioridade do produto e posição na esteira não aumentam aderência. Sem correspondência com a oferta, uma empresa pode somar no máximo 40 pontos, mesmo com ótima reputação.

A aderência é uma heurística de palavras/categorias, não probabilidade de compra. Menções podem ser de clientes, parceiros ou termos negados: confirme em conversa. Necessidade, decisor e prazo preenchidos significam **informações registradas pelo usuário**, não uma validação independente.

Scores antigos não são modificados automaticamente. Depois de publicar as funções, selecione grupos de até 100 empresas e clique em **Reanalisar**, sem nova consulta externa. O histórico das análises anteriores é preservado. Após nova auditoria, reanalise para incorporar os sinais operacionais ao score.

## Conferir antes de usar em equipe

Teste salvamento como titular/editor, bloqueio de viewer, e duas abas tentando editar a mesma ficha. Em histórico de versões, confira a qualificação anterior. Faça uma coleta pequena somente se desejar gastar os créditos autorizados e confira os campos realmente retornados: disponibilidade varia por empresa e provedor.

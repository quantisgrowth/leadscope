# Pesquisas rastreáveis, radar por etapas e dashboard visual

## Instalação na conta existente

1. Faça backup. Após os SQLs 01–04 já aplicados, execute **somente** `supabase/manual/05_radar_results.sql` no SQL Editor do Supabase. Não repita os scripts antigos. O SQL 05 é transacional e pode ser reaplicado.
2. No GitHub, Actions → **Publicar funções do LeadScope** → Run workflow → branch `main`. Confirme a instalação anterior e o novo campo de confirmação do SQL 05.
3. Aguarde sucesso e atualize o LeadScope. Antes da instalação, os indicadores antigos continuam funcionando; resultados de pesquisa/versões novas aparecem como indisponíveis. Nova coleta exige tabela instalada e função com `research_version=1`; a aplicação não gasta créditos em uma implantação incompleta.

Nenhum SQL é executado pelo workflow. Nenhuma coleta é iniciada por publicar funções. O SQL foi exercitado em PostgreSQL isolado; o responsável aplica no projeto real.

## O que será registrado

Cada resultado efetivamente retornado pela execução terá fotografia dos campos públicos necessários, critérios, motivos, preferências e identificadores da pesquisa. Categorias pesquisadas e encontradas são distintas. Campos desconhecidos não viram zero.

Decisões originais: nova na carteira, já cadastrada, fora dos critérios ou com erro. Duplicidade reaproveita o cadastro sem substituir estágio, pastas e qualificação comercial. Repetir a consulta de status não repete a gravação do mesmo item. Empresa, componentes, ofertas, canais, evidências e resultado aceito são gravados na mesma transação. Um erro em um item desfaz essa transação e mantém um resultado com erro genérico, sem expor respostas de infraestrutura.

Descartes não entram em Oportunidades. Em Radar → Resultados das pesquisas, selecione a execução e filtre decisões ou nomes. **Aproveitar resultado** cria ou vincula o cadastro, registra autor/data e preserva o descarte original. Se já houver cadastro, a revisão não substitui dados recentes por fotografia antiga. Perfil inválido e encerramento permanente não têm aproveitamento liberado. Não existe exclusão definitiva pela aplicação.

O histórico vale para novas coletas. Não reconstituímos descartes antigos, dados que o provedor não retornou ou todas as empresas de uma cidade. Executamos uma coleta limitada, sem ampliá-la automaticamente para compensar descartes. Execuções parciais podem ter resultados já gravados; o status e os erros devem ser conferidos. “Consultar execução em andamento” apenas acompanha a execução existente, sem iniciar outra.

Snapshots minimizam dados: não armazenam nome, perfil nem foto de avaliadores. Uma amostra opcional de texto pode conter dados pessoais publicados pelo próprio autor; usar somente para a finalidade comercial permitida e definir uma política de retenção conforme a operação. O SQL não instala limpeza automática que apague histórico. Resultados e versões só são acessíveis à conta e seus colaboradores; somente titular/editor podem escrever.

## Critérios do radar

O formulário tem quatro passos: quem buscar, onde buscar, critérios e revisão. O limite se refere a resultados coletados, não empresas aprovadas.

- **Obrigatório:** descarta se não atender ou se o dado estiver ausente.
- **Preferência:** destaca e ordena os resultados da pesquisa por quantidade de preferências atendidas, sem eliminar os demais nem alterar artificialmente o score do ERP.
- **Não aplicar:** ignora o critério.

Categoria obrigatória compara nomes públicos exatos, normalizando acentos e maiúsculas. Um termo de busca não necessariamente é uma categoria oficial; não ativar obrigatoriedade sem conferir o nome. As sugestões são a lista curada e categorias já coletadas, não uma sincronização de todo o catálogo do Google.

Exclusões usam nome, descrição e categorias: são uma verificação textual, não uma compreensão por IA. Termos complementares ajudam a consulta no provedor; não obrigam cada empresa retornada a conter todos os termos. A nota mínima é inclusiva; mínimo de 11 avaliações significa mais de 10. Dados ausentes ficam identificados, especialmente em preferências.

Todos esses filtros são pós-coleta: não economizam o custo dos registros excluídos. Contatos e textos de avaliações continuam opcionais. Teto por execução de US$ 0,50; limite mensal e plano do Apify não são alterados. A aplicação não controla o saldo mensal da conta: acompanhe o saldo antes de iniciar coletas.

## Dashboard

Cartões enxutos, evolução em colunas, distribuição dos resultados em rosca, etapas comerciais e cobertura em barras. Definições, tabela acessível do gráfico e movimentações ficam em detalhes expansíveis. Nenhum dado de demonstração é inserido.

Os cartões principais abrem exatamente as empresas daquele indicador/período, incluindo arquivadas quando fazem parte do histórico. A lista mostra o recorte e tem “Ver carteira completa” para removê-lo. Conversão abre as empresas convertidas da coorte, não clientes antigos.

Indicadores comerciais contam empresas únicas; resultados de pesquisas contam ocorrências (uma empresa pode voltar em pesquisas diferentes). Uma empresa com nota alta não é comercialmente qualificada. “Qualificação preenchida” exige necessidade, decisor e prazo registrados; não é verificação independente. “Cliente” significa negócio registrado no CRM, não receita recebida. Conversão considera a coorte de cadastros novos que entrou em Cliente no mesmo período; não divide clientes antigos por leads novos. Análises usam a última data explícita disponível, não reconstituem todas as análises antigas.

## Como abordar

Modelos determinísticos com três variações por tom. Todas as nove sugestões incluem o nome da empresa, o produto associado ao diagnóstico e seu resultado cadastrado. A tela mostra o produto e o benefício usados como referência. Sem produto ativo ou resultado preenchido, não é gerada uma abordagem genérica: a tela orienta o preenchimento em Oferta comercial. Auditoria concluída pode fornecer uma menção relacionada ao produto; qualificação manual pode fornecer a necessidade registrada. Não há IA nem envio automático.

Mensagens salvas e rascunhos não são substituídos automaticamente. Para renovar um texto antigo com a referência exibida, use **Outra sugestão do modelo** e depois **Salvar versão**. Esta melhoria do gerador é somente no frontend, sem SQL adicional ou nova publicação de funções.

**Outra sugestão do modelo** varia o texto no mesmo tom. Edições ficam em rascunho durante a sessão. **Salvar versão** mantém texto, tom, origem (modelo/editada), autor e data. **Marcar como utilizada** também salva uma versão; não marca contato, envio ou resposta automaticamente. O primeiro salvamento preserva o texto anterior existente como “Texto anterior preservado”; sua data é a captura, não uma data de criação inventada. Conflitos entre editores não sobrescrevem a mensagem alheia. A tela mostra as últimas 20 versões; as demais permanecem no banco.

## Verificação

Testes locais: `node tests/radar-results.mjs`, além da suíte anterior. PostgreSQL opcional: `LEADSCOPE_PGLITE=/caminho/para/pglite/dist/index.js node tests/radar-results.mjs`. Browser QA opcional segue as variáveis usadas nos testes existentes. Os fixtures não acessam dados de clientes nem consomem créditos.

Após instalar, faça uma coleta pequena se desejar usar créditos: confira total retornado, cada decisão e seus motivos. Teste uma revisão, reconsulta de status sem duplicar histórico, conta somente leitura e duas abas tentando salvar a mesma mensagem.

# Instalação: histórico, pastas e convites

## Atualização de radar e ERP

O novo radar, a ficha comercial e o score v4 estão descritos em [Qualificação para ERP](QUALIFICACAO_ERP.md). Para habilitar o salvamento da ficha, aplique somente o SQL 04 após os SQLs anteriores e publique novamente as funções pelo fluxo manual. Não repita os SQLs 01–03.

Esta entrega altera somente o repositório. Nenhum SQL foi executado no projeto remoto, nenhuma função foi publicada no Supabase e nenhum convite real foi enviado.

## 1. SQLs

Faça uma cópia de segurança antes da instalação. No SQL Editor do projeto já existente, execute nesta ordem, uma única vez:

1. `supabase/manual/01_history_and_collection.sql`
2. `supabase/manual/02_team_access.sql`

São scripts transacionais. Se ocorrer erro, não continue com o segundo script ou com a publicação das funções. Revise o erro e a versão das migrações anteriores. Estes scripts não substituem o schema inicial nem as migrações antigas. Eles não foram executados ou validados em um banco nesta entrega.

O primeiro registra uma versão inicial dos cadastros atuais, acrescenta histórico de versões, vínculos com múltiplos radares, coleta protegida e reanálise transacional. Bloqueia exclusões definitivas de empresas, ofertas e radares para usuários da aplicação. Não recupera análises que já foram apagadas antes desta atualização.

O segundo cria colaboradores e convites e autoriza acesso compartilhado por conta. Somente o titular gerencia convites e mesclagens. Colaborador pode editar dados comerciais; somente leitura não pode escrever. Ambos ficam sem acesso às integrações administrativas. A gestão de configurações da conta continua restrita ao titular. A identidade e titularidade dos registros não podem ser reassociadas pela API.

## 2. Funções de servidor — obrigatório, SQL sozinho não envia e-mail

Publique os diretórios atualizados, incluindo a dependência `supabase/functions/_shared/account.ts`:

- `search-places`
- `search-google-places` (fluxo legado, para não deixar uma rota sem proteção)
- `reanalyze-opportunities`
- `audit-site`
- `validate-cnpj`
- `team-invitations` (nova)

Mantenha a verificação de JWT habilitada. Se usar o editor do painel, preserve o import relativo `../_shared/account.ts`, o arquivo compartilhado e o `deno.json` de cada função. Com a CLI configurada, use `supabase functions deploy NOME --project-ref nlzlbrfwaloyxksaevne` para cada nome acima, a partir da raiz do projeto. Não use `--no-verify-jwt`.

Até os SQLs e as funções serem instalados, os convites e as novas proteções de servidor não estão ativos. A interface pode aparecer antes da instalação porque é hospedada separadamente no GitHub Pages. Instale tudo na mesma janela de manutenção.

### Publicação pelo GitHub, sem instalar a CLI no computador

O repositório inclui o fluxo manual **Publicar funções do LeadScope**. Ele publica somente as seis funções acima no projeto `nlzlbrfwaloyxksaevne`, com suas dependências e verificação de JWT. Não executa SQL, não altera limites de cobrança, não envia convites e não consulta o Apify. Segue a [orientação oficial de publicação via GitHub Actions](https://supabase.com/docs/guides/functions/deploy#github-actions).

1. Após aplicar os dois SQLs com sucesso, gere um token de acesso pessoal no [Supabase](https://supabase.com/dashboard/account/tokens). Não use a chave pública nem a chave `service_role` para essa etapa. O token concede acesso administrativo à conta: mantenha-o privado e revogue-o quando não precisar mais.
2. No GitHub, abra **Settings → Secrets and variables → Actions → New repository secret** e salve o token com o nome `SUPABASE_ACCESS_TOKEN`. Nunca cole o token em arquivos, commits ou mensagens.
3. Configure também os três Secrets de e-mail descritos na próxima seção, exclusivamente no Supabase.
4. Abra **Actions → Publicar funções do LeadScope → Run workflow**, escolha `main`, marque a confirmação de que os SQLs foram aplicados e execute.
5. Aguarde todas as etapas ficarem verdes. Se falhar, não considere a publicação concluída: funções publicadas antes da falha podem já ter sido atualizadas. Corrija a causa e execute novamente o fluxo (não os SQLs).
6. Confira as funções no painel do Supabase e execute o roteiro de testes abaixo. O sucesso da publicação não comprova a entrega de e-mail ou o funcionamento real das permissões.

O fluxo é exclusivamente manual; um novo commit não publica automaticamente no Supabase. O GitHub Pages continua sendo responsável apenas pela interface.

## Cadastro por convite: atualização de 01/10/2026

Novos convidados agora podem cadastrar senha sem envio de e-mail, com aprovação manual do titular. Aplique também o SQL 03 e publique a nova função. As instruções atuais estão em [Cadastro por convite](CADASTRO_POR_CONVITE.md); elas substituem, para novos convidados, as referências abaixo à confirmação obrigatória por mensagem. Não desligue a confirmação global. O SMTP continua necessário para recuperação de senha e outros fluxos de e-mail.

## 3. Configuração de e-mail

### Alternativa sem remetente verificado: copiar link

Em **Configurações → Usuários**, informe o e-mail e o papel e clique em **Gerar link de convite → Copiar link**. Envie manualmente pelo WhatsApp ou outro canal privado. Esta opção não utiliza Resend, não envia e-mail e funciona sem `RESEND_API_KEY` ou `INVITE_FROM_EMAIL`. A URL padrão do LeadScope já está definida no servidor; `LEADSCOPE_SITE_URL` continua opcional para links, mas, se configurada, deve usar HTTPS.

Somente o titular gera ou renova links. O destinatário precisa entrar com o mesmo e-mail confirmado no Supabase Auth, e clicar em Aceitar convite. O link expira em sete dias; revogação bloqueia a aceitação. Na lista, **Gerar novo link** espera pelo menos um minuto, preserva e-mail/papel e invalida o link anterior. O token original não fica salvo no banco nem no armazenamento do navegador do titular; somente seu hash é persistido. Copie antes de fechar o painel.

Não é necessário executar nenhum SQL adicional ou reaplicar os SQLs 01/02. Publique novamente as funções pelo fluxo do GitHub Actions após este ajuste. O status interno `sent` significa convite emitido, inclusive quando entregue manualmente; a interface exibe **Pendente de aceitação**, não confirmação de envio de e-mail.

**Limite importante:** compartilhar o convite por link não substitui a confirmação de e-mail do cadastro. Usuários já confirmados podem aceitar sem Resend. Para novos usuários, o Supabase Auth ainda precisa conseguir enviar a confirmação; o SMTP padrão possui restrições e não é adequado para produção. Não desligue a verificação para contornar isso. Consulte a [documentação de SMTP do Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

### Envio por e-mail (opcional)

A nova função utiliza Resend para o convite, sem contratar serviço automaticamente. Se não houver conta ou domínio verificado, configure-os antes de usar. Guarde exclusivamente nos Secrets das funções:

- `RESEND_API_KEY`: chave de envio do seu serviço Resend.
- `INVITE_FROM_EMAIL`: remetente autorizado, por exemplo `LeadScope <convites@seu-dominio.com.br>`.
- `LEADSCOPE_SITE_URL`: `https://quantisgrowth.github.io/leadscope/`.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` devem estar disponíveis no ambiente das funções; nunca copie a chave privilegiada para o HTML. Não inclua Secrets no GitHub.

Valide o remetente/domínio no provedor e configure os registros DNS informados por ele. Os e-mails de confirmação de cadastro e recuperação de senha continuam usando Supabase Auth: confira também o SMTP desse fluxo e Site URL/Redirect URLs. Uma configuração não substitui a outra.

“Aceito pelo serviço de envio” não comprova entrega na caixa de entrada. Falhas aparecem na lista; consulte os eventos do provedor se o e-mail não chegar. Reenvio é manual, espera pelo menos um minuto e invalida o link anterior. Não existe retry automático de um envio com resultado incerto.

## 4. Fluxo de convite

1. O titular abre Configurações → Usuários, escolhe e-mail e papel e clica em Gerar link de convite (entrega manual) ou Enviar por e-mail (requer configuração do remetente).
2. O destinatário abre o link. Se já tiver conta, entra com esse e-mail; se não tiver, faz cadastro, define senha e confirma o e-mail.
3. Depois da confirmação, se necessário reabre o link original e clica em Aceitar convite. Abrir o link sozinho não aceita o convite.
4. O servidor compara o destinatário com o e-mail confirmado no Auth e vincula a conta compartilhada. Não concede administração da plataforma.

Convites expiram em sete dias. Revogar convite impede aceitação; Remover acesso encerra o vínculo de colaborador. Usuários com empresas/radares próprios ou outro vínculo não são migrados silenciosamente: a aceitação informa que precisam de revisão assistida. Esta primeira versão permite um vínculo compartilhado por usuário, sem seletor de várias contas.

## 5. Organização e histórico

- A Visão geral usa apenas cadastros, datas explícitas de coleta/análise, auditorias e transições comerciais disponíveis. O seletor 7/30/90 dias ou Todo o histórico afeta os indicadores e movimentações do dashboard; a posição atual da carteira é mostrada separadamente e não depende do período.
- As métricas contam empresas únicas, não número de tentativas ou reuniões. Entradas repetidas na mesma etapa contam uma empresa no período. Uma entrada em Cliente não presume contato, resposta ou reunião anterior. Registros iniciais sem etapa anterior não datam uma conversão.
- Arquivadas permanecem nos resultados históricos; mescladas são agrupadas pelo cadastro principal. A conversão usa somente empresas criadas no período que tiveram entrada registrada em Cliente nesse mesmo período. Cliente significa negócio registrado no CRM, não comprovação de pagamento. Receita, ticket realizado e quantidade de reuniões não são inventados.
- A leitura de empresas, evidências, auditorias, componentes de score e histórico comercial é paginada. Falhas não exibem dados parciais como completos: os indicadores afetados ficam indisponíveis. O dashboard avisa sobre histórico legado ou datas ausentes. Não há SQL novo nesta atualização.

- Oportunidades, Diagnósticos e Empresas monitoradas compartilham busca, pastas, filtros, Tabela/Cards/Funil e exportação CSV das selecionadas ou dos resultados filtrados. Cada tela mantém seus próprios filtros, página e visualização no navegador; voltar do detalhe preserva a lista de origem.
- Os contadores e exportações respeitam a tela: Monitoradas inclui somente empresas acompanhadas; Diagnósticos inclui cadastros com score e data de análise disponíveis. Seleções são limpas ao trocar de tela para evitar ações em outra lista.
- Não há alertas simulados nem verificação automática nesta atualização. Monitoramento organiza empresas de interesse; reanalisar continua sendo uma ação manual. Esta alteração de interface não exige SQL ou publicação de funções e não inicia consumo externo.
- Oportunidades prioriza a carteira e o funil comercial. Diagnósticos tem tabela/cards próprios, evidências com fonte, datas de análise/auditoria e pendências. A terceira visão de Diagnósticos é o quadro de Validação, não o funil comercial. O filtro de validação indica a primeira pendência: evidências, auditoria ou cadastro; “Verificações registradas” não certifica a empresa nem dispensa revisão humana. O CSV de Diagnósticos acrescenta essas informações. Reanálise e organização em pastas permanecem disponíveis; priorização, monitoramento e arquivamento em massa ficam nas telas comerciais.

- “Todas” continua mostrando toda a carteira ativa; “Sem pasta” mostra apenas registros ainda não organizados.
- Novas coletas não alteram status, mensagens, resultado, arquivamento, monitoramento, pastas ou data original de criação. Dados públicos ausentes não apagam os campos de contato já existentes.
- CNPJ, telefone, domínio e endereço continuam sendo sinais de revisão, não critérios de mesclagem automática. A coleta bloqueia repetição pelo identificador da origem ou Google e mantém um cadastro estável sob concorrência. Identificadores inteiramente diferentes ainda podem representar a mesma empresa e exigem revisão.
- Mesclar neste cadastro é exclusivo do titular. Mantém o cadastro principal, copia pastas e vínculos de radar e arquiva a origem sem apagá-la. CNPJs diferentes são bloqueados. O registro arquivado continua guardando seus contatos, mensagens, evidências, diagnósticos e histórico comercial; eles não sobrescrevem o principal. Não há desfazer automático.
- O histórico de versões mostra até 30 versões mais recentes, incluindo as origens mescladas. As versões mais antigas permanecem no banco. O histórico comercial da origem pode ser consultado no registro arquivado/banco; não é misturado ao funil do principal nesta versão.

## 6. Roteiro de testes para você executar

- Repita uma busca: confira que o total de cadastros não cresce para os mesmos identificadores. Priorize uma empresa antes da segunda coleta e confirme que seu status, mensagem, pasta e data de criação permanecem.
- Execute buscas simultâneas e confira o cadastro único e os vínculos com os dois radares. Resultados externos ainda podem consumir crédito: faça isso somente se desejar.
- Reanalise e confira os componentes atuais, as recomendações mais recentes e as versões anteriores no banco. Simule falha na reanálise em ambiente de teste: a transação não deve deixar apenas metade da análise gravada.
- Coloque uma empresa em pasta: ela sai de “Sem pasta”, permanece em “Todas” e entra na pasta. Remova da pasta e confira o retorno.
- Arquive e restaure. Uma origem mesclada não pode ser desarquivada enquanto estiver vinculada ao principal.
- Mescle apenas registros de teste: confira preservação da origem, versões, pastas e radares. Novas coletas da identidade antiga devem atualizar o principal.
- Convide e-mails de teste autorizados: novo usuário, existente sem dados, e-mail errado, convite expirado, revogado e reenviado. Confira o provedor, não somente a mensagem do botão.
- Teste titular, editor, somente leitura e uma conta sem vínculo. Verifique tanto a interface quanto requisições diretas: leitura isolada, escrita negada ao leitor, alteração de titularidade negada e acesso administrativo bloqueado.
- Remova um colaborador e confirme que requisições com a sessão antiga não conseguem acessar os dados compartilhados.

Verificações locais disponíveis, sem serviços externos: `node tests/phase4.mjs` e `node tests/team-and-history.mjs`. Elas usam simulações; não substituem os testes do SQL, das permissões reais e da entrega de e-mail.

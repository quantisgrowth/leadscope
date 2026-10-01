# Cadastro por convite com aprovação manual

Este fluxo não precisa de domínio, SMTP ou Resend. Não altera a configuração global de confirmação de e-mail.

1. O titular gera o link em Configurações → Usuários e o compartilha por um canal privado.
2. Quem não tem conta abre o link, informa nome, o e-mail do convite e define a própria senha.
3. O cadastro fica sem sessão e sem acesso à equipe, aguardando aprovação.
4. O titular clica em Atualizar lista e Aprovar cadastro. Antes, confirma a identidade da pessoa por um canal de confiança.
5. A pessoa entra com e-mail e senha e aceita o convite para abrir a equipe.

Usuários que já possuem conta confirmada continuam usando Entrar. Nenhuma senha existente é substituída. Cadastros existentes sem confirmação precisam de revisão assistida; o token não permite tomar posse de uma conta existente.

## Instalação

Depois dos SQLs 01 e 02, aplique uma única vez `supabase/manual/03_manual_invitation_approval.sql`. Não reaplique se já instalado. Publique `team-invitations` com JWT habilitado e `register-invitation` com JWT desabilitado **somente nesta função**: ela autentica pelo token aleatório de 256 bits, exige e-mail correspondente, validade e reserva atômica de uso único.

O fluxo GitHub Actions publica sete funções e exige os três SQLs. Sua execução não aprova pessoas nem cria contas de teste.

## Limites e segurança

- Aprovação manual não comprova a propriedade do e-mail. O Supabase Auth exige ativação técnica (`email_confirm:true`) para login por senha; no servidor registramos `leadscope_activation:approved_manual` e `leadscope_email_identity_verified:false`. Não use `email_confirmed_at` como prova de verificação por mensagem para estes usuários.
- Apenas o titular pode aprovar, com o papel e a identidade vinculados ao convite. Campos editáveis do perfil não concedem permissões.
- A senha vai somente ao Supabase Auth; não é gravada na tabela de convites, logs ou armazenamento local.
- Convites expirados ou revogados não podem ser aprovados. Uma falha de ativação pode ser repetida, mas acesso removido não é recriado por essa repetição.
- Revogar um cadastro pendente não apaga a conta Auth sem acesso; isso preserva rastreabilidade. Falhas interrompidas em “Cadastro em processamento” exigem revisão; não há ativação automática.
- Recuperação de senha por e-mail continua dependendo de SMTP. Esta mudança resolve o cadastro por convite, não o envio de e-mails.

## Validação

Testes locais: `node tests/manual-registration.mjs`, `node tests/team-and-history.mjs` e `node tests/phase4.mjs`.
Verificação pública sem criar contas: `node tests/deployment-smoke.mjs`.

Teste humano: cadastrar por convite → tentar entrar antes da aprovação (negado) → aprovar como titular → entrar → aceitar → conferir permissões. Repita com e-mail incorreto, convite revogado/expirado e remoção de acesso. Não crie contas reais para testar sem consentimento.

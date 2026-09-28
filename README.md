# LeadScope

MVP de inteligência comercial (Signal-Based Outbound) com Supabase.

## Como colocar no ar

1. **Banco de dados**: no painel do Supabase, abra *SQL Editor > New query*, cole todo o conteúdo de `schema.sql` e clique em *Run*.
2. **Auth (opcional, recomendado para o piloto)**: em *Authentication > Providers > Email*, desative "Confirm email" para que novos usuários entrem direto após o cadastro.
3. **Publicar**: suba `index.html` neste repositório e ative *Settings > Pages* (branch `main`, pasta `/root`).
4. Abra a URL do GitHub Pages, crie uma conta e pronto: cada conta já nasce com 1 radar e 20 empresas de demonstração.

## Observações

- A chave `anon` do Supabase é pública por design; a segurança vem das políticas RLS do `schema.sql` (cada usuário só acessa seus dados).
- Nunca coloque a chave `service_role` no front-end.
- Não há coleta automatizada/scraping: os dados são demonstrativos.

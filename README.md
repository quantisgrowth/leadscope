# LeadScope

Plataforma de inteligência comercial para agências, prestadores de serviços e pequenas empresas de software. O primeiro estágio transforma buscas do Google em oportunidades explicáveis, com dados públicos, evidências e score.

## O que esta versão entrega

- Cadastro inicial em 3 etapas, com salvamento a cada avanço.
- Radar real pelo Google Places: segmento + localização + termos opcionais.
- Chave do Google protegida em uma Supabase Edge Function; ela nunca vai para o navegador.
- Empresas, canais públicos, evidências e componentes do score salvos separadamente.
- Score inicial explicável em cinco dimensões: perfil, oportunidade, reputação, contato e confiança.
- RLS e permissões para cada usuário acessar somente os próprios dados.
- Preservação dos dados existentes durante a migração.

## Arquitetura

- `index.html`: aplicação web estática publicada pelo GitHub Pages.
- `supabase/migrations`: evolução versionada do banco.
- `supabase/functions/search-google-places`: integração segura com a Places API (New).
- `schema.sql`: instalação inicial legada, mantida por compatibilidade. Para a versão atual, use as migrações.

## Configuração

Pré-requisitos: projeto Supabase e Google Places API (New) habilitada.

```bash
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase secrets set GOOGLE_MAPS_API_KEY=SUA_CHAVE
npx supabase db push
npx supabase functions deploy search-google-places
```

Não coloque `GOOGLE_MAPS_API_KEY` nem a chave `service_role` no `index.html`. A chave pública/anon do Supabase pode estar no cliente porque a proteção dos registros é feita por autenticação, permissões e RLS.

## Fluxo do produto

1. O usuário informa sua operação e oferta.
2. Define o tipo de empresa e a região desejada.
3. Revisa os dados e abre o primeiro radar.
4. O navegador cria o radar autenticado e chama a Edge Function.
5. A função consulta o Google, calcula o score, registra evidências e devolve a quantidade encontrada.

O CNPJ e a análise profunda de site/redes sociais ficam preparados como próximos módulos. Esta etapa evita afirmar problemas que ainda não foram realmente verificados.

## Publicação segura

Faça primeiro o deploy do banco e da função. Depois de validar um radar com uma conta de teste, faça o merge da branch de evolução na `main`; o GitHub Pages continuará publicando a versão atual enquanto a branch não for mesclada.

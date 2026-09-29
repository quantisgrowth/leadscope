-- Generaliza a origem dos estabelecimentos para permitir provedores além do Google.
-- As colunas legadas permanecem para preservar todos os dados existentes.

alter table public.empresas
  add column if not exists source_provider text,
  add column if not exists source_place_id text,
  add column if not exists source_url text,
  add column if not exists source_payload jsonb not null default '{}'::jsonb;

update public.empresas
set source_provider = 'google_maps',
    source_place_id = google_place_id,
    source_url = google_maps_url,
    source_payload = dados_google
where google_place_id is not null
  and source_place_id is null;

create unique index if not exists empresas_user_source_place_key
  on public.empresas (user_id, source_provider, source_place_id);

alter table public.radar_runs
  add column if not exists provider text,
  add column if not exists provider_run_id text,
  add column if not exists provider_dataset_id text,
  add column if not exists provider_status text,
  add column if not exists provider_payload jsonb not null default '{}'::jsonb;

create index if not exists idx_radar_runs_provider_run_id
  on public.radar_runs (provider_run_id);

alter table public.radares alter column fonte set default 'apify_google_maps';

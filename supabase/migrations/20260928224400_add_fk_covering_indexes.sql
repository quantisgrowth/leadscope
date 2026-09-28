-- Índices das colunas de relacionamento usadas isoladamente por joins e cascatas.
create index if not exists idx_radar_runs_radar_id on public.radar_runs(radar_id);
create index if not exists idx_score_components_empresa_id on public.score_components(empresa_id);
create index if not exists idx_score_components_radar_run_id on public.score_components(radar_run_id);

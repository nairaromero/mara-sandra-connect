-- =============================================================================
-- Migration: vincular pasta do Google Drive a cada caso + dedupe de imports.
--
-- Permite que cada caso aponte pra uma pasta do Drive. Quando o usuario clica
-- em "Sync", o app lista a pasta e mostra somente arquivos que ainda nao foram
-- importados (dedupe por gdrive_file_id).
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- casos: pasta do Drive vinculada
-- ---------------------------------------------------------------------------
alter table public.casos
  add column if not exists gdrive_folder_id text,
  add column if not exists gdrive_folder_name text,
  add column if not exists gdrive_vinculado_em timestamptz,
  add column if not exists gdrive_vinculado_por uuid references public.usuarios(id) on delete set null;

comment on column public.casos.gdrive_folder_id is
  'ID da pasta do Google Drive vinculada ao caso (usado pelo botao Sync). Null = sem vinculo.';

comment on column public.casos.gdrive_folder_name is
  'Nome da pasta do Drive na hora do vinculo (apenas pra display).';

-- ---------------------------------------------------------------------------
-- documentos: file_id do Drive quando o doc veio de la
-- ---------------------------------------------------------------------------
alter table public.documentos
  add column if not exists gdrive_file_id text;

comment on column public.documentos.gdrive_file_id is
  'ID do arquivo no Google Drive quando este doc foi importado de la.
   Permite dedupe na funcao de sync (evita re-importar). Null = upload manual.';

-- Index pra dedupe rapido na sync (por caso + file_id)
create index if not exists idx_documentos_gdrive
  on public.documentos(caso_id, gdrive_file_id)
  where gdrive_file_id is not null;

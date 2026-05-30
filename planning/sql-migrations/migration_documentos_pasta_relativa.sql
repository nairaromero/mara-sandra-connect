-- =============================================================================
-- Migration: documentos.pasta_relativa pra agrupar docs por pasta do Drive.
--
-- Quando importado do Drive recursivo, guarda o caminho da subpasta (ex.:
-- "Diversos" ou "Subpasta/Outra"). Permite agrupar UI da aba Documentos
-- igual ao preview do Drive Picker.
--
-- Null = doc da raiz, ou upload manual (nao importado do Drive).
--
-- Idempotente.
-- =============================================================================

alter table public.documentos
  add column if not exists pasta_relativa text;

comment on column public.documentos.pasta_relativa is
  'Caminho relativo da subpasta no Drive (ex.: "Diversos" ou "Sub A/Sub B").
   Null = doc da raiz ou upload manual. Usado pra agrupar UI da aba Documentos.';

create index if not exists idx_documentos_pasta_relativa
  on public.documentos(caso_id, pasta_relativa)
  where pasta_relativa is not null;

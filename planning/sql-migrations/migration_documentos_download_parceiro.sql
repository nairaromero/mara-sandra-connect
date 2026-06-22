-- =============================================================================
-- migration_documentos_download_parceiro.sql
--
-- Adiciona controle granular: parceiro pode VISUALIZAR docs com
-- visivel_parceiro=true, mas so BAIXAR quando a equipe interno autorizar
-- explicitamente (download_parceiro=true).
--
-- Default false: docs existentes ficam nao-baixaveis ate o interno autorizar.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS download_parceiro boolean NOT NULL DEFAULT false;

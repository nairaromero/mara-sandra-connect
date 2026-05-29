-- =============================================================================
-- Migration: aumenta limite de upload do bucket `documentos` de 20MB pra 50MB.
--
-- Por que existe:
--   - PPP (Perfil Profissiografico Previdenciario) e laudos medicos digitalizados
--     com imagens em alta resolucao frequentemente passam de 20MB.
--   - Hoje o parceiro/interno tenta upar e recebe erro generico do Supabase
--     Storage ("Payload too large"). Frustrante.
--
-- Decisao: 50MB e suficiente pra 99% dos casos reais. Acima disso vale a pena
-- o usuario reduzir/dividir o arquivo. Tambem aumenta `cnis-uploads` e
-- `contratos` no mesmo valor pra consistencia.
--
-- IMPORTANTE: o limite tambem precisa estar configurado no projeto Supabase
-- em "Project Settings > API > Max request body size" se voce limitou la.
-- Por padrao Supabase Edge aceita ate ~50MB no body multipart.
--
-- Idempotente.
-- =============================================================================

-- 50 MB = 50 * 1024 * 1024 = 52_428_800 bytes
update storage.buckets
   set file_size_limit = 52428800
 where id in ('documentos', 'cnis-uploads', 'contratos')
   and (file_size_limit is null or file_size_limit < 52428800);

-- Verificacao (rode manualmente apos aplicar):
-- select id, file_size_limit, file_size_limit / 1024 / 1024 as limite_mb
--   from storage.buckets
--  where id in ('documentos', 'cnis-uploads', 'contratos');

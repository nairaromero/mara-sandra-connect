-- migration_storage_update_revert_to_interno.sql
--
-- Reverte a policy UPDATE de storage.objects pro comportamento original:
-- apenas usuários internos podem UPDATE em documentos. A tentativa de
-- estender pra parceiro do caso esbarrou em quirk do INSERT ON CONFLICT
-- DO UPDATE que avalia WITH CHECK da UPDATE policy mesmo sem conflito real.
--
-- Fix real foi no frontend: passar upsert=false quando o caller é parceiro.
-- Assim o upload do parceiro vira INSERT puro, que passa pela policy INSERT
-- (que permite parceiro do caso). Conflito de nome é raro porque o filename
-- é auto-gerado pelo tipo da solicitação.
--
-- Idempotente.

DROP POLICY IF EXISTS "documentos_storage_update" ON storage.objects;

CREATE POLICY "documentos_storage_interno_update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'documentos' AND public.is_interno())
WITH CHECK (bucket_id = 'documentos' AND public.is_interno());

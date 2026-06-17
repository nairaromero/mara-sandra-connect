-- migration_storage_policy_inline.sql
--
-- Substitui as policies INSERT/SELECT/UPDATE/DELETE de storage.objects (bucket
-- 'documentos') por checks INLINE — sem chamar caso_do_parceiro()/is_interno().
--
-- Motivo: caso_do_parceiro() SECURITY DEFINER, quando avaliada dentro de
-- policy de storage.objects, retornava resultado errado (parceiro do caso
-- ainda recebia "new row violates RLS"). Inline funciona porque o SELECT em
-- public.casos roda no contexto do role 'authenticated' e a RLS de casos
-- já permite parceiro_id=auth.uid().
--
-- Idempotente.

-- ============ INSERT ============
DROP POLICY IF EXISTS "documentos_insert_parceiro_ou_interno" ON storage.objects;
CREATE POLICY "documentos_insert_parceiro_ou_interno" ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'documentos'
  AND (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND tipo = 'interno' AND ativo = true
    )
    OR EXISTS (
      SELECT 1 FROM public.casos
      WHERE id = (split_part(name, '/', 1))::uuid
        AND parceiro_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "documentos_storage_parceiro_insert" ON storage.objects;
CREATE POLICY "documentos_storage_parceiro_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documentos'
  AND EXISTS (
    SELECT 1 FROM public.casos
    WHERE id = (split_part(name, '/', 1))::uuid
      AND parceiro_id = auth.uid()
  )
);

-- ============ SELECT ============
-- Mantém leitura: interno vê tudo, parceiro vê só docs visiveis do seu caso.
DROP POLICY IF EXISTS "documentos_select_visivel_parceiro" ON storage.objects;
CREATE POLICY "documentos_select_visivel_parceiro" ON storage.objects
FOR SELECT
USING (
  bucket_id = 'documentos'
  AND (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND tipo = 'interno' AND ativo = true
    )
    OR EXISTS (
      SELECT 1 FROM public.documentos d
      WHERE d.storage_path = storage.objects.name
        AND d.visivel_parceiro = true
        AND EXISTS (
          SELECT 1 FROM public.casos c
          WHERE c.id = d.caso_id AND c.parceiro_id = auth.uid()
        )
    )
  )
);

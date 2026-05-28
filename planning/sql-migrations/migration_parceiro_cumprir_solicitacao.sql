-- =============================================================================
-- Migration: permitir que parceiro cumpra solicitacao de documento.
--
-- O parceiro precisa:
--   1. UPDATE em solicitacoes_documento (do caso dele) para marcar como atendido
--   2. INSERT em documentos (do caso dele) para registrar o arquivo subido
--   3. UPDATE em documentos (do caso dele, criados por ele) - se quiser editar
--      o nome ou flag visivel_parceiro depois (opcional)
--   4. Storage: INSERT no bucket "documentos" no path que comeca com caso_id
--      onde o caso pertence ao parceiro
--
-- A funcao caso_do_parceiro(caso_id) ja existe e checa caso.parceiro_id = auth.uid().
--
-- Idempotente: pode rodar varias vezes.
-- =============================================================================

-- 1) Policy de UPDATE em solicitacoes_documento para parceiro
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'solicitacoes_documento'
      and policyname = 'solicitacoes_parceiro_update'
  ) then
    create policy "solicitacoes_parceiro_update"
    on public.solicitacoes_documento
    as permissive
    for update
    to authenticated
    using (public.caso_do_parceiro(caso_id))
    with check (public.caso_do_parceiro(caso_id));
  end if;
end$$;

-- 2) Policy de INSERT em documentos para parceiro
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documentos'
      and policyname = 'documentos_parceiro_insert'
  ) then
    create policy "documentos_parceiro_insert"
    on public.documentos
    as permissive
    for insert
    to authenticated
    with check (public.caso_do_parceiro(caso_id));
  end if;
end$$;

-- 3) Storage: permitir parceiro fazer UPLOAD no bucket "documentos"
--    no path que comeca com caso_id do caso dele.
--    Note: storage.objects usa bucket_id = 'documentos' e name = '<caso_id>/<nome>'.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'documentos_storage_parceiro_insert'
  ) then
    create policy "documentos_storage_parceiro_insert"
    on storage.objects
    as permissive
    for insert
    to authenticated
    with check (
      bucket_id = 'documentos'
      and public.caso_do_parceiro(
        (split_part(name, '/', 1))::uuid
      )
    );
  end if;
end$$;

-- 4) Storage: permitir parceiro fazer SELECT (download) no bucket "documentos"
--    de arquivos do caso dele (necessario pra ele ver depois o que enviou)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'documentos_storage_parceiro_select'
  ) then
    create policy "documentos_storage_parceiro_select"
    on storage.objects
    as permissive
    for select
    to authenticated
    using (
      bucket_id = 'documentos'
      and public.caso_do_parceiro(
        (split_part(name, '/', 1))::uuid
      )
    );
  end if;
end$$;

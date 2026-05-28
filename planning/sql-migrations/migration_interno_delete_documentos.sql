-- =============================================================================
-- Migration: garantir que interno consiga deletar documentos uploadados pelo parceiro.
--
-- Sintoma: parceiro faz upload (via cumprir solicitacao), arquivo fica em
-- public.documentos com uploaded_by = id do parceiro. Quando interno tenta
-- deletar pela aba Documentos do caso, RLS bloqueia silenciosamente porque
-- as policies existentes podem so permitir delete pelo proprio uploader.
--
-- Esta migration adiciona policies explicitas de DELETE para interno em:
--   - public.documentos (registro do banco)
--   - storage.objects (arquivo no bucket "documentos")
--
-- Idempotente: pode rodar varias vezes.
-- =============================================================================

-- 1) Interno pode DELETAR qualquer documento em public.documentos
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documentos'
      and policyname = 'documentos_interno_delete'
  ) then
    create policy "documentos_interno_delete"
    on public.documentos
    as permissive
    for delete
    to authenticated
    using (public.is_interno());
  end if;
end$$;

-- 2) Interno tambem pode atualizar (UPDATE) documentos (ex.: trocar nome,
--    alternar visivel_parceiro) - caso de policy nao existir ainda
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documentos'
      and policyname = 'documentos_interno_update'
  ) then
    create policy "documentos_interno_update"
    on public.documentos
    as permissive
    for update
    to authenticated
    using (public.is_interno())
    with check (public.is_interno());
  end if;
end$$;

-- 3) Storage: interno pode DELETAR qualquer arquivo do bucket "documentos"
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'documentos_storage_interno_delete'
  ) then
    create policy "documentos_storage_interno_delete"
    on storage.objects
    as permissive
    for delete
    to authenticated
    using (
      bucket_id = 'documentos'
      and public.is_interno()
    );
  end if;
end$$;

-- 4) Storage: interno tambem pode atualizar metadados (raramente usado, mas
--    completa a permissao)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'documentos_storage_interno_update'
  ) then
    create policy "documentos_storage_interno_update"
    on storage.objects
    as permissive
    for update
    to authenticated
    using (
      bucket_id = 'documentos'
      and public.is_interno()
    )
    with check (
      bucket_id = 'documentos'
      and public.is_interno()
    );
  end if;
end$$;

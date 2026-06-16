-- =============================================================================
-- Migration: WhatsApp — anexar documento (Fase 3)
--
-- O parceiro envia foto/PDF pelo WhatsApp -> a Edge baixa do Evolution, sobe pro
-- bucket `documentos` e chama esta RPC pra registrar o metadado em public.documentos.
-- Como a Edge roda service-role (fura RLS), a AUTORIZAÇÃO é reimplementada aqui:
-- o caso precisa ser do próprio parceiro (mesma regra do add_comentario).
--
-- Depende de: tabela public.documentos (migration_caso_detalhe.sql) e do bucket
-- de storage `documentos`. Idempotente.
-- =============================================================================

create or replace function public.whatsapp_parceiro_add_documento(
  p_parceiro_id  uuid,
  p_caso_id      uuid,
  p_nome_arquivo text,
  p_storage_path text,
  p_tamanho      bigint default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_id uuid;
begin
  if coalesce(btrim(p_nome_arquivo), '') = '' or coalesce(btrim(p_storage_path), '') = '' then
    raise exception 'arquivo invalido (nome/path vazio)';
  end if;

  select exists(
    select 1 from public.casos c
     where c.id = p_caso_id and c.parceiro_id = p_parceiro_id
  ) into v_ok;

  if not v_ok then
    raise exception 'nao autorizado: caso % nao pertence ao parceiro %', p_caso_id, p_parceiro_id;
  end if;

  insert into public.documentos
    (caso_id, tipo, tipo_personalizado, nome_arquivo, storage_path,
     tamanho_bytes, uploaded_by, visivel_parceiro)
  values
    (p_caso_id, 'outro', 'Enviado pelo WhatsApp', p_nome_arquivo, p_storage_path,
     p_tamanho, p_parceiro_id, true)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.whatsapp_parceiro_add_documento(uuid, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.whatsapp_parceiro_add_documento(uuid, uuid, text, text, bigint)
  to service_role;

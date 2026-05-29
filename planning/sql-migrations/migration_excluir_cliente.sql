-- =============================================================================
-- Migration: RPC excluir_cliente para que internos possam apagar um cliente
-- (e todo o caso vinculado a ele) em uma unica operacao atomica.
--
-- Por que existe:
--   - Hoje so da pra apagar via SQL Editor. Precisa de UI segura.
--   - Apagar cliente envolve cascade por varias tabelas (documentos, casos,
--     andamentos, solicitacoes, etc.). Fazer isso no frontend e fragil.
--
-- Como funciona:
--   - Funcao security definer (bypassa RLS, mas valida tipo='interno').
--   - Coleta storage_paths dos documentos ANTES de apagar - retorna pro
--     frontend pra ele limpar o bucket do Supabase Storage.
--   - Deleta filhos em ordem reversa de dependencia (defensivo - funciona
--     mesmo se algumas FKs nao tiverem ON DELETE CASCADE configurado).
--   - Tabelas opcionais ficam em BEGIN/EXCEPTION pra ignorar se nao existem.
--
-- Idempotente.
-- =============================================================================

create or replace function public.excluir_cliente(p_cliente_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_paths text[];
  v_caso_ids uuid[];
begin
  -- Apenas usuarios internos podem apagar cliente.
  select tipo into v_tipo from public.usuarios where id = auth.uid();
  if v_tipo is null or v_tipo <> 'interno' then
    raise exception 'Apenas usuarios internos podem excluir clientes';
  end if;

  -- Verifica se cliente existe
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'Cliente nao encontrado';
  end if;

  -- IDs dos casos do cliente (pode ter 0..n casos)
  select array_agg(id) into v_caso_ids
    from public.casos where cliente_id = p_cliente_id;
  v_caso_ids := coalesce(v_caso_ids, ARRAY[]::uuid[]);

  -- Coleta storage_paths ANTES de apagar (frontend usa pra limpar bucket).
  select array_agg(storage_path) into v_paths
    from public.documentos
   where caso_id = ANY(v_caso_ids)
     and storage_path is not null;

  -- Deleta filhos em ordem reversa de dependencia.
  -- BEGIN/EXCEPTION para tabelas que podem nao existir em todos ambientes.
  delete from public.documentos where caso_id = ANY(v_caso_ids);
  delete from public.andamentos where caso_id = ANY(v_caso_ids);
  delete from public.solicitacoes_documento where caso_id = ANY(v_caso_ids);

  begin
    delete from public.repasses where caso_id = ANY(v_caso_ids);
  exception when undefined_table then null;
  end;

  begin
    delete from public.processos_admin where caso_id = ANY(v_caso_ids);
  exception when undefined_table then null;
  end;

  begin
    delete from public.processos_judiciais where caso_id = ANY(v_caso_ids);
  exception when undefined_table then null;
  end;

  -- Mensagens dependem de conversas - delete na ordem certa
  begin
    delete from public.mensagens
     where conversa_id in (
       select id from public.conversas where caso_id = ANY(v_caso_ids)
     );
  exception when undefined_table then null;
  end;

  begin
    delete from public.conversas where caso_id = ANY(v_caso_ids);
  exception when undefined_table then null;
  end;

  -- Casos primeiro, depois cliente
  delete from public.casos where cliente_id = p_cliente_id;

  -- acessos_senha_inss tem ON DELETE CASCADE no cliente_id (vide
  -- migration_senha_meu_inss_encryption.sql), entao some sozinho.
  delete from public.clientes where id = p_cliente_id;

  return coalesce(v_paths, ARRAY[]::text[]);
end;
$$;

revoke all on function public.excluir_cliente(uuid) from public;
grant execute on function public.excluir_cliente(uuid) to authenticated;

-- =============================================================================
-- Migration: solicitação respondida por LINK fecha quando o arquivo chega  —  2026-09-11
--
-- Antes: preparar_upload_documento (MCP/chat) marcava a solicitação como
-- ATENDIDA na hora de gerar o link — mesmo que o arquivo nunca chegasse
-- (tarefa "aguardando documentos" fechada, andamento "documento entregue",
-- webhook), e o prazo da exigência corria com a pendência dada como resolvida.
--
-- Agora: a ferramenta só cria o registro em `documentos` com `solicitacao_id`
-- e o link. Quando o arquivo entra no bucket `documentos`, este gatilho acha o
-- registro que o espera e marca a solicitação como ATENDIDA — os gatilhos que
-- já existem em solicitacoes_documento rodam como antes, só que na hora certa.
--
-- NÃO afeta envios pela tela (src/lib/documentos/cumprimento.ts): lá o arquivo
-- sobe PRIMEIRO e o registro em `documentos` é criado depois, então no momento
-- do upload não há registro esperando → o gatilho não faz nada.
--
-- "Esperando arquivo" = `tamanho_bytes` nulo. Só a ferramenta do link cria o
-- registro sem tamanho; tela, WhatsApp, Trello e comprovante gravam o tamanho
-- (em produção, 2026-09-14: 42 documentos com solicitação, todos com tamanho).
-- Sem esse filtro, o interno que re-sobe um arquivo de mesmo nome pela tela
-- (caminho sem timestamp) fecharia uma solicitação ANTIGA ainda pendente que
-- apontava pro mesmo caminho. Ao fechar, o gatilho grava o tamanho: o registro
-- deixa de esperar e um re-upload no mesmo caminho não dispara de novo.
--
-- Revisão 2026-09-14: WHEN no gatilho (antes rodava a função — e abria a
-- subtransação do bloco exception — em todo upload de qualquer bucket).
--
-- Idempotente. Rodar primeiro no staging:
--   node scripts/msc-sql.mjs --staging --file <este arquivo>
-- =============================================================================

-- Busca do gatilho: só os documentos que esperam arquivo de uma solicitação.
create index if not exists documentos_storage_path_esperando_arquivo_idx
  on public.documentos (storage_path)
  where solicitacao_id is not null and tamanho_bytes is null;

create or replace function public.tg_upload_link_fecha_solicitacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc_id  uuid;
  v_sol_id  uuid;
  v_caso_id uuid;
begin
  -- Só bucket `documentos` chega aqui (WHEN no gatilho).
  select d.id, d.solicitacao_id, d.caso_id
    into v_doc_id, v_sol_id, v_caso_id
    from public.documentos d
   where d.storage_path = new.name
     and d.solicitacao_id is not null
     and d.tamanho_bytes is null
   order by d.created_at desc
   limit 1;

  if v_doc_id is null then
    return new;  -- upload comum (tela, WhatsApp, etc.): nada a fazer
  end if;

  -- O arquivo chegou: o registro deixa de "esperar" (e a aba Documentos passa a
  -- mostrar o tamanho). Os gatilhos de documentos são só de INSERT.
  update public.documentos
     set tamanho_bytes = coalesce(nullif(new.metadata->>'size', '')::bigint, 0)
   where id = v_doc_id;

  -- Só fecha o que ainda está pendente (dispensada/atendida antes fica como está).
  update public.solicitacoes_documento
     set status = 'atendido',
         data_atendimento = now(),
         documento_id = v_doc_id
   where id = v_sol_id
     and caso_id = v_caso_id
     and status = 'pendente';

  return new;
exception when others then
  -- Nunca derrubar o upload do cliente por causa disto: o arquivo fica salvo e
  -- a solicitação pode ser fechada à mão.
  raise warning 'tg_upload_link_fecha_solicitacao falhou (objeto %): %', new.name, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_upload_link_fecha_solicitacao on storage.objects;
create trigger trg_upload_link_fecha_solicitacao
  after insert on storage.objects
  for each row
  when (new.bucket_id = 'documentos')
  execute function public.tg_upload_link_fecha_solicitacao();

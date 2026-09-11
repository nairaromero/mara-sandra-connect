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
-- Idempotente. Rodar primeiro no staging:
--   node scripts/msc-sql.mjs --staging --file <este arquivo>
-- =============================================================================

-- Busca do gatilho: só os documentos que esperam arquivo de uma solicitação
-- (em 2026-09-11: 40 de 6.879), então o índice é minúsculo.
create index if not exists documentos_storage_path_solicitacao_idx
  on public.documentos (storage_path)
  where solicitacao_id is not null;

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
  if new.bucket_id is distinct from 'documentos' then
    return new;
  end if;

  select d.id, d.solicitacao_id, d.caso_id
    into v_doc_id, v_sol_id, v_caso_id
    from public.documentos d
   where d.storage_path = new.name
     and d.solicitacao_id is not null
   order by d.created_at desc
   limit 1;

  if v_doc_id is null then
    return new;  -- upload comum (tela, WhatsApp, etc.): nada a fazer
  end if;

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
  execute function public.tg_upload_link_fecha_solicitacao();

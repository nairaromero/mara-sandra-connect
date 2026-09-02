-- Excluir tarefa COM MOTIVO (pelo popup de conclusão).
--
-- Naira (2026-09-02): ao clicar "Feito" numa tarefa (conclusão genérica, não
-- pelos botões de desfecho), abre um popup pra Concluir / Editar / Excluir
-- com motivo — pra nenhuma tarefa (nem o caso) ficar parada sem razão
-- registrada. Ex.: análise criada por importação do Legalmail num caso que é
-- judicial precisa ser deletada, não concluída.
--
-- Aqui: (1) coluna `motivo` no log de exclusão; (2) o trigger de log passa a
-- gravá-la; (3) RPC excluir_tarefa_com_motivo (SECURITY INVOKER — RLS do
-- interno vale) que carimba o motivo no metadata e deleta na mesma transação.
--
-- Corpo do trigger partido do pg_get_functiondef da PRODUÇÃO (2026-09-02);
-- única mudança é a coluna motivo. Idempotente.

alter table public.tarefas_excluidas add column if not exists motivo text;
comment on column public.tarefas_excluidas.motivo is
  'Motivo da exclusão quando excluída pelo popup de conclusão (vem de tarefas.metadata->>motivo_exclusao no delete).';

create or replace function public._tarefas_log_exclusao()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
begin
  insert into public.tarefas_excluidas
    (tarefa_id, caso_id, titulo, status, tipo, due_at, responsavel_id,
     created_by, created_at, dados, motivo, excluida_por, excluida_em)
  values
    (old.id, old.caso_id, old.titulo, old.status, old.tipo, old.due_at, old.responsavel_id,
     old.created_by, old.created_at, to_jsonb(old),
     nullif(btrim(old.metadata->>'motivo_exclusao'), ''), auth.uid(), now());
  return old;
end;
$function$;

-- RPC: carimba o motivo no metadata e deleta, na mesma transação. INVOKER
-- (não DEFINER) pra respeitar a RLS de tarefas — só quem já podia excluir
-- exclui; o trigger de log captura o motivo.
create or replace function public.excluir_tarefa_com_motivo(p_id uuid, p_motivo text)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.tarefas
     set metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object('motivo_exclusao', btrim(coalesce(p_motivo, '')))
   where id = p_id;
  delete from public.tarefas where id = p_id;
end;
$function$;

revoke all on function public.excluir_tarefa_com_motivo(uuid, text) from public, anon;
grant execute on function public.excluir_tarefa_com_motivo(uuid, text) to authenticated;

comment on function public.excluir_tarefa_com_motivo(uuid, text) is
  'Exclui a tarefa registrando o motivo (via metadata -> trigger de log). SECURITY INVOKER: respeita a RLS de tarefas.';

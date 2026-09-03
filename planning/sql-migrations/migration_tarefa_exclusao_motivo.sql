-- Excluir tarefa COM MOTIVO (pelo popup de conclusão).
--
-- Naira (2026-09-02): ao clicar "Feito" numa tarefa (conclusão genérica, não
-- pelos botões de desfecho), abre um popup pra Concluir / Editar / Excluir
-- com motivo — pra nenhuma tarefa (nem o caso) ficar parada sem razão
-- registrada. Ex.: análise criada por importação do Legalmail num caso que é
-- judicial precisa ser deletada, não concluída.
--
-- Aqui: (1) coluna `motivo` no log de exclusão; (2) o trigger de log passa a
-- gravá-la. O RPC excluir_tarefa_com_motivo mora SÓ em
-- migration_exclusao_tarefa_andamento.sql — re-rodar este arquivo não pode
-- rebaixar o RPC pra uma versão antiga (revisão 2026-09-02: a v1 que vivia
-- aqui desfazia o andamento da v2 ao re-aplicar).
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

-- RPC excluir_tarefa_com_motivo: ver migration_exclusao_tarefa_andamento.sql
-- (fonte única — aplicar aquele arquivo junto com este).

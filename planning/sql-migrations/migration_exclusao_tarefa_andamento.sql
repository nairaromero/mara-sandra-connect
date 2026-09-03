-- Excluir tarefa com motivo: o motivo entra também nos ANDAMENTOS do processo
-- ligado à tarefa (Naira, 2026-09-02).
--
-- Antes: excluir_tarefa_com_motivo só carimbava o motivo no metadata (→ log
-- tarefas_excluidas.motivo). Agora também registra um andamento INTERNO
-- (visivel_parceiro=false) no caso/processo vinculado, pra ficar no histórico
-- do processo por que a tarefa foi baixada.
--
-- SECURITY INVOKER (default): respeita a RLS — quem exclui a tarefa é quem já
-- podia; o mesmo usuário insere o andamento (interno). Idempotente.
--
-- FONTE ÚNICA do RPC (revisão 2026-09-02). Validações no servidor: motivo
-- obrigatório e erro claro quando a tarefa não existe/já foi excluída — antes
-- o RPC devolvia sucesso silencioso e a UI dizia "excluída" sem excluir nada.

create or replace function public.excluir_tarefa_com_motivo(p_id uuid, p_motivo text)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caso   uuid;
  v_padm   uuid;
  v_pjud   uuid;
  v_titulo text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  -- A UI valida, mas o servidor é quem garante: sem motivo não há exclusão.
  if v_motivo = '' then
    raise exception 'Motivo da exclusão é obrigatório.';
  end if;

  select caso_id, processo_admin_id, processo_judicial_id, titulo
    into v_caso, v_padm, v_pjud, v_titulo
    from public.tarefas
   where id = p_id;
  if not found then
    raise exception 'Tarefa não encontrada — talvez já excluída por outra pessoa.';
  end if;

  -- Carimba o motivo no metadata: o trigger de log grava tarefas_excluidas.motivo.
  update public.tarefas
     set metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object('motivo_exclusao', v_motivo)
   where id = p_id;

  -- Andamento INTERNO no processo/caso ligado à tarefa (fica no histórico).
  if v_caso is not null then
    insert into public.andamentos
      (caso_id, processo_admin_id, processo_judicial_id, origem, titulo, descricao,
       data_evento, visivel_parceiro, criado_por, metadata)
    values
      (v_caso, v_padm, v_pjud, 'interno',
       'Tarefa excluída: ' || coalesce(v_titulo, '(sem título)'),
       v_motivo, now(), false, auth.uid(),
       jsonb_build_object('motivo_exclusao_tarefa', true, 'tarefa_id', p_id));
  end if;

  delete from public.tarefas where id = p_id;
  if not found then
    raise exception 'Tarefa não encontrada — talvez já excluída por outra pessoa.';
  end if;
end;
$function$;

revoke all on function public.excluir_tarefa_com_motivo(uuid, text) from public, anon;
grant execute on function public.excluir_tarefa_com_motivo(uuid, text) to authenticated;

comment on function public.excluir_tarefa_com_motivo(uuid, text) is
  'Exclui a tarefa registrando o motivo: em tarefas_excluidas.motivo (via metadata->trigger) E como andamento interno no processo/caso ligado. SECURITY INVOKER.';

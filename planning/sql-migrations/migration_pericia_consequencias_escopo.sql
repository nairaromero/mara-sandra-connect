-- Consequência de uma ação permitida alcança a linha ligada, mesmo de outra pessoa.
--
-- Decisão da Naira (27/11/2026). O papel Assistente tem alcance "atribuídos" em
-- tarefas e na agenda: só altera o que está no nome dele. Duas ações passaram a
-- ter consequência numa linha que pode ser de OUTRA pessoa:
--   - responder o comparecimento (tarefa dele) encerra a perícia na agenda;
--   - remarcar a perícia (compromisso dele) leva as tarefas dela junto.
-- Pela RLS o banco recusava em silêncio (zero linhas, sem erro) e a tela seguia
-- como se tivesse feito — no remarcar, chegava a dizer que as tarefas tinham
-- acompanhado. Deixar agenda e tarefas desencontradas é pior do que o assistente
-- provocar um ajuste que é só consequência do que ele já pode fazer.
--
-- As duas funções conferem a permissão sobre a linha de ORIGEM (a mesma regra
-- da policy: escopo `todos`, ou `atribuidos` na linha de quem age) e limitam o
-- que alcançam: só a perícia do mesmo caso e processo; só tarefa aberta do
-- mesmo caso, ancorada num compromisso. Quem escolhe QUAL evento e calcula o
-- prazo é a tela (uma conta só: `eventoDaPericia`, `calcularDueAtRelativo`).
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Respondeu o comparecimento -> a perícia daquela tarefa está encerrada
-- ---------------------------------------------------------------------------
create or replace function public.concluir_pericia_da_tarefa(
  p_tarefa_id uuid,
  p_evento_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tarefa public.tarefas%rowtype;
  v_evento public.agenda_eventos%rowtype;
begin
  if not public.is_interno() then
    raise exception 'só a equipe interna encerra perícia' using errcode = 'insufficient_privilege';
  end if;
  perform private.exigir_no_escritorio('public.tarefas', p_tarefa_id);
  perform private.exigir_no_escritorio('public.agenda_eventos', p_evento_id);

  select * into v_tarefa from public.tarefas where id = p_tarefa_id;
  if v_tarefa.id is null then
    raise exception 'tarefa não encontrada' using errcode = 'no_data_found';
  end if;

  -- A mesma regra da policy de tarefas, sobre a tarefa de quem responde.
  if not (private.tem_permissao('tarefas:gerenciar', 'todos')
          or (private.tem_permissao('tarefas:gerenciar', 'atribuidos')
              and v_tarefa.responsavel_id = auth.uid())) then
    raise exception 'sem permissão para responder esta tarefa' using errcode = '42501';
  end if;

  select * into v_evento from public.agenda_eventos where id = p_evento_id for update;
  if v_evento.id is null then
    raise exception 'perícia não encontrada' using errcode = 'no_data_found';
  end if;
  -- Só a perícia DESTA tarefa: mesmo caso e mesmo processo.
  if v_evento.tipo <> 'pericia'
     or v_evento.caso_id is distinct from v_tarefa.caso_id
     or v_evento.processo_admin_id is distinct from v_tarefa.processo_admin_id
     or v_evento.processo_judicial_id is distinct from v_tarefa.processo_judicial_id then
    raise exception 'este compromisso não é a perícia desta tarefa' using errcode = 'P0001';
  end if;

  if v_evento.concluido_em is not null then
    return false;
  end if;
  update public.agenda_eventos
     set concluido_em = now(), concluido_por = auth.uid()
   where id = p_evento_id;
  return true;
end;
$$;

revoke all on function public.concluir_pericia_da_tarefa(uuid, uuid) from public, anon;
grant execute on function public.concluir_pericia_da_tarefa(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Remarcou a perícia -> a tarefa que a acompanha vai junto
-- ---------------------------------------------------------------------------
create or replace function public.reancorar_tarefa_do_evento(
  p_evento_id uuid,
  p_tarefa_id uuid,
  p_due_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento public.agenda_eventos%rowtype;
  v_tarefa public.tarefas%rowtype;
begin
  if not public.is_interno() then
    raise exception 'só a equipe interna remarca compromisso' using errcode = 'insufficient_privilege';
  end if;
  perform private.exigir_no_escritorio('public.agenda_eventos', p_evento_id);
  perform private.exigir_no_escritorio('public.tarefas', p_tarefa_id);

  select * into v_evento from public.agenda_eventos where id = p_evento_id;
  if v_evento.id is null then
    raise exception 'compromisso não encontrado' using errcode = 'no_data_found';
  end if;

  -- A mesma regra das policies da agenda, sobre o compromisso de quem remarca.
  if not (private.tem_permissao('agenda:gerenciar', 'todos')
          or (private.tem_permissao('agenda:gerenciar', 'atribuidos')
              and v_evento.responsavel_id = auth.uid()))
     or (v_evento.restrito_a is not null and not (auth.uid() = any (v_evento.restrito_a))) then
    raise exception 'sem permissão para remarcar este compromisso' using errcode = '42501';
  end if;

  select * into v_tarefa from public.tarefas where id = p_tarefa_id for update;
  if v_tarefa.id is null then
    raise exception 'tarefa não encontrada' using errcode = 'no_data_found';
  end if;
  -- Só tarefa aberta do mesmo caso, ancorada num compromisso — e não em outro.
  if v_tarefa.caso_id is distinct from v_evento.caso_id
     or v_tarefa.status not in ('a_fazer', 'fazendo')
     or not (coalesce(v_tarefa.metadata, '{}'::jsonb) ? 'pericia_em')
     or coalesce(v_tarefa.metadata->>'evento_id', p_evento_id::text) <> p_evento_id::text then
    raise exception 'esta tarefa não acompanha este compromisso' using errcode = 'P0001';
  end if;

  update public.tarefas
     set due_at   = coalesce(p_due_at, due_at),
         metadata = metadata || jsonb_build_object(
                      'evento_id', p_evento_id,
                      -- mesmo formato do toISOString() da tela
                      'pericia_em', to_char(v_evento.start_at at time zone 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   where id = p_tarefa_id;
  return true;
end;
$$;

revoke all on function public.reancorar_tarefa_do_evento(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.reancorar_tarefa_do_evento(uuid, uuid, timestamptz) to authenticated;

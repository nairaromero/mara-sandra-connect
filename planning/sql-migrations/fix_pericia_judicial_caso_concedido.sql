-- Correção de DADOS de um caso (não é migration; não entra no registro).
--
-- Um caso judicial (id abaixo). Em 24/11/2026 15:56 o
-- botão "Saiu — deferido" da tarefa "Conferir laudo da perícia judicial" lançou
-- benefício concedido num processo judicial que só teve um laudo juntado.
-- O botão foi corrigido na migration_pericia_judicial_laudo; aqui se desfaz o
-- que ele deixou NESTE caso:
--
--  1. as três tarefas do Concedido (Análise de Deferimento, Baixar PA,
--     Acompanhamento de implementação) saem pelo caminho normal de exclusão —
--     com motivo, log em tarefas_excluidas e andamento interno;
--  2. no lugar nasce "Analisar laudo da perícia judicial", para a mesma pessoa
--     e no mesmo processo da Análise de Deferimento;
--  3. o andamento "Resultado da perícia — DEFERIDO" passa a dizer o que houve:
--     laudo juntado, processo segue. O título antigo fica no metadata;
--  4. o andamento da Beatriz ("Juntada de laudo social…") perde a marca de
--     template Concedido. O texto dela não muda.
--
-- Só mexe em tarefa ainda "a_fazer": se alguém já trabalhou numa delas, ela
-- fica e o aviso sai no NOTICE. Rodar duas vezes não faz nada na segunda.

do $$
declare
  c_caso      constant uuid := 'd6866bea-c720-4bf9-ad3e-8577ef15d612';
  c_analise   constant uuid := '5e130ac8-ffd7-4623-8772-217055fdc0d3';
  c_andamento constant uuid := '51591db9-368f-403a-b13d-ea0f33856c65';
  c_and_bia   constant uuid := '3591e7bd-d104-44c6-9889-1e1dabe59c53';
  c_motivo    constant text :=
    'Lançada por engano: o botão de resultado da perícia do INSS foi usado numa perícia judicial. Houve juntada de laudo, não concessão do benefício.';
  r record;
  v_n int := 0;
begin
  -- 2 (antes de 1: copia responsável e processo da Análise de Deferimento)
  insert into public.tarefas
    (caso_id, escritorio_id, processo_judicial_id, responsavel_id, tipo, status,
     prioridade, titulo, descricao, due_at, origem, metadata)
  select t.caso_id, t.escritorio_id, t.processo_judicial_id, t.responsavel_id,
         'interna', 'a_fazer', 1,
         'Analisar laudo da perícia judicial - ' || cl.nome,
         'O laudo da perícia judicial foi juntado aos autos. Analisar e definir a manifestação (concordar, impugnar ou pedir esclarecimentos), observando o prazo da intimação. O laudo não é a decisão: o processo segue até a sentença.',
         t.due_at, 'template',
         jsonb_build_object(
           'template_aplicado', 'laudo_pericia_judicial',
           'template_item_index', 0,
           'analise_laudo_pericia', true,
           'correcao_de', t.id)
    from public.tarefas t
    join public.casos k     on k.id = t.caso_id
    join public.clientes cl on cl.id = k.cliente_id
   where t.id = c_analise and t.caso_id = c_caso and t.status = 'a_fazer'
     and not exists (
       select 1 from public.tarefas x
        where x.caso_id = c_caso
          and x.metadata->>'template_aplicado' = 'laudo_pericia_judicial');

  -- 1
  for r in
    select t.id, t.titulo, t.status
      from public.tarefas t
     where t.caso_id = c_caso
       and t.metadata->>'template_aplicado' = 'concedido'
       and t.metadata->>'aplicado_por_desfecho' = 'true'
       and t.created_at >= '2026-11-24 18:56:00+00'
       and t.created_at <  '2026-11-24 18:58:00+00'
  loop
    if r.status = 'a_fazer' then
      perform public.excluir_tarefa_com_motivo(r.id, c_motivo);
      v_n := v_n + 1;
    else
      raise notice 'NAO excluida (status %): %', r.status, r.titulo;
    end if;
  end loop;
  raise notice 'tarefas do Concedido excluidas: %', v_n;

  -- 3
  update public.andamentos a
     set titulo    = 'Laudo da perícia judicial juntado (24/11/2026)',
         descricao = 'Laudo juntado aos autos. O laudo não é a decisão: vamos analisar e nos manifestar, e o processo segue até a sentença.',
         metadata  = a.metadata || jsonb_build_object(
                       'titulo_anterior', a.titulo,
                       'corrigido_em', now(),
                       'correcao', 'pericia judicial lancada como deferida')
   where a.id = c_andamento and a.caso_id = c_caso
     and a.titulo like 'Resultado da perícia — DEFERIDO%';

  -- 4
  update public.andamentos a
     set metadata = a.metadata - 'template_aplicado' - 'template_item_index' - 'aplicado_por_desfecho'
   where a.id = c_and_bia and a.caso_id = c_caso
     and a.metadata->>'template_aplicado' = 'concedido';
end $$;

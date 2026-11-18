-- Migration: tarefas que acompanham a assinatura eletrônica (#517, ZapSign)
--
-- Ao enviar um documento para assinatura nasce a tarefa "Acompanhar assinatura";
-- quando todos assinam ela é concluída e nasce "Contrato assinado — dar
-- prosseguimento" (pedido da Naira, 17/11/2026). Quem cria e conclui é
-- `supabase/functions/_shared/zapsign.ts` (`abrirTarefaAcompanhar` e
-- `tarefasDoAssinado`), com origem 'zapsign_assinatura' e
-- origem_ref '<etapa>:<assinatura_id>' — o índice único uq_tarefas_origem_ref
-- é a trava contra a tarefa em dobro (aviso repetido do ZapSign).
--
-- Só acrescenta o valor novo à lista que o banco JÁ tem: a lista de origens
-- cresce a cada lote, e reescrevê-la daqui apagaria o que outro lote incluiu.
-- Idempotente.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.tarefas'::regclass and conname = 'tarefas_origem_check';
  if v_def is null then
    raise exception 'tarefas_origem_check não existe: confira a tabela antes de rodar';
  end if;
  if position('zapsign_assinatura' in v_def) > 0 then
    return;
  end if;
  if position('ARRAY[' in v_def) = 0 then
    raise exception 'tarefas_origem_check fora do formato esperado: %', v_def;
  end if;
  v_def := replace(v_def, 'ARRAY[', 'ARRAY[''zapsign_assinatura''::text, ');
  alter table public.tarefas drop constraint tarefas_origem_check;
  execute 'alter table public.tarefas add constraint tarefas_origem_check ' || v_def;
end $$;

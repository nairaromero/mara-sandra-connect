-- =============================================================================
-- Migration: caso encerrado só reabre quando há GENTE por trás (card #357)
--
-- Sobra da revisão do PR #391 (achado 6, segunda passada). O filtro que entrou
-- lá — `origem = 'manual'` na tarefa — não separa gente de robô:
--
--   * sete das 14 funções do banco que inserem tarefa gravam origem 'manual'
--     (em produção são 274 tarefas 'manual' SEM autor, todas de gatilho);
--   * `tg_rascunho_pericia_andamento` dispara em INSERT de `andamentos` —
--     tabela que DJEN, DataJud e o robô do e-mail do INSS alimentam — e cria a
--     tarefa com origem 'manual'. Ou seja: chegava publicação num caso
--     encerrado e o caso reabria sozinho;
--   * na outra ponta, tarefa criada por PESSOA com origem 'template' (aplicar
--     template) não reabria, e deveria.
--
-- A régua passa a ser a autoria, que é a mesma que `_tarefas_set_responsavel`
-- já usa: `_tarefas_set_created_by` (BEFORE INSERT) preenche `created_by` com
-- `auth.uid()` quando vem nulo, então quem escreve com service_role (os robôs)
-- fica com nulo e não tem como forjar. A ordem funciona: aquele gatilho é
-- BEFORE e este é AFTER, então o valor já chegou.
--
-- Solicitação e evento de agenda continuam reabrindo SEMPRE, inclusive quando
-- o robô do INSS abre o pedido (decisão da Naira, 2026-09-23): documento
-- pendente com o parceiro é trabalho real, encerrado ou não.
--
-- Partiu do `pg_get_functiondef` do STAGING (2026-09-23, onde o lote #391 já
-- está aplicado; produção ainda não tem esta função). A única mudança é o
-- bloco marcado. Idempotente. Local → staging → produção, com aval.
-- =============================================================================

create or replace function public._reabre_caso_finalizado()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fase public.fase_caso;
begin
  if NEW.caso_id is null then return NEW; end if;

  -- Reabrir é resposta a GENTE, não a robô. `created_by` só tem valor quando
  -- houve sessão de pessoa (ver cabeçalho); service_role deixa nulo. As demais
  -- tabelas (solicitação, agenda) são pedido por definição e reabrem sempre.
  --
  -- O `if` é ANINHADO de propósito. Este gatilho roda em três tabelas com
  -- colunas diferentes, e `solicitacoes_documento` não tem `created_by`:
  -- escrito como `TG_TABLE_NAME = 'tarefas' and NEW.created_by is null`, a
  -- referência estoura "record new has no field", o handler engole o erro e o
  -- PEDIDO deixa de reabrir o caso — medido aqui, o spec do kanban caiu com a
  -- fase parada em 'finalizado'. Aninhado, NEW.created_by só é tocado quando a
  -- tabela é `tarefas`.
  if TG_TABLE_NAME = 'tarefas' then
    if NEW.created_by is null then
      return NEW;
    end if;
  end if;

  if (select fase from public.casos where id = NEW.caso_id) <> 'finalizado' then
    return NEW;
  end if;

  v_fase := case
    when NEW.processo_judicial_id is not null then 'judicial'::public.fase_caso
    when NEW.processo_admin_id is not null then 'admin'::public.fase_caso
    else public._fase_pelo_processo(NEW.caso_id)
  end;

  update public.casos set fase = v_fase where id = NEW.caso_id;
  return NEW;
exception
  when others then
    raise warning 'reabrir caso finalizado falhou (caso %): %', NEW.caso_id, sqlerrm;
    return NEW;
end;
$function$;

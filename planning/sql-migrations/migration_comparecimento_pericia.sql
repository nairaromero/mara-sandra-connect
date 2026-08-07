-- migration_comparecimento_pericia.sql
--
-- Botoes "Compareceu" / "Nao compareceu" na tarefa de confirmacao, e o
-- backfill das que ja existem.
--
--   Compareceu     -> andamento + comeca a conferencia do resultado (10 em 10)
--   Nao compareceu -> andamento + tarefa de analise pro dia seguinte util,
--                     e cancela a conferencia (pericia que nao aconteceu nao
--                     tem resultado a esperar)
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Template: marca o item de confirmacao pro app mostrar os botoes
-- ---------------------------------------------------------------------------
update public.tarefa_templates
   set itens = (
     select jsonb_agg(
       case when item->>'titulo' like 'Confirmar comparecimento na perícia%'
            then item || jsonb_build_object(
                   'meta', coalesce(item->'meta','{}'::jsonb)
                           || jsonb_build_object('confirmar_comparecimento', true))
            else item end
       order by ord)
     from jsonb_array_elements(itens) with ordinality as t(item, ord)
   )
 where nome = 'pericia_parceiro'
   and itens::text like '%Confirmar comparecimento na perícia%';

-- ---------------------------------------------------------------------------
-- 2. Backfill: tarefas de comparecimento que ja existem ganham os botoes
-- ---------------------------------------------------------------------------
-- Cobre tanto o titulo do template atual quanto os que vieram da migracao do
-- Tramitacao Inteligente ("Contatar pericia - Cliente compareceu?",
-- "CONTATAR PARCEIRO - CLIENTE COMPARECEU?").
update public.tarefas t
   set metadata = coalesce(t.metadata, '{}'::jsonb)
                  || jsonb_build_object('confirmar_comparecimento', true)
 where t.status in ('a_fazer', 'fazendo')
   and coalesce((t.metadata->>'confirmar_comparecimento')::boolean, false) = false
   and (
     t.titulo ilike 'Confirmar comparecimento na perícia%'
     or t.titulo ilike '%cliente compareceu?%'
     or t.descricao ilike '%cliente compareceu?%'
   );

-- ---------------------------------------------------------------------------
-- 3. pericia_em nas tarefas de comparecimento, quando da pra saber
-- ---------------------------------------------------------------------------
-- Fonte 1: evento de pericia do proprio caso.
update public.tarefas t
   set metadata = coalesce(t.metadata,'{}'::jsonb)
                  || jsonb_build_object('pericia_em', e.start_at::text,
                                        'pericia_em_origem', 'evento da agenda')
  from (select caso_id, max(start_at) as start_at
          from public.agenda_eventos where tipo='pericia' group by caso_id) e
 where e.caso_id = t.caso_id
   and t.status in ('a_fazer','fazendo')
   and coalesce((t.metadata->>'confirmar_comparecimento')::boolean, false)
   and t.metadata->>'pericia_em' is null;

-- Fonte 2: a propria tarefa e "pericia + 1 dia" — entao da pra voltar um dia.
-- So vale pras do template (titulo padronizado); nas da migracao do TI o
-- prazo foi posto a mao e nao segue essa regra.
update public.tarefas t
   set metadata = coalesce(t.metadata,'{}'::jsonb)
                  || jsonb_build_object(
                       'pericia_em', (t.due_at - interval '1 day')::text,
                       'pericia_em_origem', 'deduzida do prazo (pericia + 1 dia)')
 where t.status in ('a_fazer','fazendo')
   and coalesce((t.metadata->>'confirmar_comparecimento')::boolean, false)
   and t.metadata->>'pericia_em' is null
   and t.due_at is not null
   and t.titulo ilike 'Confirmar comparecimento na perícia%';

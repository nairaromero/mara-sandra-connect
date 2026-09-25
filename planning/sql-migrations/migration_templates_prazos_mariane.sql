-- Ajustes de template do #397 (respostas da Mara, 25/09):
--
--   1. Análise de Indeferimento: 5 → 10 dias. (Com relógio, a data vem da
--      data do indeferimento + 10 — o offset vale só para quem aplica sem
--      relógio.)
--   2. Exigência ADMINISTRATIVA (template `exigencia`) passa da Naira para a
--      Mariane, com a Mara acompanhando (interessada). A exigência judicial
--      segue como está (Bia).
--   3. Protocolo administrativo (`protocolo_requerimento` e `protocolo`) passa
--      da Naira para a Mariane. O protocolo judicial segue com a Bia.
--   4. Marcas das janelas de prazo (ver o item 4 no fim do arquivo).
--
-- A revisão da inicial (10 → 5 dias) e o protocolo da corrente administrativa
-- (Bia → Mariane) moram no código da corrente (montagem-inicial.tsx).
--
-- Troca de pessoa só onde o item ainda está com a Naira: o outro escritório do
-- staging (sem executor) e qualquer ajuste feito à mão ficam como estão.
--
-- Idempotente.

-- 1. Análise de Indeferimento: 10 dias.
update public.tarefa_templates t
   set itens = (
         select jsonb_agg(
                  case when x.it->>'titulo' like 'Analise de Indeferimento%'
                       then jsonb_set(x.it, '{offset_dias}', '10'::jsonb)
                       else x.it end
                  order by x.ord)
           from jsonb_array_elements(t.itens) with ordinality as x(it, ord)),
       updated_at = now()
 where t.nome = 'indeferido'
   and exists (select 1 from jsonb_array_elements(t.itens) it
                where it->>'titulo' like 'Analise de Indeferimento%'
                  and coalesce(it->>'offset_dias', '') <> '10');

-- 2 e 3. Naira → Mariane (+ Mara interessada na exigência).
update public.tarefa_templates t
   set itens = (
         select jsonb_agg(
                  case when x.it->>'executor_email' = 'nairaromerovian@gmail.com'
                       then
                         case when t.nome = 'exigencia'
                              then jsonb_set(
                                     jsonb_set(x.it, '{executor_email}', '"marianefer@gmail.com"'::jsonb),
                                     '{interessados_emails}',
                                     (select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
                                        from (select jsonb_array_elements_text(coalesce(x.it->'interessados_emails', '[]'::jsonb)) e
                                              union select 'marasandra.adv@gmail.com') z
                                       where e <> 'marianefer@gmail.com'))
                              else jsonb_set(x.it, '{executor_email}', '"marianefer@gmail.com"'::jsonb)
                         end
                       else x.it end
                  order by x.ord)
           from jsonb_array_elements(t.itens) with ordinality as x(it, ord)),
       updated_at = now()
 where t.nome in ('exigencia', 'protocolo_requerimento', 'protocolo')
   and exists (select 1 from jsonb_array_elements(t.itens) it
                where it->>'executor_email' = 'nairaromerovian@gmail.com');

-- 4. Marcas das janelas (#397, Mara 25/09) — o gatilho de tarefas lê estas
--    marcas para pôr a data automática e o teto:
--      aguardando_exigencia  "Aguardando documentos…" das duas exigências
--                            (vence amanhã, vai até fatal − 3);
--      analise_deferimento   Análise de Deferimento (amanhã, até o 10º dia);
--      fatal_padrao_dias     FATAL da exigência INSS: o form já vem com
--                            hoje + 30, editável quando o INSS der menos.
update public.tarefa_templates t
   set itens = (
         select jsonb_agg(
                  case
                    when x.it->>'titulo' like 'Aguardando documentos%'
                      then jsonb_set(x.it, '{meta}',
                             coalesce(x.it->'meta', '{}'::jsonb) || '{"aguardando_exigencia": true}'::jsonb)
                    when t.nome = 'exigencia' and x.it->>'titulo' like 'FATAL - CUMPRIMENTO DE EXIGENCIA%'
                      then jsonb_set(x.it, '{meta}',
                             coalesce(x.it->'meta', '{}'::jsonb) || '{"fatal_padrao_dias": 30}'::jsonb)
                    when x.it->>'titulo' like 'Analise de Deferimento%'
                      then jsonb_set(x.it, '{meta}',
                             coalesce(x.it->'meta', '{}'::jsonb) || '{"analise_deferimento": true}'::jsonb)
                    else x.it
                  end
                  order by x.ord)
           from jsonb_array_elements(t.itens) with ordinality as x(it, ord)),
       updated_at = now()
 where t.nome in ('exigencia', 'exigencia_judicial', 'concedido')
   and exists (select 1 from jsonb_array_elements(t.itens) it
                where (it->>'titulo' like 'Aguardando documentos%'
                       and coalesce(it->'meta'->>'aguardando_exigencia', '') <> 'true')
                   or (t.nome = 'exigencia' and it->>'titulo' like 'FATAL - CUMPRIMENTO DE EXIGENCIA%'
                       and coalesce(it->'meta'->>'fatal_padrao_dias', '') <> '30')
                   or (it->>'titulo' like 'Analise de Deferimento%'
                       and coalesce(it->'meta'->>'analise_deferimento', '') <> 'true'));

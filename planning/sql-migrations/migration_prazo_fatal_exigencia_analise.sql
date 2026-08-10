-- Estende o controle de prazo fatal (adiar exige justificativa registrada em
-- andamento interno) a mais tres tarefas, alem da corrente de montagem:
--
--   exigencia  -> "FATAL - CUMPRIMENTO DE EXIGENCIA"  (ja tinha 30 dias)
--   concedido  -> "Analise de Deferimento"            (0 -> 5 dias)
--   indeferido -> "Analise de Indeferimento"          (0 -> 5 dias)
--
-- NAO entra a "Aguardando documentos do parceiro" da exigencia: quem controla
-- o prazo ali e o parceiro, nao o escritorio — o fatal e o cumprimento.
--
-- As duas analises passam de "vence hoje" para 5 dias por decisao da Naira
-- ("nao podem passar 5 dias"). E uma folga maior no papel, mas agora com trava:
-- adiar alem disso exige justificativa gravada.
--
-- Casa por TITULO e nao por indice: a posicao dos itens muda quando alguem
-- acrescenta um item ao template.
--
-- Idempotente.

-- FATAL - CUMPRIMENTO DE EXIGENCIA: so marca, mantem os 30 dias.
update public.tarefa_templates t
   set itens = (
         select jsonb_agg(
                  case when x.it->>'titulo' like 'FATAL - CUMPRIMENTO DE EXIGENCIA%'
                       then jsonb_set(
                              x.it, '{meta}',
                              coalesce(x.it->'meta', '{}'::jsonb) || '{"prazo_fatal": true}'::jsonb
                            )
                       else x.it end
                  order by x.ord
                )
           from jsonb_array_elements(t.itens) with ordinality as x(it, ord)
       ),
       updated_at = now()
 where t.nome = 'exigencia'
   and exists (
     select 1 from jsonb_array_elements(t.itens) it
      where it->>'titulo' like 'FATAL - CUMPRIMENTO DE EXIGENCIA%'
        and coalesce((it->'meta'->>'prazo_fatal')::boolean, false) is not true
   );

-- Analises de deferimento e indeferimento: marca E fixa o prazo em 5 dias.
update public.tarefa_templates t
   set itens = (
         select jsonb_agg(
                  case when x.it->>'titulo' like 'Analise de Deferimento%'
                         or x.it->>'titulo' like 'Analise de Indeferimento%'
                       then jsonb_set(
                              jsonb_set(
                                x.it, '{meta}',
                                coalesce(x.it->'meta', '{}'::jsonb) || '{"prazo_fatal": true}'::jsonb
                              ),
                              '{offset_dias}', '5'::jsonb
                            )
                       else x.it end
                  order by x.ord
                )
           from jsonb_array_elements(t.itens) with ordinality as x(it, ord)
       ),
       updated_at = now()
 where t.nome in ('concedido', 'indeferido')
   and exists (
     select 1 from jsonb_array_elements(t.itens) it
      where (it->>'titulo' like 'Analise de Deferimento%'
             or it->>'titulo' like 'Analise de Indeferimento%')
        and (coalesce((it->'meta'->>'prazo_fatal')::boolean, false) is not true
             or coalesce(it->>'offset_dias', '') <> '5')
   );

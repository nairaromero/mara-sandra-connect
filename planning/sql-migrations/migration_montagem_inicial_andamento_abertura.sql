-- Andamento de abertura da montagem de inicial.
--
-- A corrente ja registrava as transicoes (revisao, protocolo) e o desfecho
-- (protocolada). Faltava o comeco: quando a Mara aplica o template e o caso vai
-- pra Bia montar. Sem isso o historico comecava no meio.
--
-- INTERNO (visivel_parceiro=false), como os outros dois de passagem de bastao:
-- sao passos internos do escritorio, e todo andamento visivel dispara e-mail ao
-- parceiro. So o protocolo — o desfecho que interessa a ele — fica visivel.
--
-- O item entra no template com destino=andamento; o TarefaSheet ja sabe criar
-- andamento a partir disso quando a equipe aplica o template pela tela.
--
-- Idempotente.

update public.tarefa_templates
   set itens = itens || jsonb_build_array(jsonb_build_object(
         'destino', 'andamento',
         'tipo', 'interno',
         'titulo', 'Caso enviado para montagem de inicial',
         'descricao',
           'O caso foi encaminhado para montagem da petição inicial. ' ||
           'Prazo de 10 dias corridos para seguir à revisão.',
         'visivel_parceiro', false,
         'meta', jsonb_build_object('montagem_inicial', true, 'etapa_concluida', 'abertura')
       )),
       updated_at = now()
 where nome = 'montagem_inicial'
   and not exists (
     select 1 from jsonb_array_elements(itens) it
      where it->>'titulo' = 'Caso enviado para montagem de inicial'
   );

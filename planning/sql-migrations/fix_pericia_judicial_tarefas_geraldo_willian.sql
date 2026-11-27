-- Correção de DADOS (não é migration; não entra no registro).
--
-- Duas tarefas abertas de conferir perícia nasceram em agosto/2026 com o
-- template do INSS, mas a perícia é judicial (conferido pela Naira em
-- 27/11/2026): Geraldo Pereira Gomes e Willian de Oliveira Brito.
-- Os botões já passam a ser os do laudo pela regra nova (vale o processo);
-- aqui só se acerta o que a pessoa LÊ na tarefa e o template gravado.
-- O template anterior fica em metadata.template_anterior.
--
-- Só toca tarefa aberta, ligada a processo judicial e ainda com o template do
-- INSS: rodar de novo não faz nada.

update public.tarefas t
   set titulo    = 'Conferir laudo da perícia judicial - ' || cl.nome,
       descricao = 'Conferir se o laudo saiu nos autos. Se ainda não saiu, use o botão para reagendar a próxima conferência em 10 dias. Quando sair, comunicar o parceiro.',
       metadata  = t.metadata || jsonb_build_object(
                     'template_aplicado', 'pericia_judicial',
                     'template_anterior', t.metadata->>'template_aplicado',
                     'correcao', 'pericia judicial lancada com o template do INSS')
  from public.casos k
  join public.clientes cl on cl.id = k.cliente_id
 where k.id = t.caso_id
   and t.id in ('8466d1e5-72f4-458a-b85b-909117ed5e5a',   -- Geraldo
                '13a92cd2-cfbe-4a4c-8a24-fc0a9c470631')   -- Willian
   and t.status in ('a_fazer', 'fazendo')
   and t.processo_judicial_id is not null
   and t.metadata->>'template_aplicado' = 'pericia_parceiro';

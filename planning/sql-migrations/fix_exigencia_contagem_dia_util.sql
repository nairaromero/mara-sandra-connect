-- Correção de DADOS (não é migration; não entra no registro).
--
-- A única exigência do INSS aberta em produção cuja contagem começou numa sexta
-- (criada em 27/11/2026), recalculada pela regra da
-- migration_prazo_conta_do_dia_util: o prazo começa a contar no próximo dia
-- útil. Conferido com a Naira em 27/11/2026. As linhas vão pelo id.
--
--                         antes               depois
--   fatal (30 dias)       dom 27/12           ter 29/12
--   tarefa FATAL (−1)     sex 25/12 09:00     seg 28/12 09:00
--   teto do "Aguardando"  qui 24/12           sex 25/12  (26/12 é sábado)
--   prazo do parceiro     qui 24/12 23:59     sex 25/12 23:59
--
-- O vencimento do "Aguardando documentos" (04/12, escolhido à mão) não muda.
--
-- `session_replication_role = replica` só nesta transação: o teto de uma janela
-- é travado por gatilho (ninguém muda pela edição da tarefa), e esta correção é
-- justamente a troca do teto. Cada update confere o valor de ANTES — rodar de
-- novo, ou depois de alguém ter mexido, não faz nada.

begin;
set local session_replication_role = replica;

update public.tarefas
   set metadata = metadata || jsonb_build_object('prazo_fatal_em', '2026-12-29', 'teto_em', '2026-12-25'),
       updated_at = now()
 where id = '969abc43-6e0e-4774-8b9c-d110b7d0fd06'
   and status in ('a_fazer', 'fazendo')
   and metadata->>'prazo_fatal_em' = '2026-12-27'
   and metadata->>'teto_em' = '2026-12-24';

update public.tarefas
   set due_at = timestamptz '2026-12-28 09:00:00-03',
       metadata = metadata || jsonb_build_object('prazo_fatal_em', '2026-12-29'),
       updated_at = now()
 where id = '669cf075-bc6a-458d-8ffe-7faa0e97c2db'
   and status in ('a_fazer', 'fazendo')
   and metadata->>'prazo_fatal_em' = '2026-12-27'
   and due_at = timestamptz '2026-12-25 09:00:00-03';

update public.solicitacoes_documento
   set prazo_at = timestamptz '2026-12-25 23:59:59-03'
 where id = '8cdf3fc6-6400-48d7-857b-7efe69848ef8'
   and status = 'pendente'
   and (prazo_at at time zone 'America/Sao_Paulo')::date = date '2026-12-24';

commit;

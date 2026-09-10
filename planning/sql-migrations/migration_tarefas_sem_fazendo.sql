-- migration_tarefas_sem_fazendo.sql
--
-- Naira (2026-09-09): "Fazendo" sai de tarefas. A aba Ativos passa a ter só
-- "A fazer"; Arquivados fica com "Feitos" e o log de "Excluídas".
--
-- O status 'fazendo' nunca pegou no uso real (1 tarefa em produção, 0 no
-- staging) e só duplicava coluna vazia no kanban. Aqui: as tarefas que
-- estiverem em 'fazendo' voltam pra 'a_fazer' (nenhuma some) e o CHECK deixa
-- de aceitar o valor, pra ninguém reintroduzir por API/SQL.
--
-- 'cancelado' CONTINUA no CHECK: são 183 tarefas antigas (159 da migração do
-- Tramitação) que ainda vivem no banco. Elas deixam de aparecer na UI — o
-- histórico continua consultável no banco.
--
-- Nenhuma função do banco ESCREVE 'fazendo' (só filtros de leitura
-- `status in ('a_fazer','fazendo')`, que seguem corretos e inertes), então
-- apertar o CHECK não quebra trigger nenhum.
--
-- Idempotente: re-rodar não faz nada de novo.

begin;

update public.tarefas
   set status = 'a_fazer'
 where status = 'fazendo';

alter table public.tarefas
  drop constraint if exists tarefas_status_check;

alter table public.tarefas
  add constraint tarefas_status_check
  check (status = any (array['a_fazer'::text, 'feito'::text, 'cancelado'::text]));

commit;

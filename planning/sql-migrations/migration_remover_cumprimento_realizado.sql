-- migration_remover_cumprimento_realizado.sql
--
-- Remove o template tarefa_templates.cumprimento_realizado. O fluxo agora
-- é controlado pelo checklist "Exigência cumprida" dentro da tarefa
-- "Documento entregue — cumprir exigência no INSS" (criada pelo trigger
-- _solicitacao_atendida_cria_tarefa).
--
-- Tarefas/andamentos antigos gerados pelo template ficam intactos
-- (só estamos removendo o template, não o histórico).
--
-- Idempotente.

DELETE FROM public.tarefa_templates WHERE nome = 'cumprimento_realizado';

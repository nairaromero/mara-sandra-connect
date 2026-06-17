-- migration_templates_protocolo_checklist.sql
--
-- Adiciona meta.protocolo_realizado=true nos 3 templates de protocolo. Esse
-- flag faz a tarefa render o checklist "Protocolo realizado" no frontend.
-- No template protocolo_inicial, adiciona também meta.via_judicial=true
-- pra o componente saber que o andamento de conclusão deve dizer "vamos
-- seguir o processo na via judicial".
--
-- Idempotente.

UPDATE public.tarefa_templates
SET itens = jsonb_set(
  itens,
  '{0,meta}',
  '{"protocolo_realizado": true}'::jsonb,
  true
)
WHERE nome IN ('protocolo', 'protocolo_requerimento');

UPDATE public.tarefa_templates
SET itens = jsonb_set(
  itens,
  '{0,meta}',
  '{"protocolo_realizado": true, "via_judicial": true}'::jsonb,
  true
)
WHERE nome = 'protocolo_inicial';

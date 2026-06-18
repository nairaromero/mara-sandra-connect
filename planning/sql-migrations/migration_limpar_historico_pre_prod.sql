-- migration_limpar_historico_pre_prod.sql
--
-- LIMPEZA DESTRUTIVA — pré-produção real.
--
-- Apaga TODOS os dados operacionais (clientes, casos, andamentos,
-- documentos, solicitações, tarefas) e os 2 parceiros teste (Andre,
-- Camila). Mantém:
--   - usuários internos (Naira, Mara Sandra, Mariane)
--   - etiquetas (24, importadas do TI)
--   - tarefa_templates (18, configuração do sistema)
--
-- Storage do bucket "documentos" é limpo via script separado (não dá pra
-- truncar via SQL puro — os blobs ficam no backend S3).
--
-- IDs dos parceiros teste:
--   Andre  = e11d9a06-ce2a-4746-9f2f-3a55bc658c8f
--   Camila = c86f970e-e6d6-40d5-837b-5a0b0fee63e1
--
-- NÃO é idempotente — só roda uma vez. Reexecutar é seguro mas no-op.

BEGIN;

-- Dados operacionais (ordem evita FK violations).
DELETE FROM public.tarefas;
DELETE FROM public.solicitacoes_documento;
DELETE FROM public.documentos;
DELETE FROM public.andamentos;
DELETE FROM public.clientes_etiquetas;
DELETE FROM public.casos;
DELETE FROM public.clientes;

-- Tabelas relacionadas (limpeza opcional pra cobrir todo o histórico).
DELETE FROM public.alertas_duplicidade;
DELETE FROM public.comentarios;

-- Parceiros teste — public.usuarios.
DELETE FROM public.usuarios
WHERE id IN (
  'e11d9a06-ce2a-4746-9f2f-3a55bc658c8f',  -- Andre
  'c86f970e-e6d6-40d5-837b-5a0b0fee63e1'   -- Camila
);

-- auth.users (login) — só dá pra apagar via service_role/admin.
DELETE FROM auth.users
WHERE id IN (
  'e11d9a06-ce2a-4746-9f2f-3a55bc658c8f',
  'c86f970e-e6d6-40d5-837b-5a0b0fee63e1'
);

COMMIT;

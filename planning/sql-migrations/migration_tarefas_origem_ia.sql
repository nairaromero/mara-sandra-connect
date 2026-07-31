-- Migration: adiciona 'ia' aos valores permitidos de tarefas.origem
--
-- Fase 4 do planning/PROCESSOS_GLOBAL.md: a edge ia-triagem-andamentos cria
-- tarefas sugeridas pela IA a partir de movimentações/publicações novas, com
-- origem='ia' e origem_ref='ia:<andamento_id>' (dedup pelo índice único
-- uq_tarefas_origem_ref, que já cobre origem <> 'manual').
--
-- Idempotente: drop + recreate do CHECK com a lista completa atual.

ALTER TABLE public.tarefas DROP CONSTRAINT IF EXISTS tarefas_origem_check;
ALTER TABLE public.tarefas ADD CONSTRAINT tarefas_origem_check
  CHECK (origem IN (
    'manual', 'template', 'sync_inss_email', 'sync_djen', 'sync_legalmail',
    'migracao_ti', 'ia'
  ));

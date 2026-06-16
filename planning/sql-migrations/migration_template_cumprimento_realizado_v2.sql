-- =============================================================================
-- Migration: template "Cumprimento Realizado" — andamento p/ parceiro +
--             flag acompanhamento_processual na tarefa
--
-- Decisão Naira (2026-06-16):
--   - O cumprimento de exigência precisa COMUNICAR o parceiro de que
--     realizamos a exigência (andamento visível).
--   - A tarefa "Acompanhamento de agendamento de pericia" deve ter o
--     mesmo escalonamento 30/60/120 (Ouvidoria/Peticionamento/Ajuizamento)
--     que a "Acompanhamento Processual" — habilitado pelo flag meta.
--     acompanhamento_processual=true.
--
-- Estrutura final (2 itens):
--   [0] andamento  "Cumprimento de Exigência realizado"
--                  (visivel_parceiro=true → notify-novo-andamento dispara)
--   [1] tarefa     "Acompanhamento de agendamento de pericia"
--                  com meta.acompanhamento_processual=true → mostra os
--                  botões Ouvidoria 30d / Peticionamento 60d / Ajuizamento 120d.
--
-- Idempotente.
-- =============================================================================

update public.tarefa_templates
   set itens = '[
     {
       "destino": "andamento",
       "tipo": "interno",
       "titulo": "Cumprimento de Exigência realizado",
       "descricao": "Realizamos o cumprimento da exigência do INSS. Vamos acompanhar o agendamento da perícia médica.",
       "visivel_parceiro": true
     },
     {
       "titulo": "Acompanhamento de agendamento de pericia",
       "descricao": "Cumprimento de exigencia realizado. Aguardar nova analise. Requerimento {protocolo}.",
       "tipo": "pericia",
       "prioridade": 2,
       "offset_dias": 0,
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"],
       "meta": { "acompanhamento_processual": true }
     }
   ]'::jsonb,
   updated_at = now()
 where nome = 'cumprimento_realizado';

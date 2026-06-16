-- =============================================================================
-- Migration: tarefa_templates ganha `rotulo` (display label) + novos templates
--
-- DECISÕES (Naira, 2026-06-15):
--   - `nome` continua snake_case (identificador estável usado pelo
--     edge function INSS e pela RPC). UI passa a exibir `rotulo` (string
--     bonita) com fallback pro nome se vazio.
--   - Templates atuais ganham rotulo formatado (palavras capitalizadas,
--     com "de" minúsculo onde fizer sentido).
--   - Três novos templates manuais:
--       * Protocolo de Requerimento   (offset 1d)
--       * Protocolo de Inicial        (offset 1d)
--       * Protocolo                   (offset 1d)
--     Servem como atalhos de criação rápida de tarefa de acompanhamento de
--     protocolo nas primeiras 24h.
-- Idempotente.
-- =============================================================================

alter table public.tarefa_templates
  add column if not exists rotulo text;

-- Templates visíveis: rotulos bonitos.
update public.tarefa_templates set rotulo = 'Em Análise'              where nome = 'em_analise';
update public.tarefa_templates set rotulo = 'Exigência'               where nome = 'exigencia';
update public.tarefa_templates set rotulo = 'Concedido'               where nome = 'concedido';
update public.tarefa_templates set rotulo = 'Indeferido'              where nome = 'indeferido';
update public.tarefa_templates set rotulo = 'Cumprimento Realizado'   where nome = 'cumprimento_realizado';
update public.tarefa_templates set rotulo = 'Acompanhamento Processual' where nome = 'requerimento_aberto';

-- Templates ocultos: rotulos também (caso virem visíveis no futuro).
update public.tarefa_templates set rotulo = 'Cliente é Procurador'    where nome = 'cliente_eh_procurador';
update public.tarefa_templates set rotulo = 'Pagamento Processado'    where nome = 'pagamento_processado';
update public.tarefa_templates set rotulo = 'Pendente — Cumprimento Protocolado' where nome = 'pendente_cumprimento_protocolado';
update public.tarefa_templates set rotulo = 'Pendente — Outros'       where nome = 'pendente_outros';
update public.tarefa_templates set rotulo = 'Pendente — Perícia Remarcada' where nome = 'pendente_pericia_remarcada';
update public.tarefa_templates set rotulo = 'Sobrestado'              where nome = 'sobrestado';
update public.tarefa_templates set rotulo = 'Revisar Classificação'   where nome = 'revisar_classificacao';
update public.tarefa_templates set rotulo = 'Revisar E-mail Não Casado' where nome = 'revisar_email_nao_casado';

-- Novos templates: Protocolo (offset_dias=1).
insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values
(
  'protocolo_requerimento',
  'Protocolo de Requerimento',
  'protocolo_requerimento',
  'Atalho para criar tarefa de acompanhamento de protocolo de requerimento administrativo.',
  '[
    {
      "titulo": "Protocolo de Requerimento - {nome_cliente}",
      "descricao": "Acompanhar o protocolo de requerimento administrativo. Requerimento {protocolo}.",
      "tipo": "pos_protocolo",
      "prioridade": 2,
      "offset_dias": 1,
      "executor_email": "nairaromerovian@gmail.com",
      "interessados_emails": ["marasandra.adv@gmail.com"]
    }
  ]'::jsonb,
  false
),
(
  'protocolo_inicial',
  'Protocolo de Inicial',
  'protocolo_inicial',
  'Atalho para criar tarefa de acompanhamento de protocolo de petição inicial.',
  '[
    {
      "titulo": "Protocolo de Inicial - {nome_cliente}",
      "descricao": "Acompanhar o protocolo de petição inicial. Processo {protocolo}.",
      "tipo": "pos_protocolo",
      "prioridade": 2,
      "offset_dias": 1,
      "executor_email": "nairaromerovian@gmail.com",
      "interessados_emails": ["marasandra.adv@gmail.com"]
    }
  ]'::jsonb,
  false
),
(
  'protocolo',
  'Protocolo',
  'protocolo',
  'Atalho para criar tarefa genérica de acompanhamento de protocolo.',
  '[
    {
      "titulo": "Protocolo - {nome_cliente}",
      "descricao": "Acompanhar o protocolo.",
      "tipo": "pos_protocolo",
      "prioridade": 2,
      "offset_dias": 1,
      "executor_email": "nairaromerovian@gmail.com",
      "interessados_emails": ["marasandra.adv@gmail.com"]
    }
  ]'::jsonb,
  false
)
on conflict (nome) do update set
  rotulo = excluded.rotulo,
  gatilho = excluded.gatilho,
  descricao = excluded.descricao,
  itens = excluded.itens,
  oculto_na_ui = excluded.oculto_na_ui,
  updated_at = now();

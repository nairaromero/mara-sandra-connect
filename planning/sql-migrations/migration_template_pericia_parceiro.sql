-- =============================================================================
-- Migration: template "Perícia (com parceiro)" — pericia_parceiro
--
-- Esse template é "misto": 1 item vira evento na agenda, 2 itens viram
-- tarefas relativas à data da perícia.
--
-- Items:
--   [0] destino=tarefa  → contatar parceiro p/ lembrar da perícia.
--       due_relative_to=sexta_antes_agenda → na sexta-feira anterior à
--       data da perícia (varia por dia da semana da perícia).
--   [1] destino=agenda  → o agendamento da perícia em si (tipo=pericia,
--       data/hora/local definidos pela Naira na UI).
--   [2] destino=tarefa  → contatar parceiro p/ verificar comparecimento.
--       due_relative_to=agenda + offset_dias=1 → 1 dia após a perícia.
--
-- Não é selecionável no TarefaSheet (a UI filtra templates com destino=
-- agenda). É escolhido no AgendaSheet, que pede data/hora/local do evento
-- e cria evento+tarefas em uma transação lógica.
--
-- Idempotente.
-- =============================================================================

insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'pericia_parceiro',
  'Perícia (com parceiro)',
  'pericia_parceiro',
  'Agenda a perícia + cria 2 tarefas de contato com parceiro (lembrete antes + verificação depois).',
  '[
    {
      "destino": "tarefa",
      "titulo": "Contatar parceiro - lembrar da perícia - {nome_cliente}",
      "descricao": "Pedir ao parceiro indicador que instrua o cliente sobre a perícia (data, local, documentos a levar). Lembrete enviado na sexta-feira anterior à perícia.",
      "tipo": "contato_cliente",
      "prioridade": 1,
      "due_relative_to": "sexta_antes_agenda",
      "executor_email": "nairaromerovian@gmail.com",
      "interessados_emails": ["marasandra.adv@gmail.com"]
    },
    {
      "destino": "agenda",
      "tipo": "pericia",
      "titulo": "Perícia - {nome_cliente}",
      "descricao": "Perícia médica do INSS.",
      "duracao_min": 60
    },
    {
      "destino": "tarefa",
      "titulo": "Verificar comparecimento na perícia - {nome_cliente}",
      "descricao": "Confirmar com o parceiro indicador se o cliente compareceu à perícia e como foi o atendimento.",
      "tipo": "contato_cliente",
      "prioridade": 2,
      "due_relative_to": "agenda",
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

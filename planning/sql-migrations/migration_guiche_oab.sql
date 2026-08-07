-- migration_guiche_oab.sql
--
-- Guiche (atendimento online da OAB): template que agenda o guiche, cria a
-- tarefa de acompanhamento e registra andamento visivel ao parceiro com o
-- MOTIVO que a equipe digitar na hora do agendamento.
--
-- O guiche e sempre de um cliente (decisao da Naira): o andamento precisa de
-- caso pra existir e pra o parceiro ver.
--
-- Idempotente.

-- 1. 'guiche' vira um tipo de evento da agenda
alter table public.agenda_eventos drop constraint if exists agenda_eventos_tipo_check;
alter table public.agenda_eventos add constraint agenda_eventos_tipo_check
  check (tipo = any (array['pericia','audiencia','reuniao','interno','guiche']));

-- 2. Template
insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'guiche_oab',
  'Guichê OAB',
  'guiche_oab',
  'Agenda o guichê na OAB, cria a tarefa de acompanhamento e avisa o parceiro do motivo.',
  '[
    {
      "destino": "agenda",
      "tipo": "guiche",
      "titulo": "Guichê OAB - {nome_cliente}",
      "descricao": "Atendimento online no guichê da OAB.",
      "duracao_min": 30
    },
    {
      "destino": "tarefa",
      "titulo": "Guichê OAB - {nome_cliente}",
      "descricao": "Atendimento no guichê da OAB. Motivo: {motivo}",
      "tipo": "interna",
      "prioridade": 1,
      "due_relative_to": "agenda",
      "offset_dias": 0,
      "meta": { "guiche": true }
    },
    {
      "destino": "andamento",
      "titulo": "Guichê agendado na OAB",
      "descricao": "Agendamos atendimento no guichê da OAB. Motivo: {motivo}",
      "visivel_parceiro": true,
      "meta": { "guiche": true }
    }
  ]'::jsonb,
  false
)
on conflict (nome) do update
  set rotulo = excluded.rotulo,
      gatilho = excluded.gatilho,
      descricao = excluded.descricao,
      itens = excluded.itens,
      oculto_na_ui = excluded.oculto_na_ui;

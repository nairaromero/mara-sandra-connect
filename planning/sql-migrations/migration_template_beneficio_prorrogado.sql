-- =============================================================================
-- Migration: template beneficio_prorrogado
--
-- Caso novo descoberto no end-to-end (cliente Eliana, 2026-06-15):
-- INSS prorroga benefício por incapacidade. E-mail tem:
--   - status_assunto = "CONCLUÍDA"
--   - despacho: "A perícia médica reconheceu a sua incapacidade ... e o
--     benefício 7297918009 foi prorrogado. Data da cessação do benefício:
--     14/09/2026."
--
-- Decisão (Naira): criar 2 tarefas:
--   1. Ciência da prorrogação           → prazo HOJE (offset_dias=0)
--   2. Solicitar laudo ao parceiro pra
--      pedir nova prorrogação           → prazo CESSAÇÃO − 20 dias
--      (due_relative_to=data_cessacao, offset_dias=-20)
--
-- Template fica oculto na UI porque depende da extração da data de cessação
-- do e-mail — só faz sentido via edge function INSS.
-- Idempotente.
-- =============================================================================

insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'beneficio_prorrogado',
  'Benefício Prorrogado',
  'beneficio_prorrogado',
  'INSS prorrogou benefício por incapacidade. Cria ciência hoje + tarefa pra solicitar laudo 20 dias antes da nova cessação.',
  '[
    {
      "titulo": "Ciência da prorrogação do benefício - {nome_cliente}",
      "descricao": "INSS prorrogou o benefício. Requerimento {protocolo}.\n\nDespacho:\n{despacho}",
      "tipo": "interna",
      "prioridade": 2,
      "offset_dias": 0,
      "executor_email": "nairaromerovian@gmail.com",
      "interessados_emails": ["marasandra.adv@gmail.com"]
    },
    {
      "titulo": "Solicitar laudo ao parceiro para nova prorrogação - {nome_cliente}",
      "descricao": "Cessação do benefício se aproxima — pedir laudo médico atualizado ao parceiro para requerer nova prorrogação.\n\nRequerimento {protocolo}.\n\nDespacho original:\n{despacho}",
      "tipo": "contato_cliente",
      "prioridade": 1,
      "offset_dias": -20,
      "due_relative_to": "data_cessacao",
      "executor_email": "nairaromerovian@gmail.com",
      "interessados_emails": ["marasandra.adv@gmail.com"]
    }
  ]'::jsonb,
  true
)
on conflict (nome) do update set
  rotulo = excluded.rotulo,
  gatilho = excluded.gatilho,
  descricao = excluded.descricao,
  itens = excluded.itens,
  oculto_na_ui = excluded.oculto_na_ui,
  updated_at = now();

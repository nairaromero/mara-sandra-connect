-- =============================================================================
-- Migration: montagem de REQUERIMENTO ADMINISTRATIVO + ajustes da auditoria
-- (aprovado pela Naira, 2026-09-01).
--
-- 1) Template novo `montagem_requerimento_adm` — corrente igual à da montagem
--    de inicial (montagem → revisão → protocolo, widget MontagemInicial na
--    variante administrativa; a última etapa pede o Nº DO REQUERIMENTO, cria
--    o processo administrativo e liga o Acompanhamento Processual 30/60/120).
--    Nasce dos desfechos da tarefa "Cliente novo — Analisar" (widget novo).
--
-- 2) Template `protocolo` genérico OCULTO da UI (redundante com Protocolo de
--    Requerimento / de Inicial — veredito da auditoria). Não é apagado:
--    histórico e robô não usam, mas a regra da casa é ocultar, não destruir.
--
-- 3) Item "Analise de Indeferimento" do template `indeferido` ganha
--    meta.analise_indeferimento=true — ativa o widget de desfecho
--    (Ajuizar → montagem de inicial / Recurso adm / Encerrar com motivo).
--
-- Idempotente. SÓ STAGING até a Naira validar.
-- =============================================================================

insert into public.tarefa_templates (nome, gatilho, rotulo, descricao, itens)
values (
  'montagem_requerimento_adm',
  'montagem_requerimento_adm',
  'Montagem de Requerimento (INSS)',
  'Corrente administrativa: montagem, revisão e protocolo do requerimento no INSS.',
  jsonb_build_array(
    jsonb_build_object(
      'destino', 'tarefa',
      'titulo', 'Montagem do requerimento - {nome_cliente}',
      'descricao', 'Montar o requerimento administrativo com a documentação do caso. Ao terminar, use o botão "Enviar para revisão".',
      'tipo', 'interna',
      'prioridade', 2,
      'offset_dias', 7,
      'meta', jsonb_build_object('montagem_requerimento', true, 'etapa', 'montagem')
    ),
    jsonb_build_object(
      'destino', 'andamento',
      'titulo', 'Caso enviado para montagem de requerimento administrativo',
      'descricao', 'Vamos montar o requerimento administrativo e protocolar no INSS.',
      'visivel_parceiro', true
    )
  )
)
on conflict (nome) do update
  set rotulo = excluded.rotulo, descricao = excluded.descricao, itens = excluded.itens;

update public.tarefa_templates
   set oculto_na_ui = true
 where nome = 'protocolo';

-- meta.analise_indeferimento no primeiro item do `indeferido` (idempotente:
-- reescreve o meta do item 0 preservando o resto do item).
update public.tarefa_templates
   set itens = jsonb_set(
     itens, '{0,meta}',
     coalesce(itens->0->'meta', '{}'::jsonb)
       || '{"analise_indeferimento": true}'::jsonb,
     true
   )
 where nome = 'indeferido';

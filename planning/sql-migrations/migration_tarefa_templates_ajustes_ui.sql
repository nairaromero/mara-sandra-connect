-- =============================================================================
-- Migration: tarefa_templates — coluna oculto_na_ui + ajustes de matriz
--
-- DECISÕES (Naira, 2026-06-15):
--   - Adicionar coluna `oculto_na_ui boolean default false`. Templates de
--     fallback (revisar_*) e classificações que só fazem sentido via e-mail
--     (cliente_eh_procurador, sobrestado, pendente_*, pagamento_processado)
--     ficam ocultos no dropdown da UI; continuam disponíveis pra edge
--     function `inss-email-processor` (que usa service_role).
--
--   - `cumprimento_realizado`: titulo passa a ser "Acompanhamento de
--     agendamento de pericia".
--
--   - `requerimento_aberto`: offset_dias=30, titulo "Acompanhamento
--     Processual", descricao "Em caso de não haver movimentação fazer
--     Ouvidoria". Marcado com meta.acompanhamento_processual=true para
--     habilitar os botões de etapas (30d ouvidoria / 60d peticionamento de
--     mora / 120d ajuizamento) no card da tarefa.
--
-- Idempotente.
-- =============================================================================

alter table public.tarefa_templates
  add column if not exists oculto_na_ui boolean not null default false;

-- Marca como oculto os templates que só fazem sentido em automação.
update public.tarefa_templates
   set oculto_na_ui = true
 where nome in (
   'cliente_eh_procurador',
   'pagamento_processado',
   'pendente_cumprimento_protocolado',
   'pendente_outros',
   'pendente_pericia_remarcada',
   'sobrestado',
   'revisar_classificacao',
   'revisar_email_nao_casado'
 );

-- Garante que os "operacionais" estão visíveis (caso alguém tenha alternado).
update public.tarefa_templates
   set oculto_na_ui = false
 where nome in (
   'em_analise',
   'exigencia',
   'concedido',
   'indeferido',
   'cumprimento_realizado',
   'requerimento_aberto'
 );

-- cumprimento_realizado: novo título.
update public.tarefa_templates
   set itens = jsonb_build_array(
     jsonb_build_object(
       'titulo', 'Acompanhamento de agendamento de pericia',
       'descricao', 'Cumprimento de exigencia realizado. Aguardar nova analise. Requerimento {protocolo}.',
       'tipo', 'pericia',
       'prioridade', 2,
       'offset_dias', 0,
       'executor_email', 'nairaromerovian@gmail.com',
       'interessados_emails', jsonb_build_array('marasandra.adv@gmail.com')
     )
   ),
   descricao = 'Cumprimento de exigência foi realizado — agendar perícia / acompanhar nova análise.',
   updated_at = now()
 where nome = 'cumprimento_realizado';

-- requerimento_aberto: prazo 30d, título "Acompanhamento Processual",
-- descrição padrão sobre ouvidoria, meta para habilitar os botões de etapas.
update public.tarefa_templates
   set itens = jsonb_build_array(
     jsonb_build_object(
       'titulo', 'Acompanhamento Processual',
       'descricao', 'Em caso de não haver movimentação fazer Ouvidoria. Requerimento {protocolo}.',
       'tipo', 'pos_protocolo',
       'prioridade', 3,
       'offset_dias', 30,
       'executor_email', 'nairaromerovian@gmail.com',
       'interessados_emails', jsonb_build_array('marasandra.adv@gmail.com'),
       'meta', jsonb_build_object('acompanhamento_processual', true)
     )
   ),
   descricao = 'Acompanhamento processual com escalonamento: 30d ouvidoria, 60d peticionamento de mora, 120d ajuizamento.',
   updated_at = now()
 where nome = 'requerimento_aberto';

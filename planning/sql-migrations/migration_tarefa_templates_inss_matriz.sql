-- =============================================================================
-- Migration: Templates de tarefa do INSS — matriz 1-pra-1 com a skill agente-inss
--
-- CONTEXTO: a migration anterior (migration_tarefas.sql) seedou 4 templates
-- genéricos como placeholder. Aqui substituímos pela MATRIZ real do runbook
-- em ~/Documents/AI/Projeto Automacao Mara/AgenteINSS/agente_inss_config.json
-- (matriz_tarefas), com 12 classificações, títulos com placeholders e
-- executor/interessado por papel.
--
-- DECISÕES:
--   - Nome do template = id da classificação do runbook
--     (em_analise, exigencia, concedido, indeferido, cumprimento_realizado,
--     pendente_cumprimento_protocolado, pendente_pericia_remarcada,
--     pendente_outros, requerimento_aberto, pagamento_processado, sobrestado,
--     cliente_eh_procurador). Edge function `inss-email-processor` classifica
--     e chama o template pelo mesmo id.
--   - Items recebem novos campos: `descricao`, `executor_email`,
--     `interessados_emails`. Campos antigos (`titulo`, `tipo`, `prioridade`,
--     `offset_dias`) seguem iguais.
--   - Placeholders permitidos no titulo/descricao: {nome_cliente}, {protocolo},
--     {despacho}, {servico}, {nb}. Substituição é feita pelo CHAMADOR (edge
--     function), não pela RPC aplicar_template — porque os valores vêm do
--     contexto do e-mail INSS, não do banco.
--   - executor_email = "nairaromerovian@gmail.com" / "marasandra.adv@gmail.com"
--     etc. Edge function resolve email → usuarios.id; se não encontrar
--     (usuário ainda não cadastrado), grava responsavel_id=null e guarda o
--     email em metadata.responsavel_email_pendente para backfill futuro.
--   - `tipo` por classificação:
--       prazo  → tarefas com offset_dias > 0 (ex: cumprimento de exigência)
--       contato_cliente → tarefas que envolvem comunicação com parceiro/cliente
--       interna → análise interna (análise de deferimento/indeferimento)
--       pericia → perícia marcada/remarcada
--       pos_protocolo → acompanhamento de requerimento recém-aberto
--
-- Depende de: migration_tarefas.sql. Idempotente: substitui por nome.
-- =============================================================================

-- Limpa seeds antigos (os 4 genéricos `inss_*` da migration anterior).
delete from public.tarefa_templates
where nome in ('inss_exigencia','inss_indeferimento','inss_pericia_marcada','inss_deferimento');

insert into public.tarefa_templates (nome, gatilho, descricao, itens) values
(
  'em_analise',
  'em_analise',
  'Status do INSS alterado para EM ANÁLISE.',
  '[
    {"titulo":"Acompanhamento - {nome_cliente}","descricao":"Status alterado para EM ANALISE no INSS. Requerimento {protocolo}.","tipo":"pos_protocolo","prioridade":3,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'exigencia',
  'exigencia',
  'INSS exigiu documentos — comunicar parceiro e marcar prazo fatal de 30 dias.',
  '[
    {"titulo":"Comunicar parceiro + pedir documentos - {nome_cliente}","descricao":"Exigencia do INSS no requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"contato_cliente","prioridade":1,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]},
    {"titulo":"FATAL - CUMPRIMENTO DE EXIGENCIA - {nome_cliente}","descricao":"Prazo de 30 dias para cumprir a exigencia. Requerimento {protocolo}.","tipo":"prazo","prioridade":1,"offset_dias":30,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'concedido',
  'deferimento',
  'Benefício concedido pelo INSS.',
  '[
    {"titulo":"Analise de Deferimento - {nome_cliente}","descricao":"Beneficio concedido. Requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"interna","prioridade":1,"offset_dias":0,"executor_email":"marasandra.adv@gmail.com","interessados_emails":["nairaromerovian@gmail.com"]},
    {"titulo":"Baixar PA + informar parceiro - {nome_cliente}","descricao":"Beneficio concedido. Baixar PA no Meu INSS e comunicar parceiro. Requerimento {protocolo}.","tipo":"contato_cliente","prioridade":1,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'indeferido',
  'indeferimento',
  'Benefício indeferido pelo INSS.',
  '[
    {"titulo":"Analise de Indeferimento - {nome_cliente}","descricao":"Beneficio indeferido. Requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"interna","prioridade":1,"offset_dias":0,"executor_email":"marasandra.adv@gmail.com","interessados_emails":["nairaromerovian@gmail.com"]},
    {"titulo":"Baixar PA + informar parceiro - {nome_cliente}","descricao":"Beneficio indeferido. Baixar PA no Meu INSS e comunicar parceiro. Requerimento {protocolo}.","tipo":"contato_cliente","prioridade":1,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'cumprimento_realizado',
  'cumprimento_realizado',
  'Cumprimento de exigência foi realizado — aguardar nova análise.',
  '[
    {"titulo":"Aguardar nova analise - {nome_cliente}","descricao":"Cumprimento de exigencia realizado. Aguardar nova analise. Requerimento {protocolo}.","tipo":"pos_protocolo","prioridade":3,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'pendente_cumprimento_protocolado',
  'pendente_cumprimento_protocolado',
  'Status PENDENTE com cumprimento de exigência protocolado.',
  '[
    {"titulo":"Aguardar nova analise - {nome_cliente}","descricao":"Cumprimento de exigencia protocolado. Aguardar nova analise. Requerimento {protocolo}.","tipo":"pos_protocolo","prioridade":3,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'pendente_pericia_remarcada',
  'pendente_pericia_remarcada',
  'Perícia foi remarcada — checar nova data no Meu INSS.',
  '[
    {"titulo":"Lembrete de nova pericia - {nome_cliente}","descricao":"Pericia remarcada pelo INSS. Verificar nova data no Meu INSS. Requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"pericia","prioridade":1,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'pendente_outros',
  'pendente_outros',
  'Status PENDENTE com despacho não classificado — revisão manual.',
  '[
    {"titulo":"Revisao manual - Pendente - {nome_cliente}","descricao":"Status PENDENTE com despacho nao classificado. Revisar manualmente. Requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"interna","prioridade":2,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'requerimento_aberto',
  'requerimento_aberto',
  'Requerimento aberto no INSS — aguardar próxima movimentação.',
  '[
    {"titulo":"Acompanhar requerimento aberto - {nome_cliente}","descricao":"Requerimento {protocolo} aberto no INSS. Aguardar proxima movimentacao. Servico: {servico}.","tipo":"pos_protocolo","prioridade":3,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'pagamento_processado',
  'pagamento_processado',
  'Pagamento processado pelo INSS — verificar detalhes.',
  '[
    {"titulo":"Acompanhamento - pagamento processado - {nome_cliente}","descricao":"Pagamento processado pelo INSS. Verificar detalhes. Requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"interna","prioridade":2,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'sobrestado',
  'sobrestado',
  'Status SOBRESTADO ou DILIGÊNCIA — definir tratamento.',
  '[
    {"titulo":"Revisao manual - Sobrestado/Diligencia - {nome_cliente}","descricao":"Status sobrestado/diligencia. Definir tratamento. Requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"interna","prioridade":2,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'cliente_eh_procurador',
  'cliente_eh_procurador',
  'E-mail INSS direcionado ao procurador — identificar cliente real.',
  '[
    {"titulo":"Identificar cliente real - movimentacao ao procurador","descricao":"E-mail do INSS direcionado ao procurador. Identificar cliente real do requerimento {protocolo}.\n\nDespacho:\n{despacho}","tipo":"interna","prioridade":2,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":["marasandra.adv@gmail.com"]}
  ]'::jsonb
),
(
  'revisar_email_nao_casado',
  'revisar_email_nao_casado',
  'E-mail INSS chegou mas não conseguimos casar com cliente (decisão 3a do plano).',
  '[
    {"titulo":"Revisar e-mail INSS nao casado - {nome_cliente}","descricao":"E-mail do INSS chegou mas nao conseguimos casar com cliente cadastrado.\n\nNome extraido: {nome_cliente}\nCPF extraido: {cpf}\nProtocolo: {protocolo}\nNB: {nb}\n\nDespacho:\n{despacho}\n\nAcao: revisar manualmente, cadastrar cliente se necessario e aplicar template apropriado.","tipo":"interna","prioridade":2,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":[]}
  ]'::jsonb
),
(
  'revisar_classificacao',
  'revisar_classificacao',
  'Classificação ficou fora da matriz — revisar e classificar manualmente (decisão 4b do plano).',
  '[
    {"titulo":"Revisar classificacao INSS - {nome_cliente}","descricao":"E-mail do INSS nao bateu com nenhuma classificacao da matriz.\n\nProtocolo: {protocolo}\nStatus assunto: {status_assunto}\n\nDespacho:\n{despacho}\n\nAcao: revisar e classificar manualmente.","tipo":"interna","prioridade":2,"offset_dias":0,"executor_email":"nairaromerovian@gmail.com","interessados_emails":[]}
  ]'::jsonb
)
on conflict (nome) do update set
  gatilho   = excluded.gatilho,
  descricao = excluded.descricao,
  itens     = excluded.itens,
  updated_at = now();

-- =============================================================================
-- Migration: template "Concedido" — adiciona andamento automático ao parceiro
--
-- Decisão Naira (2026-06-16):
--   - O andamento "Benefício Concedido — iremos analisar e repassar" é
--     visível ao parceiro e substitui a parte "informar parceiro" da
--     segunda tarefa.
--   - Renomeia "Baixar PA + informar parceiro" → "Baixar PA".
--
-- Estrutura final do template (3 itens):
--   [0] tarefa     "Analise de Deferimento - {nome_cliente}"
--   [1] andamento  "Benefício Concedido — iremos analisar e repassar"
--                  (visivel_parceiro=true → notify-novo-andamento dispara
--                   e-mail pro parceiro)
--   [2] tarefa     "Baixar PA - {nome_cliente}"
--
-- Idempotente.
-- =============================================================================

update public.tarefa_templates
   set itens = '[
     {
       "titulo": "Analise de Deferimento - {nome_cliente}",
       "descricao": "Beneficio concedido. Requerimento {protocolo}.\n\nDespacho:\n{despacho}",
       "tipo": "interna",
       "prioridade": 1,
       "offset_dias": 0,
       "executor_email": "marasandra.adv@gmail.com",
       "interessados_emails": ["nairaromerovian@gmail.com"]
     },
     {
       "destino": "andamento",
       "tipo": "interno",
       "titulo": "Benefício Concedido — iremos analisar e repassar",
       "descricao": "O INSS deferiu o benefício do(a) cliente. Estamos analisando o requerimento {protocolo} e em breve repassaremos os detalhes (RMI, atrasados, próximos passos).",
       "visivel_parceiro": true
     },
     {
       "titulo": "Baixar PA - {nome_cliente}",
       "descricao": "Beneficio concedido. Baixar PA no Meu INSS. Requerimento {protocolo}.",
       "tipo": "contato_cliente",
       "prioridade": 1,
       "offset_dias": 0,
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"]
     }
   ]'::jsonb,
   updated_at = now()
 where nome = 'concedido';

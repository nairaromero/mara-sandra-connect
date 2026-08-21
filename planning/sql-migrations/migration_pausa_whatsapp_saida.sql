-- Pausa a saida de WhatsApp (2026-08-20)
--
-- POR QUE: a instancia da Evolution responde HTTP 500 desde 12/08. O consumidor
-- (n8n) continua buscando da fila e chamando a API, entao cada comentario novo
-- de interno em caso com parceiro vira uma entrada que tenta 5 vezes e falha.
-- Em 20/08: 19 falhas acumuladas, a ultima em 19/08, mais 4 pendentes criadas
-- no mesmo dia. Ninguem e avisado da falha.
--
-- Nenhum parceiro chegou a ser avisado de que receberia WhatsApp — a
-- funcionalidade nunca foi anunciada. O aviso por e-mail e caminho separado
-- (edge function notify-novo-comentario, chamada pelo frontend) e NAO e
-- afetado por esta migration.
--
-- ESCOPO: so pausa. Nao apaga trigger, funcao, tabela nem historico. O plano de
-- retomada esta em planning/whatsapp/PLANO_LINHA_DEDICADA.md.
--
-- COMO REVERTER:
--   alter table public.comentarios enable trigger trg_whatsapp_comentario_novo;
--
-- Idempotente: pode rodar varias vezes.

-- 1) Para de enfileirar mensagem nova.
alter table public.comentarios disable trigger trg_whatsapp_comentario_novo;

-- 2) Cancela o que ainda esta na fila, para nao virar "falhou" na proxima
--    tentativa. Nao mexe no que ja foi enviado nem no que ja falhou — o
--    historico fica intacto para diagnostico.
update public.whatsapp_outbox
   set status = 'cancelado'
 where status = 'pendente';

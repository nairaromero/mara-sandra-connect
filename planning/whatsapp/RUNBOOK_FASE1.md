# Runbook — Fase 1: saída do WhatsApp (outbox + n8n + 1 evento)

> Objetivo: validar o **caminho de saída** ponta-a-ponta, sem nenhuma ação
> destrutiva. Quando o **interno** comentar num caso, o **parceiro** recebe um
> WhatsApp. Só isso por enquanto.
>
> Pré-requisito: Fase 0 concluída (Evolution rodando, instância `mara`
> conectada, `sendText` manual funcionou).

Decisões desta fase (2026-05-31):
- Fila **dedicada e desacoplada** (não deriva de `webhook_eventos`).
- Primeiro evento: **comentário novo do interno**.
- Credenciais do Evolution ficam em **variáveis do n8n** (migram pro Vault depois,
  junto com TI/Legalmail na aba Integrações).

Arquivos:
- `../sql-migrations/migration_whatsapp_outbox.sql` — tabela + funções + trigger.
- `n8n-workflow-saida.json` — poller que chama o `sendText`.

---

## Passo 1 — Aplicar a migration no Supabase (produção)

Projeto de produção: `llugytkdsfsrciavhrfw`. Rode o conteúdo de
`migration_whatsapp_outbox.sql` no **SQL Editor** do Supabase (ou via CLI).
É idempotente — pode rodar de novo sem efeito colateral.

Confira que criou:
```sql
select to_regclass('public.whatsapp_outbox');                  -- não-nulo
select proname from pg_proc
 where proname in ('whatsapp_enqueue','whatsapp_claim_batch',
                   'whatsapp_mark_result','whatsapp_normalize_telefone');
select tgname from pg_trigger where tgname = 'trg_whatsapp_comentario_novo';
```

---

## Passo 2 — Garantir o telefone do parceiro de teste (com DDI)

A saída manda para `usuarios.telefone`, **só dígitos, incluindo o código do
país**. O parceiro de teste é o número do marido (espanhol, +34).

```sql
-- veja como está salvo:
select id, nome, tipo, telefone,
       public.whatsapp_normalize_telefone(telefone) as normalizado
  from public.usuarios
 where tipo = 'parceiro';
```
O campo `normalizado` precisa sair tipo `34XXXXXXXXX` (DDI 34 + número).
Se vier sem o `34` na frente, corrija o `telefone` do parceiro (ex. via tela
de Parceiros ou um `update`), senão o Evolution não entrega.

---

## Passo 3 — Importar o workflow no n8n e criar as variáveis

1. No n8n (`nairavian-n8n.de`): **Workflows → Import from File** →
   `n8n-workflow-saida.json`.
2. **Settings → Variables**, crie:
   - `EVOLUTION_SERVER_URL` = `https://evo.nairavian-n8n.de`
   - `EVOLUTION_API_KEY`    = (a API key do `.env` da Fase 0)
   - `EVOLUTION_INSTANCE`   = `mara`
3. Nos nós **Claim Batch** e **Marcar resultado**, selecione a credencial
   Postgres **service_role** do Supabase (a MESMA do workflow de webhooks).
4. Confira o `typeVersion` dos nós (ajuste se a sua versão do n8n reclamar).
5. **Ative** o workflow (toggle Active).

> A credencial Postgres service_role já existe se você montou o workflow de
> webhooks. Se não, crie uma com a connection string do Supabase (role
> `service_role`). Ela nunca aparece no chat nem no git.

---

## Passo 4 — Smoke test (o coração da Fase 1)

1. No app, abra um caso **cujo `parceiro_id` seja o parceiro de teste** (o
   número do marido) e **adicione um comentário como usuário interno** (a Naira).
2. Em até ~20s o poller pega e envia. Confirme no banco:
```sql
select id, telefone, tipo, status, tentativas, http_status, erro, enviado_at
  from public.whatsapp_outbox
 order by created_at desc limit 5;
```
   - `status='enviado'` e `http_status` 2xx → **Fase 1 OK**.
   - `status='pendente'` com `erro` → veja a mensagem (telefone sem DDI, API key,
     instância desconectada). Corrija e ele tenta de novo no backoff.
3. Confirme no celular do parceiro de teste que a mensagem chegou.

Teste negativo (não deve mandar nada):
- Comentário feito **pelo próprio parceiro** → trigger ignora (autor não é interno).
- Caso sem `parceiro_id` ou parceiro sem telefone → não enfileira.

---

## Rollback (se precisar desligar)

```sql
-- só desliga o disparo, mantém a fila e o histórico:
drop trigger if exists trg_whatsapp_comentario_novo on public.comentarios;
```
Ou, no n8n, **desative** o workflow (para de enviar; a fila acumula em 'pendente').

---

## O que esta fase entrega
- `whatsapp_outbox` + `whatsapp_claim_batch`/`whatsapp_mark_result` (backoff).
- Trigger `comentario.novo` (interno → parceiro).
- Poller n8n chamando `sendText`.
- 1 mensagem real entregue ao parceiro de teste.

Próximo: **Fase 2** (entrada — Edge `whatsapp-inbound`, sessões, menu, responder
comentário pelo WhatsApp). Ver [../INTEGRACAO_WHATSAPP.md](../INTEGRACAO_WHATSAPP.md) §12.

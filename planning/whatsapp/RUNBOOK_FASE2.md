# Runbook — Fase 2: entrada do WhatsApp (menu + adicionar comentário)

> Objetivo: o **parceiro** manda mensagem no WhatsApp e navega um **menu
> numerado** que termina em **adicionar comentário** num caso dele. As respostas
> do bot saem pelo MESMO outbox da Fase 1 (o poller n8n já ativo entrega).
>
> Pré-requisito: Fase 1 no ar (outbox + poller funcionando — já validado).

Decisões desta fase (2026-05-31):
- Entrada por **Edge Function direta** (`whatsapp-inbound`), protegida por token.
- Escopo **mínimo**: menu principal → meus casos → menu do caso → adicionar comentário.
- Sessão expira em **30 min**.
- Tabela de log `whatsapp_mensagens` para dedupe + auditoria + LGPD.

Arquivos:
- `../sql-migrations/migration_whatsapp_inbound.sql` — tabelas + RPCs.
- `../../supabase/functions/whatsapp-inbound/index.ts` — a Edge Function.

---

## Passo 1 — Migration (SQL Editor)

Cole o conteúdo de `migration_whatsapp_inbound.sql` no **SQL Editor** do Supabase
e rode (idempotente). Confira:

```sql
select to_regclass('public.whatsapp_sessoes')  as sessoes;     -- não-nulo
select to_regclass('public.whatsapp_mensagens') as mensagens;  -- não-nulo
select proname from pg_proc
 where proname in ('whatsapp_resolve_parceiro','whatsapp_enqueue_text',
                   'whatsapp_parceiro_add_comentario','whatsapp_canon_br',
                   'whatsapp_mensagens_purge')
 order by proname;  -- 5 linhas

-- sanidade do resolvedor (deve retornar o parceiro Andre):
select * from public.whatsapp_resolve_parceiro('34613784493');
```

---

## Passo 2 — Publicar a Edge Function

Sem CLI aqui, então **pelo dashboard**:

1. Supabase → **Edge Functions** → **Deploy a new function** (ou "Create function").
2. Nome: **`whatsapp-inbound`** (exatamente assim).
3. **Verify JWT: DESLIGADO** (toggle OFF). É um webhook público — quem autentica é
   o nosso token, não um JWT do Supabase. Se ficar ligado, o Evolution toma 401.
4. Cole o código de `supabase/functions/whatsapp-inbound/index.ts` no editor e
   **Deploy**.

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente —
> não precisa criar.

---

## Passo 3 — Secret do token

A Edge precisa do `WHATSAPP_INBOUND_TOKEN` (já gerado no seu `.env.local`).

1. Copie o valor para o clipboard:
   ```bash
   cd /Users/nairaromero/Documents/marasandraconnect
   grep '^WHATSAPP_INBOUND_TOKEN=' .env.local | cut -d= -f2- | tr -d '\n' | pbcopy
   echo "token no clipboard"
   ```
2. Supabase → **Edge Functions → Secrets** (ou Project Settings → Edge Functions)
   → **Add secret**: nome `WHATSAPP_INBOUND_TOKEN`, valor = **Cmd+V**.
3. Salve. (Se a função foi deployada antes do secret, faça um redeploy rápido.)

---

## Passo 4 — Apontar o webhook do Evolution (Claude faz via API)

Com a função publicada, o webhook da instância `mara` precisa apontar para:

```
https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/whatsapp-inbound?token=<TOKEN>
```

…escutando só o evento `MESSAGES_UPSERT`. O Claude configura isso pela API do
Evolution (lê o token do `.env.local`, não aparece no chat). Se preferir manual:
Evolution Manager → instância `mara` → Webhook → URL acima → eventos: Messages Upsert.

---

## Passo 5 — Smoke test (entrada ponta-a-ponta)

Do WhatsApp do **parceiro de teste (marido / `34613784493`)**, mande qualquer
mensagem para o número do bot (instância `mara`). Esperado:

1. Bot responde o **menu principal** (em ~20s, via outbox/poller).
2. Responda **`1`** → lista os casos do parceiro (Clerton — Em análise).
3. Responda **`1`** (o caso) → **menu do caso**.
4. Responda **`1`** (Adicionar comentário) → bot pede o texto.
5. Mande o texto do comentário → bot confirma **✅ Comentário registrado**.

Confira no banco:
```sql
select direcao, tipo, left(conteudo,40) conteudo, created_at
  from public.whatsapp_mensagens order by created_at desc limit 12;

select estado, contexto, expira_em from public.whatsapp_sessoes
 where telefone = '34613784493';

-- o comentário criado pelo parceiro:
select c.texto, c.created_at, u.nome autor, u.tipo
  from public.comentarios c join public.usuarios u on u.id = c.autor_id
 order by c.created_at desc limit 3;
```
O comentário deve aparecer com `autor.tipo = 'parceiro'` e estar visível na UI do
caso para o interno.

Teste negativo: mande mensagem de um número **não cadastrado** → resposta genérica
("Não reconhecemos este número…"), nenhuma ação.

---

## Rollback

- Apague/desligue o webhook da instância no Evolution (para de chegar entrada), ou
- remova o secret/della a função. As tabelas e o histórico ficam.

---

## Pendências conhecidas (pós-Fase 2)
- **Notificar o interno** quando o parceiro comenta pelo WhatsApp (email/coisa que
  hoje sai da UI). O INSERT direto não dispara a notificação da UI — avaliar na Fase 4.
- **Onboarding por código** (vínculo LID→parceiro em produção) ainda não construído.
- **Mídia** (foto/PDF) ainda não tratada (Fase 3) — hoje vira "opção inválida".
- **TLS da credencial Postgres do n8n** (pendência herdada da Fase 1).

---

## Lições do deploy (2026-05-31) — não repetir

- **LID do WhatsApp (crítico).** A mensagem de entrada chega com
  `key.remoteJid = "<dígitos>@lid"` (identificador anônimo por contato), **não o
  telefone**. Não dá para ENVIAR a um `@lid` (dá 400 "exists:false"). Por isso:
  - a tabela `whatsapp_lid_map` mapeia LID→parceiro (com telefone real em cache);
  - `whatsapp_resolve_parceiro(p_ident, p_via_lid)` casa por LID quando `p_via_lid`;
  - a RESPOSTA sempre vai para o telefone cadastrado (`@s.whatsapp.net`).
  - O LID do parceiro de teste (`76901926351084`) é semeado na §8 da migration.
  - **Produção:** vincular o LID via onboarding por CÓDIGO na SAÍDA (manda código
    pro telefone cadastrado, o parceiro responde, casa o LID).

- **`service_role` BYPASSRLS ≠ privilégio de tabela.** O service_role fura as
  *policies* de RLS mas precisa de GRANT explícito. Sem
  `grant ... to service_role`, o `.from().insert()/.select()` direto toma
  permission-denied que o supabase-js **engole em silêncio** (as RPCs SECURITY
  DEFINER mascaram). A migration já concede nas 3 tabelas novas.

- **Verify JWT precisa de RE-DEPLOY.** Em função criada pelo dashboard, desligar o
  toggle só vale após **re-deploy**. Antes disso o webhook toma 401
  `UNAUTHORIZED_NO_AUTH_HEADER`. E este projeto **desativou os JWT legados** → a
  anon/publishable key dá `UNAUTHORIZED_LEGACY_JWT` (não serve de workaround).

- **Latência:** entrada → enfileira no outbox → poller n8n (a cada 20s) → Evolution.
  Resposta chega em ~2–22s. Mais que 30s = algo travado.

---

## Liga/desliga da entrada (interruptor do webhook)

O webhook do Evolution é o interruptor da entrada. **Estado atual: DESLIGADO**
(2026-06-01, a pedido da Naira — só ligar durante janelas de teste). Enquanto
desligado, as mensagens recebidas se **perdem** (não há fila de entrada).

```bash
cd /Users/nairaromero/Documents/marasandraconnect
KEY=$(grep '^EVOLUTION_API_KEY=' .env.local | cut -d= -f2-)
TOK=$(grep '^WHATSAPP_INBOUND_TOKEN=' .env.local | cut -d= -f2-)
URL="https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/whatsapp-inbound?token=${TOK}"

# LIGAR (antes de testar):
curl -s -X POST -H "apikey: $KEY" -H "Content-Type: application/json" \
  https://evo.nairavian-n8n.de/webhook/set/mara \
  -d "{\"webhook\":{\"enabled\":true,\"url\":\"$URL\",\"events\":[\"MESSAGES_UPSERT\"],\"webhookByEvents\":false,\"webhookBase64\":false}}"

# DESLIGAR (depois do teste):
curl -s -X POST -H "apikey: $KEY" -H "Content-Type: application/json" \
  https://evo.nairavian-n8n.de/webhook/set/mara \
  -d "{\"webhook\":{\"enabled\":false,\"url\":\"$URL\",\"events\":[],\"webhookByEvents\":false,\"webhookBase64\":false}}"

# CONFERIR:
curl -s -H "apikey: $KEY" https://evo.nairavian-n8n.de/webhook/find/mara
```

---

## Lista/botões interativos (exploração 2026-06-01 — inconclusa)

Testados `POST /message/sendList/mara` e `/message/sendButtons/mara` (ambos HTTP
201 = aceitos pelo Evolution), mas **falta confirmar o que renderiza** no aparelho
do parceiro — o Baileys engole formatos interativos com frequência. Recomendação
(pendente de validação visual, decidir COM a Naira): manter o menu **numerado**
como base confiável; adotar **lista** só no menu principal se renderizar limpa;
deixar **botões** de fora se vierem quebrados (maior risco de ban).

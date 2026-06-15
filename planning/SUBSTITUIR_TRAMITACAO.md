# Substituir o Tramitação Inteligente — Mara Sandra Connect

> Status: **planejamento** (mapa mental aprovado pela Naira em 2026-06-15).
> Objetivo: assumir no sistema próprio tudo o que o **Tramitação Inteligente (TI)** faz hoje
> para a operação diária — tarefas, prazos, perícias, agenda, classificação de e-mails do INSS —
> deixando o TI no máximo como **fonte read-only** de movimentação administrativa do INSS
> até que se decida construir scraper próprio (ou abandonar de vez).

---

## 1. Motivação

O TI é usado hoje para duas coisas distintas:

1. **Acompanhamento administrativo INSS** — único canal automatizado para puxar movimentação
   admin do Meu INSS (não existe API pública; o TI faz scraping autenticado).
2. **Gestão operacional do escritório** — tarefas, prazos, agenda, perícias. Esse pedaço **não tem
   API de criação de tarefa** (ver [ARQUITETURA.md](ARQUITETURA.md) §"Tramitação Inteligente"),
   o que obriga vocês a operar via Chrome — frágil, lento, sem mobile, sem notificação útil.

A skill `/inss` ([agente-inss](../.claude/skills/) hoje na Cowork) já mostra o gargalo:
ela lê o Gmail, classifica os e-mails do INSS, busca o cliente no TI via API e cria a **nota**
no TI por API — mas para criar **tarefa** precisa cair no Chrome. O sistema próprio resolve isso
porque já tem (ou vai ter) API de tarefa.

> **Decisão arquitetural:** sair do TI nas partes de UX ruim (tarefas/agenda/prazos/mobile) e
> manter o TI como **feed read-only de movimentação admin INSS** até decisão posterior. Nada de
> scraper próprio nesta fase.

---

## 2. O que cada coisa faz hoje vs. onde vai morar

| Função | Hoje | Sistema próprio |
|---|---|---|
| Cadastro de cliente / caso | TI + nosso | **Nosso** (já existe) |
| Andamentos / linha do tempo | TI + nosso | **Nosso** (já existe) |
| Movimentação admin INSS | **TI (scraping)** | **TI continua** (read-only via API) |
| E-mail INSS → cliente + nota | `/inss` → TI API | **Edge function** (pipeline próprio) |
| E-mail INSS → tarefa | `/inss` → Chrome (humano) | **Edge function** (1 hop, auto) |
| Publicação DJE / DJEN | manual / TI | **Nosso** ([INTEGRACAO_DJE.md](INTEGRACAO_DJE.md)) |
| Intimação LegalMail | `sync-legalmail-caso` | **Nosso** (já existe) |
| Tarefas / kanban | **TI (Chrome)** | **Nosso** (a construir) |
| Prazos / perícias / countdown | **TI (Chrome)** | **Nosso** (a construir) |
| Agenda / calendário | **TI (Chrome)** | **Nosso** + Google Calendar 2-way |
| Mobile / push | nada decente | **PWA próprio** |
| Notificação cliente/parceiro | manual | **WhatsApp + e-mail + push** (já tem outbox) |

---

## 3. Mapa mental (6 pilares orbitando o caso)

Tudo gira em torno de `caso` (já existe em `casos`). Cada pilar é uma cápsula independente
que pendura ações em um caso.

### 3.1 Andamentos automáticos *(MVP 1 — começamos por aqui)*

O pipeline que **fecha o loop** do `/inss` sem humano no meio.

- **E-mail INSS** → edge function `inss-email-processor` classifica (mesma lógica da skill
  `agente-inss`) → cria `andamento` + `tarefa` com `due_at` por tipo de despacho.
- **DJEN** → publicação judicial via Comunica API CNJ → vira `andamento`
  ([INTEGRACAO_DJE.md](INTEGRACAO_DJE.md)).
- **LegalMail** → intimação eletrônica → vira `andamento` (`sync-legalmail-caso` já existe).
- **Saída comum:** todos viram `andamento` no caso e podem disparar `tarefa` automática
  conforme regra por tipo.

### 3.2 Tarefas (kanban) *(MVP 2)*

- Status: a fazer / fazendo / feito / cancelado.
- Campos: `caso_id`, `responsavel_id`, `tipo`, `prioridade`, `due_at`, `origem`.
- **Templates** por tipo de caso (ex: "protocolei admin" → 4 tarefas com offsets).
- Painel **"minhas hoje"** por advogada.
- Comentários e anexos ficam no próprio caso, não na tarefa.

### 3.3 Prazos & perícias *(MVP 3)*

- `tarefa.tipo IN ('prazo', 'pericia')` — não é entidade separada, é tarefa com semântica.
- Countdown automático no card, cor por urgência (verde / amarelo / vermelho).
- Alerta automático em **3d / 1d / hoje** (cron diário → notificação).
- Perícia vincula `documento` (laudo, encaminhamento) já no card.

### 3.4 Agenda + Google Calendar *(MVP 4)*

- `agenda_eventos` separado de `tarefas` (eventos têm hora e duração; tarefas têm prazo).
- Sync **2-way** com Google Calendar por advogada (token OAuth por usuária).
- Vista do escritório (todas as advogadas) + filtro por pessoa.
- Convite automático ao cliente por e-mail (Google envia).

### 3.5 Notificações *(transversal — pendura nos outros pilares)*

- Já existe outbox HMAC ([INTEGRACOES.md](INTEGRACOES.md)). Estender para:
  - **WhatsApp do escritório** ([INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md)).
  - **E-mail** transacional (parceiro + cliente).
  - **Push** no PWA.
- **Resumo diário** por advogada (cron 08:00): tarefas de hoje + prazos vencendo + perícias.

### 3.6 Mobile / 1 toque *(MVP 5)*

- PWA com push (mesmo backend de notificações).
- **Foto da pauta → IA extrai → cria tarefa** (mesmo pipeline da skill `agente-inss`,
  adaptado pra OCR de pauta de audiência).
- **Andamento em 1 clique** a partir de um caso já aberto no celular.
- **Áudio vira nota** (Whisper API ou similar).

---

## 4. Schema novo (Supabase)

### `tarefas`

```sql
create table tarefas (
  id           uuid primary key default gen_random_uuid(),
  caso_id      uuid not null references casos(id) on delete cascade,
  responsavel_id uuid references usuarios(id),
  tipo         text not null check (tipo in ('interna','prazo','pericia','pos_protocolo','contato_cliente')),
  status       text not null default 'a_fazer' check (status in ('a_fazer','fazendo','feito','cancelado')),
  prioridade   smallint not null default 2 check (prioridade between 1 and 4),
  titulo       text not null,
  descricao    text,
  due_at       timestamptz,
  origem       text not null default 'manual' check (origem in ('manual','template','sync_inss_email','sync_djen','sync_legalmail')),
  origem_ref   text,                    -- id do e-mail, hash da publicação, etc.
  lembretes    jsonb not null default '[]'::jsonb,  -- [{offset:'3d'},{offset:'1d'},{offset:'0d'}]
  gcal_event_id text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index on tarefas (responsavel_id, status, due_at);
create index on tarefas (caso_id, status);
```

### `tarefa_templates`

```sql
create table tarefa_templates (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  gatilho     text not null,            -- ex: 'protocolo_admin','indeferimento','exigencia'
  itens       jsonb not null,           -- [{titulo,tipo,offset_dias,prioridade}]
  ativo       boolean not null default true
);
```

### `agenda_eventos`

```sql
create table agenda_eventos (
  id              uuid primary key default gen_random_uuid(),
  caso_id         uuid references casos(id) on delete set null,
  responsavel_id  uuid references usuarios(id),
  tipo            text not null check (tipo in ('audiencia','pericia','reuniao','interno')),
  titulo          text not null,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  local           text,
  participantes   jsonb default '[]'::jsonb,
  gcal_event_id   text,
  gcal_calendar_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on agenda_eventos (responsavel_id, start_at);
```

### `usuario_google_oauth`

```sql
create table usuario_google_oauth (
  usuario_id     uuid primary key references usuarios(id) on delete cascade,
  refresh_token  text not null,         -- vault-encrypted
  calendar_id    text not null,         -- 'primary' ou ID específico
  scope          text not null,
  channel_id     text,                  -- watch channel pro push
  channel_expiration timestamptz,
  created_at     timestamptz not null default now()
);
```

---

## 5. Edge functions

| Função | Trigger | O que faz |
|---|---|---|
| `inss-email-processor` | Gmail push notification (ou cron 15min) | Lê e-mail, classifica via IA, bate cliente por CPF/nome, cria `andamento` + `tarefa` |
| `tarefa-template-aplicar` | RPC `aplicar_template(caso_id, template_id)` | Cria n tarefas com `due_at` calculado a partir de `today + offset` |
| `cron-prazos-alerta` | Cron diário (07:00) | Varre `tarefas.due_at` em 3d/1d/hoje, dispara notificação por canal |
| `cron-resumo-diario` | Cron diário (08:00) | Resumo por advogada: tarefas hoje + prazos + perícias |
| `gcal-sync-out` | Trigger pg_notify em `tarefas`/`agenda_eventos` | Cria/atualiza/remove evento no Google Calendar |
| `gcal-sync-in` | Webhook Google (channel watch) | Trazer mudanças do Google pro sistema |
| `dje-poll` | Cron diário | Comunica API CNJ → `andamento` (já planejado em INTEGRACAO_DJE.md) |
| `inss-pauta-ocr` | Upload de foto | OCR + IA extrai data/hora/local → cria `tarefa` ou `agenda_evento` |

---

## 6. Roadmap (ordem de entrega)

### MVP 1 — Pipeline INSS automático *(maior valor / menor risco)*

A skill `agente-inss` já tem a lógica. Migrar pra edge function fecha o loop sem humano.

1. Criar `tarefas` + `tarefa_templates`.
2. `inss-email-processor` (porta da skill pra Deno/edge).
3. Templates por tipo de despacho (exigência = 30d, indeferimento = 30d pra recurso, etc.).
4. Notificação WhatsApp via outbox.

**Entrega:** e-mail do INSS cai → tarefa criada → WhatsApp na advogada. Zero Chrome.

### MVP 2 — Tarefas + Kanban + "Hoje"

1. CRUD de `tarefas` com RLS.
2. Tela de kanban (board por caso + board geral).
3. Painel **"minhas hoje"** na home autenticada.
4. Comentários da tarefa vão pro `andamentos` do caso (mesma timeline).

### MVP 3 — Prazos & perícias

1. `cron-prazos-alerta`.
2. Render com countdown e cor.
3. Vincular `documento` no card (laudo, encaminhamento, AR).

### MVP 4 — Agenda + Google Calendar

1. OAuth Google por usuária ([usuario_google_oauth](#usuario_google_oauth)).
2. `agenda_eventos` + telas (dia / semana / mês).
3. `gcal-sync-out` + `gcal-sync-in` (channel watch).
4. Convite automático ao cliente.

### MVP 5 — Mobile / PWA

1. PWA + push (Web Push API).
2. "Foto da pauta → tarefa" (`inss-pauta-ocr`).
3. "Andamento em 1 clique" no celular.
4. "Áudio vira nota" via Whisper.

---

## 7. O que continua no TI (por enquanto)

- **Leitura** de movimentação admin INSS por API (`tramitacao_id` nos casos / requerimentos
  já existe — ver [ARQUITETURA.md](ARQUITETURA.md)).
- **Nada de criação** pelo TI a partir do MVP 1 — toda criação de tarefa nasce no sistema.

**Saída futura possível:**
- (a) Manter como está indefinidamente — TI vira "fonte de andamento INSS" e o resto é nosso.
- (b) Construir scraper próprio (Playwright + certificado) — só vale se TI ficar caro ou
  derrubar UX. Decisão pra depois do MVP 5.

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Classificação de e-mail INSS errada gera tarefa errada | Threshold de confiança; abaixo disso, cria tarefa "revisar e-mail" para humana |
| OAuth Google expira / refresh falha | Detectar 401, marcar `usuario_google_oauth.channel_expiration` e re-autenticar; UI mostra "reconectar Google" |
| Channel watch do Google expira (7d) | Renovar via cron diário |
| Templates de tarefa ficam desatualizados | Edição via UI; campo `ativo` permite descontinuar sem perder histórico |
| TI muda layout e quebra leitura admin INSS | Já é risco hoje; sem ação. Caso aconteça, acelerar decisão (a)/(b) do §7 |

---

## 9. Referências

- [ARQUITETURA.md](ARQUITETURA.md) — tabelas `casos`, `andamentos`, `requerimentos` e enums.
- [INTEGRACAO_DJE.md](INTEGRACAO_DJE.md) — fonte DJEN para publicações judiciais.
- [INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md) — canal WhatsApp do escritório.
- [INTEGRACAO_IA.md](INTEGRACAO_IA.md) — uso de LLM (classificação, OCR, transcrição).
- [INTEGRACOES.md](INTEGRACOES.md) §3.4 — LegalMail.
- Skill `agente-inss` na Cowork — lógica de classificação que migra pra `inss-email-processor`.

# Plano de integração — TI + Legalmail → Mara Sandra Connect

> Documento de implementação das integrações externas. Para arquitetura geral do app, ver [ARQUITETURA.md](ARQUITETURA.md).
> Para checklist de tarefas, ver [TODO.md](TODO.md).

---

## 1. O que cada API entrega

### 1.1 Tramitação Inteligente (TI)

Base: `https://planilha.tramitacaointeligente.com.br/api/v1`
Auth: `Authorization: Bearer <token>`
Rate limit: não documentado (parece tolerante)

| Endpoint | Funciona | O que entrega |
|---|---|---|
| `GET /usuarios` | sim | 4 operadores (admin + finances). Campos: id, name, email, roles, phone_mobile |
| `GET /clientes` | sim | **763 clientes**, 35 campos por cliente. Inclui CPF, RG, CNH, sexo, nascimento, dados dos pais, endereço completo, telefones, tags coloridas, `email_exclusivo` |
| `GET /clientes/{id}` | sim | Mesmo schema retornado como `{customer: {...}}` |
| `GET /notas` | sim | **789 notas**. Campos: content (texto livre), user (operador), customer (cliente), created_at, updated_at |
| `GET /tarefas` | **não (404)** | Não tem API. Continua via Chrome scrap |
| `GET /processos` ou variações | **não (404)** | TI não expõe processos administrativos do INSS via API |

**Endpoints de escrita confirmados (do código STAGE3 existente):**
- `POST /clientes` — cria cliente
- `POST /notas` — cria nota

⚠️ **Decisão tomada (2026-05-27): NÃO usaremos os endpoints de escrita.** TI é fonte só de leitura. Ver decisão 1 abaixo.

---

### 1.2 Legalmail

Base: `https://app.legalmail.com.br`
Auth: `api_key` como query parameter (não header)
Rate limit: **30 req/min**; bloqueio progressivo se violar 3× em 10min (10min → 30min → 1h → ... → 7 dias)

| Endpoint | Funciona | O que entrega |
|---|---|---|
| `GET /api/v1/lawsuit/all` | sim | Lista paginada de processos do workspace. Paginação por `offset`/`limit` (máx 50) |
| `GET /api/v1/lawsuit/detail?idprocesso=<INT>` | sim | Detalhe de um processo (mesmo schema do `all`) |
| `GET /api/v1/lawsuit/case-files?idprocesso=<INT>` | sim | **Lista de movimentações** do processo. Exemplo retornou **71 movimentações** num único processo |
| `GET /api/v1/inbox` | **não (404)** | Não tem endpoint específico de inbox |

**Schema de processo (lawsuit):**
```
idprocessos (PK string)
numero_processo (CNJ)
hash_processo (UUID)
last_import (timestamp da última sincronização do Legalmail com tribunal)
poloativo_nome (cliente)
polopassivo_nome (geralmente INSTITUTO NACIONAL DO SEGURO SOCIAL)
nome_classe + abreviatura_classe (ex.: "Cumprimento de Sentença contra a Fazenda Pública", "CumSenFaz")
juizo + foro + tribunal (ex.: "1ª Vara Gabinete JEF de Andradina", "TRF-3")
valor_causa
data_distribuicao
data_prazo
processo_tema (ex.: "Auxílio-Acidente (Art. 86) (6107)")
sistema_tribunal (pje, etc.)
inbox_atual (Abertos, Entrada, etc. — indica se tem movimentação não tratada)
campos_personalizados []
```

**Schema de movimentação (case-file):**
```
idmovimentacoes (PK)
fk_processo (FK para idprocessos)
titulo (ex.: "Sentença", "Despacho", "Manifestação")
id (id interno do tribunal)
data_movimentacao
tipo (principal | secundária | ...)
hash_documento (UUID — provavelmente serve para baixar o PDF da peça, mas endpoint ainda não confirmado)
```

---

## 2. Modelo mental de integração

A entidade central do Mara Sandra Connect é o **caso** (`casos`). Cada caso pode ter:

- 1 cliente (`clientes`)
- 0..1 parceiro (`usuarios` com tipo='parceiro')
- 0..N processos administrativos (`processos_admin`) — INSS
- 0..N processos judiciais (`processos_judiciais`) — Tribunais
- N andamentos (`andamentos`) com origem `interno | tramitacao | legalmail | sistema`
- N documentos, solicitações, mensagens, repasses, análises técnicas (já existem)

**Quem é a fonte de verdade do quê?**

| Entidade | Fonte primária | Sincronizado para |
|---|---|---|
| Cadastro de cliente (CPF, nome, contato) | TI | Mara Sandra Connect |
| Notas administrativas / histórico operacional | TI | `andamentos` (origem=tramitacao) |
| Tarefas (kanban) | TI (via Chrome) | — fora de escopo da API |
| Processos judiciais (CNJ, partes, juízo) | Legalmail | `processos_judiciais` |
| Movimentações judiciais | Legalmail | `andamentos` (origem=legalmail) |
| Tudo do operacional jurídico interno | Mara Sandra Connect | — (não escreve em TI) |

---

## 3. Mapeamento campo a campo

### 3.1 TI clientes → `clientes` (Supabase)

| TI | Supabase | Observação |
|---|---|---|
| `cpf_cnpj` | `cpf` | Chave única de match |
| `name` | `nome` | |
| `birthdate` | `data_nascimento` | |
| `phone_mobile` | `telefone` | |
| `email` | `email` | |
| `id` | `ti_customer_id` (já existe coluna) | Cache de ligação rápida |
| `tags` | `tags` (jsonb, já existe coluna) | Tags coloridas do TI |

**Regra de conflito (decidida):**
- Se cliente novo no TI → cria no Mara Sandra Connect
- Se já existe (mesmo CPF) → atualiza só campos vazios (não sobrescreve dado que escritório já preencheu)

### 3.2 TI notas → `andamentos` (Supabase)

| TI | Supabase | Observação |
|---|---|---|
| `content` (primeiros ~100 chars) | `titulo` | Resumo |
| `content` (completo) | `descricao` | |
| `created_at` | `data_evento` | |
| `user.id` (mapear) | `criado_por` | Precisa mapear user TI → user Mara Sandra. Por enquanto usar NULL e armazenar o email no metadata |
| — | `origem` | sempre `'tramitacao'` |
| — | `visivel_parceiro` | sempre `false` (notas TI são internas) |
| `id` (TI) | `metadata.ti_nota_id` | Para deduplicação em re-syncs |

**Atribuição ao caso:** se cliente tem múltiplos casos ativos, deixar `caso_id=NULL` (nota fica "do cliente", não de um caso específico) e o interno vincula manualmente na tela do caso.

### 3.3 Legalmail lawsuit → `processos_judiciais`

| Legalmail | Supabase | Observação |
|---|---|---|
| `numero_processo` | `numero_processo` | CNJ |
| `juizo` | `vara` | |
| `foro` ou inferido | `comarca` | Pode ser extraído do juízo |
| `tribunal` | (campo computado) | TRF-3 → SP, p.ex. |
| — | `uf` | Inferir a partir do tribunal/comarca |
| `data_distribuicao` | `data_distribuicao` | |
| `idprocessos` | `legalmail_id` | Já existe coluna |
| `last_import` | `ultima_sync` | Já existe coluna |
| `processo_tema` | `metadata.tema` ou similar | Sem coluna dedicada hoje |

**Regra de match (decidida):**
- Match por `poloativo_nome` ≈ `clientes.nome` (fuzzy)
- Se ambíguo ou sem match → `caso_id = NULL` e processo fica órfão
- Naira liga manualmente na tela "Processos órfãos para vincular" (a criar)

### 3.4 Legalmail case-files → `andamentos`

| Legalmail | Supabase | Observação |
|---|---|---|
| `titulo` | `titulo` | |
| (concatenar título + tipo) | `descricao` | |
| `data_movimentacao` | `data_evento` | |
| — | `origem` | sempre `'legalmail'` |
| — | `caso_id` | derivado do processo judicial vinculado |
| — | `visivel_parceiro` | `true` por default (mov. processual interessa ao parceiro) |
| `idmovimentacoes` | `metadata.legalmail_mov_id` | Deduplicação |
| `hash_documento` | `metadata.hash_documento` | Para baixar o PDF depois (endpoint não confirmado) |

---

## 4. Workflows n8n propostos

Quatro workflows independentes, todos rodando no `nairavian-n8n.de`.

### Workflow 1 — `ti-sync-clientes` (diário, manhã)

Pseudo:
```
1. GET /clientes do TI (paginado, todos)
2. Para cada cliente:
   - SELECT clientes WHERE cpf = <ti.cpf_cnpj>
   - Se não existe: INSERT (com ti_customer_id)
   - Se existe: UPDATE só nos campos vazios + ti_customer_id
3. Log de quantos foram criados/atualizados
```

Custo: ~16 requests (763 clientes / 50 por página).

### Workflow 2 — `ti-sync-notas` (a cada 1h)

```
1. SELECT last_synced_at FROM sync_log WHERE source='ti_notas'
2. GET /notas do TI (paginado)
3. Para cada nota:
   - Se nota.created_at < last_synced → ignora
   - SELECT cliente local pelo cliente.id do TI
   - Se cliente encontrado → INSERT andamento (origem='tramitacao', caso_id=NULL — interno decide vincular)
4. UPDATE sync_log SET last_synced_at = NOW()
```

### Workflow 3 — `legalmail-sync-processos` (a cada 4h)

```
1. GET /api/v1/lawsuit/all (paginado, offset/limit=50)
   - Pausa 2.1s entre requests (rate limit)
2. Para cada processo:
   - SELECT processos_judiciais WHERE legalmail_id = <idprocessos>
   - Se não existe → INSERT (sem caso_id, fica pra Naira vincular)
   - Se existe e last_import mudou → UPDATE + marcar para sync de movs
3. Tentar match automático por poloativo_nome ≈ clientes.nome
   - Se match único e claro → preencher caso_id
   - Se ambíguo (2+ matches) → órfão (caso_id NULL)
```

### Workflow 4 — `legalmail-sync-movs` (a cada 4h, após workflow 3)

```
1. SELECT processos_judiciais WHERE ultima_sync_movs < NOW() - 4h
   (priorizar os com inbox_atual='Entrada')
2. Para cada processo:
   - GET /api/v1/lawsuit/case-files?idprocesso=<legalmail_id>
   - Para cada movimentação:
     - SELECT andamentos WHERE metadata->>'legalmail_mov_id' = <idmovimentacoes>
     - Se não existe → INSERT andamento (origem='legalmail', caso_id derivado)
   - UPDATE processos_judiciais SET ultima_sync_movs = NOW()
   - Pausa 2.1s entre processos (rate limit)
```

**Capacidade:** 30 req/min ÷ ~50 processos = 1.5 min para sincronizar tudo. Tranquilo.

---

## 5. Decisões aplicadas (confirmadas em 2026-05-27)

### 5.1 Fluxo bidirecional? — NÃO
TI é fonte só de leitura. App **não escreve** em TI (nem clientes nem notas). Já está refletido na decisão 6.4 de [ARQUITETURA.md](ARQUITETURA.md).

### 5.2 Match cliente ↔ processo Legalmail ambíguo — NÃO VINCULAR
Quando `poloativo_nome` tem múltiplos matches em `clientes.nome`, deixa o processo **órfão** (`caso_id = NULL`). Criar tela "Processos órfãos para vincular" onde Naira faz a ligação manual.

### 5.3 Período histórico na primeira sincronização — 5 CLIENTES + TUDO DELES
Primeira sync de teste: pegar os **5 clientes mais recentes do TI** e importar **tudo deles**:
- Os 5 clientes (cadastro completo, tags, ti_customer_id)
- Notas do TI desses clientes
- Processos do Legalmail cujo `poloativo_nome` bate com nome desses clientes
- Movimentações desses processos

Esse escopo reduzido permite testar todo o fluxo end-to-end (TI clientes + TI notas + Legalmail processos + Legalmail movs + match fuzzy) sem custar muito rate limit. Depois que validar, abre pra todos os 763 clientes.

### 5.4 Notificações de movimentação nova — EMAIL + BADGE IN-APP
Quando vier movimentação nova do Legalmail (sentença, despacho, etc.):
- Email automático para interno **e** parceiro do caso
- Badge in-app (contador no sidebar, dot no caso)

**Dependência:** email precisa de Resend ou SMTP custom, que depende de domínio próprio. **Domínio `marasandraconnect.com` registrado em 2026-05-28.** Falta configurar DNS no Cloudflare + setup Resend.

### 5.5 Documentos do Legalmail — DECIDIR DEPOIS
Não decidido — antes precisa **pesquisar/testar o endpoint de download** com `hash_documento`. Já tentamos vários paths no `explorers/explorer_legalmail_v2.py` e todos retornaram 404. Próximos passos:
- Procurar na doc OpenAPI oficial (`https://app.legalmail.com.br/api/docs`) por endpoint que aceite `hash_documento`
- Se não tiver na doc, abrir issue/contato com Legalmail
- Só depois decidir se baixa auto ou sob demanda

Por enquanto, o hash fica em `metadata.hash_documento` para uso futuro.

---

## 6. Próximos passos sugeridos (na ordem)

1. **Deploy `check-legalmail-nome`** (código pronto em [edge-functions/check-legalmail-nome.ts](edge-functions/check-legalmail-nome.ts))
2. **Integrar checks (TI + Legalmail) no `/casos/novo`** quando parceiro está logado
3. **Adicionar coluna auxiliar** `processos_judiciais.ultima_sync_movs` (a `clientes.ti_customer_id` e `clientes.tags` já existem)
4. **Tabela `sync_log`** (uma linha por source: `ti_clientes`, `ti_notas`, `legalmail_processos`, `legalmail_movs` — armazena `last_synced_at`)
5. **Construir Workflow 1** (`ti-sync-clientes`) no n8n, mas filtrado para os 5 clientes mais recentes para teste
6. **Construir Workflow 3** (`legalmail-sync-processos`) só com os processos dos 5 clientes do passo 5
7. **Construir Workflow 2** (`ti-sync-notas`) restrito aos 5 clientes
8. **Construir Workflow 4** (`legalmail-sync-movs`) dos processos do passo 6
9. **Validar end-to-end** com a Naira: dados em `clientes`, `andamentos` (TI + Legalmail), `processos_judiciais`
10. **Abrir escopo** para os 763 clientes / 789 notas / N processos
11. **Pesquisar endpoint de download** do Legalmail e decidir item 5.5
12. **Implementar badge in-app** de movimentação nova (email só depois do domínio)

Cada workflow vira uma sessão dedicada de implementação. Ver [TODO.md](TODO.md) para o checklist completo.

---

## 7. Aba "Integrações" — registro de APIs e webhooks pela UI

> Decisão da Naira (2026-05-30): **todo registro/alteração de API e webhook deve
> ser feito pela UI**, não mais indo no Supabase mexer em env/secret. Aproveitar
> a construção da integração WhatsApp (ver [INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md))
> para já trazer TI e Legalmail para o mesmo lugar.

### 7.1 Problema atual
- TI e Legalmail leem a credencial de **variáveis de ambiente das Edge Functions**:
  `TI_TOKEN` (`check-ti-cliente.ts`, `sync-ti-cliente.ts`) e `LEGALMAIL_TOKEN`
  (`check-legalmail-nome.ts`, `sync-legalmail-caso.ts`). Trocar = ir no Supabase.
- Webhooks já têm tela (`src/routes/_authenticated/webhooks.tsx`, item "Webhooks"
  na sidebar), mas isolada.

### 7.2 Desenho proposto
Uma **rota nova `/integracoes`** (interno-only) com **duas seções separadas**
(sub-abas), conforme pedido ("apis e webhooks ficam separadas"):

```
[Integrações]
  ├─ Seção "APIs"      -> TI, Legalmail, WhatsApp (cadastro/edição de credencial + config)
  └─ Seção "Webhooks"  -> webhook_destinos (o que já existe em webhooks.tsx, movido pra cá)
```

- O item **"Webhooks" da sidebar vira "Integrações"** (`src/components/app-sidebar.tsx`);
  o conteúdo de `webhooks.tsx` passa a ser a seção Webhooks.

### 7.3 Armazenamento (Vault, não env)
Segue o mesmo padrão dos webhooks (segredo no Vault, nunca em GUC/coluna —
ver restrição em [ARQUITETURA.md](ARQUITETURA.md) e no design de webhooks):

Tabela nova `public.integracoes`:
```
chave        text primary key      -- 'ti' | 'legalmail' | 'whatsapp'
nome         text                  -- rótulo amigável
base_url     text                  -- ex https://app.legalmail.com.br
ativo        boolean default true
secret_id    uuid                  -- id do segredo (token/api_key) no Vault
config       jsonb default '{}'    -- não-sensível (rate limit, instance, etc.)
updated_at   timestamptz default now()
```
RPCs (espelhando `set_webhook_secret`):
- `set_integracao_secret(p_chave, p_secret)` — grava token no Vault (só `service_role`/interno via Edge).
- `get_integracao_secret(p_chave)` — `security definer`, **só `service_role`** (anon/authenticated REVOKE). As Edge Functions chamam isto para obter o token em runtime.

### 7.4 Migração das Edge Functions
TI/Legalmail/WhatsApp passam a buscar o token via `get_integracao_secret(chave)`
em vez de `Deno.env.get(...)`. Manter **fallback para o env** durante a transição
(se o Vault não tiver o segredo, usa o env antigo) para não quebrar nada.

### 7.5 UI por integração
- Campos: base_url, token/api_key (write-only — exibido só uma vez ao salvar,
  nunca retornado depois), toggle ativo, config específica.
- Botão **"testar conexão"**: reusa os `check-*` existentes (`check-ti-cliente`,
  `check-legalmail-nome`) para validar a credencial recém-salva.
- WhatsApp: campos `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`,
  `WHATSAPP_WEBHOOK_TOKEN` (ver [INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md) §10).

### 7.6 Segurança
- Rota e RPCs **interno-only**; `get_integracao_secret` exposto só a `service_role`.
- Segredo nunca volta pro browser (write-only), igual aos webhooks.

### 7.7 Decisões (confirmadas em 2026-05-30)
1. ✅ `/integracoes` com sub-abas (APIs | Webhooks) **substituindo** o item
   "Webhooks" da sidebar. Conteúdo de `webhooks.tsx` migra pra seção Webhooks.
2. ✅ TI e Legalmail migram do env para o Vault **de uma vez** (junto), com
   fallback pro env durante a transição.
3. ✅ Acesso **só admin** — PORÉM "admin" NÃO existe hoje. `usuarios.tipo` só tem
   `interno` | `parceiro`. Precisa criar a distinção (ver §7.8).

### 7.8 Papel "admin" (a criar — pré-requisito da §7.7.3) — DECIDIDO
Hoje não há sub-papel entre os internos. Decisão (2026-05-30):
- **Coluna `usuarios.is_admin boolean default false`** (Opção simples).
- **Só a Naira é admin** por enquanto: a migration seta `is_admin = true` para o
  usuário dela (identificar pelo email da Naira na hora de aplicar).
- O gate de admin vale para a **UI** (`/integracoes` só aparece/abre p/ admin) e
  para as **RPCs de escrita** (`set_integracao_secret`, CRUD de `integracoes` e
  `webhook_destinos`). Leitura via `get_integracao_secret` continua `service_role`.
- Helper sugerido: função `is_admin()` (`select coalesce((select is_admin from
  usuarios where id = auth.uid()), false)`) para usar nas policies, espelhando o
  padrão `caso_do_parceiro`.

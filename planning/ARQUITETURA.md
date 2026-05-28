# Mara Sandra Connect — Arquitetura

> Estado atual do projeto: propósito, stack, schema do banco, rotas, convenções, decisões já tomadas, APIs externas, contatos.
> Para o que vamos fazer adiante, ver [INTEGRACOES.md](INTEGRACOES.md), [UI_DESIGN.md](UI_DESIGN.md) e [TODO.md](TODO.md).

---

## 1. Propósito do aplicativo

**Mara Sandra Connect** é um app interno do escritório de advocacia **Mara Sandra Advocacia** (Naira Romero, sócia previdenciarista, Brasil). NÃO é SaaS público — é ferramenta operacional para um escritório específico.

### 1.1 Modelo de negócio

- **Parceria entre advogados (correspondência jurídica):**
  - Advogado **captador (parceiro)** indica cliente, fica com **30% dos honorários**
  - **Mara Sandra (interno)** toca o caso (administrativo INSS + judicial), fica com **70%**
  - Procuração e contrato de honorários ficam com Mara Sandra (modelo 1)
  - O parceiro mantém contato com o cliente; o app é ferramenta operacional dele para acompanhar o que está rolando
- O escritório também tem **clientes diretos** (sem parceiro indicador) — chamados de "cliente interno do escritório"

### 1.2 Tipos de usuário (`usuarios.tipo` enum)

- `interno` — Naira e equipe do escritório (acesso total)
- `parceiro` — advogado captador (acesso restrito, vê só os casos dele)
- **Cliente final NÃO loga.** Comunicação com cliente é via parceiro ou direta da Naira fora do app.

### 1.3 Áreas jurídicas

Direito previdenciário brasileiro (RGPS principalmente). Tipos de benefício suportados na criação de caso: aposentadoria por idade, tempo de contribuição, especial, PCD-LC142, incapacidade permanente, auxílios por incapacidade temporária e acidente, pensão por morte, salário-maternidade, BPC/LOAS, revisões.

---

## 2. Stack técnica

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + TanStack Router + TanStack Start (SSR) |
| Backend | Supabase managed (Auth + Postgres + Storage + RLS) |
| Edge functions | Supabase Edge Functions (Deno) |
| Orquestração | n8n self-hosted (`nairavian-n8n.de`) — para integrações TI/Legalmail futuras |
| Deploy frontend | Cloudflare Workers via push em GitHub (auto-deploy) |
| Domínio | Temporário: `mara-sandra-connect.nairaromerovian.workers.dev`. Definitivo: `marasandraconnect.com` (registrado 2026-05-28, DNS ainda não apontado pro app) |
| Repositório | `https://github.com/nairaromero/mara-sandra-connect` (público) |

### 2.1 Supabase

- Projeto: `marasandra-app` em organização `Mara Sandra Advocacia` (Company, Free tier)
- URL: `https://llugytkdsfsrciavhrfw.supabase.co`
- Region: South America (São Paulo)
- Auto-enable RLS em novas tabelas: ligado
- Auto-expose new tables: desligado (mas concedemos GRANT manual para role `authenticated` e `service_role`)
- Credenciais salvas no 1Password (publishable key e secret key)

### 2.2 Edge Functions

| Nome / slug | URL | Função |
|---|---|---|
| `check-ti-cliente` | https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/check-ti-cliente | Verifica se um CPF existe no TI (sem sincronizar). Usado no cadastro de novo caso. |
| `sync-ti-cliente` | https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/sync-ti-cliente | Sincroniza cliente (tags, dados) + importa notas como andamentos. Usado pelo botão "Sync TI" do header. |
| `check-legalmail-nome` | https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/check-legalmail-nome | Busca processos no Legalmail por nome (match fuzzy). Sem importação. |
| `sync-legalmail-caso` | https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/sync-legalmail-caso | Importa processos selecionados do Legalmail + movimentações como andamentos. |

### 2.3 Secrets do Supabase Edge Functions

Já configurados em Project Settings → Edge Functions → Secrets:
- `TI_TOKEN` = token do Tramitação Inteligente
- `LEGALMAIL_TOKEN` = api_key do Legalmail
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (automáticos)

---

## 3. Schema do banco (Supabase Postgres)

14 tabelas. As principais:

### `usuarios` (linkada a `auth.users`)
- id, nome, email, tipo (enum `tipo_usuario`: interno/parceiro), oab, telefone

### `clientes` (cliente final)
- id, nome, cpf (unique 11 dígitos), data_nascimento, telefone, email, observacoes
- `senha_meu_inss_plain` text (TEMPORÁRIO — débito crítico, precisa criptografar via pgcrypto)
- `tags jsonb` (adicionada para sincronização com TI)
- `ti_customer_id integer` (cache do id no TI)

### `casos` (entidade central)
- id, cliente_id, parceiro_id (nullable — cliente interno do escritório), tipo_beneficio, fase (enum `fase_caso`: analise/admin/judicial/finalizado), status (enum `status_caso`), rmi_estimada, atrasados_estimados, tramitacao_id, observacoes, created_at, updated_at
- **Importante**: `parceiro_id` foi tornado nullable durante o desenvolvimento via `alter table casos alter column parceiro_id drop not null`

### `contratos_parceria`
- Contrato entre Mara Sandra e cada advogado parceiro captador (vinculado a `usuarios.tipo='parceiro'`).

### `andamentos` (timeline do caso)
- id, caso_id, origem (enum `origem_andamento`: interno/tramitacao/legalmail/sistema), titulo, descricao, data_evento, criado_por, metadata (jsonb), visivel_parceiro (boolean), created_at

### `documentos`
- id, caso_id, tipo (enum `tipo_documento` — 22 valores), nome_arquivo, storage_path, tamanho_bytes, uploaded_by, visivel_parceiro, created_at

### `solicitacoes_documento`
- id, caso_id, tipo, descricao, status (enum `status_solicitacao`: pendente/atendido/dispensado), origem (text: interna/externa — adicionado pela nossa migration), comentario (text — adicionado), documento_id, solicitado_por, data_solicitacao, data_atendimento

### `analises_tecnicas`
- id, caso_id, versao, resultado_json (jsonb), beneficio_recomendado, revisoes_aplicaveis (array), rmi_estimada, valor_estimado_acao, modelo_ia, tokens_input, tokens_output, custo_brl, criado_por, created_at, resumo_parceiro (text — adicionado)

### `mensagens` (chat caso ↔ parceiro)
- id, caso_id, remetente_id, texto, lida, created_at

### `repasses`
- id, caso_id, parceiro_id, valor, status (enum `status_repasse`: previsto/a_pagar/pago), data_pagamento, created_at

### `processos_admin` (INSS)
- id, caso_id, numero_requerimento, data_protocolo, decisao, data_decisao, tramitacao_id, ultima_sync, created_at, updated_at

### `processos_judiciais`
- id, caso_id, numero_processo, vara, comarca, uf, data_distribuicao, legalmail_id, ultima_sync, created_at, updated_at

### `alertas_duplicidade`
- Tabela de auditoria — quando uma sincronização detecta possível duplicidade (CPF, nome similar etc.) que precisa de revisão humana.

### `acessos_senha_inss` (audit log)
- Log de quem acessou senha MEU INSS de cada cliente, quando. Requisito LGPD.

### Enums críticos

- `fase_caso`: `analise`, `admin`, `judicial`, `finalizado` (4 valores — não confundir com a versão antiga de 8)
- `status_caso`: `aguardando_documentos`, `em_analise`, `em_revisao`, `em_andamento`, `concluido_exito`, `concluido_sem_exito`, `arquivado`
- `status_repasse`: `previsto`, `a_pagar`, `pago`
- `status_solicitacao`: `pendente`, `atendido`, `dispensado`
- `origem_andamento`: `interno`, `tramitacao`, `legalmail`, `sistema`
- `tipo_usuario`: `interno`, `parceiro`
- `tipo_documento`: 22 valores (cnis, ppp, ctps, cat, hiscre, ltcat, certidões, etc.)

### Funções importantes

- `is_interno()` — checa se auth.uid() é tipo='interno'
- `caso_do_parceiro(caso_id)` — checa se caso pertence ao parceiro logado
- `set_senha_meu_inss(cliente_id, senha)` / `get_senha_meu_inss(cliente_id)` — pgcrypto com chave em GUC `app.inss_key` (chave **ainda não configurada** — débito crítico)
- `handle_new_auth_user()` — trigger que cria linha em `usuarios` quando há novo auth.users (usado pelo convite de parceiros)
- `tg_set_updated_at()` — trigger genérico para colunas `updated_at`

### Storage

3 buckets privados: `cnis-uploads`, `documentos`, `contratos`. Policies via RLS por `caso_id` no path.

### GRANTs aplicados

```sql
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
```

---

## 4. Rotas atuais do frontend

Todas em `src/routes/_authenticated/`:

| Rota | Arquivo | Status |
|---|---|---|
| `/` | [index.tsx](../src/routes/_authenticated/index.tsx) | Dashboard com métricas + 10 casos recentes |
| `/login` | (fora de authenticated) | Login com magic link / e-mail+senha |
| `/casos/novo` | [casos.novo.tsx](../src/routes/_authenticated/casos.novo.tsx) | Cadastro de caso completo |
| `/casos/$id` | [casos.$id.tsx](../src/routes/_authenticated/casos.%24id.tsx) | Detalhe do caso (7 abas: visão geral, andamentos, documentos, análise técnica, chat, repasses, processos) — chat e processos condicionais |
| `/parceiros` | [parceiros.tsx](../src/routes/_authenticated/parceiros.tsx) | Convite e listagem de parceiros (só interno) |
| `/documentos` | [documentos.tsx](../src/routes/_authenticated/documentos.tsx) | Visão global de solicitações pendentes |
| `/conversas` | [conversas.tsx](../src/routes/_authenticated/conversas.tsx) | Lista de chats por caso (polling 30s) |
| `/configuracoes` | [configuracoes.tsx](../src/routes/_authenticated/configuracoes.tsx) | Perfil + senha + logout |
| `/repasses` | **NÃO CRIADA** | Pendente |

Sidebar com itens condicionais (Parceiros só aparece para interno). Layout autenticado com guard.

---

## 5. Convenções obrigatórias do projeto

**Atenção**: o parser do `@tanstack/router-generator` v1.167.28 é frágil. Erros comuns que pegamos:

### 5.1 Sem JSX fragments `<>...</>`

O parser não engole. Usar dois blocos `{cond && (<X />)}` separados em vez de `<>{...}</>`.

### 5.2 100% ASCII

Não usar caracteres não-ASCII em strings, comentários, ou regex literais. Em vez disso:
- Comentários em pt-BR sem acentos (`Em analise` ao invés de `Em análise`)
- Regex unicode usando escapes (`/[̀-ͯ]/g`, não diretamente o intervalo unicode)
- Em-dash → vírgula ou hífen

### 5.3 Sem non-null assertions inline (`x!.y`)

Em vez de `clienteInsert!.id`, usar:
```ts
if (!clienteInsert) throw new Error("...");
const id = clienteInsert.id;
```

### 5.4 Sem casts inline complexos

Em vez de `(existente as { casos?: { id: string }[] } | null)?.casos?.[0]?.id`, declarar interface antes e fazer `as` em statement separado.

### 5.5 Mobile-first

Tailwind: estilo mobile primeiro, breakpoints crescem (`grid-cols-2 sm:grid-cols-4 lg:grid-cols-7`). Nunca o inverso. Detalhes em [UI_DESIGN.md](UI_DESIGN.md).

### 5.6 Componente novo? Procurar genérico primeiro

Ver [UI_DESIGN.md](UI_DESIGN.md) seção 3 para lista de componentes genéricos a criar (Spinner, EmptyState, StatusBadge, DataField, ConfirmDialog, MoneyTile, DialogShell).

### 5.7 Tema unificado (em planejamento)

Ver [UI_DESIGN.md](UI_DESIGN.md) seção 4 — paleta semântica via CSS vars + Tailwind config. **Ainda não implementado.**

### 5.8 SSR e `<ClientOnly>`

Como o frontend usa TanStack Start (SSR), alguns componentes que tocam `window`/`document` precisam estar dentro de `<ClientOnly>` (helper em [src/components/client-only.tsx](../src/components/client-only.tsx)).

---

## 6. Decisões já tomadas

### 6.1 LGPD
Co-controle entre CNISIA/Mara Sandra e advogado parceiro.

### 6.2 SLA aprovação
Configurável por advogado parceiro (24/48/72h/manual).

### 6.3 Cliente final não loga
Só advogados (interno + parceiro). WhatsApp e contato direto fora do app por enquanto.

### 6.4 Integrações TI/Legalmail são apenas leitura
App não escreve no TI nem no Legalmail. Apenas consome. **Confirmado em 2026-05-27.**

### 6.5 n8n para sync periódico, edge functions para checks pontuais
- Edge function: chamadas síncronas do frontend (ex.: check duplicata ao cadastrar)
- n8n: jobs cron que populam o Supabase a partir de TI/Legalmail (a planejar — ver [INTEGRACOES.md](INTEGRACOES.md))

### 6.6 Match cliente entre sistemas
- Mara Sandra ↔ TI: por **CPF** (ambos têm)
- Mara Sandra ↔ Legalmail: por **NOME fuzzy** (Legalmail não expõe CPF na API). Quando ambíguo, processo fica órfão para vinculação manual.

### 6.7 Parceiro pode cadastrar caso novo
- Mas precisa passar nos 3 checks: Mara Sandra (CPF unique), TI (edge function), Legalmail (edge function fuzzy)
- Se algum encontra → bloqueia ou pede confirmação

### 6.8 Notificações
Quando movimentação nova chegar (futuro): **email + badge in-app**, tanto interno quanto parceiro. **Confirmado em 2026-05-27.**

### 6.9 Resend (SMTP customizado) pausado
**Domínio `marasandraconnect.com` registrado em 2026-05-28.** Falta configurar DNS no Cloudflare + setup Resend pra enviar magic link com remetente próprio.

### 6.10 Frontend ↔ Supabase direto
CRUD/Auth via SDK direto do frontend (não passa por backend intermediário).

### 6.11 Modelo híbrido confirmado
n8n só em operações longas (análise IA, integração Tramitação/Legalmail, geração PDF). Resto fica no frontend.

---

## 7. APIs externas — resumo operacional

> Detalhamento completo (mapeamento de campos, workflows propostos) em [INTEGRACOES.md](INTEGRACOES.md).

### 7.1 Tramitação Inteligente (TI)

- Base: `https://planilha.tramitacaointeligente.com.br/api/v1`
- Auth: `Authorization: Bearer <TI_TOKEN>`
- Rate limit: não documentado, parece tolerante

**Endpoints que funcionam:**
- `GET /usuarios` — operadores (4)
- `GET /clientes` — 763 clientes paginados (35 campos cada, incluindo CPF, RG, CNH, tags coloridas, email_exclusivo)
- `GET /clientes/{id}` — detalhe
- `GET /notas` — 789 notas com content, user, customer
- `POST /clientes`, `POST /notas` — escrita (**não usaremos por enquanto** — decisão 6.4)

**Endpoints que NÃO existem (404):**
- `/tarefas`, `/processos`, `/movimentacoes` — confirmado, TI não expõe via API. Tarefas continuam via Chrome.

### 7.2 Legalmail

- Base: `https://app.legalmail.com.br`
- Auth: `?api_key=<LEGALMAIL_TOKEN>` (query parameter, **não header**)
- Doc oficial: `https://app.legalmail.com.br/api/docs` (OpenAPI 3)
- Rate limit duro: **30 req/min**; bloqueio progressivo (10min→30min→1h→...→7 dias) se violar 3× em 10min
- Já existe cliente Python em `/Users/nairaromero/Documents/Claude/Projects/Mara Sandra - Escritorio Previdenciario/briefing-astrea/legalmail_client.py` com rate limiter

**Endpoints que funcionam:**
- `GET /api/v1/lawsuit/all?offset&limit` — lista paginada (limit max 50)
- `GET /api/v1/lawsuit/detail?idprocesso=<INT>` — detalhe (mesmo schema do all)
- `GET /api/v1/lawsuit/case-files?idprocesso=<INT>` — movimentações (até 71+ por processo)

**Importante**: o campo é `idprocesso` (singular) com tipo **INT** na chamada, mas o JSON retorna `idprocessos` (plural) como string.

**O que não tem:**
- CPF do polo ativo (apenas `poloativo_nome` text)
- Download de documento (testado `hash_documento` em vários paths — todos 404; **endpoint de download ainda precisa ser pesquisado**, ver [INTEGRACOES.md](INTEGRACOES.md))

---

## 8. Estado atual do desenvolvimento

### Implementado e em produção

- Build do Cloudflare desbloqueado (era erro do router-generator com construções TS densas)
- Tela `/casos/{id}` completa, 7 abas, condicional a parceiro
- Tela `/casos/novo` com cliente interno
- Tela `/documentos` global
- Tela `/conversas`
- Tela `/configuracoes`
- Dashboard com link clicável para `/casos/{id}`
- Migrations aplicadas: `andamentos.visivel_parceiro`, `documentos.visivel_parceiro`, `analises_tecnicas.resumo_parceiro`, `solicitacoes_documento.origem`, `solicitacoes_documento.comentario`, `clientes.tags`, `clientes.ti_customer_id`, índices, GRANTs para service_role
- Edge function `check-ti-cliente` deployada — ainda não consumida pelo frontend
- Edge function `sync-ti-cliente` deployada — botão Sync TI no header do caso (importa tags + notas TI como andamentos)
- Edge function `check-legalmail-nome` deployada — busca fuzzy por nome no Legalmail
- Edge function `sync-legalmail-caso` deployada — importa processos selecionados + movimentações
- Tags do TI renderizando coloridas no header

### Em progresso / próximos

Ver [TODO.md](TODO.md) para a lista priorizada e atualizada.

---

## 9. Bugs conhecidos / pegadinhas

- **Slug autogerado das edge functions**: quando cria via Dashboard, se o nome tem caractere inválido (ex.: `.ts`), o Supabase gera slug aleatório. Sempre digitar nome correto **sem extensão** e conferir a URL após deploy.
- **Service role precisa de GRANT explícito**: nas novas tabelas, rodar `grant select, insert, update, delete on all tables in schema public to service_role;`
- **Rate limit do Supabase SMTP**: 3 emails/hora no Free tier. Aguarda 1h se passar.
- **Router-generator é frágil**: ver seção 5 das convenções. Já gastamos várias sessões debugando.

---

## 10. Mapa dos arquivos da pasta `planning/`

| Arquivo | Função |
|---|---|
| `ARQUITETURA.md` | Este documento. Estado atual do projeto. |
| [INTEGRACOES.md](INTEGRACOES.md) | Plano detalhado de integração TI + Legalmail via n8n (workflows propostos, mapping de campos, decisões aplicadas) |
| [UI_DESIGN.md](UI_DESIGN.md) | Mobile-first + componentes genéricos a extrair + plano de tema unificado |
| [TODO.md](TODO.md) | Checklist consolidado de tudo que falta fazer |
| `edge-functions/check-ti-cliente.ts` | Verifica se CPF existe no TI (deployada como `check-ti-cliente`) |
| `edge-functions/sync-ti-cliente.ts` | Sincroniza cliente do TI + importa notas como andamentos (deployada como `sync-ti-cliente`) |
| `edge-functions/check-legalmail-nome.ts` | Busca processo no Legalmail por nome fuzzy (deployada como `check-legalmail-nome`) |
| `edge-functions/sync-legalmail-caso.ts` | Importa processos selecionados do Legalmail + movimentações como andamentos (deployada como `sync-legalmail-caso`) |
| `sql-migrations/migration_caso_detalhe.sql` | Adiciona visivel_parceiro, resumo_parceiro, índices (já aplicada) |
| `sql-migrations/migration_fase_casos.sql` | Adiciona casos.fase (SQL antiga — **não aplicar, já existe**) |
| `sql-migrations/diagnostico_schema.sql` | Queries pra ver schema/enums do banco |
| `explorers/explorer_ti.py` | Script Python que mapeia endpoints do TI |
| `explorers/explorer_legalmail.py` | Script Python que mapeia endpoints do Legalmail |
| `explorers/explorer_legalmail_v2.py` | Versão expandida buscando CPF e documentos |

Os arquivos `.tsx` que estão atualmente em produção estão em `src/routes/_authenticated/` deste mesmo repositório.

---

## 11. Pessoas/contatos do projeto

- **Naira Romero (sócia, dev product owner)** — nairaromerovian@gmail.com — papel: interno + admin no TI
- **Mara Sandra Vian de Oliveira** — sócia operacional — marasandra.adv@gmail.com — papel: interno
- Domínio `marasandraconnect.com`: **registrado em 2026-05-28** (DNS no Cloudflare, ainda não apontado para o app, sem Resend configurado)
- Marido da Naira: tem acesso SSH ao servidor n8n self-hosted (`nairavian-n8n.de`)

---

## 12. Estilo de trabalho

- Direto, técnico, sem rodeios
- Naira valida cada decisão antes de implementar
- Contexto: previdenciário brasileiro (não EOR Irlanda)
- Mudanças pequenas e commitáveis independente

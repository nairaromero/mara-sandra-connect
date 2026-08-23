# Mara Sandra Connect — Arquitetura

> Estado atual do sistema: propósito, stack, ambientes, schema, rotas, automações,
> convenções e decisões tomadas.
> **Última auditoria contra o banco de produção: 2026-08-21** (commit `d45a6d7`).
> A anterior foi em 2026-08-15; os números que mudaram estão marcados abaixo.
> Onde este documento divergir do banco, vale o banco — e corrija aqui.
> Para o que falta fazer, ver [TODO.md](TODO.md).

---

## 1. Propósito

**Mara Sandra Connect** é o sistema operacional do escritório **Mara Sandra Vian
Advocacia** (previdenciário brasileiro, Votuporanga/SP). NÃO é SaaS público.

Hoje ele acumula três papéis:

1. **Portal do parceiro** — o advogado captador acompanha os casos que indicou.
2. **Ferramenta de operação do escritório** — tarefas, prazos, agenda, perícias,
   processos, documentos. Substituiu o Tramitação Inteligente em 2026-07/08.
3. **Site institucional público** — a raiz `/` é a home de captação.

### 1.1 Modelo de negócio

- **Parceria (correspondência jurídica):** o advogado **captador** indica o cliente e
  fica com **30%**; Mara Sandra toca o caso (administrativo + judicial) e fica com **70%**.
  Procuração e contrato ficam com Mara Sandra. O percentual é por parceiro
  (`usuarios.percentual_parceiro`).
- O escritório também tem **clientes diretos** (sem parceiro indicador).
- **Captação própria** pelo site institucional → `leads` → tela `/comercial`.

### 1.2 Papéis

| Conceito | Coluna | O que decide |
|---|---|---|
| **Modo de acesso** | `usuarios.tipo` (`interno` \| `parceiro`) | O que a pessoa vê na interface |
| **Papel comercial** | `usuarios.eh_parceiro` (boolean) | Se ela recebe repasse de parceria |
| **Admin do escritório** | `usuarios.eh_admin` (boolean, desde 2026-08-19) | Só Naira e Mara: Equipe, Webhooks, Auditoria, integrações (IA/Claude/Gmail), convidar interno. No SQL, `public.is_admin()` |

Separados desde 2026-08-10: alguém da equipe interna pode ser parceiro comercial.
**Cliente final não loga.** Por que é assim: [DECISOES.md](DECISOES.md) D1 e D3.

### 1.3 Áreas

Direito previdenciário (RGPS). Os tipos de benefício vivem na tabela `tipos_beneficio`
(editável pela UI), não mais num enum fixo.

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + TanStack Router/Start (SSR) |
| Backend | Supabase gerenciado (Auth + Postgres + Storage + RLS + Realtime + pg_cron) |
| Edge functions | Supabase Edge Functions (Deno) — **29 no ar, 28 versionadas** (ver §6.2) |
| Agendamento | **pg_cron no próprio banco** (7 jobs) + n8n self-hosted para o DJEN |
| Orquestração | n8n (`nairavian-n8n.de`) — DJEN e filas de WhatsApp/webhooks |
| Deploy | Cloudflare Workers Builds — 2 projetos: `mara-sandra-connect` ← `main` (produção) e `mara-sandra-connect-staging` ← `staging` (staging.marasandraconnect.com). Sem preview de PR |
| Domínio | `marasandraconnect.com` (+ `www`) |
| Repositório | `github.com/nairaromero/mara-sandra-connect` |
| Gerenciador | **bun** (`bun add`, `bun dev` em :8080) |

---

## 3. Ambientes (desde 2026-08-03)

Detalhe completo em [AMBIENTES.md](AMBIENTES.md).

| Ambiente | Frontend | Projeto Supabase |
|---|---|---|
| **Produção** | marasandraconnect.com (branch `main`) | `llugytkdsfsrciavhrfw` (Pro) |
| **Staging** | staging.marasandraconnect.com (branch `staging`, worker próprio) | `alhqbpbekmxpoibrrnbi` (free) |
| **Dev local** | localhost:8080 | staging (via `.env.local`) |

- `vite.config.ts` injeta as vars de staging em qualquer branch ≠ `main` (só `staging` builda).
- Contas de staging por papel (`e2e+admin`, `e2e+interno`, `e2e+parceiro`): ver CLAUDE.md.
- **Migration roda no staging primeiro**, valida, e só então em produção:
  `node scripts/msc-sql.mjs --staging --file ...` → confirmar a linha
  `[msc-sql] alvo: STAGING` → depois sem a flag.
- Staging **não roda cron**, não dispara webhook e não tem Storage copiado.
- Espelho anonimizado semanal: GitHub Actions `espelho-staging` (segunda 05:00 BRT) ou
  `bash scripts/espelho-staging.sh`. Produção só é lida pelo role `espelho_leitura`.

---

## 4. Schema — 45 tabelas

Contagem conferida em **2026-08-21** (eram 43 em 15/08). Agrupadas por domínio:

| Domínio | Tabelas |
|---|---|
| **Núcleo** | `casos` · `clientes` · `usuarios` · `contratos_parceria` · `tipos_beneficio` · `etiquetas` · `clientes_etiquetas` |
| **Operação do caso** | `andamentos` · `documentos` · `solicitacoes_documento` · `analises_tecnicas` · `processos_admin` · `processos_judiciais` · `repasses` |
| **Trabalho diário** | `tarefas` · `tarefa_templates` · `tarefas_excluidas` · `agenda_eventos` |
| **Comunicação** | `comentarios` · `conversa_leitura` · `notificacoes` · `notificacao_dispensada` · `comentario_email_throttle` · `mensagens` *(morta — ver §11)* |
| **Fontes externas** | `publicacoes_dje` · `oabs_monitoradas` · `inss_email_log` · `usuario_gmail_oauth` · `alertas_duplicidade` |
| **Comercial** | `leads` · `lead_comentarios` |
| **IA** | `ia_integracoes` · `ia_tokens` · `ia_acoes` |
| **WhatsApp** | `whatsapp_outbox` · `whatsapp_mensagens` · `whatsapp_sessoes` · `whatsapp_ativacao_codigos` · `whatsapp_lid_map` |
| **Webhooks** | `webhook_destinos` · `webhook_eventos` · `webhook_config` |
| **Conformidade** | `aceites_termos` · `acessos_documento` · `acessos_senha_inss` |

### 4.1 Entidades centrais

**Modelo mental:** `cliente → 1 pasta (caso) → processos (cada benefício) → andamentos`.
O caso é um container; quem opera pensa em cliente e benefício.

- **`casos`** — `cliente_id`, `parceiro_id` (nullable), `tipo_beneficio`, `fase`, `status`,
  `rmi_estimada`, `atrasados_estimados`, `tramitacao_id`, `gdrive_folder_id` (+ nome,
  vinculado_em/por).
- **`clientes`** — `cpf` (unique), `data_nascimento`, `telefone`, `email`, `endereco`,
  `senha_meu_inss` (**cifrada**), `tags` jsonb, `ti_customer_id`, `ti_dados` jsonb, `created_by`.
- **`andamentos`** — `caso_id`, `origem`, `titulo`, `descricao`, `data_evento`, `criado_por`,
  `metadata`, `visivel_parceiro`, `processo_admin_id`, `processo_judicial_id`.
- **`tarefas`** — `caso_id` (nullable), `responsavel_id`, `tipo`, `status`, `prioridade`,
  `due_at`, `origem`, `origem_ref`, `lembretes`, `metadata`, `processo_admin_id`,
  `processo_judicial_id`. Unique `(origem, origem_ref)` quando `origem <> 'manual'` — é o
  que torna todo pipeline automático idempotente.
- **`agenda_eventos`** — `start_at`/`end_at`, `local`, `participantes`, `restrito_a uuid[]`
  (NULL = todos os internos veem), `concluido_em`/`concluido_por`, `gcal_event_id` (não usado ainda).

### 4.2 Enums (conferidos no banco)

| Enum | Valores |
|---|---|
| `fase_caso` | `analise`, `admin`, `judicial`, `finalizado` |
| `status_caso` | `aguardando_documentos`, `em_analise`, `em_revisao`, `em_andamento`, `concluido_exito`, `concluido_sem_exito`, `arquivado` |
| `origem_andamento` | `interno`, `tramitacao`, `legalmail`, `sistema`, `djen`, `inss_email`, `datajud` |
| `tipo_documento` | 25 valores (cnis, ppp, ctps, ctc, laudo_medico, … substabelecimento, declaracao_hipossuficiencia, declaracao_ausencia_duplicidade) |
| `status_solicitacao` | `pendente`, `atendido`, `dispensado` |
| `status_repasse` | `previsto`, `a_pagar`, `pago` |
| `status_contrato` | `pendente`, `assinado`, `vigente`, `encerrado` |
| `tipo_usuario` | `interno`, `parceiro` |

`tarefas.origem` e `tarefas.tipo` são **text com CHECK**, não enum. Origens em uso:
`manual`, `migracao_ti`, `ia`, `sync_inss_email`, `pericia_acompanhamento`, `pericia_lembrete`.

### 4.3 Funções importantes

- **Autorização:** `is_interno()`, `is_admin()`, `caso_do_parceiro(caso_id)`.
- **Equipe (admin):** `definir_admin`, `desligar_interno`, `reativar_interno`.
- **Espelho:** role `espelho_leitura` + policies `espelho_leitura_select` (só SELECT).
- **Senha MEU INSS:** `set_senha_meu_inss` / `get_senha_meu_inss` / `tem_senha_meu_inss`
  (pgcrypto, chave no Vault; toda leitura grava em `acessos_senha_inss`).
- **Conformidade:** `registrar_aceite_termos`, `log_acesso_documento`.
- **Tarefas/templates:** `aplicar_template`, `somar_dias_uteis`.
- **Perícias:** `pericia_draft_texto`, `pericia_lembrete_texto`, `pericias_do_caso`,
  `pericias_do_parceiro`, `rotina_diaria_pericia`, `trocar_etiqueta_pos_pericia`.
- **Implementação do benefício:** `rotina_diaria_implementacao`, `implementacao_cadencia`.
- **Filas:** `webhook_enqueue`/`claim_batch`/`mark_result`, `whatsapp_enqueue`/`claim_batch`/
  `mark_result`, além das rotinas de purga (`*_purge`).
- **Outros:** `vincular_publicacao_dje`, `excluir_cliente`, `ia_disponivel`,
  `precisa_definir_senha`.

**Não existe trigger** ligando `auth.users` → `public.usuarios`. Quem cria a linha é a
edge function `convidar-usuario`. Criar usuário fora dela deixa a conta órfã
(no staging, `scripts/seed-staging-contas.mjs` faz as duas partes).

### 4.4 Storage

3 buckets **privados**, limite de 50 MB por arquivo: `documentos`, `cnis-uploads`,
`contratos`. Acesso só por signed URL de 60–300s; RLS por `caso_do_parceiro`/owner e por
`visivel_parceiro`. Nenhum `getPublicUrl` no código.

### 4.5 Garantias que vivem no banco (não na tela)

- **RLS em toda tabela.** Parceiro só alcança os casos dele mesmo chamando a API direto.
- **`visivel_parceiro` é respeitado no RLS** de `andamentos`, `documentos` e do Storage;
  `analises_tecnicas` é interno-only. *(Corrigido em 2026-06-09 — antes a flag valia só
  no frontend, o que era falha de confidencialidade.)*
- **PostgREST corta em 1000 linhas** (`max_rows`). Query que "traz tudo" precisa paginar
  com `range()` e ordem estável — já mordeu em etiquetas e na exportação Excel.

---

## 5. Rotas — 27 telas

### Públicas

| Rota | Arquivo | O que é |
|---|---|---|
| `/` | [index.tsx](../src/routes/index.tsx) | Site institucional (SSR/SEO, captação, dois públicos) |
| `/login` | [login.tsx](../src/routes/login.tsx) | Magic link / e-mail+senha |
| `/definir-senha`, `/redefinir-senha` | | Primeiro acesso e recuperação |
| `/privacidade` | | Política de privacidade |
| `/upload` | [upload.tsx](../src/routes/upload.tsx) | Link assinado de upload (parceiro sem login) |

### Autenticadas (`src/routes/_authenticated/`)

| Rota | Quem vê | O que é |
|---|---|---|
| `/tarefas` | interno | **Home do interno.** Kanban + "minhas de hoje" |
| `/agenda` | ambos | Agenda do escritório; parceiro vê só as perícias dele |
| `/a-enviar` | interno | Fila de avisos de perícia aguardando envio |
| `/clientes` | ambos | **Home do parceiro.** Lista, busca, filtros, etiquetas |
| `/casos` | ambos | Dashboard (redireciona: interno → `/tarefas`, parceiro → `/clientes`) |
| `/casos/novo` | ambos | Cadastro de caso |
| `/casos/$id` | ambos | **Tela do caso** — abas, Drive, documentos, andamentos, perícias |
| `/conversas` | ambos | Caixa de conversas (aceita `?caso=`) |
| `/documentos` | ambos | Solicitações pendentes |
| `/publicacoes` | ambos | Publicações DJEN + triagem das órfãs |
| `/comercial` | interno | CRM de leads (kanban por etapa) |
| `/processos` | interno | Visão global admin + judicial |
| `/processos/movimentacoes` | interno | Feed diário do DataJud |
| `/equipe` | **admin** | Gestão e convite de internos; tornar/remover admin; desligar/reativar |
| `/parceiros` | interno | Convite, percentual, registro de aceite |
| `/etiquetas` | interno | Gestão de etiquetas |
| `/webhooks` | **admin** | Destinos e eventos do outbox |
| `/auditoria` | **admin** | Acessos à senha MEU INSS |
| `/configuracoes` | ambos | Perfil, senha; cards de IA/Claude/Gmail só pra admin |
| `/boas-vindas` | parceiro | Onboarding + aceite de termos |

~~`/repasses` existe no código mas não está na sidebar~~ — **corrigido em 2026-08-21: essa rota
nunca existiu.** `find src -iname "*repasse*"` não devolve nada. Repasses são uma **aba dentro
de `casos.$id.tsx`** (`TabsTrigger value="repasses"`). A tela global segue sendo decisão de
produto pendente — mas não há código dela.

---

## 6. Automações

### 6.1 Cron (pg_cron, só produção)

> ⚠️ **Corrigido em 2026-08-21.** Até esta data a tabela abaixo dizia "BRT" e listava
> 05:00 / 09:00 / 09:45 / 11:00 / 11:10. **Estava errada em 3 horas.**
> `cron.timezone = GMT` e o `TimeZone` do banco é `UTC` — os schedules são UTC.
> Confirmado no histórico real (`cron.job_run_details` convertido para `America/Sao_Paulo`).

| BRT (real) | `schedule` (UTC) | Job | O que faz |
|---|---|---|---|
| **02:00** | `0 5 * * *` | `msc-inss-email` | Lê o Gmail, classifica o despacho, cria andamento + tarefas |
| **06:00 / 06:06 / 06:12** | `0/6/12 9 * * *` | `msc-datajud-sync-1/2/3` | 3 passadas de 60 processos, janela 90 dias |
| **06:45** | `45 9 * * *` | `msc-digest-diario` | E-mail resumo do dia (**hoje só para a Naira** — campo `para`) |
| **08:00** | `0 11 * * *` | `rotina-pericia-diaria` | Gera os rascunhos de aviso de perícia |
| **08:10** | `10 11 * * *` | `rotina-implementacao-diaria` | Acompanha implantação do benefício concedido |
| madrugada | — | `djen-sync` (n8n) | Publicações por OAB |
| — | — | ~~`msc-ia-triagem`~~ | **Desligado em 2026-08-06** (confirmado: não existe em `cron.job`) |

Os 7 jobs estão `active` e com **zero falhas** no histórico. O `msc-inss-email` tem só 5
execuções contra 23 dos syncs de DataJud — coerente com "no ar desde 2026-08-14".

**Consequência a decidir:** o `msc-inss-email` lê o Gmail às **02:00**, não às 05:00. Se o INSS
despacha de madrugada, a passada pode acontecer antes dos e-mails do dia chegarem.

Inspeção: `select jobname, schedule, active from cron.job`, histórico em `cron.job_run_details`,
respostas em `net._http_response`.

### 6.2 Edge functions (29)

| Finalidade | Functions |
|---|---|
| Sincronizar | `sync-datajud-movimentacoes` · `sync-djen-publicacoes` · `sync-djen-caso` · `sync-legalmail-caso` · `sync-ti-cliente` · `sync-ti-todos` · `cnj-consulta-processo` · `listar-processos-legalmail` · `listar-clientes-ti` · `check-ti-cliente` · `check-legalmail-nome` |
| Avisar | `notify-novo-andamento` · `notify-novo-comentario` · `notify-solicitacao-doc` · `digest-diario` · `send-email-hook` |
| IA | `ia-analise` · `ia-assistant` · `ia-mcp` · `ia-config` · `ia-triagem-andamentos` · `extrair-dados-cliente` |
| Pipeline INSS | `inss-email-processor` · `gmail-oauth-start` · `gmail-oauth-callback` |
| Pessoas | `convidar-usuario` · `update-parceiro` |
| WhatsApp | `whatsapp-inbound` |

> ℹ️ **`excluir-parceiro`**: deployada em 2026-05-29 (v17, `verify_jwt=true`) e nunca
> atualizada; até 2026-08-23 só existia como cópia solta em `planning/edge-functions/`. A cópia
> foi movida para `supabase/functions/excluir-parceiro/index.ts` e **conferida contra o bundle
> em produção** (fonte extraído via `GET /v1/projects/<ref>/functions/excluir-parceiro/body`;
> idêntico após normalização com esbuild). A partir daqui, deploy dela segue o fluxo normal.

Deploy: **staging primeiro** (`--project-ref alhqbpbekmxpoibrrnbi`), depois produção.
Segredos precisam existir nos **dois** projetos.

---

## 7. Integrações externas

| Serviço | Para quê | Estado (2026-08-15) |
|---|---|---|
| **DataJud / CNJ** | Movimentação judicial | ✅ 1.523 andamentos; header `x-region: sa-east-1` obrigatório |
| **DJEN / Comunica (CNJ)** | Publicações com teor completo | 🔴 **226 de 264 órfãs** (21/08); **96 delas são de processos JÁ cadastrados** — ver §7.1 |
| **Gmail (INSS)** | E-mail do INSS → andamento + tarefa | ⚠️ no ar desde 2026-08-14 |
| **Google Drive** | Espelho de documentos | ⚠️ bidirecional; **76 de 395 casos** têm pasta (21/08) — 66 vinculados nos últimos 30 dias |
| **Resend** | E-mail transacional e magic link | ✅ |
| **Anthropic / OpenAI** | Análise, triagem, assistente (BYOK) | ⚠️ pendências contratuais LGPD |
| **Legalmail** | Processos e intimações | ⚠️ só importação manual; 30 req/min |
| **Tramitação Inteligente** | Origem da base | 🔻 sync **desligado em 2026-08-11**; sobrou "Buscar/Importar do TI" |
| **Evolution (WhatsApp)** | Conversa com parceiro | ⏸️ **saída PAUSADA em 2026-08-21** (`migration_pausa_whatsapp_saida.sql`). A Evolution segue em `HTTP 500` |

### 7.1 Publicações DJEN órfãs — o risco não é o que estava escrito

O [TODO.md](TODO.md) descrevia as órfãs como *"intimação com prazo em processo não cadastrado"*.
Medido no banco em **2026-08-21**, é outra coisa:

| | |
|---|---|
| Órfãs (`caso_id is null`) | **226** de 264 |
| Do tipo intimação | **224** |
| **Cujo processo JÁ existe em `processos_judiciais`** | **96**, tocando **57 casos** |
| Desses 96, últimos 30 dias / 7 dias | 20 / 5 |

Ou seja: **vínculo que falhou em processo que o escritório já tem** — intimação com prazo em
caso ativo que não aparece na tela do caso. Mais grave que o documentado, e mais barato de
resolver: o match é determinístico por `numero_proc_normalizado`, e a função
`vincular_publicacao_dje` **já existe no banco**.

Detalhes por integração: [INTEGRACAO_DJE.md](INTEGRACAO_DJE.md),
[INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md), [INTEGRACAO_IA.md](INTEGRACAO_IA.md),
[DRIVE_ACESSO_EQUIPE.md](DRIVE_ACESSO_EQUIPE.md), [CONECTOR_MNI.md](CONECTOR_MNI.md).
Por que cada integração é assim (TI/Legalmail só leitura, Judit descartada, Drive com conta
única, WhatsApp pausado): [DECISOES.md](DECISOES.md).

---

## 8. Convenções obrigatórias

### 8.1 Parser do router-generator é frágil

- **Sem fragments `<>…</>`** — usar blocos `{cond && (<X />)}` separados.
- **100% ASCII** em código (comentários em pt-BR sem acento; regex unicode por escape).
  *Texto visível ao usuário pode ter acento — a restrição é sintática.*
- **Sem `x!.y`** — checar e atribuir antes.
- **Sem cast inline complexo** — declarar a interface e fazer `as` em statement separado.

### 8.2 Produto

- **Mobile-first** — Tailwind do menor pro maior, nunca o inverso.
- **SSR** — o que toca `window`/`document` vai dentro de `<ClientOnly>`.
- **IA é interno-only** — verificação `usuario?.tipo === "interno"` em `_authenticated.tsx`.
- **Toda alteração de banco** vira migration em `planning/sql-migrations/`, idempotente
  quando possível.

### 8.3 Fuso

Horário do escritório é **America/Sao_Paulo**, fixado no backend
([src/lib/fuso.ts](../src/lib/fuso.ts)). Timestamp sem offset é interpretado como Brasília,
não UTC — foi a causa de deslocamento de 3h nas perícias migradas do TI.

---

## 9. Decisões tomadas

| # | Decisão | Quando |
|---|---|---|
| 1 | TI e Legalmail são **só leitura** — o app nunca escreve neles | 2026-05-27 |
| 2 | Match: TI por **CPF**; Legalmail por **nome fuzzy** (não expõe CPF); ambíguo → órfão | 2026-05-27 |
| 3 | Cliente final **não loga** | — |
| 4 | Frontend fala **direto** com o Supabase (sem backend intermediário) | — |
| 5 | `check-legalmail-nome` **não** é chamada automática no caso novo (varre a base inteira) | 2026-06-09 |
| 6 | Tela global de `/repasses` **adiada** por decisão de produto | 2026-06-09 |
| 7 | Prazos: publicação gera **ciência D+1** e, havendo prazo, **fatal − 1** | 2026-07-29 |
| 8 | Descoberta por OAB **não auto-cria** caso — vira publicação órfã pra triagem | 2026-07-28 |
| 9 | **Judit descartada** (R$ 1.000/mês pelo que DataJud+DJEN dão de graça) | 2026-07-29 |
| 10 | Bancos de produção e staging **separados** | 2026-08-03 |
| 11 | Papel comercial (`eh_parceiro`) **separado** do modo de acesso (`tipo`) | 2026-08-10 |
| 12 | Sync automático com o TI **desligado** | 2026-08-11 |
| 13 | Saída de **WhatsApp pausada** (Evolution em `HTTP 500`; trigger desabilitado) | 2026-08-21 |
| 14 | **Scaffold da Lovable removido** — preset do Vite substituído por config própria | 2026-08-21 |
| 15 | Staging como **worker separado** em staging.marasandraconnect.com; preview de PR abandonada | 2026-08-22 |
| 16 | `staging → main` por **squash**; realinhar por reset | 2026-08-22 |
| 17 | Sessão morta: **401 tratado num ponto só** (fetch do supabase-js) | 2026-08-22 |
| 18 | Espelho lê produção com **role só-leitura** + travas antes de truncar | 2026-08-23 |
| 19 | **Contas de staging por papel** (admin/interno/parceiro) | 2026-08-23 |

Contexto, alternativas e custo de cada uma: [DECISOES.md](DECISOES.md).

---

## 10. Pegadinhas conhecidas

- **PostgREST trunca em 1000 linhas, calado.** Paginar com `range()`.
- **Service role precisa de GRANT explícito** em tabela nova.
- **Router-generator** regenera `routeTree.gen.ts` no build; `tsc` roda depois.
- **Slug de edge function**: criar pelo Dashboard com nome inválido gera slug aleatório.
- **Drive só funciona em origem cadastrada no Google Cloud** — produção está; localhost e
  `staging.marasandraconnect.com` só se alguém cadastrar (ver DRIVE_ACESSO_EQUIPE.md).
- **CPF de teste**: nunca usar um que possa colidir com cliente real (já houve perda por
  cascade delete).
- **Logs de edge function** nem sempre mostram `console.error`; para diagnóstico, gravar no
  banco e ler via `msc-sql`. *(Do lado do Worker isso melhorou: os Workers Logs da Cloudflare
  foram ligados em 2026-08-21 — `observability.logs.enabled` no `wrangler.jsonc`.)*
- **Cron é UTC, não BRT** — ver o aviso em §6.1. Errar isso já custou 3h de diferença na
  documentação.
- **`bun install` já saiu com código 0 escondendo 403** de um registry privado. Depois de
  instalar, confira que `node_modules/<pacote>/` existe de verdade antes de concluir que deu
  certo. *(A causa foi corrigida em 2026-08-21.)*
- **O build escreve todo o `.env.local` em `dist/server/.dev.vars`**, em texto puro — service
  role incluso. `dist/` é gitignored e `dist/client` (o que vai público) está limpo, mas não
  compartilhe a pasta `dist/`.
- **As fontes do site não carregam.** `src/styles.css` importa Inter e Cormorant Garamond via
  `@import`, mas o Tailwind v4 expande o `@import "tailwindcss"` antes deles — o `@import` fica
  depois de regras, vira inválido e o otimizador **descarta**. O CSS em produção tem zero
  `googleapis` e zero `@font-face`: todo mundo vê o fallback (`system-ui` e Georgia).
  Correção: `<link>` no `<head>` em vez de `@import` no CSS.

---

## 11. Superfícies mortas (existem no código, não são usadas)

Registradas para ninguém investir nelas por engano:

- **`mensagens`** — chat antigo, 0 linhas. Substituído por `comentarios` + `/conversas`.
- **`/repasses`** — ~~rota existe~~ **a rota nunca existiu** (ver §5); é aba de `casos.$id.tsx`.
  Confirmado: **0 repasses lançados** para 23 parceiros e 395 casos.
- **Webhooks** — módulo completo (HMAC, retry, tela, workflow n8n) com **0 destinos**
  cadastrados e último evento em 2026-05-30.
- **`whatsapp-inbound`** — webhook desligado desde 2026-06. A saída continuava enfileirando e
  falhando (23 falhas, a última em 20/08) e foi **pausada em 2026-08-21**: o trigger
  `trg_whatsapp_comentario_novo` está `DISABLED` nos dois bancos. Histórico preservado
  (62 enviadas, 123 recebidas).

---

## 12. Pessoas

- **Naira Romero** — sócia, product owner e quem desenvolve — nairaromerovian@gmail.com
- **Mara Sandra Vian de Oliveira** — sócia operacional — marasandra.adv@gmail.com
- Equipe interna: Mariane, Beatriz
- Escritório: Mara Vian Sociedade Individual de Advocacia — CNPJ 60.244.853/0001-09 —
  Votuporanga/SP. Canal de privacidade: marasandravian.advocacia@gmail.com

---

## 13. Como retomar o projeto

1. Ler este documento (estado), o [TODO.md](TODO.md) (o que falta) e o
   [DECISOES.md](DECISOES.md) (por quê).
2. `git log --oneline -20` — o código costuma estar à frente dos docs.
3. Conferir o banco antes de confiar em qualquer número daqui:
   `node scripts/msc-sql.mjs "select ..."`.
4. Índice de todos os documentos: [00_README.md](00_README.md).

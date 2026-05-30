# TODO — Mara Sandra Connect

> Checklist consolidado. Para contexto, ver [ARQUITETURA.md](ARQUITETURA.md), [INTEGRACOES.md](INTEGRACOES.md), [UI_DESIGN.md](UI_DESIGN.md).
> Convenção: marque com `[x]` quando concluir. Não apague — deixa o histórico visível.

---

## Curto prazo (próxima sessão)

- [ ] **Integrar checks (TI + Legalmail) no `/casos/novo`** quando parceiro está logado — chamar `check-ti-cliente` e `check-legalmail-nome` pra alertar duplicidade na criação. _(Ref: [INTEGRACOES.md](INTEGRACOES.md) §6 passo 2)_
- [ ] **Criar tela `/repasses` global no sidebar** — link existe, falta a tela. _(Ref: [ARQUITETURA.md](ARQUITETURA.md) §4)_
- [ ] **Re-rodar `explorer_legalmail_v2.py`** — testar de novo se há endpoint de download de documento (`hash_documento`). Se funcionar, abrir o plano de segurança da seção "Data Protection" abaixo. _(Ref: [INTEGRACOES.md](INTEGRACOES.md) §5.5)_

---

## Médio prazo

### UI / Tema (sequência T1→T10, ver [UI_DESIGN.md](UI_DESIGN.md) §4.2)

- [ ] **T1** — CSS vars `--ms-*` em `src/index.css`/`globals.css` (`:root` + `.dark`)
- [ ] **T2** — `tailwind.config.ts` mapeando vars para utilities (`bg-pending`, `text-partner`, etc.)
- [ ] **T3a** — Criar `<Spinner>` e `<EmptyState>` em `src/components/ui-app/`
- [ ] **T3b** — Criar `<StatusBadge>`, `<DataField>`, `<ConfirmDialog>`, `<MoneyTile>`, `<DialogShell>`
- [ ] **T7** — Aplicar mobile-first nas violações ([UI_DESIGN.md](UI_DESIGN.md) §2):
  - [ ] TabsList scroll horizontal no mobile ([casos.$id.tsx](../src/routes/_authenticated/casos.%24id.tsx))
  - [ ] Table com overflow ([index.tsx](../src/routes/_authenticated/index.tsx) dashboard)
  - [ ] Dialogs com `max-h-[90vh] overflow-y-auto` (vários instâncias)
- [ ] **T4** — Refatorar `casos.$id.tsx` usando os genéricos
- [ ] **T5** — Refatorar `index.tsx`, `documentos.tsx`, `conversas.tsx`, `configuracoes.tsx`, `casos.novo.tsx`
- [ ] **T6** — Substituir cores brutas (`bg-amber-500`, `bg-green-600`, hexs em `style={}`) por tokens. Exceção: tags do TI vêm do TI direto.

### Funcionalidade

- [ ] **Dashboard refinado para parceiro** — visão diferente da do interno
- [ ] **Marcar mensagens como lidas** quando abre chat
- [ ] **Ajustar whitelist Legalmail** conforme uso real revelar (adicionar/remover termos)

---

## Integrações TI + Legalmail (longo prazo, ver [INTEGRACOES.md](INTEGRACOES.md) §6)

- [ ] **Adicionar coluna `processos_judiciais.ultima_sync_movs`** (migration)
- [ ] **Criar tabela `sync_log`** (uma linha por source: `ti_clientes`, `ti_notas`, `legalmail_processos`, `legalmail_movs` com `last_synced_at`)
- [ ] **Tela "Processos órfãos para vincular"** — lista processos do Legalmail sem `caso_id` para a Naira ligar manualmente
- [ ] **Workflows n8n (cron periódico):**
  - [ ] **Workflow 1 `ti-sync-clientes`** — primeiro restrito aos 5 clientes mais recentes do TI (teste)
  - [ ] **Workflow 3 `legalmail-sync-processos`** — só processos dos 5 clientes
  - [ ] **Workflow 2 `ti-sync-notas`** — notas dos 5 clientes
  - [ ] **Workflow 4 `legalmail-sync-movs`** — movs dos processos do Workflow 3
- [ ] **Abrir escopo** dos workflows para todos os 763 clientes / 789 notas / N processos
- [ ] **IA pra resumir movs Legalmail (Estratégia D)** — a cada sync, IA gera resumo humano do caso em linguagem natural pra parceiro ler. Requer Claude/GPT, custo $$$. Pensar quando o uso revelar necessidade.

---

## Longo prazo

### Notificações

- [ ] **Badge in-app** de movimentação nova (contador no sidebar, dot no caso) — _não depende de domínio_
- [ ] **Notificações por email de movimentação nova** (Resend já configurado em 2026-05-28; falta implementar gatilho + template do email)

### Plataforma

- [ ] **PWA manifest** + `theme-color` no `index.html` (T8)
- [ ] **Dark mode** via `prefer-color-scheme` (T9, opcional)
- [ ] **STYLE_GUIDE.md** documentando o sistema de design (T10)
- [ ] **Tela `/processos` global** no sidebar (se decidir adicionar)
- [ ] **Onboarding de parceiro**

### Google Drive — sync bidirecional (push app → Drive)

> **Contexto:** hoje o sync é unidirecional (Drive → app). Quando o documento já existe no Drive, o app importa. Mas quando o documento foi cadastrado direto no app (upload manual, cumprir solicitação, ou caso ainda sem pasta vinculada), ele NÃO vai pro Drive.
>
> **Objetivo:** complementar o fluxo atual permitindo subir docs do app pro Drive — útil pra equipe que prefere o Drive como repositório de backup e pra clientes legacy que ainda não têm pasta no Drive.

Cenários a cobrir:

- [ ] **Cenário A — caso sem pasta vinculada ainda**: botão "Criar pasta no Drive e exportar tudo" no caso. App cria pasta no Drive (com nome do cliente), faz upload de cada documento do caso, salva folder_id + file_id em cada doc.
- [ ] **Cenário B — pasta já vinculada, documento só no app**: detectar docs com `pasta_relativa is null` (ou docs sem `gdrive_file_id`) e oferecer botão "Subir pendentes pro Drive". Cria/escolhe subpasta opcional. Atualiza `gdrive_file_id` após upload.
- [ ] **Cenário C — sync incremental contínuo**: extensão do "Sync pasta" — além de baixar arquivos novos do Drive, também detectar e subir docs do app que ainda não estão no Drive. Sync bidirecional num clique.

Considerações:

- Drive API precisa de scope `drive.file` (escrita) além do `drive.readonly` (leitura) que já temos
- Requer nova autorização OAuth (popup pedindo escopo maior na primeira vez)
- Verificar limites: API Drive permite ~750 uploads/dia por usuário sem cobrar
- UX: confirmar destino (raiz vs subpasta específica) antes de subir
- Conflitos: o que fazer se arquivo de mesmo nome já existe no Drive? Renomear (sufixo `_1`), substituir, pular?
- Audit: registrar quem disparou cada upload (já cobre `documentos.uploaded_by`)

### Reorganização opcional do repositório

- [ ] **Mover `planning/edge-functions/` para `supabase/functions/<slug>/index.ts`** (padrão do Supabase CLI, habilita `supabase functions deploy`)
- [ ] **Mover `planning/sql-migrations/` para `supabase/migrations/`**
- [ ] **Mover `planning/explorers/` para `scripts/explorers/`** (são scripts de pesquisa)

---

## Data Protection / LGPD (registrar AGORA, implementar quando lançar com parceiro real)

> Pré-requisito crítico antes de lançar o app com qualquer parceiro real OU baixar PDFs do Legalmail. Discussão completa registrada em conversa de 2026-05-28.

### 🔴 Críticos (bloqueadores de lançamento com parceiro)

- [ ] **Audit log de acesso a documentos**
  - Criar tabela `acessos_documento` (caso_id, documento_id, usuario_id, acao, ip, timestamp)
  - Logar: visualizou, baixou, fez download de PDF
  - LGPD Art. 37: registro de operações de tratamento
- [ ] **RLS rigoroso no Storage** — auditar policies dos buckets `documentos`, `cnis-uploads`, `contratos`:
  - Parceiro só lê arquivos de casos onde `caso.parceiro_id = auth.uid()`
  - Interno lê tudo
  - Confirmar policies por `caso_id` no path estão funcionando
- [ ] **Signed URLs com TTL curto (5-15 min)** para acesso a docs no Storage — nunca URL pública
- [ ] **DPA / Anexo de proteção de dados no contrato de cada parceiro**
  - LGPD Art. 39: cláusulas mínimas com operador
  - Formalizar "co-controle" CNISIA/Mara Sandra ↔ parceiro
- [ ] **Política de privacidade pública** — publicar no app (link no rodapé) + na criação de conta de parceiro
- [ ] **Criptografar `clientes.senha_meu_inss_plain`** → pgcrypto via `set_senha_meu_inss` / `get_senha_meu_inss`. Configurar `app.inss_key` no Postgres (depende de SSH no servidor da Naira ou Supabase Vault) e migrar dados existentes. Depois remover a coluna `_plain`.
- [ ] **Audit log de acessos a CNIS / senha MEU INSS** — tabela `acessos_senha_inss` existe mas não está sendo populada

### 🟡 Importantes (primeiras semanas após lançar)

- [ ] **Política de retenção e descarte de PDFs/documentos**
  - Sugestão: manter até trânsito em julgado + 5 anos (prazo de revisional)
  - Script de purge automático ou notificação de revisão manual
- [ ] **Direito do titular (LGPD Art. 18)** — implementar:
  - [ ] **Export** — cliente pede cópia: gerar ZIP com docs do caso (botão admin no /casos/$id)
  - [ ] **Exclusão** — avaliar caso ativo vs arquivado. Procedimento documentado
  - [ ] **Portabilidade** — mesmo do export
- [ ] **Sanitização de logs** — auditar `console.log` nas edge functions; remover CPF/nome/PII em texto puro
- [ ] **Plano de resposta a incidentes** — LGPD Art. 48 (notificar ANPD)
- [ ] **Upgrade Supabase Pro** (~$25/mês) — habilita PITR de 7 dias (Point-in-Time Recovery), hoje Free não tem
- [ ] **Apontar `marasandraconnect.com` para o app** no Cloudflare DNS — pré-requisito pra Resend/SMTP. Domínio registrado em 2026-05-28.

### 🟢 Recomendáveis (continuamente)

- [ ] **2FA obrigatório** pra usuários internos (TOTP/SMS além do magic link)
- [ ] **Treinamento LGPD da equipe** (Beatriz, Lucas, Mara Sandra)
- [ ] **Encarregado (DPO)** — LGPD Art. 41: nomear pessoa responsável (Naira mesma?)
- [ ] **Privacy by design check periódico** — `visivel_parceiro=false` default em dados sensíveis (já fazemos), minimização (whitelist Legalmail já ajuda)

### Riscos específicos ao armazenar PDFs do Legalmail (caso o endpoint de download seja confirmado)

| Risco | Mitigação |
|---|---|
| Vazamento de senha de parceiro → vê docs de outros casos | RLS rigoroso por `caso.parceiro_id` (item crítico) |
| Parceiro malicioso baixa PDFs e usa fora do escopo | Audit log + cláusula contratual de uso restrito |
| PDF tem dados de terceiros (testemunhas, peritos) | Avisos legais + considerar pseudonimização |
| Backup velho com dados após exclusão LGPD | PITR Pro + política de purge dos backups |

---

## Decisões pendentes

- [ ] **Documentos do Legalmail (Art. 5 do INTEGRACOES.md item 5)** — antes de decidir (baixar auto vs sob demanda):
  - [ ] Re-rodar `explorer_legalmail_v2.py` (testar 5 endpoints conhecidos + novos)
  - [ ] Consultar `https://app.legalmail.com.br/api/docs` (OpenAPI 3) por endpoint que aceite `hash_documento`
  - [ ] Se não tiver, contatar suporte do Legalmail
  - [ ] Se funcionar: abrir o checklist 🔴 Críticos da seção Data Protection acima

---

## Concluído (histórico — Fases 1-17)

- [x] Build do Cloudflare desbloqueado (era erro do router-generator com construções TS densas)
- [x] Tela `/casos/{id}` completa, 7 abas, condicional a parceiro
- [x] Tela `/casos/novo` com cliente interno
- [x] Tela `/documentos` global
- [x] Tela `/conversas`
- [x] Tela `/configuracoes`
- [x] Tela `/parceiros` com convite por magic link
- [x] Dashboard com link clicável para `/casos/{id}`
- [x] **Edge functions deployadas:**
  - [x] `check-ti-cliente` deployada (slug renomeado de `clever-worker`)
  - [x] `sync-ti-cliente` deployada (slug renomeado de `hyper-action`) + botão Sync TI no header
  - [x] `check-legalmail-nome` deployada
  - [x] `sync-legalmail-caso` deployada + botão "Buscar no Legalmail" + popup de seleção
- [x] **Migrations aplicadas:**
  - [x] `andamentos.visivel_parceiro`, `documentos.visivel_parceiro`, `analises_tecnicas.resumo_parceiro`, `solicitacoes_documento.origem`, `solicitacoes_documento.comentario`, `clientes.tags`, `clientes.ti_customer_id`, índices, GRANTs
  - [x] `andamentos.processo_admin_id` + `processo_judicial_id` + constraint + índices (Fase 2)
  - [x] RLS `andamentos_interno_acesso_total` (interno tem acesso total a andamentos)
- [x] **Tela /casos/$id refatorada:**
  - [x] Header limpo: só nome + CPF + tipo + tags TI + botões Sync (Fase 1)
  - [x] Popups de edição cliente e caso na Visão Geral (Fase 11)
  - [x] Card "Dados do caso" virou linha discreta com botão Editar
  - [x] Andamentos em 3 cards: Administrativos / Judiciais / Gerais (Fases 14, 14b, 14c, 14d, 15)
  - [x] Sub-divisão por processo via accordion (sempre, mesmo com 1 processo)
  - [x] Sub-seção "Sem processo" no card Admin pra notas TI órfãs + multi-select de transferência
  - [x] Botões Editar/Excluir em cada andamento com popup unificado (Fase 8)
  - [x] Detecção de RLS silencioso em UPDATE/DELETE/INSERT
- [x] **Sync TI:**
  - [x] Importa notas como andamentos `origem='tramitacao'` (Fase 3)
  - [x] Dedup por `metadata.ti_nota_id`
  - [x] Auto-vincula ao processo admin mais antigo (se houver); senão fica NULL na sub-seção "Sem processo"
  - [x] Backfill: criado_por + processo_admin_id pras notas antigas
- [x] **Sync Legalmail:**
  - [x] Importa processos selecionados + movimentações como `origem='legalmail'` (Fase 12, 13)
  - [x] Dedup por `metadata.legalmail_mov_id`
  - [x] Dedup processo por CNJ (`numero_processo`)
  - [x] Whitelist filtra movs irrelevantes (Documento Comprobatório, Procuração, etc.) — Fase 16
  - [x] Botão "Sync Legal" no header pra re-sync de processos vinculados (Fase 17)
- [x] **Tags do TI** renderizando coloridas no header
- [x] **Decisões registradas:**
  - [x] TI bidirecional → só leitura (2026-05-27)
  - [x] Match Legalmail ambíguo → órfão para revisão manual (2026-05-27)
  - [x] Histórico inicial → 5 clientes mais recentes do TI + tudo deles (2026-05-27)
  - [x] Notificações → email + badge in-app, interno e parceiro (2026-05-27)
  - [x] Notas TI default → `visivel_parceiro=false` (2026-05-28, revisada)
  - [x] Regra de auto-vínculo notas TI → admin mais antigo ou NULL (2026-05-28, ajustada várias vezes)
  - [x] Movs Legalmail default → `visivel_parceiro=true` (Fase 12)
  - [x] Whitelist Legalmail → 20 termos iniciais (Fase 16)
  - [x] Estratégia D (IA pra resumir) → adiada pro futuro (2026-05-28)
- [x] **Slugs limpos:** `check-ti-cliente`, `sync-ti-cliente`, `check-legalmail-nome`, `sync-legalmail-caso`
- [x] **Domínio `marasandraconnect.com` registrado** (2026-05-28)
- [x] **Resend configurado** com SMTP custom no Supabase Auth — magic link já sai com remetente `noreply@marasandraconnect.com` (2026-05-28)

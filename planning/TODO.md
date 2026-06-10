# TODO — Mara Sandra Connect

> Checklist consolidado. Para contexto, ver [ARQUITETURA.md](ARQUITETURA.md), [INTEGRACOES.md](INTEGRACOES.md), [UI_DESIGN.md](UI_DESIGN.md), [INTEGRACAO_IA.md](INTEGRACAO_IA.md), [INTEGRACAO_DJE.md](INTEGRACAO_DJE.md), [INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md).
> Convenção: marque com `[x]` quando concluir. Não apague — deixa o histórico visível.
> **Última auditoria de estado: 2026-06-09** (o app estava muito à frente desta lista; sincronizado abaixo).

---

## Em aberto — código (próximas sessões)

### 🔴 LGPD / segurança (bloqueadores de lançamento com parceiro real)

- [x] **Audit log de acesso a documentos** — tabela `acessos_documento` + RPC `log_acesso_documento` ([migration](sql-migrations/migration_acessos_documento.sql), aplicada em prod), instrumentada nos 3 pontos de signed URL em [casos.$id.tsx](../src/routes/_authenticated/casos.%24id.tsx) (visualização/download). LGPD Art. 37. _(Não confundir com `acessos_senha_inss`.)_
  - [ ] **Falta só:** surfacing na tela [auditoria.tsx](../src/routes/_authenticated/auditoria.tsx) (a captura já grava; a tela ainda só mostra senha INSS).
- [ ] **Direito do titular (LGPD Art. 18)** — parte é código:
  - [ ] **Export/Portabilidade** — gerar ZIP com docs do caso (botão admin no /casos/$id).
  - [ ] **Exclusão** — procedimento (caso ativo vs arquivado) documentado + ação admin.

### Funcionalidade / UX

- [ ] **Higiene de Storage** — limpar órfãos (arquivos de teste de 22 bytes etc.); validade maior do link de upload (hoje ~2h). _(Ref: [IA_HANDOFF.md](IA_HANDOFF.md) §4 E)_
- [ ] **Dashboard refinado para parceiro** — visão diferente da do interno.
- [ ] **Marcar mensagens como lidas** ao abrir o chat/comentários.
- [ ] **Ajustar whitelist Legalmail** conforme uso real (adicionar/remover termos).

### UI / Tema (o tema-base T1/T2 já está feito — ver Concluído)

- [ ] **T3 — genéricos em `src/components/ui-app/`** — hoje há versões informais inline (`<Loader2 animate-spin>`, AlertDialog, etc.). Formalizar `<Spinner>`, `<EmptyState>`, `<StatusBadge>`, `<DataField>`, `<ConfirmDialog>`, `<MoneyTile>`, `<DialogShell>` se/quando o reuso justificar. _(O `<Markdown>` genérico já foi criado em 2026-06-09.)_
- [ ] **T4/T5/T6 — refactor** de `casos.$id.tsx`, `index.tsx`, `documentos.tsx` etc. para os genéricos + trocar cores brutas por tokens. _(Baixa prioridade — cosmético; o tema já aplica.)_
- [ ] **T7 — varredura mobile-first** (TabsList scroll no mobile, tabelas com overflow, dialogs `max-h-[90vh] overflow-y-auto`). _(Parcialmente já feito caso a caso.)_
- [ ] **Dark mode toggle** — o CSS `.dark` já existe ([styles.css](../src/styles.css)); falta só o botão de alternância na UI. _(PWA manifest + theme-color já feitos.)_
- [ ] **STYLE_GUIDE.md** documentando o design system (T10).

### Integrações TI + Legalmail (longo prazo, ver [INTEGRACOES.md](INTEGRACOES.md) §6)

- [ ] **Coluna `processos_judiciais.ultima_sync_movs`** + tabela **`sync_log`** (uma linha por source com `last_synced_at`).
- [ ] **Workflows n8n (cron periódico)** — `ti-sync-clientes`, `ti-sync-notas`, `legalmail-sync-processos`, `legalmail-sync-movs`; começar restrito aos 5 clientes mais recentes, depois abrir escopo.
- [ ] **IA pra resumir movs Legalmail (Estratégia D)** — resumo humano por sync. Adiado (custo $$).

### Google Drive — sync bidirecional (push app → Drive)

> Hoje o sync é unidirecional (Drive → app). Falta subir docs criados no app pro Drive.

- [ ] **Cenário A** — caso sem pasta: "Criar pasta no Drive e exportar tudo".
- [ ] **Cenário B** — pasta vinculada, doc só no app: "Subir pendentes pro Drive".
- [ ] **Cenário C** — sync incremental bidirecional num clique.
- Considerações: scope `drive.file` (escrita) + nova autorização OAuth; limite ~750 uploads/dia; resolver conflitos de nome; audit via `documentos.uploaded_by`.

---

## Decisões de produto (não implementar até decidir)

- [ ] **Tela `/repasses` global no sidebar** — **adiada por decisão de produto** (2026-06-09). A rota nem existe; há comentário em [app-sidebar.tsx](../src/components/app-sidebar.tsx) marcando como pendência de produto. Repasses já existem como aba dentro do caso e na agregação do dashboard. Construir a tela global só quando o produto decidir.
- [x] **check-legalmail-nome no `/casos/novo`** — **decidido NÃO auto-chamar** (2026-06-09). A função varre TODA a base do Legalmail (`/lawsuit/all`, paginando 2,1s/página, até 5000) — rodar a cada criação de caso seria lento e bateria no rate limit toda hora. A duplicidade por CPF já é coberta automaticamente (`alertas_duplicidade`); a busca por nome continua **sob demanda** no botão "Buscar no Legalmail" do caso.
- [ ] **Tela `/processos` global** no sidebar (se decidir adicionar).
- [ ] **Onboarding de parceiro** (fluxo dedicado).

---

## Jurídico / Operacional (ação da Naira — não é código)

> Registrado aqui para não se perder; eu (Claude) não consigo executar estes — dependem de assinatura, conta de terceiro, dinheiro ou decisão da controladora.

### LGPD — contratual / governança

- [ ] **Base legal** definida (legítimo interesse / execução de contrato / consentimento).
- [ ] **DPA / Termos de Processamento** assinados com **Anthropic** e **OpenAI** (uso do plugin de IA). _(Ref: [INTEGRACAO_IA.md](INTEGRACAO_IA.md))_
- [ ] **No-training / retenção-zero** habilitados na conta de cada provedor de IA.
- [ ] **DPA / Anexo de proteção de dados** no contrato de cada **parceiro** (LGPD Art. 39; co-controle CNISIA/Mara Sandra ↔ parceiro).
- [ ] **Política de privacidade pública** — publicar no app (link no rodapé) + na criação de conta. _(Posso gerar o rascunho do texto se quiser.)_
- [ ] **Transparência** — aviso de que dados podem ser processados por IA.
- [ ] **Encarregado (DPO)** nomeado (LGPD Art. 41).
- [ ] **Treinamento LGPD da equipe** (Beatriz, Lucas, Mara Sandra).
- [ ] **Plano de resposta a incidentes** (LGPD Art. 48 — notificar ANPD).
- [ ] **Política de retenção e descarte** de PDFs/documentos (sugestão: trânsito em julgado + 5 anos).
- [ ] **2FA obrigatório** para internos (TOTP/SMS além do magic link).

### Infra / ops

- [ ] **Upgrade Supabase Pro** (~$25/mês) — habilita PITR de 7 dias (backups). Hoje Free não tem.
- [ ] **Apontar `marasandraconnect.com` para o app** no Cloudflare DNS (domínio já registrado).

---

## WhatsApp (Evolution API) — **deixado de lado a pedido da Naira (2026-06-09)**

> Será retomado em outra sessão. Estado e plano completos em
> [INTEGRACAO_WHATSAPP.md](INTEGRACAO_WHATSAPP.md) e nos runbooks em `whatsapp/`.
> Resumo: Fase 1 (saída) e Fase 2 (entrada/menu/comentário) **implantadas**;
> Fase 3 (mídia/documento + onboarding por código) **já está no código** da
> `whatsapp-inbound` mas ainda **não commitada/validada**; webhook de entrada
> está **DESLIGADO** (só ligar em janela de teste). Faltam: decisões §11,
> Fase 4 (andamento/status/decisão), Fase 5 (clientes), notificar interno quando
> parceiro comenta pelo WhatsApp, validar lista/botões interativos.

---

## Concluído (histórico)

### Sessão 2026-06-09 (esta)

- [x] **🔒 Blindagem LGPD do `visivel_parceiro` no RLS** — **bug de confidencialidade
      encontrado e corrigido**. A flag era respeitada só no frontend; um parceiro
      conseguia ler, via API direta, andamentos/documentos internos e análises
      inteiras dos próprios casos. As policies de `andamentos`, `documentos`,
      `analises_tecnicas` e do Storage (bucket `documentos`) agora exigem
      `visivel_parceiro` (análises = interno-only). _([migration](sql-migrations/migration_rls_visivel_parceiro.sql), aplicada em prod.)_
- [x] **Audit log de acesso a documentos** — ver seção 🔴 acima (feito).
- [x] **E-mail do magic link/convite repaginado** — templates HTML em português,
      com a marca do portal (dourado/creme, cabeçalho tipográfico, CTA "Acessar o
      portal"), aplicados no Supabase Auth via Management API. Fontes versionadas
      em [auth-emails/](auth-emails/). Assuntos em PT-BR.
- [x] **E-mails de notificação no ar** — 3 edge functions deployadas em produção
      (`notify-novo-andamento`, `notify-novo-comentario`, `notify-solicitacao-doc`);
      o frontend já as chamava (fire-and-forget) mas não estavam deployadas.
      Secrets `RESEND_API_KEY`/`APP_BASE_URL` confirmados. Boot 401 OK nas 3.
      _(Cobre "Notificações por email de movimentação nova".)_
- [x] **Renderização Markdown do resultado da IA** — novo componente
      [markdown.tsx](../src/components/markdown.tsx) (`react-markdown` + `remark-gfm`,
      estilizado nos tokens do app); aplicado em Observações e Resumo do parceiro
      na aba Análise técnica. _(IA_HANDOFF §4 C.)_
- [x] **Triagem manual de publicações órfãs (DJE)** — RPC
      `vincular_publicacao_dje` ([migration](sql-migrations/migration_vincular_publicacao_dje.sql),
      aplicada em prod) + botão "Vincular a um caso" e diálogo de busca em
      [publicacoes.tsx](../src/routes/_authenticated/publicacoes.tsx). Cria o
      processo se faltar, gera o andamento e marca a publicação como vinculada.
- [x] **PWA manifest + theme-color** — [manifest.webmanifest](../public/manifest.webmanifest)
      + meta `theme-color`/apple-touch em [__root.tsx](../src/routes/__root.tsx).
- [x] **Auditoria de estado** — sincronizado este TODO com o código real
      (typecheck + build verdes).

### Descoberto já-feito na auditoria (anterior a esta sessão)

- [x] **Auto-refresh / realtime** — Supabase `postgres_changes` no sino de
      notificações e no sino de movimentações do parceiro + polling 60s + evento
      `msc:sync-done` recarregando o caso. _(IA_HANDOFF §4 D — atendido.)_
- [x] **Badge in-app** — contador no sino + badge de publicações novas (DJEN) no sidebar.
- [x] **Signed URLs com TTL curto** (60–300s) em todo acesso a documentos; nenhum `getPublicUrl`.
- [x] **Criptografia da senha MEU INSS** — pgcrypto + Vault (`set/get/tem_senha_meu_inss`); coluna `_plain` migrada/removida.
- [x] **Audit log de senha MEU INSS** — `acessos_senha_inss` populada por `get_senha_meu_inss` + tela [auditoria.tsx](../src/routes/_authenticated/auditoria.tsx).
- [x] **RLS rigoroso no Storage** — policies por `caso_do_parceiro`/owner nos **3** buckets (`documentos`, `cnis-uploads`, `contratos`); todos privados.
- [x] **DJE / Publicações (DJEN)** — tabelas `publicacoes_dje` + `oabs_monitoradas`, edge `sync-djen-publicacoes` (Comunica API CNJ, `x-region: sa-east-1`), tela [publicacoes.tsx](../src/routes/_authenticated/publicacoes.tsx) (interno vê órfãs+vinculadas, parceiro vê via andamentos), badge no sidebar.
- [x] **Checks no `/casos/novo`** — `check-ti-cliente` por CPF integrado ("Buscar no TI" + import automático); duplicidade por CPF via `alertas_duplicidade`.
- [x] **Telas `/clientes` e `/equipe`** — listagem/busca de clientes com casos agrupados + importar TI; gestão e convite de internos (`convidar-usuario`).
- [x] **Tema base T1/T2** — CSS vars (light + `.dark`) em [styles.css](../src/styles.css) via `@theme inline` (Tailwind v4 CSS-first).
- [x] **Plugin de IA / MCP** — ver [IA_HANDOFF.md](IA_HANDOFF.md): `ia-analise` (Dr. Cláudio), OCR de PDFs escaneados (BYOK), `ia-mcp` com `ler_documentos_caso`, `salvar_analise`, `salvar_peca_docx`.

### Fases 1–17 (CRUD, casos, sync TI + Legalmail)

- [x] Build Cloudflare desbloqueado; telas `/casos/{id}` (7 abas), `/casos/novo`, `/documentos`, `/conversas`, `/configuracoes`, `/parceiros` (convite magic link); dashboard clicável.
- [x] **Edge functions:** `check-ti-cliente`, `sync-ti-cliente`, `check-legalmail-nome`, `sync-legalmail-caso` (slugs limpos).
- [x] **Migrations:** `visivel_parceiro` em andamentos/documentos, `resumo_parceiro`, `solicitacoes_documento.origem/comentario`, `clientes.tags/ti_customer_id`, `andamentos.processo_admin_id/processo_judicial_id` + constraints/índices, RLS `andamentos_interno_acesso_total`.
- [x] **/casos/$id refatorada:** header limpo, popups de edição, andamentos em 3 cards (Admin/Judicial/Gerais), accordion por processo, sub-seção "Sem processo", editar/excluir com detecção de RLS silencioso.
- [x] **Sync TI:** notas → andamentos `origem='tramitacao'`, dedup por `ti_nota_id`, auto-vínculo ao processo admin mais antigo, backfill.
- [x] **Sync Legalmail:** processos+movs `origem='legalmail'`, dedup por `legalmail_mov_id` e CNJ, whitelist (20 termos), botão "Sync Legal".
- [x] **Decisões registradas:** TI só-leitura; match Legalmail ambíguo → órfão; histórico inicial 5 clientes; notas TI default `visivel_parceiro=false`; movs Legalmail default `true`.
- [x] **Domínio `marasandraconnect.com` registrado** + **Resend** configurado (SMTP custom no Supabase Auth; magic link sai de `noreply@marasandraconnect.com`).

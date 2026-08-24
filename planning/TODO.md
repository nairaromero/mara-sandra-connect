# TODO — Mara Sandra Connect

> Checklist consolidado do que está em aberto.
> **Auditoria contra o banco de produção: 2026-08-15**, números revistos em 2026-08-21
> (ver ARQUITETURA.md) e lista revisada em 2026-08-23. Os números foram lidos do banco,
> não estimados — se estiverem velhos, confira antes de agir.
> Convenção: marque `[x]` ao concluir, não apague — o histórico fica no fim.
> Contexto: [ARQUITETURA.md](ARQUITETURA.md) · índice: [00_README.md](00_README.md).

---

## 🔵 Lote atual — reunião de agosto + pedidos diretos (aberto em 2026-08-24)

Em execução item a item, com commits direto na `staging`; a Naira valida em
staging.marasandraconnect.com e, fechado o lote, faz um único merge `staging → main`.
Os tempos entre parênteses apontam o trecho da gravação da reunião.

- [x] E-mails ao parceiro + aba do app: "Mara Sandra" → **"Mara Vian Advocacia"**
      (remetente, título em negrito e assinatura texto dos `notify-*`; título da aba).
      Ainda em aberto, decidir um a um: assuntos/corpo dos e-mails de auth
      (`send-email-hook`), digest interno, subtítulo "Plataforma Mara Sandra Connect",
      imagem do logo e o domínio `noreply@marasandraconnect.com`.
- [x] Sheet de tarefa: campo Caso virou combobox com busca de cliente
      (substring, ignorando acento e caixa).
- [ ] Dividir exigência em dois templates: **Exigência INSS × Exigência Judicial**,
      renomeando as tarefas existentes; texto ao parceiro claro e com prazo (00:50)
- [ ] Template de perícia — confirmação de comparecimento; parceiro só é notificado
      após conferência interna; encaixa no fluxo `/a-enviar` já desenhado (00:46)
- [ ] Template de audiência + modelo de registro de atendimento (00:42, 00:46)
- [ ] Template de montagem de requerimento (cadastro → montagem → revisão → protocolo) (00:30)
- [ ] Tarefa automática de acompanhamento de implantação em processo ganho
      (carta de concessão, histórico de crédito, termo aditivo) (00:35)
- [ ] Prorrogação de auxílio-doença pela DCB: tarefa criada 15 dias antes do fatal (00:34)
- [ ] E-mail automático ao cliente confirmando caso em análise, no vínculo do processo
- [ ] Agenda: ocultar concluídas, destacar eventos, diferenciar tarefa comum × prazo
      fatal × solicitação de documento, filtro de audiências (00:39, 00:42)
- [ ] Integração Trello → sistema (+ Drive): importar casos pendentes com e-mail ao
      parceiro na importação — ninguém move manualmente até existir (01:11)
- [ ] Integração financeira Banco Asas — boletos, Pix, cartão; conciliação automática
      a partir de setembro (01:16)
- [ ] Revisar benefício legado dos clientes — filtro novo existe, dado antigo
      incompleto (01:03; conversa com o resíduo da migração TI logo abaixo)
- [ ] Auto-reload quando sai versão nova, pra sumir com o "erro de login" pós-deploy (01:05)
- [ ] Planejar migração dos logins pro Google Workspace `@advocaciaprev.com`
      (muda e-mail de auth de todo mundo; planejar junto com a troca de domínio)

---

## 🔴 Achados da auditoria de 2026-08-15

Coisas que estavam abertas **sem constar em nenhuma lista**. Ordenadas por risco.

- [x] ~~WhatsApp falhando calado desde junho~~ — **saída pausada em 2026-08-21**
      (`migration_pausa_whatsapp_saida.sql`: trigger `trg_whatsapp_comentario_novo`
      desabilitado, pendentes cancelados, histórico preservado). Sobra a decisão:
- [ ] **WhatsApp: linha dedicada ou desligar de vez** — chip + Evolution (grátis, mesmo risco
      de ban) ou API oficial (custo por mensagem). Ver
      [whatsapp/PLANO_LINHA_DEDICADA.md](whatsapp/PLANO_LINHA_DEDICADA.md) e DECISOES.md D9.
- [ ] **226 das 264 publicações DJEN estão órfãs (21/08) — e 96 são de processos JÁ
      cadastrados** (57 casos). Não é "processo desconhecido": é vínculo que falhou em caso
      ativo. O match é determinístico por `numero_proc_normalizado` e
      `vincular_publicacao_dje` já existe. → Rodar o vínculo em lote; depois rotina diária.
- [ ] **Zero repasses lançados** para 23 parceiros e 395 casos. O modelo 30/70 não existe
      dentro do sistema; o parceiro não vê o que tem a receber. Ver §"Produto" abaixo.
- [ ] **319 dos 395 casos sem pasta do Drive** (76 com pasta em 21/08). → Cenário A (criar
      pasta automaticamente no caso novo) resolve daqui pra frente; os antigos precisam de
      vinculação em lote.
- [ ] **8 aceites de termos para 23 parceiros.** Dois terços operam sem o instrumento
      contratual de dados (LGPD art. 39). O gate por versão já existe — basta forçar o
      re-aceite subindo `TERMOS_VERSAO`.
- [ ] **Modelos OpenAI saem do ar em outubro/2026.** A lista oferecida é
      `gpt-4.1 · gpt-4.1-mini · gpt-4o · gpt-4o-mini`. Quem tiver `gpt-4.1` salvo vê a
      análise parar sem aviso. → Trocar em [src/lib/ia/client.ts](../src/lib/ia/client.ts)
      e [_shared/ia-providers.ts](../supabase/functions/_shared/ia-providers.ts).
- [ ] **Digest diário só vai para a Naira** — o campo `para` da `digest-diario` continua
      travado "por ora" desde julho. Mara, Mariane e Beatriz não recebem o panorama do dia.
- [ ] **Resíduo da migração TI:** 82 casos com `tipo_beneficio='a_definir'` e 52 sem
      parceiro (criados só para segurar os andamentos importados). Somam-se aos 77 clientes
      sem CPF que nunca migraram. Enquanto existirem, contagem nenhuma é confiável.
- [x] ~~Espelho semanal do staging nunca foi agendado~~ — **ativo desde 2026-08-23**
      (`.github/workflows/espelho-staging.yml`, segunda 05:00 BRT, role só-leitura em produção).
- [ ] **9 processos judiciais nunca sincronizaram** no DataJud (`ultima_sync` nula).
- [ ] **Triagem por IA desligada desde 06/08** (`msc-ia-triagem`) — decidir se volta.
- [ ] **Webhooks: módulo inteiro inerte.** 0 destinos, último evento em 30/05. Ou tem uso
      real esperando (leads → n8n) ou vira código morto mantido de graça.
- [ ] **`casos.$id.tsx` com 8.300 linhas** — um terço de todo o código de tela. É onde toda
      mudança cai e onde o risco de quebrar algo sem perceber é maior.
- [ ] **Fontes do site não carregam** — issue #199.
- [x] ~~`excluir-parceiro`: conferir a cópia contra a versão deployada~~ — conferido em
      2026-08-23: o fonte extraído do bundle em produção (v17, 2026-05-29) é idêntico à
      cópia em `supabase/functions/excluir-parceiro/index.ts` após normalização.
- [ ] **Drive em staging** (origem no Google Cloud) — issue #200.

---

## 🔴 LGPD e conformidade

### Depende de decisão/assinatura (não é código)

- [ ] **Base legal** definida e registrada (legítimo interesse / execução de contrato /
      consentimento).
- [ ] **DPA com Anthropic e OpenAI** + **no-training / retenção zero** ligados na conta de
      cada provedor. Hoje dado previdenciário (que toca saúde, art. 11) vai para os EUA sem
      instrumento assinado.
- [ ] **Política de privacidade pública** — texto pronto em [legal/](legal/), falta publicar
      e linkar no rodapé e no cadastro.
- [ ] **Revisão das minutas por especialista LGPD** (DPA do parceiro, política, adendo de IA).
- [ ] **Política de retenção e descarte** de documentos (sugestão: trânsito em julgado + 5 anos).
- [ ] **Plano de resposta a incidente** (art. 48 — notificar ANPD).
- [ ] **Treinamento da equipe** (Mara Sandra, Mariane, Beatriz).
- [ ] **2FA obrigatório** para internos.
- [ ] **Teste de balanceamento** do espelho anonimizado documentado no registro de
      tratamento (ver [AMBIENTES.md](AMBIENTES.md) §LGPD).

> Escritório de pequeno porte é dispensado de DPO formal (Resolução CD/ANPD nº 2/2022),
> mas deve manter canal com o titular — já configurado em [termos.ts](../src/lib/legal/termos.ts).

### É código

- [ ] **Direito do titular (art. 18)** — exportar dados do caso em ZIP e procedimento de
      exclusão (caso ativo vs. arquivado).
- [ ] **Auditoria de acesso a documento na tela.** A captura já grava em `acessos_documento`;
      a tela [auditoria.tsx](../src/routes/_authenticated/auditoria.tsx) ainda só mostra
      senha do INSS.
- [ ] **Higiene de Storage** — limpar órfãos e arquivos de teste antigos.

---

## Produto — decidido adiar, vale revisitar

- [ ] **Tela global de `/repasses`** — adiada em 2026-06-09. A rota **não existe** (repasses
      é uma aba em `casos.$id`). É a espinha comercial do escritório e está fora do sistema.
- [ ] **Dashboard próprio do parceiro** — hoje ele vê versão reduzida da visão interna, sem
      "quanto tenho a receber" nem "o que precisa de mim".
- [ ] **Aba Processos para o parceiro** (só leitura — o CNJ é o que ele passa ao cliente).
- [ ] **Onboarding dedicado do parceiro**, além do aceite de termos.
- [ ] **Cliente final no WhatsApp** — a fronteira ficou pronta num ponto só (resolvedor de
      contato), a fase nunca começou.

---

## Funcionalidade — planejado e não construído

### Substituir o Tramitação — o plano parou no MVP 3

MVPs 1 (pipeline INSS por e-mail), 2 (tarefas/kanban) e 3 (prazos/perícias) entregues; o
TI foi desligado em 2026-08-11. Por quê e como: DECISOES.md D5.

- [ ] **MVP 4 — Agenda ↔ Google Calendar nos dois sentidos.** `agenda_eventos.gcal_event_id`
      já existe e está sempre nulo. Falta OAuth por usuária, `gcal-sync-out`/`in` e convite
      automático ao cliente.
- [ ] **MVP 5 — Mobile.** Push no PWA (o manifest existe, o push não), foto da pauta virando
      tarefa, áudio virando nota.

### Outros

- [ ] **Agendamento pelo WhatsApp** com os horários livres da agenda — o pedido mais concreto
      do comercial. Depende da decisão do WhatsApp.
- [ ] **Alerta de lead parado** em "novo" sem primeiro contato.
- [ ] **Kit previdenciário digital** com acompanhamento de assinatura.
- [ ] **Drive: arquivo > 5 MB** (falha no limite do multipart — precisa de resumable upload).
- [ ] **Drive: subpastas** pelo app.
- [ ] **Drive: sinalização global** (sidebar/sino com todos os casos com mudança pendente),
      **sync em background** (polling/webhook, sem clique) e **conflito de conteúdo** (mesmo
      arquivo alterado nos dois lados — hoje só trata nome/delete).
- [ ] **Conector MNI** — falta a senha do PJe-TJMT no Keychain para o primeiro teste real e o
      credenciamento no TRF1/TRF3 ([CONECTOR_MNI.md](CONECTOR_MNI.md)).
- [ ] **Marcar comentários como lidos** ao abrir a thread (hoje só a caixa marca).
- [ ] **Whitelist do Legalmail** — ajustar termos conforme o uso real.

---

## Técnico

- [ ] **Quebrar `casos.$id.tsx`** (8.300 linhas) em componentes por aba.
- [ ] **Aposentar as superfícies mortas** — tabela `mensagens`, decidir o destino dos
      webhooks e do WhatsApp inbound (ver [ARQUITETURA.md](ARQUITETURA.md) §11).
- [ ] **Modo escuro** — o CSS `.dark` existe, falta o botão de alternância.
- [ ] **Componentes genéricos** (`Spinner`, `EmptyState`, `StatusBadge`, `DataField`,
      `ConfirmDialog`, `MoneyTile`, `DialogShell`) — formalizar se/quando o reuso justificar.
- [ ] **STYLE_GUIDE.md** documentando o design system.
- [ ] **Varredura mobile** caso a caso (TabsList com scroll, tabela com overflow, dialog com
      `max-h-[90vh]`).
- [ ] **Upgrade do Supabase de staging** ou aceitar a hibernação do free.

---

## Não fazer (decidido)

- ~~Judit~~ — descartada em 2026-07-29: R$ 1.000/mês pelo que DataJud + DJEN dão de graça.
  Código no commit `14028ee` se um dia mudar o cenário. Ver DECISOES.md D7.
- ~~Scraper próprio do INSS~~ — fora de escopo; o TI continua sendo o feed admin se precisar.
- ~~`check-legalmail-nome` automática no caso novo~~ — varre a base inteira, estoura o rate
  limit. Fica sob demanda.
- ~~Aba `/integracoes` unificando APIs e webhooks~~ — proposta de 2026-05-30 que nunca foi
  construída. Os tokens seguem em secrets de edge function. Reavaliar só se a troca de
  credencial virar incômodo real.
- ~~Preview URL de PR no Cloudflare~~ — abandonada em 2026-08-22 (range de IP inalcançável
  e risco de sobrescrever produção). Validar = merge na `staging` → staging.marasandraconnect.com.

---

## Concluído (histórico)

### 2026-08 — Ambientes, refino e automação do INSS

- [x] **Staging com domínio próprio** (22/08) — worker separado em
      staging.marasandraconnect.com; contas por papel (`e2e+admin/interno/parceiro`);
      squash `staging → main`.
- [x] **Espelho semanal ativo no GitHub Actions** (23/08) — produção lida só pelo role
      `espelho_leitura`; travas antes do truncate; seed das contas no fim.
- [x] **Sessão morta volta pro `/login`** (#184, 22/08) — 401 tratado no fetch do supabase-js;
      hooks depois do early return em `/casos` (#179); executor async do Drive picker (#180).
- [x] **Papel admin** (19/08) — `eh_admin`/`is_admin()`; gestão da equipe em `/equipe`
      (tornar admin, desligar com migração de tarefas, reativar); autoria em tarefas.
- [x] **Lovable removido + upgrade de 206 versões** (21/08) — `vite.config.ts` próprio,
      `minimumReleaseAge` no bun; lint sem ruído de formatação.
- [x] **E2E com vídeo e cursor visível**; smoke do lote; spec do site público.
- [x] **Pipeline INSS por e-mail no ar** (14/08) — `inss-email-processor` + cron 05:00 UTC
      (02:00 BRT) + auditoria em `inss_email_log`; andamento no requerimento certo, e-mail ao
      parceiro e trava que sobrevive a exclusão.
- [x] **Bancos separados** produção/staging com espelho anonimizado e usuários sintéticos.
- [x] **Caixa de conversas** — fases 1 a 4: fonte única em `comentarios`, não-lido por
      conversa, resposta inline, tempo real, sino como atalho, destinatário e filtro por pessoa.
- [x] **Agenda geral do escritório** — filtros, legenda de cores, evento de vários dias,
      evento restrito, conclusão, template por tipo, fuso fixo em Brasília.
- [x] **Perícias** — rascunho padronizado → fila `/a-enviar` separada por quem agendou →
      envio → e-mail; comparecimento e acompanhamento de implementação.
- [x] **Sino por pessoa** — dispensar não apaga para os outros.
- [x] **Papel comercial separado do modo de acesso** (`eh_parceiro` × `tipo`).
- [x] **OCR no cadastro** — RG, comprovante e vários documentos na mesma leitura; completa
      CPF com dígitos ilegíveis.
- [x] **Chave de IA compartilhável** com a equipe interna.
- [x] **Montagem de inicial em corrente**, com prazo fatal justificado e andamento por etapa.
- [x] **TI desligado** — botões removidos e sync desativado; sobrou importação manual.
- [x] **Truncamento do PostgREST corrigido** em etiquetas e exportação Excel.

### 2026-07 — A virada: sair do Tramitação

- [x] **Migração TI** — 360 clientes, 1.387 andamentos, 257 tarefas (82 perícias).
- [x] **Tarefas e kanban** + 21 templates de despacho + "minhas de hoje".
- [x] **Visão global de processos** (fases 1–4) + DataJud + digest diário + triagem por IA.
- [x] **Pipeline solicitação → exigência** — pedido, cobrança do parceiro, entrega e tarefa
      automática de cumprimento no INSS. *(Fechou o bug do handoff de 16/06 — verificado em
      produção: entrega em 14/08 disparou o trigger corretamente.)*
- [x] **CRM comercial** — formulário no site, esteira de 9 etapas, kanban, análise com
      responsável, conversão em cliente.
- [x] **Judit avaliada e descartada.**

### 2026-06 — Blindagem e conformidade

- [x] **Falha de confidencialidade corrigida no RLS** — `visivel_parceiro` passou a valer no
      banco para andamentos, documentos, análises e Storage.
- [x] **Aceite eletrônico de termos** versionado (hash, IP, user-agent, comprovante) +
      re-aceite por versão + tela interna do registro.
- [x] **Registro de acesso a documento** (`acessos_documento` + `log_acesso_documento`).
- [x] **Senha MEU INSS cifrada** (pgcrypto + Vault); coluna em texto puro removida.
- [x] **E-mails de notificação no ar** (3 edge functions) + templates com a marca.
- [x] **DJEN** — publicações com teor completo, tela de triagem, badge.
- [x] **Site institucional** + dashboard movido de `/` para `/casos`.
- [x] **Drive bidirecional** — upload espelhado, sync de novos/renomeados/apagados, rename e
      delete propagando, cache de token.
- [x] **Documentos jurídicos** (DPA, política, adendo de IA) redigidos sob medida.
- [x] **Tema do escritório** (navy + dourado) e PWA manifest.

### Até 2026-05 — O portal do parceiro

- [x] CRUD de casos, tela do caso, documentos, conversas, convite de parceiro, dashboard.
- [x] Integrações TI e Legalmail (só leitura), 4 edge functions de check/sync.
- [x] Plugin de IA — chat BYOK, MCP, análise técnica com leitura de PDF (inclusive escaneado),
      `salvar_analise` e `salvar_peca_docx`.
- [x] Outbox de webhooks com HMAC + workflow n8n.
- [x] WhatsApp fases 1–3 (saída, entrada, mídia) — hoje parado, ver achados.
- [x] Domínio próprio + Resend.

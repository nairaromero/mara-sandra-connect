# TODO — Mara Sandra Connect

> Checklist consolidado do que está em aberto.
> **Auditoria contra o banco de produção: 2026-08-15.** Os números aqui foram lidos do
> banco, não estimados — se estiverem velhos, confira antes de agir.
> Convenção: marque `[x]` ao concluir, não apague — o histórico fica no fim.
> Contexto: [ARQUITETURA.md](ARQUITETURA.md) · índice: [00_README.md](00_README.md).

---

## 🔴 Achados da auditoria de 2026-08-15

Coisas que estavam abertas **sem constar em nenhuma lista**. Ordenadas por risco.

- [ ] **WhatsApp falhando calado desde junho.** A instância do Evolution caiu
      (`Connection Closed`) mas o trigger `tg_whatsapp_comentario_novo` continua
      enfileirando: **13 mensagens falharam** após 5 tentativas cada, a última em 14/08.
      Ninguém é avisado da falha.
      → Decidir: linha dedicada (ver [whatsapp/PLANO_LINHA_DEDICADA.md](whatsapp/PLANO_LINHA_DEDICADA.md))
      **ou** desligar o trigger. O e-mail continua saindo, então o estrago é limitado —
      mas a fila entope em silêncio.
- [ ] **218 das 243 publicações DJEN estão órfãs.** 90% da fila de triagem parada.
      Uma órfã pode ser intimação com prazo em processo não cadastrado — é o cenário de
      prazo perdido. → Rotina diária de triagem **ou** filtro que separe o que é do
      escritório do ruído da OAB.
- [ ] **Zero repasses lançados** para 23 parceiros e 380 casos. O modelo 30/70 não existe
      dentro do sistema; o parceiro não vê o que tem a receber. Ver §"Produto" abaixo.
- [ ] **317 dos 380 casos sem pasta do Drive.** Todo o sync bidirecional rende em 1 caso a
      cada 6. → Cenário A (criar pasta automaticamente no caso novo) resolve daqui pra frente;
      os antigos precisam de vinculação em lote.
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
- [ ] **Espelho semanal do staging nunca foi agendado.** O arquivo está pronto em
      `espelho-staging.workflow.yml` — falta copiar para `.github/workflows/` **pela UI do
      GitHub** (o token local não tem escopo `workflow`). Sem isso o projeto free hiberna.
- [ ] **9 processos judiciais nunca sincronizaram** no DataJud (`ultima_sync` nula).
- [ ] **Triagem por IA desligada desde 06/08** (`msc-ia-triagem`) — decidir se volta.
- [ ] **Webhooks: módulo inteiro inerte.** 0 destinos, último evento em 30/05. Ou tem uso
      real esperando (leads → n8n) ou vira código morto mantido de graça.
- [ ] **`casos.$id.tsx` com 8.200 linhas** — um terço de todo o código de tela. É onde toda
      mudança cai e onde o risco de quebrar algo sem perceber é maior.

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

- [ ] **Tela global de `/repasses`** — adiada em 2026-06-09. A rota existe fora da sidebar.
      É a espinha comercial do escritório e está fora do sistema.
- [ ] **Dashboard próprio do parceiro** — hoje ele vê versão reduzida da visão interna, sem
      "quanto tenho a receber" nem "o que precisa de mim".
- [ ] **Aba Processos para o parceiro** (só leitura — o CNJ é o que ele passa ao cliente).
- [ ] **Onboarding dedicado do parceiro**, além do aceite de termos.
- [ ] **Cliente final no WhatsApp** — a fronteira ficou pronta num ponto só (resolvedor de
      contato), a fase nunca começou.

---

## Funcionalidade — planejado e não construído

### Substituir o Tramitação — o plano parou no MVP 3

Ver [SUBSTITUIR_TRAMITACAO.md](SUBSTITUIR_TRAMITACAO.md). MVPs 1, 2 e 3 entregues.

- [ ] **MVP 4 — Agenda ↔ Google Calendar nos dois sentidos.** `agenda_eventos.gcal_event_id`
      já existe e está sempre nulo. Falta OAuth por usuária, `gcal-sync-out`/`in` e convite
      automático ao cliente.
- [ ] **MVP 5 — Mobile.** Push no PWA (o manifest existe, o push não), foto da pauta virando
      tarefa, áudio virando nota.

### Outros

- [ ] **Agendamento pelo WhatsApp** com os horários livres da agenda — o pedido mais concreto
      do comercial ([CRM_COMERCIAL.md](CRM_COMERCIAL.md) §1). Depende da decisão do WhatsApp.
- [ ] **Alerta de lead parado** em "novo" sem primeiro contato.
- [ ] **Kit previdenciário digital** com acompanhamento de assinatura.
- [ ] **Drive: arquivo > 5 MB** (falha no limite do multipart — precisa de resumable upload).
- [ ] **Drive: subpastas** pelo app.
- [ ] **Conector MNI** — falta a senha do PJe-TJMT no Keychain para o primeiro teste real e o
      credenciamento no TRF1/TRF3 ([CONECTOR_MNI.md](CONECTOR_MNI.md)).
- [ ] **Marcar comentários como lidos** ao abrir a thread (hoje só a caixa marca).
- [ ] **Whitelist do Legalmail** — ajustar termos conforme o uso real.

---

## Técnico

- [ ] **Quebrar `casos.$id.tsx`** (8.200 linhas) em componentes por aba.
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
  Código no commit `14028ee` se um dia mudar o cenário. Ver [PILOTO_JUDIT.md](PILOTO_JUDIT.md).
- ~~Scraper próprio do INSS~~ — fora de escopo; o TI continua sendo o feed admin se precisar.
- ~~`check-legalmail-nome` automática no caso novo~~ — varre a base inteira, estoura o rate
  limit. Fica sob demanda.
- ~~Aba `/integracoes` unificando APIs e webhooks~~ — proposta de 2026-05-30
  ([INTEGRACOES.md](INTEGRACOES.md) §7) que nunca foi construída. Os tokens seguem em
  secrets de edge function. Reavaliar só se a troca de credencial virar incômodo real.

---

## Concluído (histórico)

### 2026-08 — Ambientes, refino e automação do INSS

- [x] **Pipeline INSS por e-mail no ar** (14/08) — `inss-email-processor` + cron 05:00 +
      auditoria em `inss_email_log`; andamento no requerimento certo, e-mail ao parceiro e
      trava que sobrevive a exclusão.
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

# TODO — Mara Sandra Connect

> [!IMPORTANT]
> **O trabalho em aberto saiu daqui.** Desde 2026-09-10, o que está pendente vive no board:
> **[Legal Connect](https://github.com/users/nairaromero/projects/1)**. Dos 63 itens abertos
> deste arquivo, **57 viraram issues novas** — quatro foram descartados por já estarem
> prontos e dois já existiam como #199 e #200. Somando um achado novo da verificação,
> o board recebeu **58 issues: #234–#291**.
>
> **Item novo não volta pra cá — abre issue.** Duas listas de pendência é como uma delas
> começa a mentir.

Este arquivo continua existindo para guardar as duas coisas que um board não guarda bem:
**o que foi decidido não fazer** (e por quê) e **o registro do que já foi entregue**.
Ambas seguem íntegras abaixo.

---

## Para onde foi cada seção

| Seção que existia aqui | Label no board | Issues |
|---|---|---|
| 🔵 Lote atual — reunião de agosto + pedidos diretos | `lote-atual` | #234–#244 |
| 🔴 Achados da auditoria de 2026-08-15 | `auditoria` | #245–#254 |
| 🔴 LGPD e conformidade | `lgpd` | #255–#265 |
| Produto — decidido adiar, vale revisitar | `produto` | #266–#272 |
| Funcionalidade — planejado e não construído | `funcionalidade` | #273–#283 |
| Técnico | `tecnico` | #284–#291 |

As colunas do board são **Backlog · Lote atual · Em revisão · Validar no staging · Produção**
— o mesmo caminho que uma mudança percorre aqui, incluindo a espera pela validação em
staging.marasandraconnect.com, que antes não era registrada em lugar nenhum.

## Quatro itens não viraram issue: já estavam prontos

Conferidos contra o banco de produção e o código em 2026-09-10, antes da migração:

| Item | Por que saiu |
|---|---|
| 9 processos judiciais nunca sincronizaram no DataJud | `ultima_sync IS NULL` → **0**; os três crons `msc-datajud-sync-*` rodam diariamente |
| Digest diário só vai para a Naira | `digest-diario/index.ts:279-285` consulta **todos** os `tipo='interno'`; o campo `para` é override de teste |
| Política de privacidade pública | `/privacidade` existe e está linkada no rodapé (`index.tsx:815`) e no aceite (`boas-vindas.tsx:187`) |
| Template de montagem de requerimento | `tarefa_templates.montagem_requerimento_adm` ativo e visível |

Outros três itens foram **reescritos** porque a premissa tinha mudado — o mais gritante
sendo o das publicações DJE órfãs: a auditoria falava em *96 publicações de processos já
cadastrados, 57 casos*; em 2026-09-10 eram **6 publicações e 3 casos**, e a rotina diária que
o item pedia para construir (`msc-djen-rematch`) já rodava havia semanas.

E um achado novo, que não constava em lista nenhuma, virou a issue **#291**:
`digest-diario` filtra `tipo='interno'` mas não `ativo`, então quem for desligado
continua recebendo o panorama diário do escritório.

> Cada número acima tem a consulta que o produz registrada na issue correspondente.

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

### Fechados nas seções de trabalho (recuperados na migração de 2026-09-10)

> Estavam marcados `[x]` no meio das listas de pendência, e por isso não constavam
> deste histórico. Ficam aqui para não se perderem com a migração.

- [x] E-mails ao parceiro + aba do app: "Mara Sandra" → **"Mara Vian Advocacia"**
      (remetente, título em negrito e assinatura texto dos `notify-*`; título da aba).
      Ainda em aberto, decidir um a um: assuntos/corpo dos e-mails de auth
      (`send-email-hook`), digest interno, subtítulo "Plataforma Mara Sandra Connect",
      imagem do logo e o domínio `noreply@marasandraconnect.com`.
- [x] Sheet de tarefa: campo Caso virou combobox com busca de cliente
      (substring, ignorando acento e caixa).
- [x] Dividir exigência em dois templates: **Exigência INSS × Exigência Judicial**,
      renomeando as tarefas existentes; texto ao parceiro claro e com prazo (00:50)
      — feito em 2026-08-24 (`migration_exigencia_inss_judicial.sql`): rótulos/títulos
      novos daqui pra frente (tarefas abertas ficam como estão); no judicial quem
      aplica informa o prazo fatal da publicação e a FATAL nasce no dia útil
      anterior; a solicitação ao parceiro é reescrita em linguagem simples pela
      edge `mensagem-parceiro-exigencia` (fallback = texto do template); o trigger
      de "documento entregue" manda pro Meu INSS ou pros autos conforme a origem.
- [x] ~~WhatsApp falhando calado desde junho~~ — **saída pausada em 2026-08-21**
      (`migration_pausa_whatsapp_saida.sql`: trigger `trg_whatsapp_comentario_novo`
      desabilitado, pendentes cancelados, histórico preservado). Sobra a decisão: issue #245.
- [x] ~~Espelho semanal do staging nunca foi agendado~~ — **ativo desde 2026-08-23**
      (`.github/workflows/espelho-staging.yml`, segunda 05:00 BRT, role só-leitura em produção).
- [x] ~~`excluir-parceiro`: conferir a cópia contra a versão deployada~~ — conferido em
      2026-08-23: o fonte extraído do bundle em produção (v17, 2026-05-29) é idêntico à
      cópia em `supabase/functions/excluir-parceiro/index.ts` após normalização.

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

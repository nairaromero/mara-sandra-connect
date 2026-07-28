# Processos — visão global (inspirado no Tramitação Inteligente)

Status: fases 1 a 4 implementadas + crons ligados (branch `feat/processos-lista`)
Aval: pendente validação da Naira (PR #87 → staging)

## Operação diária (ligada em 2026-07-29)

Crons no pg_cron do próprio banco (`migration_cron_processos.sql`; ver jobs
com `SELECT * FROM cron.job`, histórico em `cron.job_run_details` e respostas
em `net._http_response`):

| BRT   | job                  | o que faz                                      |
|-------|----------------------|------------------------------------------------|
| ~madrugada | djen-sync (n8n, EXISTENTE) | publicações DJEN por OAB              |
| 06:00/06:06/06:12 | msc-datajud-sync-1/2/3 | movimentações DataJud, 3 passadas de 60 processos, dias=90 |
| 06:30 | msc-ia-triagem       | resumo IA + tarefas (ciência D+1 / fatal−1), janela 10 dias |
| 06:45 | msc-digest-diario    | e-mail resumo — POR ORA só pra Naira (campo `para`; remover pra ir a todos os internos) |

Backfill DataJud (90 dias, 161 judiciais): iniciado em 2026-07-28/29 — 40
processos e ~370 movimentações importados antes de a API pública do CNJ ficar
instável (timeout global à noite). Os 121 restantes entram pelas passadas
diárias do cron (fila por `ultima_sync` nulls-first; processo com erro fica na
frente e re-tenta). A triagem IA ignora movimentação com mais de 10 dias, então
o histórico não vira tarefa retroativa.
Referência estudada: https://planilha.tramitacaointeligente.com.br/processos (sessão de 2026-07-27)

## Contexto

O TI tem uma tela "Processos" que funciona como planilha global: importação
automática por OAB, lista com busca/filtros, detalhe com timeline unificada
(publicações + movimentações + documentos) e feed diário de movimentações com
e-mail resumo. As fontes são públicas — DataJud/CNJ (movimentações e metadados)
e Comunica API/DJEN (publicações, descoberta de processos por OAB) — então dá
pra replicar sem dependência do TI.

No nosso sistema, processos (`processos_admin` + `processos_judiciais`) só
aparecem DENTRO do caso (aba Processos do `/casos/$id`). Não existe visão
global. Este doc cobre as 4 fases pra fechar essa lacuna e superar o TI.

## O que já temos (não refazer)

- `processos_admin` / `processos_judiciais` com número normalizado (coluna
  gerada + índice único global), hierarquia pai/filho e `etapa_tipo`.
- `andamentos` com FKs opcionais pros dois tipos de processo, origem
  (`djen`, `inss_email`, `tramitacao`, ...) e `visivel_parceiro`.
- `tarefas` com FKs opcionais pros dois tipos de processo.
- `oabs_monitoradas` com as duas OABs da Mara: **439.016/SP** e **22.928/MT**.
- `publicacoes_dje` + tela `/publicacoes` (triagem vinculada/órfã).
- Edge `cnj-consulta-processo` (DataJud) que auto-preenche tribunal/vara/comarca.
- Plano DJE (`INTEGRACAO_DJE.md`) e plano geral (`SUBSTITUIR_TRAMITACAO.md`).

## Fase 1 — Tela `/processos` (só frontend) ← ESTA BRANCH

Planilha global unindo os dois tipos de processo. Interno-only (parceiro
continua vendo processos por caso).

- Rota `src/routes/_authenticated/processos.tsx` + item "Processos" no sidebar
  (bloco interno).
- 4 queries paralelas: processos admin, processos judiciais (ambos com join
  `casos → clientes/parceiro`), último andamento e tarefas pendentes por
  processo (agregação client-side; volume atual ~700 processos é tranquilo).
- Colunas: número (com copiar), tipo (Admin/Judicial), cliente (+parceiro),
  benefício, etapa, início (protocolo/distribuição), último andamento
  (data + título), tarefas pendentes, ação "Abrir" → caso na aba Processos.
- Busca (número ou cliente), filtros (tipo, etapa, benefício), ordenação
  (último andamento — default —, início mais recente, cliente A–Z).
- Chips de resumo: total, admin, judicial, sem andamento há 30+ dias
  (processo "parado" — coisa que o TI não destaca).

Vantagem sobre o TI já na fase 1: cada linha conectada a caso, cliente,
parceiro e tarefas do nosso sistema.

## Fase 2 — Movimentações automáticas (DataJud) ← IMPLEMENTADA

- Edge `sync-datajud-movimentacoes` (deployada 2026-07-28): varre
  `processos_judiciais`, consulta o endpoint DataJud do tribunal (deduzido do
  número CNJ, mesma lógica da cnj-consulta-processo), grava movimentos novos
  como `andamento` origem `datajud`, `visivel_parceiro=true`, dedup por
  `metadata->>'datajud_mov'` = `<grau>:<codigo>:<dataHora>`. Params:
  `dias` (janela, default 90), `limite`, `numeros` (teste), `dry_run`.
  Invocar com header `x-region: sa-east-1`. Atualiza `ultima_sync`.
  Testada em prod: 2 processos → 12 movimentos criados, re-run 0 duplicatas.
- Migration `migration_andamento_origem_datajud.sql` aplicada em prod.
- Feed `/processos/movimentacoes` agrupado por dia, com botão "Buscar agora"
  (invoca a edge com dias=7) e link pro caso com foco no andamento.
- PENDENTE: cron diário no n8n (mesmo esquema do djen-sync) — invoke da edge
  com body `{"dias": 7}` + header `x-region: sa-east-1`, 1x/dia de manhã.
- PENDENTE (decisão): backfill dos ~160 judiciais (rodar sem `numeros`,
  `dias: 90`) — cria os andamentos históricos de todo mundo de uma vez;
  esperar aval da Naira pra não inundar as timelines sem aviso.

## Fase 3 — Descoberta por OAB + digest diário ← IMPLEMENTADA

- Edge `digest-diario` (deployada 2026-07-28): e-mail de resumo com 4 seções —
  movimentações DataJud novas, publicações DJEN vinculadas, **fila "processos
  fora do sistema"** (órfãs cujo CNJ não está em `processos_judiciais`, com
  link pra triagem em /publicacoes) e tarefas atrasadas/vencendo hoje. Cada
  item linka direto pro caso. Params: `horas` (default 24), `dry_run`, `para`
  (override de destinatário), `sempre` (envia mesmo sem novidade). Sem
  novidades → não envia. Destinatários: usuários internos. Envio via Resend
  (mesma RESEND_API_KEY das notify-*).
  Testada em prod: dry-run ok + envio real pra Naira (12 movimentações,
  2 publicações, 2 processos novos detectados, 124 tarefas).
- Descoberta por OAB: decidimos NÃO auto-criar processo/caso — a publicação
  órfã já fica em `publicacoes_dje` (via sync-djen existente) e a fila aparece
  no digest; a triagem manual em /publicacoes vincula (criando o processo) ou
  ignora. Auto-criação de caso exigiria inventar cliente — fica pra depois, se
  fizer falta.
- PENDENTE: cron diário no n8n (invoke da digest-diario de manhã, depois dos
  syncs DJEN e DataJud).

## Fase 4 — IA (diferencial) ← IMPLEMENTADA

- Edge `ia-triagem-andamentos` (deployada 2026-07-28): batch de andamentos
  datajud/djen ainda sem análise → UMA chamada ao modelo (tool-use como saída
  estruturada, provider-agnóstica via `_shared/ia-providers.ts` + integração
  do usuário em `ia_integracoes`) → grava em `andamentos.metadata`:
  `ia_resumo` (linguagem simples), `ia_relevancia` (rotina/atencao/urgente),
  `ia_processado_em`. Sugestão de tarefa vira registro em `tarefas` com
  `origem='ia'` (dedup pelo índice único), prioridade 1 se urgente.
- Regra de prazos do escritório (Naira, 2026-07-29): toda sugestão gera tarefa
  de **ciência** vencendo D+1 da publicação (`origem_ref ia:<id>:ciencia`);
  quando há prazo processual, tarefa adicional tipo `prazo` vencendo no
  **fatal − 1** (`ia:<id>:fatal`), com o fatal estimado na descrição. Datas
  passadas sobem pra hoje; fatal limitado a 90 dias.
- Migration `migration_tarefas_origem_ia.sql` aplicada em prod (CHECK de
  `tarefas.origem` agora aceita 'ia').
- Front: feed de movimentações mostra o resumo (✨ itálico) + badge
  Urgente/Atenção; botão "Analisar com IA" (interno, usa o JWT da sessão).
- Testada em prod: 19 andamentos triados (12 rotina, 5 atenção, 2 urgente),
  2 tarefas criadas — uma detectou prazo judicial de 15 dias numa intimação.
  Re-run: 0 reprocessados (idempotente).
- Nota: `tarefa_templates` acabou não sendo necessário — a IA gera título/
  tipo/prazo direto, com regras de prazo processual no system prompt.
- PENDENTE: cron no n8n (depois dos syncs: DJEN → DataJud → IA → digest).

## Fora de escopo (por ora)

- Download de PDF dos autos (Abrir/Baixar do TI): parcial via link de certidão
  da Comunica API; inteiro teor exigiria scraping PJe/eproc. Reavaliar depois
  da fase 3.
- Importação em massa por OAB de processos históricos (a migração TI já cobriu
  o acervo; a descoberta da fase 3 cobre os novos).

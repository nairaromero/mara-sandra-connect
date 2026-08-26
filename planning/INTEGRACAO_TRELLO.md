# Integração Trello — intake de clientes do André

**Status:** desenho aprovado em conversa (2026-08-24). Implementação ainda não iniciada.

## Contexto

O André capta clientes e os registra como cards no board Trello
**"01-AÇÕES PREVIDENCIÁRIAS"** (id `667f43859d983b821643cf07`, shortlink `SFNc4E3A`,
conta nairavianromero1). Hoje, quando um card é movido pra lista
**"2.5.) NAIRA>ORGANIZAÇÃO DE DOCUMENTOS P/ REQ ADM"** (id `667f448ec6b497edbdd2eb22` —
o n8n a chama de "Mariane", nome antigo), dois workflows n8n ("V2.2 - Intake STAGE 1/2",
ids `3ZEunN2qBNENZpg8` / `OmBKvZuCkfyqzfZ7`) fazem:

1. Extraem por regex da descrição do card: nome (título), CPF, cidade/UF, celular,
   senha gov.br. Anexo do card traz o link da pasta Google Drive do cliente.
2. POST na API do Tramitação Inteligente (`/api/v1/clientes`) — inclusive `meu_inss_pass`
   em texto puro.
3. Copiam os arquivos do Drive pra pasta do cliente em "PARCERIA - ALUMINIO - Camila e
   Andre" (2 níveis de subpasta; ignoram .docx; bloqueiam se a pasta já existir).
4. Classificam cada documento com OpenAI (visão sobre thumbnails, 27 categorias
   previdenciárias, fallback OCR+embedding+similares em Postgres próprio).
5. Stage 2: renomeia, faz merge de PDFs por categoria (Laudos/Holerites/SABI/LTCAT via
   API pdf-lib própria), move resto pra "Diversos", grava estado em `intake_runs`
   (Postgres externo, credencial n8n "Postgres account" — NÃO é nosso Supabase).

Formato da descrição dos cards (modelo, mas o André às vezes foge dele):
`Dia da captação: / Cidade/Estado: / Qualificação Civil: / CPF: / Senha GOV.BR: /
Zap: / Indicação: / Obs.: / Relato:`. Etiquetas do card = tipo do caso
(Auxílio Acidente, Aposentadoria Pcd etc.). Alguns cards têm dezenas de arquivos
anexados direto no Trello além do link do Drive (o robô atual ignora esses).

## Decisões (Naira, 2026-08-24)

- **Sem n8n.** Polling direto do Trello pelo nosso backend, **a cada 2 dias** (por ora).
- Gatilho continua sendo o card **estar** na lista 2.5 — qualquer pessoa pode mover.
- Migração = como se o André preenchesse a tela de criação: **cliente + caso**
  vinculados a ele como parceiro; relato/obs. → descrição do caso; etiquetas → tipo
  do caso; senha do Meu INSS no campo próprio (cifrada via RPC `set_senha_meu_inss` —
  melhora sobre Trello/TI, onde fica em texto puro).
- Documentos continuam sendo **organizados**, mas mais leve:
  - Heurística por nome primeiro (`src/lib/doc-type-inference.ts`) — grátis; os
    arquivos do André costumam vir bem nomeados.
  - IA só nos que sobrarem como "outro"/sem nome (reaproveitar as regras do prompt
    do n8n, que é bom).
  - **Sem merge de PDFs** (a tela do caso já agrupa por tipo; "baixar todos de um
    tipo" pode vir depois se fizer falta).
  - Tipo entra como sugestão; equipe revisa/ajusta na tela (como no importador de
    Drive da Fase 51).

## Arquitetura proposta

1. `pg_cron` (a cada 2 dias) → edge function **`intake-trello`**.
2. Edge function consulta `GET /1/lists/667f448ec6b497edbdd2eb22/cards` (com
   attachments + labels + desc). Tabela **`intake_trello_runs`** (card_id único,
   status, erros, cliente_id/caso_id criados) dá idempotência — card já processado
   não repete, não importa quanto tempo fique na lista.
3. Parse da descrição (regexes do n8n como ponto de partida + tolerância a formato
   livre). Card sem CPF/nome ou cliente já existente → status `pendente` com motivo,
   sem travar os demais; resumo por e-mail/notificação no fim da rodada.
4. Download dos arquivos da pasta Drive do card: reaproveitar o fluxo OAuth Google
   existente (`gmail-oauth-start/callback`, refresh token cifrado, já com
   `include_granted_scopes`) adicionando escopo `drive.readonly` — exige a Naira
   reautorizar uma vez em Configurações. Upload no bucket `documentos`
   (`caso_id/...`), linha em `documentos` com tipo sugerido.
5. Anexos hospedados no próprio Trello: baixar também (o robô antigo não baixava).

## Pendências / a decidir na implementação

- [x] **Credencial Trello** (2026-08-24): key/secret/token no `.env.local`
      (`TRELLO_API_KEY`/`TRELLO_OAUTH_SECRET`/`TRELLO_TOKEN`, conta nairavianromero1,
      scope read, sem expiração). Testado: board e lista 2.5 acessíveis. Na
      implementação, copiar key+token pra secrets da edge function.
- [x] **Escopo Drive** (2026-08-24): `gmail-oauth-start` agora pede também
      `drive.readonly`; falta a Naira reconectar (staging E produção — a tabela
      `usuario_gmail_oauth` não entra no espelho, então staging precisa de
      conexão própria).
- [x] Parceiro = André Alves Servan, `usuarios.id 5d4cf10c-…d26` (mesmo id nos
      dois ambientes; override por secret `INTAKE_PARCEIRO_ID`).
- [x] Tipos de documento (2026-08-24): 8 novos no enum + `tipos.ts` +
      heurística (`cnis_resumido`, `laudo_inss`, `pgr_ppra`, `cnpj_empregadora`,
      `termo_representacao`, `autodeclaracao_veracidade`, `termo_renuncia_teto`,
      `termo_responsabilidade`).
- [x] IA da classificação: integração da Naira via `ia_integracao_efetiva`
      (mesmo padrão do inss-email-processor); arquivo inteiro como attachment,
      cap de 20 arquivos/rodada e 8 MB/arquivo; sem IA configurada, degrada
      pra só-heurística sem falhar.

## Auditoria pré-produção (2026-08-26)

- **Detecção por AÇÕES do board** (além da lista): a 2.5 é lista de passagem
  (4 cards reais transitaram num só dia); polling de 2/2 dias olhando só a
  lista perderia cards. A função agora também consulta
  `/boards/{id}/actions?filter=createCard,updateCard:idList` numa janela de
  `INTAKE_JANELA_HORAS` (default 72h) e processa cards que passaram pela lista
  mesmo que já tenham saído. Card ARQUIVADO no Trello não entra. Validado em
  staging com listas de teste temporárias (criadas e arquivadas em 2026-08-26).
- **Validado também**: retry de card com status `erro` (reprocessa do zero) e
  recursão de subpasta do Drive (`pasta_relativa` preenchida).
- **Incidente (resolvido)**: rodada manual de staging processou o card real
  "Matheus Henrique Duarte" que entrou na lista entre checagens — 31 docs +
  cadastro criados no staging e REMOVIDOS por completo no mesmo dia (storage +
  linhas; card marcado não-reprocessar). Prevenção: o TRELLO_LISTA_ID do
  staging aponta pra lista morta "DOCUMENTOS" (arquivada) — staging nunca mais
  lê a lista real.
- **NÃO exercitado (aceito, validar na 1ª rodada de prod)**: classificação por
  IA (staging não tem chave utilizável; caminho protegido por try/catch e
  degrada pra "outro").
- **OAuth prod**: GMAIL_CLIENT_ID de produção é um cliente PRÓPRIO (≠ Drive
  Picker; conferido por hash) e o GMAIL_REDIRECT_URI de prod está correto —
  reconexão em prod usa o setup que já funciona desde junho, só com o escopo
  novo pedido pelo código.

## Runbook da virada (executar numa sentada, horário calmo)

1. `node scripts/msc-sql.mjs --file planning/sql-migrations/migration_intake_trello.sql`
   (cron nasce agendado; inofensivo até a função existir/ter secrets).
2. Deploy em PRODUÇÃO (`--project-ref llugytkdsfsrciavhrfw`): `intake-trello`
   e `gmail-oauth-start`.
3. Secrets de produção: `TRELLO_API_KEY`, `TRELLO_TOKEN` (os mesmos do staging).
4. Naira reconecta o Google em Configurações de PRODUÇÃO (conta real dela, que
   enxerga as pastas do André) — card "Integração Google (Gmail INSS + Drive)".
5. **Pré-marcar** em `intake_trello_runs` de prod (status `pendente`) todos os
   cards atualmente na lista 2.5 E os que aparecem nas ações das últimas 72h —
   já foram processados pelo n8n antigo, não podem ser re-importados.
6. Desativar os workflows n8n "V2.2 - Intake STAGE 1/2" (via API do n8n).
7. Rodada manual assistida: `dry_run` primeiro, conferir a lista de candidatos,
   depois rodada real com card de teste fictício; conferir cliente/caso/docs/
   senha/e-mail/sino e a classificação por IA.
8. Conferir `cron.job` agendado e, no dia seguinte à 1ª execução automática,
   `cron.job_run_details` + `net._http_response`.

**Status implementação (2026-08-24):** migration aplicada no STAGING; functions
`intake-trello` e `gmail-oauth-start` deployadas no STAGING; secrets TRELLO_*
cadastrados no staging; dry_run OK (lista vazia). Validação pendente: Naira
conecta Google no staging + card de teste na lista 2.5. Produção: rodar a
migration sem `--staging`, deployar as 2 functions no ref de produção e setar
os secrets TRELLO_* lá — só depois do OK em staging.
- [ ] O que fazer com os workflows n8n V2.2 depois da virada (desativar; TI deixa
      de receber esses clientes).
- [ ] Webhooks: novas entidades criadas pelo intake disparam os triggers de outbox
      normalmente (pré-autorizado, ver memória feedback-webhooks-proativos).

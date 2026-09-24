# CLAUDE.md

Instruções específicas do projeto pro Claude Code.

## Workflow de branches

A partir de 2026-06-18, todo trabalho passa por `staging` antes de ir pra produção real.

```
feature branch  ──merge──▶  staging  ──merge (após validação)──▶  main
                            (pre-prod)                            (prod)
```

- **`main`** = produção. Deploy automático (Workers Builds, worker `mara-sandra-connect`) → marasandraconnect.com.
- **`staging`** = pre-prod. Deploy automático (projeto Workers Builds SEPARADO, worker `mara-sandra-connect-staging`, build com `CLOUDFLARE_ENV=staging`) → **staging.marasandraconnect.com**. É onde a Naira valida antes de ir pra `main`.
- Cada projeto builda SÓ a própria branch ("Builds for non-production branches" desligado nos dois). O de staging ainda tem trava no comando: só builda se `WORKERS_CI_BRANCH=staging` e só deploya se o config gerado tiver o nome `mara-sandra-connect-staging`. Não existe mais preview URL de PR — validar feature = merge na `staging` e conferir em staging.marasandraconnect.com. NUNCA rodar `wrangler deploy` pra staging a partir do projeto de produção (incidente 2026-08-22: sobrescreveu produção com o banco de staging).
- Merge `staging → main` é **merge commit** (botão "Create a merge commit", NÃO squash — desde 2026-08-23). Assim a `main` nunca diverge da `staging`, não há o que realinhar e o PR seguinte lista só o lote novo. Revert de um lote = `git revert -m 1 <sha-do-merge>`. Após o merge, só `git checkout staging && git pull`.
- **Sem comandos destrutivos no git**: nada de `reset --hard`, `push --force` ou `--force-with-lease`, nem em branch própria. Erro já pushado se corrige com commit por cima.
- **Feature branches** (`feat/*`, `fix/*`, `chore/*`) saem de `staging` e voltam pra `staging` via PR.

**Pra abrir PR:** sempre `base: staging ← compare: <minha-branch>`. NÃO abrir PR direto pra `main` — só Naira merge `staging → main` quando tudo estiver pronto pra produção.

**Bancos separados desde 2026-08-03 (ver planning/AMBIENTES.md):**
- Produção: projeto Supabase `llugytkdsfsrciavhrfw`. Staging/dev/E2E: projeto `alhqbpbekmxpoibrrnbi` (espelho anonimizado semanal).
- Migrations: rodar PRIMEIRO `node scripts/msc-sql.mjs --staging --file ...`, validar, depois sem a flag (produção).
- Edge functions: deploy no staging (`--project-ref alhqbpbekmxpoibrrnbi`) antes de produção.
- **Quem pode chamar edge function** (desde 2026-09-20): toda function começa com
  `exigirUsuario` (sessão de pessoa, já conferindo `ativo`) ou `exigirSistema`
  (cron/gatilho, por assinatura HMAC) do `supabase/functions/_shared/auth.ts`. Desde 2026-09-23
  nenhuma rotina do sistema passa pelo n8n (o DJEN roda no pg_cron, `migration_cron_djen`; webhooks
  está "Em breve" na tela e volta por function; a saída do WhatsApp já sai pela function
  `whatsapp-outbox-enviar` no pg_cron, com a chave do escritório da linha — `migration_rbac_14` —, fila
  pausada até retomar). O n8n fica instalado na máquina do Evolution para uso futuro — não criar rotina nova nele.
  `verify_jwt` fica declarado por function no `supabase/config.toml` — nunca na linha
  de comando. Lembrando que `verify_jwt=true` **não** fecha nada sozinho: a chave
  publicável do site é um JWT válido; quem fecha é a checagem dentro da função.
  Chamada de sistema precisa do segredo `msc_system_secret` (Vault) espelhado em
  `MSC_SYSTEM_SECRET` nos segredos das functions do mesmo projeto.
- Build de branch ≠ main no Cloudflare aponta pro banco de staging automaticamente (vite.config.ts).

**Contas de staging (uma por papel, senha = `STAGING_SYNTH_PASSWORD`):**
- `e2e+admin@marasandraconnect.com` (interno + `eh_admin`), `e2e+interno@…` (interno comum), `e2e+parceiro@…` (parceiro, já onboardado). Só existem no staging.
- Criadas/recriadas por `node scripts/seed-staging-contas.mjs` (idempotente; o `espelho-staging.sh` chama no fim, porque o espelho apaga `auth.users`). Se alguma conta não logar, rodar o seed.
- Pessoa valida em staging.marasandraconnect.com com a conta do papel que quer ver — NÃO compartilhar `e2e+interno` com a suíte E2E (duas sessões na mesma conta se derrubam pela rotação de refresh token).
- E2E: `e2e/auth.setup.ts` gera `e2e/.auth/{interno,parceiro,admin}.json`; spec de admin usa `STORAGE_ADMIN`. Parceiro nos testes é o `e2e+parceiro` (senha). Era a Isabella por magic link até 2026-08-23 — o e-mail dela em produção mudou e o espelho passou a mascará-lo.
- Spec que derruba sessão (ex.: `parceiro-desligar`) cria o próprio usuário descartável (`e2e+desligar@…`) e apaga no fim — nunca usa a conta do storageState.
- Se o staging ficar atrás do Cloudflare Access: `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` (service token) no `.env.local` — o `playwright.config.ts` manda os headers sozinho.

## Ambiente local isolado (início de TODA implementação ou conserto)

Pedido da Naira (2026-09-15): antes de mexer em código, recriar o banco local
como cópia do staging e trabalhar/testar nele, isolado. Detalhes em
planning/AMBIENTES.md ("Ambiente local isolado").

```bash
bun run local:copiar   # sobe o Supabase no Docker e copia o staging (~2,5 min)
bun run dev:local      # app em :8080 no banco local
bun run e2e:local      # suíte E2E no banco local (vite na :8095)
node scripts/msc-sql.mjs --local --file planning/sql-migrations/migration_x.sql
```

- Rodar `local:copiar` no começo de cada tarefa (e de novo sempre que quiser zerar o local). Precisa do Docker aberto.
- Login local: as contas do staging, senha `STAGING_SYNTH_PASSWORD`.
- O script só LÊ o staging (credencial temporária, sessão read-only). O local nunca chama o staging: edge functions, triggers e e-mail ficam na máquina.
- Edge function local roda sem chave de IA/Resend/WhatsApp. Integração de verdade: testar no staging depois do deploy de staging.

## Rotina deploy

1. Naira diz "implementar X".
2. Crio branch `feat/x` saindo de `staging` e rodo `bun run local:copiar`.
3. Commit, push, abro PR `feat/x → staging` com `Closes #N` (o card) no corpo.
4. Naira valida (em staging.marasandraconnect.com, com a conta do papel certo, ou local) e merge.
5. Quando um lote estiver validado: Naira merge `staging → main` → deploy prod.
   O PR de release abre **com o label `release`**
   (`gh pr create --base main --head staging --label release`) — assim ele fica fora do board.

**Board ([Legal Connect](https://github.com/users/nairaromero/projects/1), desde 2026-09-10):** o trabalho aberto vive lá, não mais no `planning/TODO.md`. Colunas: Backlog · Lote atual · Em revisão · Validar no staging · Produção.
- **O card é a issue.** PR não vira card: o corpo do PR abre com `Closes #N` (**em inglês** — "Fecha #N" não liga) ou a issue é ligada no campo Development. Com essa ligação, o PR move a issue e o card dele (se entrar no board) é arquivado. PR sem issue ligada continua sendo o próprio card.
  - Em PR pra `staging` o GitHub **não** registra o `Closes` do corpo (só faz isso em PR pra `main`; conferido em 2026-09-15). Quem lê o corpo é o `board-sync` (`scripts/board-sync-ligacoes.mjs`, mesmas regras do GitHub), nos dois sentidos. Vale a partir do release que levar isso pra `main`; antes, mover a issue à mão.
  - A issue **fecha sozinha** quando um commit com `Closes #N` **na mensagem** chega na `main` (foi assim que a #299 fechou). O corpo do PR não fecha nada: sem o `Closes` num commit, fechar à mão depois da Produção.
- Automático: issue nova → Backlog (nativo); PR aberto pra staging → issue ligada em Em revisão; PR mergeado na staging → issue ligada em Validar no staging (a que ainda tem outro PR aberto fica em Em revisão); PR fechado sem merge → a issue que estava em Em revisão só por ele volta pra Lote atual (ou vai pra Validar no staging, se outro PR dela já foi mergeado; issue movida à mão para outra coluna fica onde está); release → Produção (`.github/workflows/board.yml` + `scripts/board-sync.mjs`). PR sem issue: nativo "Pull request merged" → Validar no staging. Em vigor desde o release de 2026-09-15 (#324).
- Um card só vai pra Produção quando o commit está na `main` **e** as migrations do PR estão no registro de produção (ver DB). Card segurado anda sozinho na rodada diária depois que a migration é aplicada.
- O `board.yml` roda **inteiro a partir da `main`** — inclusive o gatilho de PR (`pull_request_target` sempre usa a branch padrão). Mudança nele só vale depois do release que a leva pra `main`.
- Workflows nativos ligados: Auto-add (filtro `is:issue is:open -label:release` desde 2026-09-15 — PR não entra sozinho; se algum entrar, o script arquiva o card do PR ligado), Item added → Backlog, Pull request merged → Validar no staging, Auto-add sub-issues. "Item closed" fica **desligado**: fechar a issue no release não pode passar por cima da trava de migration.
- Teste local sem mexer em nada: `node scripts/board-sync.mjs release --dry-run`; `em-revisao <pr> --dry-run` e `fechado <pr> --dry-run` mostram quais issues o PR move (esses dois nem leem o board).

## DB

- Toda alteração via migration em `planning/sql-migrations/migration_*.sql`.
- Apply: `node scripts/msc-sql.mjs --local --file <arq>` (cópia local primeiro), depois `--staging`, depois sem a flag (produção).
- Migrations devem ser idempotentes quando possível.
- **Registro de migrations (desde 2026-09-11):** o `--file` grava toda `migration_*.sql` que roda sem erro em `ops.migrations_aplicadas` do banco-alvo. É esse registro — não inferência pelo `pg_proc` — que responde "já rodou em produção?", e o workflow do board depende dele. O que foi aplicado antes de 2026-09-11 não está lá.
  - Aplicou por outro caminho (SQL editor, antes do registro)? `node scripts/msc-sql.mjs [--staging] --registrar <arq>` — grava sem executar.
  - Saída **3** = a migration rodou mas não registrou; a mensagem traz o comando exato pra consertar.
  - O `ops` fica fora do `public` de propósito: o espelho semanal só toca o `public` (senão sobrescreveria o registro do staging com o da produção) e a API REST não expõe `ops`.

## Papéis (interno / admin / parceiro)

- `usuarios.tipo` = modo de acesso (`interno` x `parceiro`). `usuarios.eh_parceiro` = papel comercial.
- `usuarios.eh_admin` (desde 2026-08-19) = admin do escritório. **Só Naira e Mara.** No front: `const { isAdmin } = useAuth()`. No SQL: `public.is_admin()`.
- Só admin vê: Equipe interna (`/equipe`), Auditoria, e em Configurações as abas **Integrações** (Integração de IA / Conectar Claude / Integração Google) e **Webhooks**. Convidar interno (edge `convidar-usuario`) exige admin. RLS de webhooks/auditoria usa `is_admin()`.
- Configurações (desde 2026-09-14) segue o layout de `/parceiros`: centralizada, abas com a ativa na URL (`?tab=seguranca|beneficios|integracoes|webhooks`; sem `tab` = Perfil). Aba fora do papel da pessoa cai em Perfil sem reescrever a URL. Webhooks saiu da sidebar; `/webhooks` só redireciona pra `?tab=webhooks`.
- **Convite (desde 2026-09-18, #362):** quem é convidado cria senha antes de usar o sistema. Quem decide é `usuarios.senha_definida_em` (nulo = ainda não criou), marcado pelo gatilho `trg_senha_definida` em `auth.users` — nunca pelo front. Não voltar a inferir por `auth.users.encrypted_password`: o Supabase preenche esse campo sozinho quando a pessoa abre o link do convite.
- Gestão da equipe pela UI (`/equipe`, RPCs em migration_equipe_admin_desligar): `definir_admin`, `desligar_interno` (não apaga: `ativo=false` + ban no auth + tarefas abertas/agenda futura migram pra outra pessoa; histórico fica no nome), `reativar_interno`.
- Autoria em tarefas (migration_tarefas_autoria): `created_by`, `status_alterado_por/_em` via trigger; exclusões vão pra `tarefas_excluidas`.

## RBAC multi-tenant (branch `feat/rbac-multi-tenant`, só local por enquanto)

Desenho em planning/MULTI_TENANT_RBAC.md (§0 = estado real), decisões D23–D25, teste em
planning/RBAC_TESTE_LOCAL.md. Enquanto não chega ao staging, o resto deste arquivo descreve
o sistema em produção. Quando chegar, vale o seguinte:

- **Escritório ativo** = header `x-escritorio-id` que o front manda em toda chamada
  (`src/lib/supabase.ts`), conferido no banco por `private.escritorio_ativo()` contra
  `membros`. Header inválido → NULL (nada visível), nunca fallback. Nada é lido do JWT.
- **Fonte da verdade de papel/status é `membros`** (admin/advogado/assistente/financeiro/
  parceiro × 26 permissões). `usuarios.tipo/eh_admin/ativo` continuam sincronizados por
  gatilho pro código antigo, mas nenhuma decisão de acesso deve ler deles. No front:
  `const { pode, escritorio, vinculos } = useAuth()`; `pode("casos:editar")`. No SQL:
  `tem_permissao('casos:editar')`, `is_admin()`, `is_interno()` (todos sobre o vínculo ativo).
- **Telas** (desde 2026-09-24): ação de escrita passa pelo **gate único**, nunca por uma
  permissão escrita à mão. `src/lib/rbac/exigencias.ts` espelha o que o SERVIDOR exige (tabela
  por operação e escopo, RPC, edge function, bucket); na tela use
  `podeEscrever("tarefas")` para o que cria, `podeEscreverLinha("tarefas", tarefa)` para o que
  age sobre uma linha (escopo `atribuidos` só aceita a linha de quem está logado), `podeChamar`
  para RPC/function, ou `<AcaoProtegida escrever="documentos" operacao="excluir">`.
  `scripts/rbac-conferir-exigencias.mjs` (e a spec `rbac-exigencias`) compara o espelho com o
  banco e acusa sobra ou falta — é a resposta automática para "ainda falta alguma?".
  Contexto: a varredura de 23/09 mexeu só em rotas e nos gates que já existiam, e deixou ~40
  botões oferecendo o que o banco recusa (planning/RBAC_AUDITORIA_TELAS.md). Página de gestão
  (Comercial, Etiquetas, Parceiros, Processos, Novo caso, Publicações) confere a permissão além
  do tipo e devolve para /casos ou mostra "Área restrita a quem gerencia…". Prova:
  `e2e/tests/rbac-telas.spec.ts`.
- **Legalmail e TI por escritório** (RBAC 13): credencial em `escritorio_integracoes` (cifrada), lida só pelas
  functions via `_shared/integracoes.ts` (`integracaoDoEscritorio`); sem ela → 412 `integracao_nao_configurada`.
  Na tela, `useIntegracoesEscritorio().tem("legalmail")` (RPC `minhas_integracoes`) decide se o botão aparece.
  Nunca voltar a ler `LEGALMAIL_TOKEN`/`TI_TOKEN` direto: só o escritório padrão cai nesse legado, via o helper.
- **Provedores simulados no local** (`e2e/demo/mocks/provedores.cjs`, porta 8787): Evolution, Comunica/DJEN,
  Google OAuth + Gmail, Legalmail, TI, Resend e "Claude simulado". As functions leem a base por env só quando definida
  (`COMUNICA_BASE_URL`, `GOOGLE_OAUTH_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GMAIL_API_BASE`, `LEGALMAIL_BASE_URL`, `TI_BASE_URL`, `RESEND_BASE_URL`);
  sem a variável, endereço real. Essas variáveis ficam SÓ no `supabase/functions/.env` local — nunca em
  segredo de staging/produção. Filme do lote: `node e2e/demo/roteiros/lote-rbac-local.cjs` (seção R do guia).
- **Tabela nova de domínio** precisa de `escritorio_id not null` + FK + policy restritiva
  `isolamento_escritorio` + gatilho `aa_herdar_escritorio` — a `migration_rbac_02` é o
  molde (`private.tabelas_de_dominio()` lista quem fica de fora e por quê).
- **RPC `SECURITY DEFINER`** que recebe id de linha começa com
  `private.exigir_no_escritorio('tabela'::regclass, p_id)` — o `postgres` tem BYPASSRLS.
- **Edge function**: `exigirUsuario(req, { permissao: "x:y" })` resolve papel e escritório
  via `meu_contexto()`; `exigirRecurso(quem, tabela, id)` antes de tocar em linha; client de
  service role sempre `escopado(sb, escritorioId)`. Integrações de sistema (INSS, DJEN,
  WhatsApp) são do escritório `padrao_sistema` na v1.
- **QG (superadmin)** vive em `qg.<domínio>` (`qg.localhost:8080` local), rotas `/qg/*`,
  staff em `plataforma_staff`, funções `qg_*` — só metadados e contagens. Conteúdo de
  cliente só por `acessos_suporte` aprovado pelo admin do escritório (somente leitura,
  com prazo, auditado). Eliminar dados exige segunda pessoa.
- Setup local: `bun run local:copiar && bun run local:rbac` (seed idempotente com o
  escritório Canário e as contas de teste). Nova edge function local → `supabase stop/start`.
- **Listas**: nunca `.limit(n)` fixo pra "trazer tudo" — o PostgREST corta em 1.000 (`max_rows`)
  **sem erro**. Lista inteira → `buscarPaginado` (`src/lib/supabase-paginado.ts`); lista longa na
  tela → `<Paginador>` (`src/components/paginador.tsx`: "1–25 de N", « ‹ números › », itens por
  página) com `useListaPaginada` (página buscada no banco: `.range()` + `count: "exact"`, ou RPC com
  `p_limite/p_offset` e `total = count(*) over ()`) ou `usePaginaLocal` (fatia de lista já carregada).
  Ordem estável (desempate por `id`); filtro/busca muda → página 1; tamanho lembrado por lista
  (`usePorPagina`). Nada de "mostrar mais" acumulando. `qg_escritorios` e `conversas_threads` são os moldes.
- **MCP (#385)**: `ia-config` emite token para a pessoa escolhida (`ia:mcp_conceder`), grava
  `usuario_id` (dono) e `emitido_por`; `ia-mcp` roda como o dono e exige emissor admin ativo no
  escritório do token; dono e emissor veem/revogam. Nunca voltar a exigir que o dono seja admin.
- **MFA (TOTP)**: `src/lib/mfa.ts` + `<VerificacaoDuasEtapas>`; o login pede o código de quem tem
  fator, o QG exige AAL2 quando `app_config.qg_exigir_aal2='true'` (banco, não só tela). Local:
  `[auth.mfa.totp]` ligado no `supabase/config.toml`; a spec calcula o TOTP. Cloud: habilitar TOTP
  em Authentication → Multi-factor.
- **Marca**: a do PRODUTO (Legal Connect, `<MarcaLegalConnect>`) fica onde não há escritório
  (login, favicon, QG, rodapé); a do ESCRITÓRIO ativo (`escritorio_config.marca`, `<MarcaEscritorio>`,
  `useAuth().escritorio.marca`) no topo, nos e-mails (`_shared/marca.ts`) e nas mensagens. Nunca
  escrever "Mara Sandra Vian"/`/logo.png` fixo em tela ou function.
- **Glossário** (`/glossario`, `/qg/glossario`): termos em `src/lib/glossario/termos.ts`
  (id estável, categoria, `publico` todos/interno/qg). Permissões dos papéis vêm do banco em
  tempo real — não escrever matriz de permissão em texto. Papel, permissão ou conceito novo →
  termo novo lá (e `veja` dos vizinhos).

## IA (importante)

- IA é de quem tem **`ia:usar`** (admin, advogado, assistente) e é interno. Parceiro não usa IA.
- Onde vale: no front, `usuario?.tipo === "interno" && pode("ia:usar")` (`_authenticated.tsx`);
  no SERVIDOR, desde 24/09, as functions de IA exigem a permissão — `ia-assistant`,
  `ia-triagem-andamentos`, `sugerir-proxima-tarefa`, `mensagem-parceiro-exigencia`,
  `extrair-agendamento-pericia` e `ia-analise`. Antes a tela era o único freio e a API respondia
  a qualquer pessoa autenticada (planning/RBAC_CLASSE_INVERSA.md).
- `ia-config` confere **por ação**: o cofre de chaves (status/testar/salvar/ativar/compartilhar)
  pede `ia:usar`; as ações de token do MCP são da DONA do token, que pode ser parceira (#385) —
  não feche essa porta de novo.

## Checagem de regressão (após TODA modificação)

Pedido da Naira (2026-08-25), depois do code review que achou 10 bugs latentes
no lote de agosto: **sempre olhar se nada quebrou no meio do caminho.**

1. `bunx tsc --noEmit` + eslint nos arquivos tocados. Desde 2026-09-14 o `tsc`
   barra import, variável e parâmetro sem uso (`noUnusedLocals`/`noUnusedParameters`).
   Parâmetro que a assinatura exige e o código não usa leva prefixo `_`
   (`(_, i) => …`); o resto sem uso se apaga, não se silencia.
2. Suíte E2E **completa** antes do push — não só a spec da feature. Padrão: `bun run e2e:local`
   (banco local, isolado). Contra o staging (`bunx playwright test`) quando a mudança depende do
   que só existe lá (edge function com segredo, IA de verdade) — depois do deploy de staging.
3. Reler o próprio diff com lente de revisor, caçando os padrões que já morderam:
   - função de banco reescrita a partir de migration velha — partir SEMPRE do
     `pg_get_functiondef` da produção e comparar hash staging×prod antes/depois;
   - falha de query engolida virando "não existe" (error ignorado ≠ resultado vazio);
   - data fora do calendário de Brasília (usar `src/lib/fuso.ts`, nunca `new Date()` cru);
   - guard de contexto ainda carregando (comparar contra null passa calada);
   - dedup/anti-spam largo demais engolindo o 2º evento legítimo;
   - migration re-rodável desfazendo estado intencional (ex.: `oculto_na_ui`);
   - matching amplo demais (`like '%_aviso'` concluiu tarefa errada);
   - chamada externa (IA/HTTP) sem timeout.
4. Depois de subir, conferir o que roda **de verdade**: logs da edge function,
   `cron.job_run_details`, respostas do pg_net, dado esperado no banco.
   Deploy verde ≠ funcionando.

## Comandos úteis

```bash
# SQL em prod
node scripts/msc-sql.mjs --file <arquivo>
node scripts/msc-sql.mjs "SELECT ..."

# Debug RLS de storage
node scripts/debug-storage-rls.mjs

# Deploy edge function (NUNCA com --no-verify-jwt: a flag sobrepoe o
# verify_jwt declarado em supabase/config.toml)
bunx supabase functions deploy <nome> --project-ref llugytkdsfsrciavhrfw

# Dev local
bun run local:copiar   # início de toda tarefa: banco local = cópia do staging
bun run dev:local      # vite em :8080 no banco local
bun dev                # vite em :8080 no banco de STAGING (.env.local)
```

# RBAC multi-tenant — plano da ida para o staging

Escrito em 2026-09-23, depois do lote validado no local (guia: [RBAC_TESTE_LOCAL.md](RBAC_TESTE_LOCAL.md)).
**Nada daqui foi executado.** É a ordem, os comandos e o que conferir; cada passo no staging só roda com o OK da Naira.

## 0. O que a branch leva

Branch `feat/rbac-multi-tenant`, **28 commits à frente da `staging`**:

| Camada | O que muda |
|---|---|
| Banco | **16 migrations**: `migration_rbac_01` → `14` (modelo de acesso, `escritorio_id` em toda tabela de domínio, isolamento, RPCs, QG, paginação, suporte, exclusão só admin, integrações por escritório, marca, AAL2 do QG, MCP para terceiro, status de integrações, saída do WhatsApp) e duas de cron, **só produção**: `migration_cron_djen`, `migration_cron_whatsapp_outbox` (no staging viram aviso e ficam registradas) |
| Edge functions | **32 functions** alteradas ou novas (lista no §2.3), mais `_shared/` (`auth.ts` com `escopado`, `integracoes.ts`, `marca.ts`, `crypto.ts`) |
| `supabase/config.toml` | `verify_jwt` declarado para `whatsapp-outbox-enviar` (false), `qg-escritorios`, `integracoes-escritorio` (true), `sync-djen-publicacoes` (false, chamado pelo cron); `[auth.mfa]` só vale no local |
| Front | rotas `/qg/*`, Configurações (abas Escritório, Integrações, Suporte, Webhooks "Em breve"), glossário, paginador, marca, MFA, gates por permissão em todas as telas |
| Infra | QG em host próprio `qg.<domínio>` (precisa de rota no worker); n8n sai das rotinas |

O que **não** muda: contas, senhas, dados dos clientes. Todo usuário existente vira membro do escritório padrão (Mara Sandra Vian) com o papel equivalente ao de hoje (interno → advogado; `eh_admin` → admin; parceiro → parceiro).

## 1. Pré-requisitos de código (antes de abrir o PR)

- [x] **Rota do QG no worker** (feito em 23/09) — `wrangler.jsonc`: acrescentado `{ "pattern": "qg.staging.marasandraconnect.com", "custom_domain": true }` no `env.staging.routes` e `{ "pattern": "qg.marasandraconnect.com", "custom_domain": true }` nas `routes` de produção. O `custom_domain` cria o DNS no Cloudflare no deploy. Sem isso `qg.staging…` não resolve e o QG não abre.
- [x] **Espelho semanal** (feito em 23/09: `PRESERVAR` com o catálogo, `EXCLUIR` com segredos/histórico, passo 6/6 reaplicando as migrations e o seed) — antes ele **trunca todas as tabelas de `public`** (menos `app_config`) e restaura os dados de produção, que não têm RBAC. Na segunda seguinte o staging ficaria sem `escritorios`, `membros`, `papeis`… e ninguém veria nada. Dois ajustes:
  1. `PRESERVAR` ganha o catálogo do RBAC: `escritorios`, `papeis`, `permissoes`, `papel_permissoes`, `plataforma_staff`, `escritorio_config`, `oabs_monitoradas`? (não: tem dados de prod) — só o catálogo; `escritorio_integracoes` e `acessos_suporte` vão para `EXCLUIR` (segredo e histórico não vêm de prod).
  2. Depois da restauração, reaplicar `migration_rbac_01` → `14` com `--staging` (são idempotentes; o backfill de `membros` é `on conflict (escritorio_id, usuario_id) do update`), para os usuários espelhados voltarem a ser membros do escritório padrão.
- [x] **Seed do Canário no staging** (feito em 23/09: `node scripts/seed-local-rbac.mjs --staging`, com `STAGING_PUBLISHABLE_KEY` e `STAGING_SERVICE_ROLE_KEY` do `.env.local`; no staging o QG segue exigindo o código) — antes só conhecia o local. Tem `--staging` (service key do staging, mesmas contas `canario+*`, `qg+*`) para a Naira validar com os papéis, como no guia. Senão a validação fica só com o escritório padrão.
- [x] **Card no board** — issue [#395](https://github.com/nairaromero/mara-sandra-connect/issues/395) "RBAC multi-tenant: escritórios, papéis, permissões e QG (lote de 23/09)" criada em 23/09; o PR abre com `Closes #395` e `Closes #385`.
- [ ] **PR** `feat/rbac-multi-tenant → staging` (nunca para `main`), corpo com `Closes #395` e `Closes #385` e a lista de migrations e functions deste plano. Suíte completa no local antes do push (124 testes; a falha do kanban "Outros" é das migrations do PR #391 no banco local, não deste lote).

## 2. No staging, nesta ordem

### 2.1 Migrations (registram em `ops.migrations_aplicadas` do staging)

**Aplicadas no staging em 24/09/2026**, uma a uma, com conferência a cada passo (16/16 registradas).
Estado depois: 1 escritório (padrão), 33 membros (31 ativos), 5 papéis, 26 permissões, 65 papel_permissoes,
49 tabelas com `escritorio_id` (0 nulos em casos/clientes/tarefas), 44 policies `isolamento_escritorio`,
58 `perm_*`, 28 funções `private`, 24 `qg_*`, `plataforma_staff` vazio (seed vem em 2.6).
Todos esses números batem com o banco local.

```bash
for m in 01_modelo_acesso 02_escritorio_id 03_isolamento 04_rpcs 05_qg 06_qg_paginacao 07_suporte_escritorio \
         08_excluir_so_admin 09_integracoes_por_escritorio 10_marca_por_escritorio 11_qg_aal2 12_mcp_para_terceiro \
         13_integracoes_status 14_whatsapp_outbox_por_escritorio; do
  node scripts/msc-sql.mjs --staging --file planning/sql-migrations/migration_rbac_$m.sql || break
done
node scripts/msc-sql.mjs --staging --file planning/sql-migrations/migration_cron_djen.sql            # aviso (sem pg_cron), registra
node scripts/msc-sql.mjs --staging --file planning/sql-migrations/migration_cron_whatsapp_outbox.sql # idem
```

Conferir: `select count(*) from escritorios` = 1 (padrão), `select count(*) from membros` = nº de usuários ativos, `select * from papeis`; `migration_rbac_11` deixa `qg_exigir_aal2 = true` (no staging o QG já exige código).

### 2.2 Segredos das functions (nomes; conferir com `bunx supabase secrets list --project-ref alhqbpbekmxpoibrrnbi`)

| Segredo | Para quê | Estado esperado |
|---|---|---|
| `IA_MASTER_KEY` | cifra as chaves de WhatsApp/Legalmail/TI e o refresh token do Gmail | deve existir (a IA já usa); sem ele, salvar integração responde "não consegui cifrar" |
| `MSC_SYSTEM_SECRET` | assinatura de sistema (cron/gatilhos) | existe; espelhado no Vault (`msc_system_secret`) |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` | OAuth do Gmail do INSS | `GMAIL_REDIRECT_URI=https://alhqbpbekmxpoibrrnbi.supabase.co/functions/v1/gmail-oauth-callback`, e essa URL cadastrada no console do Google |
| `APP_BASE_URL` | para onde o callback do Gmail volta | `https://staging.marasandraconnect.com` |
| `EVOLUTION_BASE_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY`, `WHATSAPP_INBOUND_TOKEN` | legado do escritório padrão (entrada e saída) | como hoje |
| `LEGALMAIL_TOKEN`, `TI_TOKEN` | legado do escritório padrão até cadastrar a credencial pela tela | como hoje |
| `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET` | e-mails | como hoje |
| `COMUNICA_BASE_URL`, `GOOGLE_*_URL`, `GMAIL_API_BASE`, `LEGALMAIL_BASE_URL`, `TI_BASE_URL`, `RESEND_BASE_URL` | **só o local** (mocks) | **NÃO definir** em staging/produção |

### 2.3 Deploy das functions (uma por vez; nunca `--no-verify-jwt`)

```bash
bunx supabase functions deploy check-legalmail-nome --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy cnj-consulta-processo --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy convidar-usuario --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy digest-diario --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy excluir-parceiro --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy extrair-dados-cliente --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy gmail-oauth-callback --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy gmail-oauth-start --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy ia-analise --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy ia-assistant --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy ia-config --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy ia-mcp --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy ia-triagem-andamentos --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy inss-email-processor --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy integracoes-escritorio --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy listar-clientes-ti --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy listar-processos-legalmail --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy mensagem-parceiro-exigencia --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy notify-novo-andamento --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy notify-novo-comentario --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy notify-solicitacao-doc --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy qg-escritorios --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy send-email-hook --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy sugerir-proxima-tarefa --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy sync-datajud-movimentacoes --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy sync-djen-caso --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy sync-djen-publicacoes --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy sync-legalmail-caso --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy sync-ti-cliente --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy update-parceiro --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy whatsapp-inbound --project-ref alhqbpbekmxpoibrrnbi
bunx supabase functions deploy whatsapp-outbox-enviar --project-ref alhqbpbekmxpoibrrnbi
```

### 2.4 Auth (painel do Supabase, projeto staging)

- [ ] Authentication → Multi-factor → **TOTP ligado** (sem isso o cadastro do autenticador falha e o QG, que exige AAL2, não abre para ninguém).
- [ ] Send Email Hook já apontando para `send-email-hook` (assunto dos convites com o nome do escritório).

### 2.5 Front e QG

- [ ] Merge do PR na `staging` → Workers Builds deploya `mara-sandra-connect-staging`; o deploy cria `qg.staging.marasandraconnect.com` (custom domain do §1).
- [ ] `https://staging.marasandraconnect.com/login` mostra a marca Legal Connect; `https://qg.staging.marasandraconnect.com` abre o QG (pede código).

### 2.6 Contas e seed

- [ ] `node scripts/seed-staging-contas.mjs` (contas `e2e+*`) e `node scripts/seed-local-rbac.mjs --staging` para os papéis `canario+*` e o staff `qg+*` (o espelho semanal passa a fazer os dois no passo 6/6).
- [ ] Naira e Mara como `plataforma_staff` (dono) — inserir à mão ou pelo seed; sem isso o QG só tem as contas sintéticas.

### 2.7 Conferir de verdade

- [ ] `bunx playwright test` contra o staging: 28 specs rodam lá (12 são só do local: Canário + mocks).
- [ ] Guia (artefato v18) com as contas de staging: seções A–H e J–Q com o Canário; O (MFA com app de verdade), L (Gmail com credencial real do Google: conectar a caixa do Canário e rodar `inss-email-processor` como admin dele), P (token do MCP no Claude de verdade).
- [ ] Logs das functions no painel (integracoes-escritorio, ia-mcp, qg-escritorios) sem 500; `ops.migrations_aplicadas` com as 16; `select * from minhas_integracoes()` como admin do padrão mostra `legado = true` para legalmail/ti.
- [ ] Deixar o staging passar por **um espelho semanal** antes de ir para produção (prova o §1.2).

## 3. Riscos e reversão

- **Código e banco vão juntos.** O front antigo não manda `x-escritorio-id`; com as migrations aplicadas ele não veria nada. Nunca aplicar migration em produção sem o deploy do front logo em seguida (e vice-versa).
- **Não há "down".** As migrations criam tabelas, colunas `escritorio_id not null`, 58 policies e gatilhos. Reverter = revert do merge (`git revert -m 1 <sha>`) **e** restauração do banco (PITR do Supabase para antes da aplicação). Por isso o staging precisa de pelo menos uma semana, com o espelho no meio.
- **Cron em produção**: `msc-djen-sync` e `msc-whatsapp-outbox` só nascem na produção; conferir `cron.job_run_details` no dia seguinte. Desligar o workflow `djen-sync` do n8n depois de aplicar (senão sincroniza em dobro).
- **Escritório padrão no legado**: Legalmail, TI e WhatsApp seguem nas variáveis de ambiente até a Mara cadastrar as credenciais pela tela; nada quebra no dia 1.

## 4. Depois: produção (`staging → main`, merge commit, label `release`)

Mesma ordem do §2 com o projeto `llugytkdsfsrciavhrfw`: migrations sem `--staging` (as de cron passam a valer), segredos (`APP_BASE_URL=https://marasandraconnect.com`, `GMAIL_REDIRECT_URI` de produção), deploy das functions, TOTP ligado no Auth, rota `qg.marasandraconnect.com`, `plataforma_staff` com Naira e Mara, desligar o workflow do n8n, conferir `cron.job` (11 jobs) e os logs. O board move os cards para Produção quando as migrations estiverem no registro de produção.

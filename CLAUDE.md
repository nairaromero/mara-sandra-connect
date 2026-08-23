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
- Merge `staging → main` é **squash** (um commit só, revert = `git revert <sha>`); logo depois, realinhar a staging com **reset**, não merge: `git checkout staging && git reset --hard origin/main && git push --force-with-lease origin staging`. (Merge mantém os commits órfãos do squash e o PR seguinte lista dezenas de commits pra meia dúzia de arquivos.)
- **Feature branches** (`feat/*`, `fix/*`, `chore/*`) saem de `staging` e voltam pra `staging` via PR.

**Pra abrir PR:** sempre `base: staging ← compare: <minha-branch>`. NÃO abrir PR direto pra `main` — só Naira merge `staging → main` quando tudo estiver pronto pra produção.

**Bancos separados desde 2026-08-03 (ver planning/AMBIENTES.md):**
- Produção: projeto Supabase `llugytkdsfsrciavhrfw`. Staging/dev/E2E: projeto `alhqbpbekmxpoibrrnbi` (espelho anonimizado semanal).
- Migrations: rodar PRIMEIRO `node scripts/msc-sql.mjs --staging --file ...`, validar, depois sem a flag (produção).
- Edge functions: deploy no staging (`--project-ref alhqbpbekmxpoibrrnbi`) antes de produção.
- Build de branch ≠ main no Cloudflare aponta pro banco de staging automaticamente (vite.config.ts).

**Contas de staging (uma por papel, senha = `STAGING_SYNTH_PASSWORD`):**
- `e2e+admin@marasandraconnect.com` (interno + `eh_admin`), `e2e+interno@…` (interno comum), `e2e+parceiro@…` (parceiro, já onboardado). Só existem no staging.
- Criadas/recriadas por `node scripts/seed-staging-contas.mjs` (idempotente; o `espelho-staging.sh` chama no fim, porque o espelho apaga `auth.users`). Se alguma conta não logar, rodar o seed.
- Pessoa valida em staging.marasandraconnect.com com a conta do papel que quer ver — NÃO compartilhar `e2e+interno` com a suíte E2E (duas sessões na mesma conta se derrubam pela rotação de refresh token).
- E2E: `e2e/auth.setup.ts` gera `e2e/.auth/{interno,parceiro,admin}.json`; spec de admin usa `STORAGE_ADMIN`. Parceiro nos testes continua sendo a Isabella (magic link).
- Se o staging ficar atrás do Cloudflare Access: `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` (service token) no `.env.local` — o `playwright.config.ts` manda os headers sozinho.

## Rotina deploy

1. Naira diz "implementar X".
2. Crio branch `feat/x` saindo de `staging`.
3. Commit, push, abro PR `feat/x → staging`.
4. Naira valida (em staging.marasandraconnect.com, com a conta do papel certo, ou local) e merge.
5. Quando um lote estiver validado: Naira merge `staging → main` → deploy prod.

## DB

- Toda alteração via migration em `planning/sql-migrations/migration_*.sql`.
- Apply: `node scripts/msc-sql.mjs --staging --file <arq>` (staging primeiro), depois sem a flag (produção).
- Migrations devem ser idempotentes quando possível.

## Papéis (interno / admin / parceiro)

- `usuarios.tipo` = modo de acesso (`interno` x `parceiro`). `usuarios.eh_parceiro` = papel comercial.
- `usuarios.eh_admin` (desde 2026-08-19) = admin do escritório. **Só Naira e Mara.** No front: `const { isAdmin } = useAuth()`. No SQL: `public.is_admin()`.
- Só admin vê: Equipe interna (`/equipe`), Webhooks, Auditoria, e em Configurações os cards Integração de IA / Conectar Claude / Integração Gmail. Convidar interno (edge `convidar-usuario`) exige admin. RLS de webhooks/auditoria usa `is_admin()`.
- Gestão da equipe pela UI (`/equipe`, RPCs em migration_equipe_admin_desligar): `definir_admin`, `desligar_interno` (não apaga: `ativo=false` + ban no auth + tarefas abertas/agenda futura migram pra outra pessoa; histórico fica no nome), `reativar_interno`.
- Autoria em tarefas (migration_tarefas_autoria): `created_by`, `status_alterado_por/_em` via trigger; exclusões vão pra `tarefas_excluidas`.

## IA (importante)

- IA fica disponível só pra usuários `tipo='interno'`. Parceiros não veem launcher de IA, integrações, nem assistant panel.
- Verificação atual: `usuario?.tipo === "interno"` no `_authenticated.tsx`.

## Comandos úteis

```bash
# SQL em prod
node scripts/msc-sql.mjs --file <arquivo>
node scripts/msc-sql.mjs "SELECT ..."

# Debug RLS de storage
node scripts/debug-storage-rls.mjs

# Deploy edge function
bunx supabase functions deploy <nome> --no-verify-jwt --project-ref llugytkdsfsrciavhrfw

# Dev local
bun dev    # vite em :8080
```

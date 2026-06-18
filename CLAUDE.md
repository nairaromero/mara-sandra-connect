# CLAUDE.md

Instruções específicas do projeto pro Claude Code.

## Workflow de branches

A partir de 2026-06-18, todo trabalho passa por `staging` antes de ir pra produção real.

```
feature branch  ──merge──▶  staging  ──merge (após validação)──▶  main
                            (pre-prod)                            (prod)
```

- **`main`** = produção. Deploy automático no Cloudflare Pages → marasandraconnect.com.
- **`staging`** = pre-prod. Onde a Naira valida mudanças antes de ir pra `main`.
- **Feature branches** (`feat/*`, `fix/*`, `chore/*`) saem de `staging` e voltam pra `staging` via PR.

**Pra abrir PR:** sempre `base: staging ← compare: <minha-branch>`. NÃO abrir PR direto pra `main` — só Naira merge `staging → main` quando tudo estiver pronto pra produção.

**Mudanças que vão direto pra prod (sem passar por staging):**
- Migrations de DB (já são aplicadas em prod no momento que `node scripts/msc-sql.mjs` roda, porque o banco é único).
- Edge function deploys (mesmo motivo).

Frontend (Cloudflare Pages) é o que tem o workflow real de branches. Backend é prod único.

## Rotina deploy

1. Naira diz "implementar X".
2. Crio branch `feat/x` saindo de `staging`.
3. Commit, push, abro PR `feat/x → staging`.
4. Naira valida (em preview Cloudflare ou local) e merge.
5. Quando um lote estiver validado: Naira merge `staging → main` → deploy prod.

## DB

- Toda alteração via migration em `planning/sql-migrations/migration_*.sql`.
- Apply via `node scripts/msc-sql.mjs --file planning/sql-migrations/migration_xxx.sql`.
- Migrations devem ser idempotentes quando possível.

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

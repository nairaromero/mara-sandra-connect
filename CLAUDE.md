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

**Bancos separados desde 2026-08-03 (ver planning/AMBIENTES.md):**
- Produção: projeto Supabase `llugytkdsfsrciavhrfw`. Staging/dev/E2E: projeto `alhqbpbekmxpoibrrnbi` (espelho anonimizado semanal).
- Migrations: rodar PRIMEIRO `node scripts/msc-sql.mjs --staging --file ...`, validar, depois sem a flag (produção).
- Edge functions: deploy no staging (`--project-ref alhqbpbekmxpoibrrnbi`) antes de produção.
- Build de branch ≠ main no Cloudflare aponta pro banco de staging automaticamente (vite.config.ts).

## Rotina deploy

1. Naira diz "implementar X".
2. Crio branch `feat/x` saindo de `staging`.
3. Commit, push, abro PR `feat/x → staging`.
4. Naira valida (em preview Cloudflare ou local) e merge.
5. Quando um lote estiver validado: Naira merge `staging → main` → deploy prod.

## DB

- Toda alteração via migration em `planning/sql-migrations/migration_*.sql`.
- Apply: `node scripts/msc-sql.mjs --staging --file <arq>` (staging primeiro), depois sem a flag (produção).
- Migrations devem ser idempotentes quando possível.

## Papéis (interno / admin / parceiro)

- `usuarios.tipo` = modo de acesso (`interno` x `parceiro`). `usuarios.eh_parceiro` = papel comercial.
- `usuarios.eh_admin` (desde 2026-08-19) = admin do escritório. **Só Naira e Mara.** No front: `const { isAdmin } = useAuth()`. No SQL: `public.is_admin()`.
- Só admin vê: Equipe interna (`/equipe`), Webhooks, Auditoria, e em Configurações os cards Integração de IA / Conectar Claude / Integração Gmail. Convidar interno (edge `convidar-usuario`) exige admin. RLS de webhooks/auditoria usa `is_admin()`.
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

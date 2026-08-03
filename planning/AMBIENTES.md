# Ambientes e isolamento de banco (desde 2026-08-03)

Antes havia UM projeto Supabase pra tudo. Agora:

| Ambiente | Frontend | Projeto Supabase |
|---|---|---|
| **Produção** | marasandraconnect.com (branch `main`) | `llugytkdsfsrciavhrfw` (Pro) |
| **Staging** | staging-….workers.dev + previews de PR | `alhqbpbekmxpoibrrnbi` (free, org pessoal) |
| **Dev local** (`bun dev`) | localhost | staging (via `.env.local`) |
| **Testes E2E** | localhost/staging | staging |

Nada que rode local/staging encosta mais no banco de produção.

## Como o frontend escolhe o banco

- `src/lib/supabase.ts` lê `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`;
  **fallback = produção** (build sem vars se comporta como sempre).
- `vite.config.ts`: build do Cloudflare em branch **≠ main** (`WORKERS_CI_BRANCH`)
  injeta as vars de STAGING automaticamente. `main` → produção.
- Dev local: `.env.local` aponta pro staging (chave anon é pública por design).

## Migrations (mudou!)

Toda migration roda **primeiro no staging**, valida, e só então em produção:

```bash
node scripts/msc-sql.mjs --staging --file planning/sql-migrations/migration_x.sql
# validar no staging…
node scripts/msc-sql.mjs --file planning/sql-migrations/migration_x.sql   # produção
```

Edge functions idem: deploy no staging antes (`--project-ref alhqbpbekmxpoibrrnbi`),
depois produção. Segredos de function: gerenciar nos DOIS projetos.

## Espelho produção → staging (dados realistas anonimizados)

```bash
bash scripts/espelho-staging.sh   # local; ou GitHub Actions "espelho-staging"
```

Agendamento semanal: o arquivo `planning/espelho-staging.workflow.yml` está
pronto — pra ativar, copie-o pra `.github/workflows/` pela UI do GitHub (o
token local não tem escopo `workflow`; os secrets do repo já estão criados).
Até lá, rodar o comando acima localmente. Pipeline:
1. dump de produção (só dados, `public`) **já excluindo** tabelas sensíveis que
   nunca saem de prod (chaves de IA, tokens OAuth, trilhas, WhatsApp, webhooks);
2. truncate + restore no staging;
3. `scripts/anonimizar-staging.sql`: mascara PII estruturada (nome/CPF/telefone/
   e-mail/endereço/nascimento/senha MEU INSS), reescreve NOMES DE CLIENTES em
   texto livre (títulos, descrições, comentários, nomes de arquivo — inclusive
   primeiro nome isolado), remove CPFs de texto, zera análises técnicas (saúde),
   desliga webhooks;
4. usuários de Auth **sintéticos**: mesmos UUIDs, senha única
   (`STAGING_SYNTH_PASSWORD` no `.env.local`) — nenhuma credencial real existe
   no staging. E-mails da equipe (`nairaromerovian*`, `e2e+*`) são preservados
   pra login familiar; parceiros reais ficam mascarados.

Storage (documentos) **não é copiado** — downloads falham graciosamente no
staging. Texto de publicações DJEN/DataJud é mantido (fonte pública oficial).

### LGPD

O ato de anonimizar é tratamento de dado pessoal (estudo técnico ANPD/2023):
- base legal: legítimo interesse (garantia de qualidade/segurança do serviço) —
  documentar teste de balanceamento e registrar no registro de tratamento (art. 37);
- nenhuma técnica é 100%: risco de reidentificação deve ser reavaliado a cada
  refresh (o passe de texto livre é a parte frágil — revisar amostras após
  mudanças de schema que criem novos campos de texto);
- staging tem os mesmos controles de acesso (RLS idêntica, equipe própria).

## Credenciais (`.env.local`, gitignored; espelhadas em GitHub secrets)

`STAGING_PROJECT_REF`, `STAGING_DB_PASSWORD`, `STAGING_PUBLISHABLE_KEY`,
`STAGING_SERVICE_ROLE_KEY`, `STAGING_SYNTH_PASSWORD` — além das de produção
já existentes. **Service role nunca vai pro browser/git.**

## O que o staging NÃO faz

- Sem cron jobs (syncs DataJud/DJEN/INSS não rodam sozinhos).
- Webhooks desativados (n8n é só produção).
- E-mails: hook do Resend não configurado; magic link de UI usa o SMTP
  embutido do Supabase (rate-limited) — pra logar use senha sintética.
- Projeto free: pausa após ~1 semana sem uso; o espelho semanal reativa/mantém.
  Se pausar, "Restore" no dashboard do Supabase.

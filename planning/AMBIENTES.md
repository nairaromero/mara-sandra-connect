# Ambientes e isolamento de banco (desde 2026-08-03)

Antes havia UM projeto Supabase pra tudo. Agora:

| Ambiente | Frontend | Projeto Supabase |
|---|---|---|
| **Produção** | marasandraconnect.com (branch `main`) | `llugytkdsfsrciavhrfw` (Pro) |
| **Staging** | staging.marasandraconnect.com (branch `staging`, worker `mara-sandra-connect-staging`) | `alhqbpbekmxpoibrrnbi` (free, org pessoal) |
| **Dev local** (`bun dev`) | localhost | staging (via `.env.local`) |
| **Testes E2E** | localhost/staging | staging |

Nada que rode local/staging encosta mais no banco de produção.

## Como o frontend escolhe o banco

- `src/lib/supabase.ts` lê `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`;
  **fallback = produção** (build sem vars se comporta como sempre).
- `vite.config.ts`: build do Cloudflare em branch **≠ main** (`WORKERS_CI_BRANCH`)
  injeta as vars de STAGING automaticamente. `main` → produção. Na prática só
  `staging` builda fora da `main` (preview de PR não existe mais — ver CLAUDE.md).
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

Agendamento semanal: `.github/workflows/espelho-staging.yml` (segunda 05:00
BRT, ou "Run workflow" à mão). **Ativo na `main` desde 2026-08-23** (primeiro
run bem-sucedido: 1m20). Secrets no repo: `ESPELHO_LEITURA_PASSWORD`,
`STAGING_DB_PASSWORD`, `STAGING_SYNTH_PASSWORD`, `STAGING_SERVICE_ROLE_KEY`,
`STAGING_PUBLISHABLE_KEY` (cadastrados em 2026-08-23). O runner instala o
client Postgres 17 do PGDG — o do Ubuntu é 16 e não dumpa servidor 17.
Pipeline:
0. travas (2026-08-23): a conexão de produção tem que ser o role
   `espelho_leitura` (só `SELECT`, sem `BYPASSRLS`; criado por
   `migration_espelho_role_leitura.sql`, senha em `ESPELHO_LEITURA_PASSWORD`) —
   a senha do Postgres de produção **não é mais usada** pelo espelho; toda
   tabela com RLS em produção precisa da policy `espelho_leitura_select`
   (rodar a migration de novo quando nascer tabela nova); e o destino precisa
   do marcador `comment on schema public is 'ambiente=staging'` (produção está
   marcada `ambiente=producao`). Qualquer uma falhando, o script aborta antes
   de tocar em qualquer banco;
1. dump de produção (só dados, `public`, `--enable-row-security`) **já
   excluindo** tabelas sensíveis que nunca saem de prod (chaves de IA, tokens
   OAuth, trilhas, WhatsApp, webhooks);
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
`STAGING_SERVICE_ROLE_KEY`, `STAGING_SYNTH_PASSWORD`, `ESPELHO_LEITURA_PASSWORD`
(role só-leitura de produção usado pelo espelho) — além das de produção já
existentes. **Service role nunca vai pro browser/git.** O espelho não usa
`SUPABASE_DB_PASSWORD` (nem local, nem no workflow — o secret de produção no
GitHub é só o do role de leitura; `SUPABASE_DB_PASSWORD` foi removido de lá).

## Backup de produção e restore (testado em 2026-08-23)

O que existe de backup do banco de produção:

- **Backup diário automático da Supabase (plano Pro)**: físico, ~01:45 BRT,
  **7 últimos retidos**. Não dá pra baixar (backup físico não tem download).
- **PITR**: desligado (add-on pago; volume atual não justifica).
- **Storage NÃO entra em backup nenhum** — nem no diário, nem em PITR, nem no
  clone. Os arquivos de `documentos`/`cnis-uploads`/`contratos` só existem no
  bucket. É o buraco real de backup (item aberto no TODO).
- O espelho semanal pro staging **não é backup** (anonimizado e sobrescrito).

### Runbook de restore — validado com um clone real

Caminho certo pra testar (e pra recuperar sem derrubar produção):
**Dashboard → produção → Database → Backups → Restore to a new project.**
Cria um projeto novo na mesma org; produção não é tocada. O "Restore" simples,
sem "new project", **sobrescreve produção in-place** — só em incidente.

Resultado do teste de 2026-08-23 (backup daquela madrugada → projeto
`marasandra-restore-teste`, apagado depois):

- **~4 minutos** do clique ao `ACTIVE_HEALTHY`; custo adicional $0 (mesmo compute).
- Conferido idêntico à produção em 14 indicadores: 400 clientes, 400 casos,
  4.394 andamentos, 800 tarefas, 5.126 documentos (linhas), 29 `auth.users`,
  46 tabelas, 133 policies, 41 triggers, 96 funções, role `espelho_leitura`.
- **Vault veio junto**: senha MEU INSS decifra no clone (testado por
  `pgp_sym_decrypt` + `_inss_get_key()`, conferindo só o length).
- Estado de triggers preservado (`trg_whatsapp_comentario_novo` desabilitado).

Pegadinhas do clone, todas observadas no teste:

- **`pg_cron` e `pg_net` NÃO vêm** (extensões exigem reconfiguração manual).
  Bom: os jobs do clone não disparam contra as edge functions de produção.
- A **API de query (Management) demora uns minutos** pra funcionar no clone
  ("password authentication failed" logo após criar — é só esperar).
- A senha do Postgres do clone é **a de produção** (roles são restaurados).
- Não vêm: Storage, edge functions, config de Auth, API keys, settings.
- O clone não pode ser fonte de outro clone.

## O que o staging NÃO faz

- Sem cron jobs (syncs DataJud/DJEN/INSS não rodam sozinhos).
- Webhooks desativados (n8n é só produção).
- E-mails: hook do Resend não configurado; magic link de UI usa o SMTP
  embutido do Supabase (rate-limited) — pra logar use senha sintética.
- Projeto free: pausa após ~1 semana sem uso; o espelho semanal reativa/mantém.
  Se pausar, "Restore" no dashboard do Supabase.

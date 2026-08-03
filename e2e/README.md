# Testes E2E (Playwright)

Testes ponta-a-ponta das funcionalidades principais, rodando contra o app real
e o banco de **produção** (único). Leia as regras de segurança abaixo.

## Rodar

```bash
bun run e2e            # frontend local (vite dev :8085)
bun run e2e:staging    # frontend da branch STAGING (URL estável do Cloudflare)
bun run e2e:ui         # modo interativo (debug)

# Contra qualquer preview URL (versão de PR):
PLAYWRIGHT_BASE_URL=https://<versao>-mara-sandra-connect.nairaromerovian.workers.dev bun run e2e
```

**Atenção — o que muda com o alvo é só o FRONTEND.** O banco/Storage/edge
functions são os de **produção** em todos os casos (o projeto tem backend
único). É por isso que existem as regras de marcador `[E2E]` + cleanup abaixo.
Isolamento real de dados exigiria um segundo projeto Supabase só de teste.

## Segredos (`.env.local`, gitignored — em CI, GitHub Actions secrets)

| Variável | O quê |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | admin: login programático, seed e cleanup. **Nunca** vai pro browser/git. |
| `E2E_INTERNO_PASSWORD` | senha do usuário de teste interno `e2e+interno@marasandraconnect.com` (criado pelo setup no 1º uso) |

## Como funciona a autenticação

`e2e/auth.setup.ts` (globalSetup) loga os dois papéis **sem UI de login** e
grava `e2e/.auth/{interno,parceiro}.json` como storageState (a sessão do
supabase-js vive em localStorage):

- **interno**: `signInWithPassword` com o usuário e2e dedicado;
- **parceiro**: Isabella (`nairaromerovian+isabella@gmail.com`) via
  `admin.generateLink({type:'magiclink'})` + `verifyOtp` — o token volta na
  resposta, nenhum e-mail é enviado.

## Regras pro banco de produção único

1. **Todo dado criado por teste leva o marcador `[E2E]`** no nome do cliente.
2. Seeds sempre via `e2e/supabase-admin.ts` (`seedClienteCaso`, `seedSolicitacao`).
3. `cleanupE2E()` roda no `afterAll` de cada spec: apaga storage, documentos,
   solicitações, tarefas, notificações, comentários, andamentos, agenda, casos
   e clientes `[E2E]%` — inclusive o que triggers criaram durante o teste.
4. Nunca tocar em dados sem o marcador. Nunca usar contas reais além da
   Isabella (parceira de teste).
5. `workers: 1` no config: specs rodam em série pra não disputar os dados.

## Escrevendo testes novos

- Locators semânticos: `getByRole`, `getByLabel`, `getByText`. Nos Selects
  Radix (portal), clique no trigger (`getByRole("combobox")` filtrado por
  placeholder) e depois no `getByRole("option", {name})`.
- Assertions `expect(...)` do Playwright são auto-retrying — nunca usar
  `waitForTimeout`.
- Verificação forte: depois do fluxo de UI, conferir o efeito no banco com o
  client admin (ver specs existentes).

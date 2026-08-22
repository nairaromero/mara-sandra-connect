# Testes E2E (Playwright)

Testes ponta-a-ponta rodando contra o app real e o banco de **staging**
(projeto `alhqbpbekmxpoibrrnbi`, espelho anonimizado — ver
[planning/AMBIENTES.md](../planning/AMBIENTES.md)).

> **Corrigido em 2026-08-21.** Este README dizia que os testes rodavam contra
> PRODUCAO, com regras de marcador `[E2E]` + cleanup para conviver com dados
> reais. Isso deixou de valer quando os bancos foram separados (2026-08-03):
> `e2e/env.ts` escolhe o projeto pela URL em `VITE_SUPABASE_URL` e, apontando
> pro staging, usa `STAGING_SERVICE_ROLE_KEY` e `STAGING_SYNTH_PASSWORD`.
> **Antes de rodar, confira pra onde `VITE_SUPABASE_URL` aponta** — se estiver
> em producao, os testes usam a service key de producao. O marcador `[E2E]` e o
> cleanup continuam valendo de qualquer forma.

## Rodar

```bash
bun run e2e                  # frontend local (vite dev :8085)
bun run e2e:staging          # frontend da branch staging
bun run e2e:ui               # modo interativo (debug)

# com VIDEO de cada teste
bun run e2e:video            # local
bun run e2e:video:staging    # staging  <- o que usar pra validar um lote
```

Os videos saem em `test-results/<nome-do-teste>/video.webm`.

### Espaco em disco — nao acumula

`test-results/` e `playwright-report/` sao **gitignored**: video nunca vai pro
repositorio.

E o Playwright **apaga o `outputDir` inteiro no inicio de cada run** (conferido
empiricamente: um arquivo plantado ali some no run seguinte). Ou seja, o video
de hoje substitui o de ontem — nao acumula sozinho.

Medido num run completo com `PW_VIDEO=1`:

| | |
|---|---|
| `test-results/` | ~5,6 MB (13 videos) |
| `playwright-report/` | ~6,1 MB |
| traces | 0 — `trace: "retain-on-failure"`, so aparecem quando algo quebra |

Trace de falha ocupa ~8 MB cada; por isso ficam so nos testes que falham.

Se quiser limpar na mao (depois de um run interrompido, por exemplo):

```bash
bun run e2e:clean
```

### Validar um lote antes de promover pra main

```bash
bun run e2e:video:staging
```

Roda tudo, inclusive `smoke-lote.spec.ts` — que e **so leitura**: navega as
telas principais, abre um caso e confere o form de caso novo, sem criar nem
apagar nada. E o video serve de registro do que foi validado.

### O cursor do mouse no video

O Playwright move um ponteiro de verdade, mas **o video nao desenha cursor
nenhum**. Quem desenha e o helper [`e2e/cursor.ts`](cursor.ts): chame
`await cursorVisivel(page)` **antes do primeiro `goto`** e o video passa a
mostrar o ponteiro e um pulso a cada clique.

Para o vídeo ficar legivel, mova antes de clicar — `locator.click()` teleporta
o mouse e o movimento some na gravacao:

```ts
const b = await alvo.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
await page.waitForTimeout(500);
await alvo.click();
```

## Segredos (`.env.local`, gitignored — em CI, GitHub Actions secrets)

| Variável | O quê |
|---|---|
| `VITE_SUPABASE_URL` | **decide o alvo.** Apontando pro staging, tudo abaixo muda pras chaves de staging |
| `STAGING_SERVICE_ROLE_KEY` | admin no staging: login programático, seed e cleanup. **Nunca** vai pro browser/git |
| `STAGING_SYNTH_PASSWORD` | senha única de todos os usuários sintéticos do espelho, inclusive `e2e+interno@marasandraconnect.com` |
| `SUPABASE_SERVICE_ROLE_KEY` | só usada se o alvo for produção |
| `E2E_INTERNO_PASSWORD` | só usada se o alvo for produção |

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

# Remover a Lovable do projeto

> Plano de remoção completa do scaffold/preset da Lovable, mantendo local,
> staging e produção funcionando **sem breaking change**.
> Escrito em 2026-08-19 contra o commit `dc9f897`.

---

## 0. O que já foi testado (leia antes do resto)

Isto não é um plano no papel. A remoção foi **executada e comparada** num
worktree isolado, **com as versões reais de produção** (`wrangler 4.84.1`,
`@cloudflare/vite-plugin 1.33.1`, TanStack `1.167.50`, `react 19.2.5`,
`@supabase/supabase-js 2.106.1` — nenhuma mexeu):

| Teste | Resultado |
|---|---|
| Build `WORKERS_CI_BRANCH=staging`, com × sem preset | **269 arquivos byte-idênticos** |
| Build sem a var (= produção), com × sem preset | **269 arquivos byte-idênticos** |
| URL do Supabase no bundle (branch) | só `alhqbpbekmxpoibrrnbi` — 2 arquivos, zero refs de produção |
| URL do Supabase no bundle (`main` / sem var) | só `llugytkdsfsrciavhrfw` — 2 arquivos, zero refs de staging |
| `bun dev` | :8080, HTTP 200, SSR real |
| HTML de dev, com × sem preset | idêntico salvo **um timestamp de render** do TanStack Router |
| Lock | **796 → 718 entradas, 0 versões alteradas, 0 pacotes novos** |
| Dependências novas | **nenhuma** |
| `bun run lint` | **2042 problemas antes e depois** — falha pré-existente em `staging`, intocada |

### Correção importante sobre um teste anterior

Uma primeira rodada deste teste comparou preset × sem-preset **com o lock
regenerado do npmjs nos dois lados**. Provou que a troca de config é fiel, mas
**não** isolou o efeito de regenerar o lock. Ao medir isso separadamente:
regenerar o `bun.lock` inteiro sobe **142 pacotes de versão**, incluindo
`wrangler 4.84.1 → 4.95.0`, `@cloudflare/vite-plugin 1.33.1 → 1.39.0`,
`workerd` e `miniflare` por um mês inteiro, e a pilha TanStack Router/Start
por vários minors. **Nada disso pode viajar escondido dentro de um PR de
"remover Lovable"** — daí a abordagem em dois commits do §4.

---

## 1. O que é "Lovable" neste repositório

Cinco pontos de acoplamento. Só o primeiro tem efeito em runtime.

| # | Onde | O que é | Efeito hoje |
|---|---|---|---|
| 1 | `package.json` → `@lovable.dev/vite-tanstack-config@^1.7.0` (devDep) | Wrapper que **monta a config do Vite inteira** | Roda em todo build e todo `bun dev` |
| 2 | `vite.config.ts:7` | `import { defineConfig } from "@lovable.dev/vite-tanstack-config"` | Ponto de entrada do #1 |
| 3 | `bunfig.toml:6` | `minimumReleaseAgeExcludes = ["@lovable.dev/vite-tanstack-config"]` | Tira o pacote da quarentena de 24h de supply-chain |
| 4 | `.lovable/project.json` | Marcador `template: tanstack_start_ts_2026-05-12` | Inerte |
| 5 | `package.json` → `"name": "tanstack_start_ts"` | Nome herdado do template | Cosmético |

Fora do repositório, o histórico mostra que o editor visual foi usado de verdade
e depois abandonado: `gpt-engineer-app[bot]` assina **18 commits**, o último em
**2026-05-25** — três meses atrás. `Lovable <noreply@lovable.dev>` assina 1
(o commit do template).

---

## 2. O que o preset faz — separado por utilidade

Lido do `dist/index.js` da versão 1.7.0 (o pacote é público no npm, 5,4 KB).
Fora do sandbox — que é o nosso caso em **todos** os ambientes — ele produz:

### Load-bearing (precisa ser reproduzido)

| Peça | Por quê |
|---|---|
| `tailwindcss()`, `tsConfigPaths()`, `viteReact()` | Sem isso não há build |
| `cloudflare({ viteEnvironment: { name: "ssr" } })`, **só em `command === "build"`** | É o que gera o Worker |
| `tanstackStart()` com `importProtection` (`behavior: "error"`, barra `**/server/**` e `server-only` no cliente) | Proteção real contra vazar código de servidor pro bundle do cliente |
| `define: import.meta.env.VITE_*` via `loadEnv(mode, cwd, "VITE_")` | **O switch staging/produção depende disto.** É o que carrega pro bundle as vars que o `vite.config.ts` seta em `process.env` antes de exportar |
| `resolve.dedupe` de `react`, `react-dom`, jsx-runtimes, `@tanstack/react-query`, `@tanstack/query-core` | Evita duas cópias de React em runtime |
| `resolve.alias` `@` → `<cwd>/src` | Redundante com o `tsconfig.json`, mas mantido |
| `server: { host: "::", port: 8080 }` | De onde vem a :8080 que o `CLAUDE.md` documenta |
| `server.watch.awaitWriteFinish` (1000 ms / 100 ms) | Debounce do watcher |

### Resíduo do sandbox (pode cair)

| Peça | Por que cai |
|---|---|
| `componentTagger()` do `lovable-tagger` — roda em **todo `bun dev`** | Marca o JSX pro editor visual da Lovable. **Medido: o HTML servido tem `data-lov-*` = 0 com e sem ele** — não muda nada observável |
| `devServerBridgePlugin` | Só ativa dentro do sandbox (`LOVABLE_SANDBOX=1` ou `DEV_SERVER__PROJECT_PATH`) |
| `hmrGatePlugin` | Fora do sandbox é opt-in, e não está optado |
| `devSsrErrorLogger` + `devServerFnErrorLogger` | Dev-only. O repo já tem o próprio caminho de erro SSR em `src/lib/error-capture.ts` + `src/server.ts` |
| `validateConfig` / `cleanServerConfig` | Só rodam no sandbox |

---

## 3. A substituição

Arquivo `vite.config.ts` inteiro, já testado:

```ts
// Config do Vite SEM o preset da Lovable.
//
// Reproduz o caminho NAO-sandbox de @lovable.dev/vite-tanstack-config@1.7.0
// (dist/index.js). Ficaram de fora, de proposito, as partes que so serviam
// dentro do sandbox da Lovable: componentTagger (lovable-tagger),
// devServerBridgePlugin, hmrGatePlugin e os dois loggers de erro de dev
// (o repo tem o proprio em src/lib/error-capture.ts + src/server.ts).
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// AMBIENTES (ver planning/AMBIENTES.md): build de branch NAO-main no
// Cloudflare (WORKERS_CI_BRANCH) aponta pro Supabase de STAGING - producao
// (main, ou build sem a var) usa o fallback de producao em src/lib/supabase.ts.
// Vars ja definidas explicitamente (ex.: .env.local no dev) tem prioridade.
const branchCI = process.env.WORKERS_CI_BRANCH;
if (branchCI && branchCI !== "main" && !process.env.VITE_SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = "https://alhqbpbekmxpoibrrnbi.supabase.co";
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsaHFicGJla214cG9pYnJybmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NTY3NDIsImV4cCI6MjEwMTEzMjc0Mn0.WBM4zpE6R3dlE2iQV8Y0U2n-Zvr9msj9xPNhW434xKM";
}

export default defineConfig(({ command, mode }) => {
  // O preset injetava as VITE_* como `define` literal. Mantido igual: e o que
  // carrega pro bundle as vars setadas acima em process.env.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(env)) {
    define[`import.meta.env.${chave}`] = JSON.stringify(valor);
  }

  return {
    define,
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    server: {
      host: "::",
      port: 8080,
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      // cloudflare so no build, igual ao preset
      ...(command === "build" ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // src/server.ts: nosso wrapper de erro em cima do entry do TanStack Start
        server: { entry: "server" },
      }),
      react(),
    ],
  };
});
```

O bloco de ambientes (`WORKERS_CI_BRANCH`) e o `server: { entry: "server" }`
seguem **idênticos** ao que já estava lá — só saiu o wrapper em volta.

---

## 4. Passo a passo — dois commits, nessa ordem

Os dois problemas estão **entrelaçados**: `bun remove` não consegue rodar
enquanto o lock apontar pro registry privado (ele tenta instalar, toma 403 e
não altera nada). Por isso o destravamento vem primeiro.

### Commit 1 — destrava o `bun install`

Troca **só o campo de URL** das 8 entradas presas por `""` (registry padrão),
que é como as outras 788 já estão. **Versão e hash `sha512` intactos** — o bun
valida a integridade na instalação, então o tarball do npmjs é comprovadamente
o mesmo artefato. Diff: **8 linhas**.

```bash
# no bun.lock, para as 8 entradas de @supabase/* e iceberg-js:
#   "https://europe-west4-npm.pkg.dev/lovable-core-prod/..."  ->  ""
bun install
# confere: @supabase/supabase-js segue 2.106.1
```

**Nunca** `rm bun.lock && bun install` — é o que sobe os 142 pacotes.

### Commit 2 — remove o preset

```bash
# 1. substituir o vite.config.ts pelo do §3
# 2. bun remove @lovable.dev/vite-tanstack-config
# 3. bunfig.toml: minimumReleaseAgeExcludes = []
# 4. git rm -r .lovable/
# 5. rm -rf node_modules && bun install
ls node_modules | grep -i lovable    # tem que voltar vazio
```

O `bun remove` poda **78 entradas** do lock — o preset, seus 2 sub-plugins e a
árvore inteira do `lovable-tagger` (que arrastava `tailwindcss 3.4.19`, um
major atrás do que o projeto usa, e o set completo de binários do esbuild) —
**sem alterar uma única versão**.

Abrir PR **`chore/remove-lovable` → `staging`**. Nunca direto pra `main`.

## 5. Validação antes do merge pra produção

| # | Checagem | Como | Esperado |
|---|---|---|---|
| 1 | Build de produção | `bun run build` | ✓ sem erro |
| 2 | Build de branch aponta pro staging | `WORKERS_CI_BRANCH=staging bun run build` + grep | só a URL de staging no `dist` |
| 3 | Build de `main` aponta pra produção | `bun run build` + grep | só a URL de produção no `dist` |
| 4 | Dev local | `bun dev` | :8080, home renderiza |
| 5 | Preview do Cloudflare | abrir a URL do PR | login, `/clientes` e `/casos/$id` funcionam |
| 6 | E2E | `bun run e2e` | 4 specs passam |
| 7 | Alias `@` | qualquer import `@/lib/...` | resolve |
| 8 | Sem React duplicado | abrir uma tela com hooks | sem erro de "invalid hook call" |

O item **5 é o que não dá pra simular localmente**: a `@cloudflare/vite-plugin`
roda no build, mas quem executa o Worker de verdade é a Cloudflare. É o único
ponto onde a validação precisa acontecer no preview do PR.

---

## 6. Riscos e rollback

| Risco | Probabilidade | Mitigação |
|---|---|---|
| O `bun.lock` inteiro é reescrito no PR | **Alta** — remover uma dep rebaixa a árvore toda | Esperado. Ver §8: é também o que conserta os 403 do `bun install`. Revisar o diff do lock com atenção |
| O preset publica uma versão nova com algo que passamos a precisar | Baixa | Não se aplica depois da remoção |
| Alguém reabre o projeto no editor da Lovable e ele recria o preset | **Média** | Ver §8 — depende de desconectar o GitHub App |
| Diferença que o teste não pegou | Baixa | Build byte-idêntico nos dois modos; rollback é `git revert` de um PR de 4 arquivos |

**Rollback:** o PR toca `vite.config.ts`, `package.json`, `bunfig.toml`,
`.lovable/` e o lock. `git revert` resolve. Nenhuma migration, nenhum dado, nada
irreversível.

---

## 7. Como reproduzir o teste que embasa este plano

```bash
git worktree add /tmp/verify HEAD --detach
cd /tmp/verify
mv bun.lock bun.lock.bak
bun install --registry https://registry.npmjs.org

# baseline, com preset
WORKERS_CI_BRANCH=staging bun run build && mv dist dist-base-staging
bun run build && mv dist dist-base-prod

# aplicar o vite.config.ts do §3 e remover a dep
bun remove @lovable.dev/vite-tanstack-config
rm -rf node_modules && bun install --registry https://registry.npmjs.org

WORKERS_CI_BRANCH=staging bun run build && mv dist dist-novo-staging
bun run build && mv dist dist-novo-prod

diff -r dist-base-staging dist-novo-staging && echo IDENTICO
diff -r dist-base-prod    dist-novo-prod    && echo IDENTICO

cd - && git worktree remove --force /tmp/verify
```

---

## 8. Fora do escopo — precisa de decisão da Naira

Três coisas que **não** dá pra resolver de dentro do repositório:

1. **O GitHub App da Lovable ainda está instalado?**
   O bot `gpt-engineer-app[bot]` não escreve desde 2026-05-25, mas o app pode
   seguir instalado com permissão de escrita. Enquanto estiver, alguém abrir o
   projeto no editor pode gerar commit e recriar o que este PR removeu.
   → Conferir em **GitHub → Settings → Integrations → Applications** e
   desinstalar, se a decisão for sair de vez.

2. **O `bun.lock` fixa 8 pacotes num registry privado da Lovable.**
   `@supabase/supabase-js` (+5 sub-libs), `@supabase/phoenix` e `iceberg-js`
   apontam pra `europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache`,
   que responde **403** fora do sandbox — e o `bun install` **sai com código 0
   mesmo assim**. Provável resíduo do lock ter sido gerado dentro do sandbox.
   Este PR reescreve o lock de qualquer jeito, então conserta de carona — mas é
   uma mudança na árvore de dependências de todo mundo, e a decisão é sua.

3. **O nome do projeto no `package.json` é `tanstack_start_ts`.**
   Renomear pra `mara-sandra-connect` é cosmético e não quebra nada
   (`private: true`, nunca foi publicado). Fica a critério.

---

## 9. Recomendação

**Vale fazer, e é barato.** O preset é 5,4 KB de utilidade real cercada de
resíduo de um editor que ninguém usa desde maio. Remover:

- devolve visibilidade — hoje o `vite.config.ts` abre com *"do NOT add them
  manually or the app will break with duplicate plugins"*, e ninguém consegue
  ver a cadeia de plugins sem abrir o `node_modules`;
- tira 81 pacotes da árvore;
- elimina a única exceção à quarentena de supply-chain do `bunfig.toml`;
- não custa nenhuma dependência nova e não muda um byte do build.

O que **não** deve entrar no mesmo PR: renomear o projeto, mexer no registry por
decisão própria, ou desinstalar o GitHub App. Cada um é uma conversa separada.

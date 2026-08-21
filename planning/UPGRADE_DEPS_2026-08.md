# Upgrade de dependências e limpeza do lint — 2026-08-21

> Plano em duas frentes que se cruzam: subir as dependências (paradas desde
> ~21/04) e resolver o `bun run lint`, que falha com **2.043 problemas**.
> Tudo abaixo foi medido, não estimado. O comando de cada medição está junto.

---

## 1. O que está desatualizado

`bun outdated` em 2026-08-21: **62 pacotes**.

| Faixa | Qtd | Entra com `^`? |
|---|---|---|
| **major** | 12 | ❌ exige `bun add` explícito |
| **minor** | 25 | ✅ |
| **patch** | 25 | ✅ |

Como o `package.json` usa `^` em tudo, **regenerar o lock aplica os 50
minor+patch e nenhum dos 12 major**. É por isso que este PR consegue ser
"upgrade sem breaking change de API": os majors ficam de fora por construção.

### Os 12 majors — fora deste PR, cada um é uma conversa

| Pacote | De | Para | Por que é decisão separada |
|---|---|---|---|
| `zod` | 3.25.76 | 4.4.3 | v4 reescreveu a API de erros; `@hookform/resolvers` acopla |
| `recharts` | 2.15.4 | 3.10.1 | v3 mudou composição de componentes |
| `react-day-picker` | 9.14.0 | 10.0.1 | props renomeadas; afeta o `calendar` do shadcn |
| `lucide-react` | 0.575.0 | 1.33.0 | 0.x → 1.x; nomes de ícones podem ter mudado |
| `typescript` | 5.9.3 | 7.0.2 | dois majors de uma vez |
| `vite` | 7.3.2 | 8.2.2 | ecossistema inteiro precisa acompanhar |
| `eslint` | 9.39.4 | 10.8.1 | + `@eslint/js`, `eslint-plugin-react-hooks` 5→7 |
| `@vitejs/plugin-react` | 5.2.0 | 6.1.0 | acopla com o vite |
| `@types/node` | 22.19 | 26.2 | acopla com o typescript |
| `globals` | 15.15 | 17.11 | acopla com o eslint |

---

## 2. O que este PR faz

`bun update` (respeita os ranges `^`). **`package.json` não muda** — só o lock.

```
entradas do lock   718 -> 688
versões alteradas  206
pacotes novos      51
pacotes removidos  81
```

### As que executam produção

| Pacote | De | Para |
|---|---|---|
| `wrangler` | 4.84.1 | **4.124.0** |
| `workerd` | 1.20260421.1 | **1.20260815.1** |
| `@cloudflare/vite-plugin` | 1.33.1 | **1.53.0** |
| `miniflare` | 4.20260421.0 | **5.20260815.0-alpha** ⚠️ |
| `@supabase/supabase-js` | 2.106.1 | 2.112.3 |
| `@tanstack/react-router` | 1.168.25 | 1.170.31 |
| `@tanstack/react-start` | 1.167.50 | 1.168.48 |
| `react` / `react-dom` | 19.2.5 | 19.2.8 |
| `tailwindcss` | 4.2.4 | 4.3.3 |
| `vite` | 7.3.2 | 7.3.6 |

> ⚠️ **`miniflare` pula para `5.x-alpha`**, arrastado pelo `wrangler 4.124.0`.
> Um *alpha* entrando por dependência transitiva é exatamente o tipo de coisa
> que o `minimumReleaseAge` do `bunfig.toml` existe para hesitar. **O miniflare
> só roda em desenvolvimento local** (`wrangler dev`) — produção usa o `workerd`
> na infra da Cloudflare. Ainda assim, é o item a vigiar.

### Verificação feita

- `bun run build` ✓
- `WORKERS_CI_BRANCH=staging` → só a URL do Supabase de staging no bundle
- sem a var → só a de produção
- **`src/routeTree.gen.ts` gerado com os mesmos 23.801 bytes** — o
  `router-generator` subiu de versão e produziu saída idêntica
- `dist`: 267 → **265 arquivos** (2 chunks a menos; ver §5)

---

## 3. O lint: 2.043 problemas, e o que eles são

```bash
bunx eslint . -f json -o /tmp/lint.json
```

| Regra | Qtd | Auto-fixável | Natureza |
|---|---|---|---|
| `prettier/prettier` | **2.003** | 2.003 | formatação pura |
| `@typescript-eslint/no-explicit-any` | 20 | 0 | qualidade de tipo |
| `react-refresh/only-export-components` | 9 | 0 | HMR em dev |
| `no-useless-escape` | 4 | 0 | regex |
| `no-async-promise-executor` | 3 | 0 | **padrão de bug** |
| `prefer-const` | 2 | 1 | estilo |
| `react-hooks/rules-of-hooks` | 2 | 0 | **bug real** |

**98% é formatação.** Sobram **40 problemas de verdade**, em 2 categorias que
importam e 3 que não.

---

## 4. Os dois bugs reais

### 4.1 `casos.index.tsx` — hooks condicionais 🔴

`src/routes/_authenticated/casos.index.tsx:228-229`

O componente tem um early return na linha 149:

```tsx
if (usuario?.tipo === "interno") {
  return <Navigate to="/tarefas" replace />;
}
```

E **depois dele**, nas linhas 228-229:

```tsx
const [spinnerTimedOut, setSpinnerTimedOut] = useState(false);
useEffect(() => { ... }, [usuario]);
```

O comentário na linha 146 afirma *"O redirect fica DEPOIS dos hooks (regra de
hooks)"*. **Não fica.** Dois hooks vivem abaixo dele.

**Como quebra:** no primeiro render `usuario` é `undefined` → sem early return
→ os dois hooks rodam. O `useAuth` resolve para `interno` → early return → os
dois hooks **não** rodam. A contagem de hooks cai entre renders e o React
lança *"Rendered fewer hooks than expected"*.

Atinge um **interno** que abra `/casos` direto pela URL.

**Correção:** mover os dois hooks para antes do early return. Sem mudança de
comportamento — o `useEffect` já tem guarda `if (usuario) return;`.

### 4.2 `google-drive.ts` — `async` em executor de Promise 🟡

Linhas 155, 313 e 673. Erro lançado dentro de `new Promise(async (res, rej) => …)`
**não rejeita a Promise** — some. No fluxo do Drive Picker, isso vira uma
Promise que nunca resolve: a UI fica esperando para sempre em vez de mostrar
erro.

**Correção:** tirar o `async` do executor e usar `.then/.catch`, ou envolver o
corpo em `try { } catch (e) { reject(e) }`.

---

## 5. Formatação: segura, mas **não** produz build idêntico

A pergunta era se dá para rodar `bun run format` mantendo os mesmos outputs.
Medi com dois worktrees limpos, build antes e depois:

```
lint            2.043 -> 40      (os 2.003 de prettier somem)
arquivos tocados                 178
build            267 -> 267 arquivos
conteúdo realmente diferente     31 arquivos
```

Neutralizando o hash dos nomes (a cascata que renomeia 250 arquivos), **31
chunks mudam de conteúdo de verdade**. Investiguei o que muda:

**a) Whitespace de JSX — renderização idêntica**

```
antes: "…do escritório"," ",jsx("strong",…)
depois: "…do escritório ",jsx("strong",…)
```
Mesma saída na tela. Só muda como o espaço é representado no bundle.

**b) Template literal de markdown — string muda**

Em `src/lib/legal/termos.ts`, o prettier insere linha em branco depois de cada
cabeçalho markdown dentro do template literal:

```
antes: "## 1. Objeto e papéis\n1.1. Este Acordo regula…"
depois: "## 1. Objeto e papéis\n\n1.1. Este Acordo regula…"
```

Markdown renderiza igual, mas **a string mudou** — e é o texto do **DPA que o
parceiro aceita**. `aceites_termos` guarda `termos_versao`, não o texto; então
não invalida aceite. Mas é conteúdo jurídico, e merece um olhar humano antes.

**Veredito:** formatar é seguro **em comportamento**, não em bytes. Não dá para
prometer "mesmo output" — dá para prometer "mesma renderização", com uma
ressalva no texto legal.

### 5.1 Cuidado: `bun run format` mexe no `wrangler.jsonc`

O prettier acrescenta **vírgula final** no `wrangler.jsonc`:

```diff
-      "invocation_logs": true
-    }
+      "invocation_logs": true,
+    },
```

O `wrangler` aceita (usa parser JSONC), mas **`JSON.parse` estrito falha**.
Qualquer ferramenta que leia esse arquivo como JSON puro quebra.

→ **Adicionar `wrangler.jsonc` ao `.prettierignore` antes de formatar.**

---

## 6. Ordem sugerida

Quatro PRs pequenos em vez de um grande. Cada um reversível sozinho.

| # | PR | Risco | Por que separado |
|---|---|---|---|
| 1 | **Upgrade minor+patch** (este) | médio | Só lock. Se quebrar, `git revert` |
| 2 | **`casos.index.tsx`: hooks antes do early return** | baixo | Bug real, correção de 5 linhas |
| 3 | **`google-drive.ts`: tirar `async` dos executores** | baixo | Bug real, 3 pontos |
| 4 | **`.prettierignore` + `bun run format`** | baixo/ruidoso | 178 arquivos. Precisa entrar sozinho, senão esconde tudo |

**Não juntar 4 com nada.** Um diff de 178 arquivos formatados torna qualquer
outra mudança invisível na revisão.

Os 20 `no-explicit-any`, os 9 `react-refresh` e os 4 `no-useless-escape` ficam
para depois: nenhum tem efeito em runtime, e o `react-refresh` só afeta HMR em
desenvolvimento.

---

## 7. Depois do merge do #1 — o que vigiar

| Onde | O quê |
|---|---|
| Preview do PR | O Worker sobe? É a única prova real — `workerd` subiu 4 meses |
| `bun dev` local | O `miniflare 5.x-alpha` roda? Só afeta dev |
| Telas com Radix | 20+ componentes subiram de patch/minor: Select, Dialog, Popover, Sidebar |
| `/casos/$id` | O maior arquivo, e o que mais usa Radix |
| E2E | `bun run e2e` — 4 specs; exige `STAGING_SERVICE_ROLE_KEY` no `.env.local` |

O `bun run lint` continua falhando depois deste PR — na verdade sobe de 2.043
para **2.062**, porque o `prettier` 3.8.3 → 3.9.6 mudou regras de formatação.
É esperado, e some no PR #4.

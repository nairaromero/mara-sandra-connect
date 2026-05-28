# UI Design — Mobile-first + tema unificado + componentes genéricos

> Auditoria das telas atuais e plano para padronizar UI. Para arquitetura geral, ver [ARQUITETURA.md](ARQUITETURA.md). Para checklist, ver [TODO.md](TODO.md).

---

## 1. Regras (a fixar no projeto)

### 1.1 Mobile-first sempre

Toda nova classe Tailwind escreve **primeiro o estilo mobile (sem prefixo)** e depois progride com `sm:`, `md:`, `lg:`. Breakpoints Tailwind v4:

- mobile: `< 640px` (default)
- `sm:` ≥ 640px
- `md:` ≥ 768px
- `lg:` ≥ 1024px
- `xl:` ≥ 1280px

**Errado:** `className="grid grid-cols-7 sm:grid-cols-4 lg:grid-cols-2"` (desktop-first)
**Certo:** `className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7"` (mobile-first)

### 1.2 Antes de criar componente novo → procurar genérico

Toda funcionalidade que aparece em 2+ telas vira componente em `src/components/ui-app/` (ou `src/components/common/`). Antes de escrever JSX repetido, abrir essa pasta e ver se já existe.

### 1.3 Tema unificado (single source of truth)

Toda cor sai de **tokens CSS variables** definidos em `globals.css` e expostos via Tailwind config. Proibido: `bg-purple-600`, `text-blue-700`, `#e6f5e6` direto no JSX.
Permitido: `bg-partner`, `text-internal`, `bg-warning`, etc.

---

## 2. Violações mobile-first encontradas

### 2.1 `casos.$id.tsx` — TabsList (CRÍTICO)

```tsx
<TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 h-auto">
```

7 abas em 2 colunas no mobile = 4 linhas de tabs apertadas. **Em mobile real (≤375px) os ícones+texto vão quebrar.**

**Recomendação:** scroll horizontal no mobile, grid só em ≥sm:

```tsx
<TabsList className="flex w-full overflow-x-auto sm:grid sm:grid-cols-4 lg:grid-cols-7 h-auto">
```

E nos `TabsTrigger`, esconder texto em mobile, manter só ícones:

```tsx
<TabsTrigger value="visao_geral" className="flex items-center gap-1 shrink-0">
  <Activity className="h-4 w-4" />
  <span className="hidden sm:inline">Visao geral</span>
</TabsTrigger>
```

### 2.2 `dashboard_index.tsx` — Tabela sem scroll

```tsx
<Table>
  <TableHeader>...</TableHeader>
  <TableBody>...</TableBody>
</Table>
```

Tabela com 5 colunas (Cliente/Parceiro/Tipo/Status/Data) **estoura mobile**. Texto fica colado, scroll horizontal não controlado.

**Recomendação:** wrap em `<div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">` ou criar versão mobile com Card list.

### 2.3 `casos.$id.tsx` — Header com badges (parcial)

```tsx
<div className="flex flex-wrap items-center gap-2">
```

`flex-wrap` salva, mas com muitas tags TI + fase + status + parceiro + botões, o header fica bagunçado em mobile (vira 6+ linhas). Aceitável por enquanto, mas vale considerar collapse das tags em "+3 mais" no mobile.

### 2.4 `documentos.tsx` — Cards de filtro

```tsx
<CardContent className="pt-4 grid gap-3 sm:grid-cols-4">
  <div className="sm:col-span-2">...busca...</div>
  ...
</CardContent>
```

Mobile-first OK aqui (col-span faz sentido). Só comentando que está OK.

### 2.5 Dialogs (10 instâncias) — Sem altura máxima mobile

```tsx
<DialogContent>...</DialogContent>
```

Em mobile pequeno (iPhone SE 375x667), Dialog com muito conteúdo (ex.: análise técnica nova versão) **vaza fora da tela** sem permitir scroll interno.

**Recomendação:** sempre usar `max-h-[90vh] overflow-y-auto`:

```tsx
<DialogContent className="max-h-[90vh] overflow-y-auto">
```

### 2.6 Inputs file (uploads)

Em mobile, `<input type="file">` nativo é OK, mas o resto do dialog precisa de scroll garantido.

---

## 3. Componentes genéricos a extrair

Padrões duplicados várias vezes que viram componente em `src/components/ui-app/`:

### 3.1 `<Spinner size?>` — usado 28 vezes

Pattern repetido:
```tsx
<div className="flex h-96 items-center justify-center">
  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
</div>
```

Vira:
```tsx
<Spinner fullHeight />
// e
<Spinner inline />  // pra dentro de botões
```

### 3.2 `<EmptyState icon message description? action?>` — usado ~10 vezes

Pattern:
```tsx
<Card>
  <CardContent className="py-12 text-center">
    <Icon className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
    <p className="text-sm text-muted-foreground">Nenhum X registrado.</p>
  </CardContent>
</Card>
```

Vira:
```tsx
<EmptyState
  icon={ClipboardList}
  message="Nenhuma solicitacao registrada."
/>
```

### 3.3 `<StatusBadge status type?>` — várias implementações inline

Hoje:
```tsx
{isPendente && <Badge className="bg-amber-500 ...">Pendente</Badge>}
{isAtendido && <Badge className="bg-green-600 ...">Atendido</Badge>}
{isDispensado && <Badge variant="outline">Dispensado</Badge>}
```

Vira (após tema unificado):
```tsx
<StatusBadge value={s.status} kind="solicitacao" />
<StatusBadge value={r.status} kind="repasse" />
<StatusBadge value={caso.status} kind="caso" />
```

O componente faz lookup interno na tabela de status conhecidos.

### 3.4 `<DataField label value>` — usado ~15 vezes (Linha de casos.$id.tsx, configuracoes.tsx, etc.)

Pattern:
```tsx
<div className="flex items-baseline gap-2">
  <span className="text-xs text-muted-foreground min-w-[7rem]">{label}:</span>
  <span className="text-sm">{value}</span>
</div>
```

Já existe (`Linha` em `casos.$id.tsx`) mas só local. Promover para genérico.

### 3.5 `<ConfirmDialog open onCancel onConfirm title description>` — 4 instâncias

Modais de confirmar ação (dispensar solicitação, marcar pago, deletar doc, etc.) seguem mesma estrutura. Vira genérico.

### 3.6 `<MoneyDisplay value highlight?>` — 8 instâncias

Pattern em `casos.$id.tsx` (Repasses):
```tsx
<div className="border rounded-md p-3">
  <p className="text-xs text-muted-foreground">Total</p>
  <p className="text-base font-medium">{formatMoney(total)}</p>
</div>
```

Vira:
```tsx
<MoneyTile label="Total" value={total} />
<MoneyTile label="Pago" value={pago} variant="success" />
```

### 3.7 `<DialogShell>` — wrapper sobre `Dialog` que aplica `max-h-[90vh] overflow-y-auto`

Garante consistência mobile sem precisar lembrar de adicionar a cada uso.

---

## 4. Plano de tema unificado

### 4.1 Definir paleta semântica

Em vez de cores brutas (purple-600, amber-500), definir tokens **semânticos** que refletem o domínio:

| Token | Uso | Cor sugerida |
|---|---|---|
| `--ms-primary` | Marca, ações primárias | indigo-600 |
| `--ms-partner` | Tudo relacionado a parceiro | violet-600 |
| `--ms-internal` | Tudo só do escritório interno | sky-700 |
| `--ms-pending` | Aguardando ação | amber-500 |
| `--ms-success` | Atendido / pago / deferido | emerald-600 |
| `--ms-danger` | Indeferido / sem êxito / erro | red-600 |
| `--ms-warning` | Atraso, atenção | orange-500 |
| `--ms-archived` | Arquivado, inativo | slate-400 |

### 4.2 Tasks de implementação (T1-T10)

- **T1**: Editar `src/index.css` (ou `globals.css`) adicionando CSS vars `--ms-*` em `:root` e dark equivalents em `.dark`
- **T2**: Editar `tailwind.config.ts` mapeando as vars para utilities (`bg-pending`, `text-partner`, etc.)
- **T3**: Criar `src/components/ui-app/` com os 7 componentes da seção 3
- **T4**: Refatorar `casos.$id.tsx` para usar os genéricos (maior arquivo, ganho maior)
- **T5**: Refatorar `dashboard_index.tsx`, `documentos.tsx`, `conversas.tsx`, `configuracoes.tsx`, `casos.novo.tsx`
- **T6**: Substituir todos os `bg-amber-500`, `bg-green-600`, `text-blue-700`, hexs em `style={}` (tags do TI são exceção — vêm do TI direto) por tokens
- **T7**: Aplicar regras mobile-first da seção 2 (Tabs scroll, table responsiva, dialogs com overflow)
- **T8**: Adicionar `viewport`, `theme-color` e PWA manifest no `index.html` antecipando conversão para app
- **T9**: Adicionar `prefer-color-scheme: dark` (opcional, mas barato de habilitar agora)
- **T10**: Documentar o sistema em `README.md` ou `STYLE_GUIDE.md` do repo, fixar como guideline

### 4.3 Exemplo de `globals.css` (referência)

```css
:root {
  /* Marca */
  --ms-primary: 79 70 229;          /* indigo-600 */
  --ms-primary-foreground: 255 255 255;

  /* Papeis */
  --ms-partner: 124 58 237;         /* violet-600 */
  --ms-internal: 3 105 161;         /* sky-700 */

  /* Estados */
  --ms-pending: 245 158 11;         /* amber-500 */
  --ms-success: 5 150 105;          /* emerald-600 */
  --ms-danger: 220 38 38;           /* red-600 */
  --ms-warning: 249 115 22;         /* orange-500 */
  --ms-archived: 148 163 184;       /* slate-400 */
}

.dark {
  /* ... versões dark ... */
}
```

### 4.4 Exemplo de `tailwind.config.ts`

```ts
theme: {
  extend: {
    colors: {
      partner: "rgb(var(--ms-partner) / <alpha-value>)",
      internal: "rgb(var(--ms-internal) / <alpha-value>)",
      pending: "rgb(var(--ms-pending) / <alpha-value>)",
      success: "rgb(var(--ms-success) / <alpha-value>)",
      danger: "rgb(var(--ms-danger) / <alpha-value>)",
      warning: "rgb(var(--ms-warning) / <alpha-value>)",
      archived: "rgb(var(--ms-archived) / <alpha-value>)",
    }
  }
}
```

Aí no JSX:

```tsx
<Badge className="bg-pending text-white">Pendente</Badge>
<Badge className="border-internal text-internal">Cliente interno</Badge>
```

---

## 5. Ordem sugerida (passo a passo)

Como o estilo de trabalho é pequenos passos commitáveis, faríamos nessa ordem, **um por sessão**:

1. **T1 + T2**: tokens em CSS + Tailwind (~15 min) — base de tudo
2. **T3 (parcial)**: criar `<Spinner>` e `<EmptyState>` (mais simples, mais reutilizados)
3. **T3 (restante)**: `<StatusBadge>`, `<DataField>`, `<ConfirmDialog>`, `<MoneyTile>`, `<DialogShell>`
4. **T7**: aplicar correções mobile-first (Tabs scroll, Tables, Dialogs overflow)
5. **T4-T5-T6**: refatorar telas usando os genéricos
6. **T8-T9-T10**: PWA / dark mode / styleguide

Cada passo é commitável independente, sem quebrar nada.

---

## 6. Escopo NÃO coberto neste documento

- Lógica de negócio (continua igual)
- Schema do Supabase
- Edge functions (TI/Legalmail)
- Estrutura de rotas (TanStack Router)
- Bibliotecas externas (shadcn, lucide, sonner, react-hook-form, zod)

Só camada de apresentação + organização de componentes.

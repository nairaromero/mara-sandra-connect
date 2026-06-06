# Site Institucional — Mara Sandra Vian Advocacia

> Planejamento do **site público** do escritório, dentro do mesmo app (Mara Sandra Connect).
> O app que já existe vira o **portal** — acessível por um botão "Entrar no portal".
> Referência de estrutura/tom: https://andreservanadvogados.com.br/
> Para arquitetura geral do app, ver [ARQUITETURA.md](ARQUITETURA.md). Para UI, [UI_DESIGN.md](UI_DESIGN.md).

**Status:** ✅ Fase 0 + Fase 1 (MVP) implementadas em 2026-06-06.
- Dashboard movido de `/` → `/casos` ([casos.index.tsx](../src/routes/_authenticated/casos.index.tsx)); links/redirects internos atualizados.
- Home pública criada em [src/routes/index.tsx](../src/routes/index.tsx) (one-page, SSR/SEO, WhatsApp, faixa de parceiros com demo do app).
- Mockup visual de referência: [site-mockup.html](site-mockup.html) (aprovado pela Naira).
- Pendências de conteúdo real: ver §9 (WhatsApp oficial, OAB, foto, métricas do hero).

---

## 1. Objetivo

Hoje o domínio `marasandraconnect.com` cai direto no app autenticado (login). A ideia é que a **raiz `/` passe a ser um site institucional público** — vitrine do escritório — e o app operacional vire um **portal** acessível por um botão "Entrar no portal".

Decisões já travadas com a Naira (2026-06-06):

| Decisão | Escolha |
|---|---|
| **Arquitetura** | Mesmo app, rotas públicas (1 repo, 1 deploy). |
| **Público-alvo** | Duplo: **cliente final** (segurado INSS) **+ advogado parceiro** (captador). |
| **Escopo do 1º lançamento** | Enxuto: **home única** (one-page) com âncoras. |
| **Entregável agora** | Só este documento. |

---

## 2. Os dois públicos (mensagem dupla)

O site precisa falar com dois perfis sem confundir nenhum. Solução: **uma home com foco no cliente final** + **uma faixa/seção dedicada a parceiros** + o botão de portal no topo.

| | Cliente final (segurado) | Advogado parceiro |
|---|---|---|
| Quem é | Pessoa buscando aposentadoria, auxílio, BPC/LOAS, pensão, revisão | Advogado que quer indicar casos e ganhar 30% |
| Dor | "Será que tenho direito? O INSS negou. Não entendo o processo." | "Tenho cliente previdenciário mas não toco a área / não tenho estrutura." |
| CTA principal | **WhatsApp / "Analisar meu caso grátis"** | **"Seja parceiro"** (form) + **"Entrar no portal"** |
| Onde aparece | Hero + corpo da home | Faixa própria perto do fim + botão no header |
| Prova | Depoimentos, casos resolvidos, áreas | Modelo 30/70, o portal como diferencial (transparência) |

> O **portal** (app) é, na prática, um diferencial de venda para parceiros: "acompanhe seus casos em tempo real". Vale mostrar isso (print/mockup) na faixa de parceiros.

---

## 3. Arquitetura de rotas (o ponto técnico central)

### 3.1 Situação atual

- `src/routes/_authenticated/index.tsx` → resolve para **`/`** (o `_authenticated` é layout *pathless*, não adiciona segmento).
- Ou seja: **hoje `/` É o dashboard de casos.** Quem não está logado é mandado pra `/login`.
- Logo, **não dá** para simplesmente criar `src/routes/index.tsx` — ele colidiria com `_authenticated/index.tsx` (ambos = `/`).

### 3.2 Reestruturação proposta

**A home pública assume `/`. O dashboard migra para `/casos`.**

```
src/routes/
  __root.tsx                  (já existe — providers globais)
  index.tsx                   ← NOVO: home institucional pública (/)
  login.tsx                   (já existe — vira destino do "Entrar no portal")
  _site/                      ← NOVO (opcional): layout público p/ futuras páginas
    (header público + footer, sem sidebar do app)
  _authenticated/
    casos.index.tsx           ← MOVER para cá o atual index.tsx (dashboard → /casos)
    casos.$id.tsx             (já existe)
    casos.novo.tsx            (já existe)
    documentos.tsx, conversas.tsx, parceiros.tsx, ... (inalterados)
```

**Por que `/casos` para o dashboard:** o dashboard já é a lista "Meus casos"; `/casos` é semanticamente perfeito e não existe ainda (só `casos.$id` e `casos.novo`). Alternativa: `/painel` ou `/portal`.

### 3.3 O que muda junto (checklist de refactor)

Mover o index quebra todos os links `to="/"` internos. Precisam apontar para `/casos`:

- [ ] `src/routes/_authenticated.tsx` — logo do header (`<Link to="/">`) → `/casos`
- [ ] `src/routes/_authenticated.tsx` — guard: ao não ter sessão vai pra `/login` (ok); **login bem-sucedido deve ir pra `/casos`**, não `/`
- [ ] `src/routes/login.tsx` — todos os `navigate({ to: "/" })` → `/casos`
- [ ] `src/routes/login.tsx` — `emailRedirectTo` do magic link (hoje `window.location.origin` = `/`) → `/casos` (senão o link mágico joga na home pública)
- [ ] `src/components/app-sidebar.tsx` — item "Casos" (`/`) → `/casos`
- [ ] `__root.tsx` — botão 404 "Voltar ao início" → decidir se vai pra home pública `/` (provável) ou `/casos`
- [ ] `_authenticated.tsx` — redirect de onboarding parceiro (`/boas-vindas`) inalterado
- [ ] Qualquer `<Link to="/">` restante no app → grep antes de mexer

> **Risco baixo, mas mecânico.** É um find/replace cuidadoso de `to="/"`. Fazer num PR isolado ("refactor: dashboard / → /casos") antes de adicionar a home, pra revisar limpo.

### 3.4 Layout público (`_site` ou só no `index.tsx`)

Para uma home única, **não precisa de layout `_site` ainda** — a home pode ser um componente autocontido em `index.tsx` com seu próprio `<header>` e `<footer>`. O layout `_site` (pathless) só compensa quando houver 2+ páginas públicas (fase 2: /sobre, /areas, blog). Documentado aqui para não reinventar depois.

**Importante:** a home pública **não** usa `SidebarProvider`/`AppSidebar` (isso é do app). Header próprio, leve, com navegação por âncoras + botão "Entrar no portal".

---

## 4. Estrutura da home (one-page)

Espelha o andreservan, adaptado ao modelo previdenciário + parceria. Seções na ordem, todas com âncora para o menu:

1. **Header (sticky)**
   - Logo Mara Sandra Vian à esquerda.
   - Menu âncoras: Sobre · Áreas · Como funciona · Depoimentos · Parceiros · Contato.
   - À direita: **botão "Entrar no portal"** (→ `/login`) + botão WhatsApp.
   - Mobile: menu hambúrguer.

2. **Hero**
   - Headline focada no cliente final. Ex.: *"Aposentadoria, auxílio ou benefício negado pelo INSS? A gente resolve."*
   - Subheadline: especialização previdenciária, atendimento online em todo o Brasil.
   - CTA primário: **"Analisar meu caso no WhatsApp"**. CTA secundário: "Conhecer o escritório" (âncora).
   - Selo de confiança (OAB, anos de atuação, nº de casos — preencher com dados reais).

3. **Sobre / Quem é a Mara Sandra**
   - Apresentação da Dra. (sócia previdenciarista), credibilidade, foto.
   - Atendimento 100% online (igual referência) + presencial se houver.

4. **Áreas de atuação** (cards)
   - Aposentadorias (idade, tempo de contribuição, especial, PCD/LC-142)
   - Benefícios por incapacidade (auxílio-doença, aposentadoria por invalidez, acidente)
   - BPC/LOAS (idoso e PCD)
   - Pensão por morte
   - Salário-maternidade
   - Revisões de benefício
   > Fonte: tipos de benefício já suportados no app (ARQUITETURA §1.3) — mantém site e portal coerentes.

5. **Como funciona** (passo a passo, igual referência — 4/5 etapas)
   - 1. Você nos conta o caso (WhatsApp) → 2. Análise jurídica gratuita → 3. Estratégia (administrativo/judicial) → 4. Acompanhamento até o resultado.

6. **Depoimentos / prova social**
   - Cards de depoimento. Integração futura com Google Reviews (fase 2).

7. **Faixa "Seja parceiro"** (público advogado)
   - Headline: *"É advogado? Indique casos previdenciários e ganhe 30%."*
   - Explica o modelo 30/70, que a Mara Sandra toca todo o processo (administrativo + judicial), e que o parceiro **acompanha tudo pelo portal**.
   - Mockup/print do portal como diferencial.
   - CTA: **"Quero ser parceiro"** (form simples → e-mail/WhatsApp ou tabela Supabase) + **"Já sou parceiro → Entrar no portal"**.

8. **FAQ** (accordion — componente Radix já no projeto)
   - "O INSS negou, ainda tenho chance?" · "Quanto custa?" · "Atende minha cidade?" · "Quanto tempo demora?" · "Como funciona a parceria?" etc.

9. **Contato / CTA final**
   - Form (nome, WhatsApp, resumo do caso) com aviso LGPD (igual referência).
   - Botão WhatsApp fixo flutuante no canto (mobile e desktop).

10. **Footer**
    - Logo, OAB, endereço/área de atuação, redes, link "Entrar no portal", aviso de provimento OAB (publicidade na advocacia — ver §7).

---

## 5. Identidade visual

Reaproveita o tema que já existe no app (não inventar paleta nova):

- **Paleta:** navy (primary) + dourado (gold) + creme — já definida em `globals.css` (UI_DESIGN.md §1.3). Os tokens (`bg-primary`, `gold`, `gold-soft`) já estão em uso no header do app.
- **Logo:** `/public/logo.png` (já usado no topbar do app).
- **Tom:** sóbrio, confiável, humano. Advocacia previdenciária = público muitas vezes idoso/vulnerável → **tipografia grande, contraste alto, linguagem simples**.
- **Mobile-first** obrigatório (UI_DESIGN.md §1.1) — boa parte do público entra pelo celular.
- **Componentes:** reusar shadcn/ui já instalado (Accordion p/ FAQ, Card p/ áreas, Button, Input/form p/ contato). Nada novo a instalar.

---

## 6. SEO & performance

Vantagem de estar no TanStack Start: **SSR já está ligado** → home pública é indexável sem esforço extra.

- [ ] `<title>` + `<meta description>` por rota (via `head` do TanStack Router no `index.tsx`).
- [ ] Open Graph (og:image, og:title) p/ compartilhar no WhatsApp bonito.
- [ ] JSON-LD `LegalService`/`Attorney` (schema.org) — ajuda muito advocacia local.
- [ ] `sitemap.xml` + `robots.txt` (a home é pública; o portal `/_authenticated/*` e `/login` devem ficar `noindex`).
- [ ] Imagens otimizadas (WebP, lazy). Hero leve.
- [ ] Lighthouse: mirar 90+ mobile.

---

## 7. Conformidade (advocacia)

Publicidade na advocacia tem regras (Provimento 205/2021 OAB e Código de Ética). O site **pode** existir, mas:

- Sem promessa de resultado ("ganhe sua aposentadoria garantida" → proibido).
- Sem mercantilização / captação agressiva. Tom informativo.
- Exibir OAB do responsável.
- **LGPD** no form de contato (consentimento + finalidade) — igual à referência.
- Depoimentos: cuidado com regras de publicidade; preferir linguagem informativa.

> Não sou a fonte jurídica disso — a Naira valida o texto final sob a ótica do provimento OAB.

---

## 8. Fases de implementação

### Fase 0 — Refactor de rotas (pré-requisito)
PR isolado: mover dashboard `/` → `/casos`, atualizar todos os links/redirects (§3.3). App continua idêntico, só muda a URL do dashboard. **Mergear e validar antes da home.**

### Fase 1 — Home institucional (MVP)
- `src/routes/index.tsx` pública com as 10 seções (§4).
- Header público + botão "Entrar no portal" → `/login`.
- Form de contato → WhatsApp (link `wa.me`) e/ou grava em tabela Supabase `leads`.
- Faixa "Seja parceiro" com form simples.
- SEO básico (§6: title, meta, OG, robots/sitemap).
- Responsivo + WhatsApp flutuante.

### Fase 2 — Refino & autoridade (futuro)
- Layout `_site` + páginas internas (/sobre, /areas/[slug], "Seja parceiro" dedicada).
- Blog/conteúdo (SEO previdenciário — alto valor de captação).
- Integração Google Reviews real.
- Mockup/screenshots reais do portal na faixa de parceiros.

---

## 9. Decisões em aberto (para a Naira)

1. **URL do dashboard:** `/casos` (recomendado), `/painel` ou `/portal`?
2. **Form de contato:** só link WhatsApp (`wa.me`), ou também gravar lead numa tabela Supabase `leads` (+ notificação/webhook)?
3. **Faixa parceiro:** form "Seja parceiro" grava onde? (e-mail, WhatsApp, ou tabela `leads_parceiro`).
4. **Dados reais p/ o hero:** anos de atuação, nº de casos, cidades atendidas, OAB — preciso disso pra escrever os textos.
5. **Conteúdo/fotos:** tem foto da Dra.? Texto "Sobre" pronto ou eu rascunho?
6. **WhatsApp:** número oficial para os botões `wa.me`.

---

## 10. Resumo executivo

- Site institucional **dentro do mesmo app**, raiz `/` = home pública, app vira **portal** atrás do botão "Entrar no portal".
- Pré-requisito técnico: **mover o dashboard de `/` para `/casos`** (refactor mecânico, PR isolado).
- Home única, dois públicos (cliente final + parceiro), reusando tema/componentes já existentes.
- SSR já dá SEO de graça; resta meta tags, sitemap e `noindex` no portal.
- Sem dependências novas. Trabalho concentrado em conteúdo + uma rota pública + refactor de links.

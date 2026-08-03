# Caixa de Conversas — comunicação com parceiros em escala

> Status: **planejamento** (ideia da Naira em 2026-08-03, organização "por parceiro" aprovada).
> Objetivo: transformar a comunicação com os parceiros (hoje presa no sininho e
> enterrada dentro de cada caso) numa **caixa de conversas dedicada na sidebar**,
> estilo WhatsApp, que aguente escala.

---

## 1. Motivação

O parceiro fala com o escritório pelos **comentários do caso**. Hoje isso só aparece:
- no **sininho** (`notificacoes`) — alerta efêmero, sem histórico navegável, sem
  "não lido" por conversa, sem filtro por parceiro;
- **dentro de cada caso** — some no meio das abas, exige abrir caso a caso.

Em escala (dezenas de parceiros × centenas de clientes) isso não se acompanha. Sininho
é pra **avisar**, não pra **trabalhar**. Falta o *lugar de conversar*.

---

## 2. Estado atual (levantado no código, 2026-08-03)

Já existe **70% da base** — o problema é que está fragmentado em dois canais:

| Peça | O que é | Situação |
|---|---|---|
| Tela **`/conversas`** (`conversas.tsx`) | Caixa estilo WhatsApp: agrupa por caso, última mensagem, busca, polling 30s | **Existe, mas lê `mensagens`** |
| Tabela **`mensagens`** (caso_id, remetente_id, texto, `lida`, created_at) | Chat caso↔parceiro | **Vazia — ninguém usa** |
| Tabela **`comentarios`** (caso_id, parent_id, autor_id, texto, rascunho, andamento_id) | Onde os parceiros de fato falam (com thread e vínculo a andamento) | **Em uso**, só aparece no sininho + dentro do caso |
| Edge `notify-novo-comentario` | Dispara e-mail + notificação quando cria comentário | OK |
| `notificacoes` (tem `lida` global) | O sininho | OK, mas `lida` é 1 flag só, não por conversa |

**Diagnóstico:** dois canais paralelos (`mensagens` vazio ↔ `comentarios` real). O trabalho
não é criar do zero — é **unificar a caixa `/conversas` com onde a conversa realmente acontece**.

---

## 3. Decisões

1. **Fonte única = `comentarios`.** É onde a comunicação já rola (tem thread, rascunho,
   vínculo a andamento). `mensagens` é aposentada/absorvida; `/conversas` passa a ler
   `comentarios`.
2. **Organização por parceiro, dois níveis** (aprovado):
   - Nível 1: lista de **parceiros** (como "contatos" do WhatsApp), com badge de não-lido.
   - Nível 2: ao abrir um parceiro, as **threads por cliente/caso** dele.
3. **Sininho continua** como alerta, mas vira **atalho**: clicar na notificação abre a
   thread na caixa (deep-link), não a aba do caso.
4. **Visibilidade:** interno vê todos os parceiros; cada parceiro vê só as próprias conversas
   (RLS por `caso.parceiro_id = auth.uid()`, já é o padrão do sistema).

---

## 4. Modelo de dados (o que falta)

O que já tem cobre conteúdo (`comentarios`) e alerta (`notificacoes`). Falta o essencial de
uma caixa: **estado de "não lido" por usuário por conversa**.

### 4.1 `conversa_leitura` (novo)
```sql
create table conversa_leitura (
  usuario_id   uuid not null references usuarios(id) on delete cascade,
  caso_id      uuid not null references casos(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (usuario_id, caso_id)
);
```
- Não-lido de uma thread = existe `comentario` com `created_at > last_read_at` (e autor ≠ usuário).
- Não-lido de um parceiro = soma das threads dele.
- Abrir a thread → upsert `last_read_at = now()`.

Alternativa mais simples pra fase 1: um `lida_por jsonb` em `comentarios`. Preferir a tabela
dedicada — escala melhor e não incha o comentário.

### 4.2 Índices
- `comentarios (caso_id, created_at desc)` — montar a thread e a "última mensagem".
- Índice já implícito por `caso.parceiro_id` pra agrupar por parceiro.

---

## 5. Roadmap (fases)

### Fase 1 — Unificar a caixa + não-lido ✅ *(implementada 2026-08-03)*
- `/conversas` agora lista **threads de `comentarios`** (não mais `mensagens`),
  ignorando rascunhos, **já agrupadas por parceiro** (adiantou parte da fase 2).
- Tabela `conversa_leitura` (migration `migration_conversa_leitura.sql`) + badge
  de não-lido por thread e por parceiro; abrir a thread marca como lida.
- **Sidebar:** "Conversas" de volta ao menu, com **badge de não-lidas** (padrão
  do `docBadge`), atualizado via evento `msc:conversas-mudou`.
- Abrir uma thread leva ao caso na aba de comentários (responder ainda é lá;
  responder inline fica pra uma próxima).
- **Pendente de dado real:** hoje os únicos comentários são rascunhos, então a
  caixa mostra o estado vazio até os parceiros enviarem de fato.

### Fase 2 — Agrupar por parceiro *(a organização aprovada)*
- Nível 1: lista de parceiros com contagem de não-lido; nível 2: threads por cliente.
- Filtro/busca por parceiro e por cliente.
- Item na **sidebar** ("Conversas") com **badge de não-lidas**, igual ao de
  "Documentos pendentes" que já existe. Replicar o padrão de `app-sidebar.tsx`:
  - Estado `conversasBadge` (hoje há `docBadge` e `pubBadge`), contagem de threads
    com comentário novo (`created_at > last_read_at`, autor ≠ eu).
  - Atualiza via evento `window` (hoje: `msc:solicitacoes-mudou`) — disparar um
    `msc:conversas-mudou` ao abrir/ler uma thread, pra zerar/atualizar na hora.
  - Render igual: número no badge dourado, "9+" acima de 9.

### Fase 3 — Tempo real
- Trocar polling de 30s por **Supabase Realtime** em `comentarios` (chega na hora).
- Indicador de "digitando"/nova mensagem opcional.

### Fase 4 — Sininho vira atalho
- Notificação de comentário deep-linka pra thread na caixa.
- Opcional: silenciar o sininho pra quem já acompanha pela caixa.

---

## 6. Decisões em aberto / riscos

| Ponto | Observação |
|---|---|
| Aposentar `mensagens`? | Está vazia; migrar a `/conversas` pra `comentarios` e descontinuar `mensagens` (ou deixar dormente). Confirmar que nada mais escreve nela. |
| Comentário em rascunho | `comentarios.rascunho=true` não deve contar como mensagem enviada na caixa. |
| Comentário ligado a andamento | `andamento_id` — na caixa, mostrar de qual andamento veio (contexto), mas a thread é do caso. |
| Volume | Com muitos comentários, paginar a thread e a lista; não carregar tudo de uma vez. |
| Notificação dupla | Evitar que a mesma mensagem gere sininho **e** ruído na caixa — a caixa é o workspace, o sininho é o alerta. |

---

## 7. Referências
- `src/routes/_authenticated/conversas.tsx` — a caixa que já existe (hoje sobre `mensagens`).
- Tabela `comentarios` — fonte real da comunicação.
- Edge `notify-novo-comentario` — alerta por e-mail/notificação.
- [ARQUITETURA.md](ARQUITETURA.md) — RLS por `caso.parceiro_id`, tabelas base.

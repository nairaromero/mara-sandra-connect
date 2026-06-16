# Handoff — 2026-06-16 — Pipeline Solicitação→Exigência

Sessão grande na branch `feat/tarefas-ui-kanban`. Tudo commitado e empurrado.

## TL;DR do que ficamos travadas

**Bug aberto:** aplicar o template `exigencia` manualmente pelo TarefaSheet ainda mostra **"Falha ao salvar."** no toast. Já corrigi 1 causa (constraint do banco) mas continua falhando — possivelmente por outro motivo ainda não diagnosticado.

**Próximo passo amanhã:**
1. Naira: dar hard refresh (Cmd+Shift+R) na aba do app.
2. Tentar aplicar o template `exigencia` num caso (ex: Maicon Vandson).
3. O toast agora vai aparecer como `Falha: <mensagem real do banco>` (mudei o handler hoje, último commit).
4. Mandar o texto que aparecer — com isso descobrimos o que ainda está bloqueando.

---

## O que foi construído nessa conversa

### Conceito — pipeline solicitação→exigência

Quando o INSS manda uma **exigência** num requerimento, o fluxo passou a ser:

1. **Andamento visível ao parceiro**: "Documento solicitado ao parceiro — aguardando cumprimento" (e-mail automático pelo `notify-novo-andamento`).
2. **Solicitação na aba Documentos** do caso (`origem='template:exigencia'`) — substituiu o "agendamento Comunicar parceiro" antigo.
3. **Tarefa "Aguardando documentos do parceiro - {nome}"** (renomeada do antigo "Comunicar parceiro + pedir documentos").
4. **Tarefa FATAL - CUMPRIMENTO DE EXIGENCIA** com prazo de 30 dias (mantida).
5. Quando o parceiro upa o documento → `solicitacoes_documento.status='atendido'` → **trigger DB** cria automaticamente tarefa "Documento entregue — cumprir exigência no INSS" pra Naira finalizar no Meu INSS.

Também ajustamos `em_analise`: tirou tarefa "Acompanhamento", virou só 1 andamento visível "Status alterado para EM ANÁLISE no INSS".

### Novo destino de template: `solicitacao_documento`

Adicionei no enum de `TarefaTemplateItem.destino`:
- `"tarefa"` (default)
- `"agenda"` (já existia)
- `"andamento"` (já existia)
- **`"solicitacao_documento"` (novo)** — cria entrada em `solicitacoes_documento`.

Arquivos tocados:
- `src/lib/tarefas/types.ts` — adicionou union + comentário.
- `src/components/tarefas/tarefa-sheet.tsx` — branch que insere em `solicitacoes_documento` quando aplica template; campo "Documentos solicitados pelo INSS" (Textarea) aparece quando o template tem item com esse destino.
- `supabase/functions/inss-email-processor/index.ts` — mesma branch pra fluxo automático do e-mail INSS.

### Trigger DB

`_solicitacao_atendida_cria_tarefa()` em `solicitacoes_documento`:
- Dispara em `AFTER UPDATE` quando `OLD.status != NEW.status AND NEW.status='atendido' AND NEW.origem LIKE 'template:%'`.
- Insere tarefa urgente (`tipo='interna'`, `prioridade=1`, `status='a_fazer'`, `due_at=now()`) com título "Documento entregue — cumprir exigência no INSS" e metadata referenciando a solicitação.

Migration: `planning/sql-migrations/migration_pipeline_solicitacao_exigencia.sql`.

### Migrations aplicadas hoje

1. `migration_pipeline_solicitacao_exigencia.sql` — trigger + templates `em_analise` e `exigencia` atualizados.
2. `migration_solicitacao_origem_template.sql` — amplia o check constraint de `solicitacoes_documento.origem` pra aceitar `template:%` (originalmente só aceitava `'interna'` ou `'externa'`).

Ambas aplicadas em produção via `node scripts/msc-sql.mjs --file ...`. Idempotentes.

### Edge function

`supabase functions deploy inss-email-processor --no-verify-jwt --project-ref llugytkdsfsrciavhrfw` — deploy do branch novo (`destino=solicitacao_documento`).

---

## Bug em aberto

### Sintoma

Aplicar template `exigencia` no caso da Maicon Vandson:
- Tarefa principal "Aguardando documentos do parceiro" **é criada** (visível na aba Atividades).
- Os extras (andamento + solicitação + tarefa FATAL) **não são criados**.
- Toast mostra **"Falha ao salvar."** (genérico).

### O que já descartamos

1. ~~Constraint `solicitacoes_documento_origem_check`~~ — corrigido na migration `migration_solicitacao_origem_template.sql`.
2. ~~Inserts via SQL com service_role~~ — passam (andamento + solicitação testados isoladamente).
3. ~~RLS de `solicitacoes_documento` e `andamentos`~~ — políticas permitem `is_interno()` (a Naira é interna).

### Próximo passo concreto

Já melhorei o handler do catch no `tarefa-sheet.tsx` pra mostrar `Falha: <mensagem real>` em vez do genérico (último commit). **Naira precisa hard refresh** (HMR pode não ter pegado) e tentar de novo — o toast vai mostrar a mensagem do banco/Postgrest, que aponta direto pro problema.

### Hipóteses do que pode ser

- Algum campo do insert do andamento ou tarefa FATAL com tipo errado (ex: enum desconhecido).
- O `responsavelId` ou `emailParaId` lookup falhando silenciosamente.
- Throw inesperado vindo do `marcarDestaque` ou de outro hook.

A mensagem real do toast vai responder isso em 5 segundos.

---

## Arquivos novos/modificados nessa sessão

### Migrations
- `planning/sql-migrations/migration_pipeline_solicitacao_exigencia.sql`
- `planning/sql-migrations/migration_solicitacao_origem_template.sql`

### Frontend
- `src/lib/tarefas/types.ts` — adicionou destino `solicitacao_documento`.
- `src/components/tarefas/tarefa-sheet.tsx` — branch de insert, campo "Documentos solicitados", handler de erro melhorado.

### Backend
- `supabase/functions/inss-email-processor/index.ts` — branch idêntico pro fluxo automático.

### Commits dessa sessão (branch `feat/tarefas-ui-kanban`)
- `9254014` feat(tarefas): pipeline solicitação documento → cumprir exigência
- `6629b91` feat(tarefas): campo "Documentos solicitados" no TarefaSheet (acidentalmente trouxe 227 arquivos untracked — planning/whatsapp, video-demo, scripts, supabase/functions/check-ti-cliente, etc; já estavam no git status há tempos, ficou como bônus)
- `e9e29f0` fix(db): amplia constraint solicitacoes_documento.origem p/ aceitar template:%
- Último commit pendente: handler do catch com `Falha: <mensagem>` (já no working tree, falta push)

---

## Como retomar amanhã

```
git checkout feat/tarefas-ui-kanban
git pull
```

Pede pra Naira mandar a mensagem real do toast. Com ela:
- Corrige o ponto exato que está falhando.
- Confirma fluxo end-to-end: aplicar template → 4 itens criados → parceiro responde → tarefa "cumprir exigência" gerada pelo trigger.
- Faz commit + push final. Merge via PR (Naira faz porque não consigo pushar na main).

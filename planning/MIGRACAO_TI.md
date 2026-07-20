# Migração total do Tramitação Inteligente (TI)

> Status: **fase 1 pronta** (aguardando `TI_TOKEN` no `.env.local` pra rodar).
> Complementa [SUBSTITUIR_TRAMITACAO.md](SUBSTITUIR_TRAMITACAO.md) — aquele doc trata
> de substituir a *operação* (tarefas/agenda); este trata de migrar os *dados*.

## Decisões (Naira, 2026-07-20)

1. **Caso automático**: todo cliente migrado ganha 1 caso (`tipo_beneficio='a_definir'`,
   fase/status default) — necessário porque `andamentos.caso_id` é NOT NULL.
2. **Campos extras do TI** (RG, CNH, sexo, dados dos pais, endereço detalhado…):
   guardados íntegros em `clientes.ti_dados` (jsonb). Promover a coluna quando a UI precisar.
3. **Tarefas/perícias**: o TI **não tem export nem API** pra isso (`/tarefas` = 404).
   Extração via **API interna** do site (fase 2 abaixo).
4. **Legalmail fica de fora por enquanto** — a migração cobre apenas dados do TI.
5. **Parceiros = tags `PARCERIA_*`** (24 parcerias, ~352 clientes). Migração roda com
   `parceiro_id` NULL; alocação por tag conforme cada parceiro for convidado
   (`MAPA_PARCEIROS` no script — só preenche casos com parceiro NULL, idempotente).
   Já mapeado: `PARCERIA_ISABELA/MT` → usuária Isabella.
6. **Escopo da 1ª leva: só clientes COM tag** (360 de 749 válidos). Os 389 sem tag
   entram depois da limpeza da base (`--todos` inclui todos).
7. **77 clientes sem CPF no TI** não podem ser migrados (CPF é chave). Relatório em
   `~/Desktop/clientes-ti-sem-cpf.csv` pra Naira preencher no TI; re-rodar o script depois.

## O que a API oficial do TI dá

- `GET /clientes` — 763 clientes, 35 campos ✅
- `GET /notas` — 789 notas ✅
- `/processos`, `/movimentacoes`, `/tarefas` — **404** ❌

## Fase 1 — clientes + casos + notas (`scripts/migrar-ti.mjs`)

```bash
node scripts/migrar-ti.mjs --dry-run   # relatório, não escreve
node scripts/migrar-ti.mjs             # executa (idempotente)
```

Requer `TI_TOKEN=` e `SUPABASE_ACCESS_TOKEN=` no `.env.local`.

- Match por CPF normalizado; CPF inválido/CNPJ e duplicados são **pulados e listados**.
- Cliente novo → INSERT completo (payload TI inteiro em `ti_dados`).
- Cliente existente → atualiza tags/`ti_customer_id`/`ti_dados`; contatos **só se vazios**.
- Trigger `_clientes_sync_tags_para_etiquetas` popula etiquetas automaticamente.
- Notas → `andamentos` (origem `tramitacao`, `visivel_parceiro=false`), dedup garantido
  pelo índice único `andamentos_ti_nota_id_uniq` (migration `migration_migracao_ti.sql`).
- Depois da fase 1, o `sync-ti-todos` segue funcionando como sync incremental.

## Fase 2 — tarefas e perícias ✅ (executada 2026-07-20)

Extração via API interna do TI com a sessão logada da Naira no Chrome:

- **Endpoint que funcionou: `GET /agenda.json?start=YYYY-MM-DD&end=YYYY-MM-DD`** —
  devolve TODAS as atividades agendadas no intervalo, num array plano (256 no
  range 2020→2030). Sem paginação, uma chamada só.
- O endpoint do painel (`/atividades?current_scope=activityPanelActivities`) pagina
  as futuras de 5 em 5 mas **ignora o param `page`** — não usar.
- XHR direto de fora cai no desafio Cloudflare; precisa rodar `fetch` no contexto
  da página logada (navegação real limpa o desafio).
- Transferência browser → local: POST na tabela `ti_staging` (anon insert
  temporário, revogado e dropado em seguida). Base64 manual corrompe; evitar.

Import: `node scripts/importar-ti-tarefas.mjs --file <json> [--dry-run]`
- `MedicalExam`→`pericia`, `Deadline`→`prazo`, resto→`interna`.
- caso via `ti_customer_id`; responsável por primeiro nome (Mara Oliveira↔Mara
  Sandra, Mariane Oliveira↔Mariane Fernandes); dedup por `uq_tarefas_origem_ref`.
- **Responsável = SÓ executor** (decisão Naira 2026-07-20): o TI tem papéis
  executor/reviewer/interested no assignment; revisor e interessado não viram
  responsável (ficam em `metadata.ti_assignments_roles`). Extrair o `role` do
  `/agenda.json` (campo `assignments[].role`).
- Resultado: **257 tarefas** (82 perícias, 4 prazos), 255 com caso.
  Responsáveis: Naira 200, Mara 30, Mariane 7, **20 sem responsável** —
  executora é a Beatriz Santiago, que ainda não tem usuário; ao convidá-la,
  backfill: `update tarefas set responsavel_id=<id> where origem='migracao_ti'
  and responsavel_id is null and metadata->'ti_executores' ? 'Beatriz Santiago'`.
- **Fora**: atividades arquivadas/históricas do TI (as notas já cobrem o histórico).

## Fora do escopo (por enquanto)

**Legalmail e DJEN não entram nesta migração** (decisão Naira 2026-07-20) — as
integrações continuam existindo, mas a migração cobre só dados do TI. Movimentação
admin INSS continua com o TI como feed read-only (SUBSTITUIR_TRAMITACAO.md §7).

## Migration aplicada (2026-07-20)

`migration_migracao_ti.sql`:
- `clientes.ti_dados jsonb`
- `tarefas.origem` aceita `'migracao_ti'`
- índice único parcial `andamentos_ti_nota_id_uniq` (dedup de notas)

# Integração DJE (DJEN / Comunica API do CNJ) — Mara Sandra Connect

> Status: **planejado** (aval da Naira em 2026-06-04 sobre fonte = Comunica API CNJ e match = OAB).
> Objetivo: trazer o **texto completo das publicações** do Diário de Justiça Eletrônico Nacional
> para os andamentos dos casos, dando ao parceiro indicador atualização real do andamento processual.

---

## 1. Motivação

O Legalmail (ver [INTEGRACOES.md](INTEGRACOES.md) §3.4) entrega a **lista de movimentações** com
`titulo`, `tipo` e `data_movimentacao` — ou seja, o **rótulo** da movimentação ("Sentença",
"Despacho", "Intimação polo passivo"), mas **não o teor**. O conteúdo fica atrás de um
`hash_documento` cujo endpoint de download nem foi confirmado, e baixá-lo abre toda a discussão
de Data Protection/LGPD (ver [TODO.md](TODO.md) seção "Data Protection").

A **publicação do DJE** resolve isso: traz o **texto efetivamente publicado** pela serventia,
que é informação **pública** (diário oficial) — sensibilidade muito menor do que baixar peça do
processo. É a fonte certa para "atualização real" do caso.

---

## 2. Fonte escolhida — Comunica API do CNJ (DJEN)

O CNJ unificou os diários no **DJEN** (Diário de Justiça Eletrônico Nacional) e expõe a
**Comunica API**. A **consulta é pública e gratuita** — é o mesmo backend do portal
[comunica.pje.jus.br](https://comunica.pje.jus.br/). Só o *envio* de comunicação (POST) exige
credencial Corporativo do CNJ; a **consulta (GET) não precisa de auth**.

- Base produção: `https://comunicaapi.pje.jus.br/api/v1`
- Base homologação: `https://hcomunicaapi.cnj.jus.br/api/v1`
- Swagger: https://app.swaggerhub.com/apis-docs/cnj/pcp/1.0.0

### 2.1 Endpoint de consulta

```
GET /api/v1/comunicacao
```

Parâmetros relevantes (confirmar nomes exatos no Swagger antes de codar):

| Param | Uso |
|---|---|
| `numeroOab` + `ufOab` | consulta por OAB (estratégia principal) |
| `numeroProcesso` | consulta por processo específico (estratégia alternativa) |
| `dataDisponibilizacaoInicio` / `dataDisponibilizacaoFim` | janela `YYYY-MM-DD` (sync incremental) |
| `meio` | `D` = diário |
| `siglaTribunal` | opcional, filtrar tribunal |
| `pagina` / `itensPorPagina` | paginação |

### 2.2 Campos retornados por publicação (a confirmar no Swagger)

`id`, `hash`, `numeroprocessocommascara` / `numero_processo`, `siglaTribunal`, `nomeOrgao`,
`tipoComunicacao`, `data_disponibilizacao`, `texto` (teor completo, HTML), `destinatarios[]`
(advogados com OAB), `link`. Certidão PDF por publicação em `/comunicacao/{hash}/certidao`.

---

## 3. Estratégia de match — múltiplas OABs

A Naira decidiu: **começar pela OAB do escritório**; quando houver parceiros reais, **também
puxar pela OAB de cada parceiro**. A arquitetura já nasce multi-OAB.

### Nova tabela `oabs_monitoradas`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `numero` | text | só dígitos |
| `uf` | text(2) | |
| `tipo` | text | check `('escritorio','parceiro')` |
| `parceiro_id` | uuid null | FK `parceiros`, quando `tipo='parceiro'` |
| `ativo` | bool | default `true` |
| `created_at` | timestamptz | |

Seed inicial: OAB(s) do escritório como `tipo='escritorio'`.
Futuro: no onboarding do parceiro, gravar a OAB dele como `tipo='parceiro'`.

### Fluxo de match

1. Para cada OAB ativa → consulta a janela do dia.
2. Extrai o número CNJ da publicação e **normaliza** (só dígitos).
3. Procura em `processos_judiciais.numero_processo` (normalizado).
   - **Match** → cria andamento (ver §4).
   - **Sem match** → grava em fila de órfãos (publicação de processo ainda não cadastrado;
     sinaliza processo novo a registrar). Reaproveita o conceito da tela
     "Processos órfãos para vincular" do [TODO.md](TODO.md).

> Match por OAB do **parceiro** (futuro) também precisa ligar a publicação ao(s) caso(s) em que
> aquele parceiro é o indicador — depende da relação parceiro→caso. Tratar quando entrar parceiro real.

---

## 4. Gravação em `andamentos`

- `origem` = novo valor **`djen`**. ATENÇÃO: `andamentos.origem` é um **enum**
  (`origem_andamento`), não texto livre — exige migration
  `ALTER TYPE origem_andamento ADD VALUE 'djen'` (ver
  `migration_andamento_origem_djen.sql`) antes de qualquer gravação, senão o
  INSERT falha. Descoberto no dry-run de 2026-06-05.
- `titulo` = `tipoComunicacao` + `siglaTribunal` (ex.: "Intimação — TRF1").
- `descricao` = `texto` da publicação (HTML → texto limpo).
- `data_evento` = `data_disponibilizacao`.
- `processo_judicial_id` = match; `caso_id` herdado do processo.
- `visivel_parceiro` = `true` (publicação pública, do próprio caso do indicador).
- `metadata` = `{ djen_id, hash, sigla_tribunal, tipo_comunicacao, link, certidao_url }`.
- **Dedup** por `metadata->>djen_id` (ou `hash`).

---

## 5. Edge function + cron

- Edge function `sync-djen-publicacoes` (mesma forma das outras: service role, paginação,
  respeitar rate limit / `User-Agent`).
- Workflow n8n `djen-sync` (cron diário de manhã), janela incremental via `dataDisponibilizacao`.
  JSON pronto pra importar: [`dje/n8n-djen-sync.json`](dje/n8n-djen-sync.json).
  **O n8n NÃO chama a Comunica API direto** (geo-block) — só dispara a function, que roda em
  São Paulo via header **`x-region: sa-east-1`** (obrigatório no cron).
- Atualiza `sync_log` (source `djen_publicacoes`, `last_synced_at`) — ver task de `sync_log`.

---

## 6. LGPD

Publicação do DJE é **pública** (diário oficial) → muito menos sensível que baixar peça do
processo. Casos em **segredo de justiça** não têm teor publicado no DJEN, então o risco de
vazar conteúdo sigiloso pela publicação é baixo. Ainda assim: parceiro só vê os próprios casos
(RLS já existente), e `visivel_parceiro` segue a regra atual.

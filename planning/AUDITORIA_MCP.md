# Auditoria do MCP (ia-mcp) — 2026-09-11

Servidor MCP próprio: `supabase/functions/ia-mcp` (Claude Desktop via `mcp-remote` +
token `msc_…` da tabela `ia_tokens`). Ferramentas em `supabase/functions/_shared/ia-tools.ts`,
compartilhadas com o chat interno do app (`ia-assistant`).

## 1. Diagnóstico

**Por que tinha parado:** o token da config do Claude Desktop ("teste 3v") venceu em
04/09 (validade de 90 dias). O servidor recusava (401), o `mcp-remote` tentava login OAuth
(que não temos) e morria com "Dynamic Client Registration rejected (HTTP 404)" +
"Invalid content type, expected text/event-stream". Resolvido com token novo.

**Requests subindo no Supabase:** o GET do `ia-mcp` respondia 200 (JSON de debug). O cliente
MCP usa GET para abrir um stream SSE; ao receber JSON, reconectava em loop.
Medido em produção: **2.275 chamadas em 17 min (~135/min)** com 2 processos conectados,
até 196/min. Desligar o MCP no menu da conversa **não** para o loop (testado: mesmos
processos vivos, 98–142 chamadas/min); só tirar da config + reiniciar o Claude.

**Graves encontrados** (confirmados no código e no banco):
1. Quem é desligado continuava usando o MCP (o `ia-mcp` não checava `ativo`; `desligar_interno` não revogava tokens).
2. Qualquer interno podia alterar qualquer token pela API (policy de UPDATE com `or is_interno()`): trocar o dono ou desfazer revogação. "Só admin gera token" existia só na tela.
3. `preparar_upload_documento` marcava a solicitação como ATENDIDA ao gerar o link, antes do arquivo existir (disparando tarefa, andamento "documento entregue" e webhook).
4. Nota "interna" podia chegar ao parceiro: `criar_comentario` se dizia "mensagem interna" (o parceiro lê comentários) e `criar_andamento` cria visível ao parceiro sem avisar.

## 2. O que foi corrigido (branch `fix/ia-mcp-graves`)

| Arquivo | Mudança |
|---|---|
| `ia-mcp/index.ts` | GET de cliente MCP (`Accept: text/event-stream`) → **405** (fim do loop); navegador segue vendo o JSON. Erro de banco → **503** (não mais 401, que disparava o erro de OAuth). Usuário inativo/desligado → **403**. `instructions` + prefixo nas descrições: usar as ferramentas **só quando o usuário pedir** ("use o MCP para…") — só no MCP, o chat interno não muda. |
| `ia-config/index.ts` | `token_criar` exige admin ativo no servidor. |
| `_shared/ia-tools.ts` | `criar_comentario`: descrição avisa que o parceiro vê. `criar_andamento`: visibilidade explícita na descrição, na prévia do cartão de confirmação e na resposta — **o padrão continua visível**, igual à tela do caso (`casos.$id.tsx`, `useState(true)`). `preparar_upload_documento`: valida que a solicitação existe e é do caso **antes** de criar qualquer coisa; **não fecha mais a solicitação no link** — grava `documentos.solicitacao_id` e orienta o Claude a conferir depois. |
| `migration_ia_tokens_seguranca.sql` (nova) | `ia_tokens` só leitura pela API (drop das policies de insert/update/delete + revoke de `authenticated`/`anon`); `desligar_interno` revoga os tokens (a partir do `pg_get_functiondef` de produção, md5 `b76896a0…`; única diferença é o bloco novo); backfill de tokens de quem já está inativo. |
| `migration_upload_link_fecha_solicitacao.sql` (nova) | Gatilho em `storage.objects` (AFTER INSERT, bucket `documentos`): quando chega o arquivo que um registro de `documentos` com `solicitacao_id` espera, marca a solicitação pendente como ATENDIDA. Índice parcial `documentos(storage_path) where solicitacao_id is not null`. Nunca derruba o upload (erro vira warning). |
| `migration_ia_plugin.sql` | Re-rodar não recria mais as policies de escrita em `ia_tokens`. |

## 3. O que NÃO muda (análise de impacto)

- `ia_tokens` só é escrita por `ia-config` e `ia-mcp`, ambos com service role (conferido em `src/` e `supabase/functions/`); nenhuma função do banco, cron ou spec E2E escreve nela. O card "Conectar Claude" já é só de admin.
- `desligar_interno`: retorno igual (a tela `/equipe` não muda). `reativar_interno` limpa `desligado_em`, então reativado não fica barrado (gera token novo).
- Envio pela tela (`src/lib/documentos/cumprimento.ts`) sobe o arquivo **antes** de criar o registro → o gatilho não age. Só `cumprimento.ts` grava `documentos.solicitacao_id` hoje.
- Gatilhos de `solicitacoes_documento` rodam como antes, só que na hora em que o arquivo chega: a trava do parceiro libera `auth.uid() is null` (upload por link); tarefa/andamento de exigência continuam nascendo; a tarefa "cumprida pelo parceiro" só nasce com parceiro logado (igual a hoje via MCP).
- A assinatura do cartão de confirmação do chat é `ferramenta + args` — mudar a prévia não quebra.
- `ia-tools.ts` é compartilhado: as correções também valem para o chat interno quando o `ia-assistant` for publicado.

## 4. Validação

| Teste | Resultado |
|---|---|
| Migration de tokens em staging, em transação sempre abortada | Antes: interno trocou o dono de um token (buraco confirmado). Depois: 4 tentativas de escrita **bloqueadas**; leitura ok; service role escreve; `desligar_interno` revogou **só** o token do desligado. Staging conferido intacto depois. |
| Gatilho de upload em staging, em transação abortada | Link → pendente; arquivo chega → **atendido**, documento vinculado, 1 andamento + 1 tarefa (template); envio pela tela não afetado; dispensada continua dispensada; outro bucket não afeta; falha simulada no fechamento → **arquivo salvo** e solicitação pendente. Staging conferido intacto. |
| 19 ferramentas com o código novo (staging, dados sintéticos, apagados) | Idêntico ao código antigo: 21 OK + 3 recusas esperadas (entradas inválidas). |
| Casos específicos | Solicitação de outro caso / inexistente → recusada **sem** criar documento; link com solicitação → segue pendente e vinculada; visibilidade do andamento na resposta e na prévia. |
| `ia-mcp` rodando local contra staging | GET cliente MCP → 405; navegador → 200; sem token / token inválido → 401; banco falhando → 503. |
| Loop de GET (mock + `mcp-remote` 0.13.5) | Com 405: 18 → 2 GETs em 10 s; ferramentas continuam funcionando. |
| `deno check` / `tsc` / `eslint` | Nenhum erro novo (os erros de `deno check` já existiam na `staging`). |

**Não testado ainda:** caminho HTTP completo com token válido (conectar, `instructions` chegando
no Claude, 403 de desativado) — criar token de teste em staging foi bloqueado; upload real pelo
link com o gatilho aplicado (depende de aplicar a migration no staging); suíte E2E completa
(roda antes do push).

## 5. Ordem segura de publicação

1. **Staging:** `migration_upload_link_fecha_solicitacao.sql` e `migration_ia_tokens_seguranca.sql`
   **antes** do código. (Gatilho com código antigo = sem efeito; código novo sem gatilho =
   solicitação ficaria pendente para sempre.)
2. **Staging:** publicar `ia-mcp`, `ia-config` e `ia-assistant` (os três usam o código mexido).
3. Validar em staging (upload real pelo link, token de teste, E2E).
4. Produção na mesma ordem, só com aval da Naira.

Aplicar sempre com `node scripts/msc-sql.mjs [--staging] --file <migration>`: desde 2026-09-11 o
`--file` grava em `ops.migrations_aplicadas`, e o card do board só vai para Produção quando as
migrations do PR estão no registro de produção. Os testes desta auditoria rodaram em transação
abortada, com arquivos que não são `migration_*.sql`, então nada foi registrado.

## 6. Pendentes (médios/menores, fora deste lote)

- Resposta do MCP cortada em 8.000 caracteres no meio do JSON (`listar_andamentos` com 20 itens passa disso em ~30% dos casos).
- `ler_documentos_caso` lê só 14 documentos sem ordem e não lista os omitidos; baixa o PDF antes de checar 5 MB; sem timeout.
- `atualizar_caso` / `atualizar_cliente` / `responder_solicitacao_documento` com id inexistente respondem `ok`.
- `cadastrar_caso`: processo duplicado se chamado 2×; cliente/pasta pela metade se o nº de requerimento já existir; `clientes.created_by` NULL.
- `atualizar_*`: `""` apaga campo; observações substituem; `03/05/1960` vira 5 de março (DateStyle MDY).
- `criar_andamento` aceita processo de outro caso.
- Pelo MCP, comentário não gera e-mail e solicitação não avisa o parceiro (a tela avisa).
- `/upload` faz PUT em qualquer URL do parâmetro `u` (phishing com o domínio do escritório); link fixo no domínio de produção.
- `listar_comentarios` devolve os mais antigos; CPF sem máscara no texto de ~100 andamentos; auditoria guarda textos inteiros; 3 idas ao banco por chamada.

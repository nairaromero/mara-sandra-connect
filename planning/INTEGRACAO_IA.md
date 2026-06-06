# Plugin de IA (CRUD por conversa) — Documentacao do pacote

> Estado: **Fases 0, 1 e 3 implementadas e no ar.** Leitura + escrita com confirmacao,
> nas duas superficies (chat in-app e MCP no Claude). Sem delecao. Anexar documento (upload)
> e edicao de cliente/solicitacao por parceiro continuam fora de escopo.
>
> Ferramentas de escrita (8): criar_comentario, criar_andamento (interno), responder_solicitacao_documento,
> atualizar_caso, criar_caso, criar_cliente, atualizar_cliente (interno), criar_solicitacao_documento (interno).
> No chat in-app a escrita pede confirmacao (card assinado por HMAC, a prova de TOCTOU). No MCP, a
> aprovacao do tool no Claude e a confirmacao; o token precisa ter escopo 'completo'.
> Plano completo aprovado: ver o arquivo de plano da sessao + `ia-overview.html` e
> `ia-seguranca.html` nesta pasta.

## O que e

Permite que cada usuario (interno ou parceiro) **converse com uma IA** para consultar
(e, nas proximas fases, criar/atualizar) dados do sistema. **Nunca apaga nada** — acoes
destrutivas nem existem como ferramenta.

Duas superficies (mesmo nucleo de tools + RLS + auditoria):
- **A — Chat in-app (BYOK):** painel proprio; o usuario cola a chave do provedor dele.
- **B — Claude/ChatGPT externos (Fase 3):** servidor MCP + connector, auth por token pessoal.

## Componentes (Fase 0)

### Banco — `planning/sql-migrations/migration_ia_plugin.sql`
- `ia_integracoes` — cofre BYOK por usuario (provider, modelo, chave cifrada, hint, ativo).
- `ia_acoes` — auditoria + fila de acoes pendentes (`action_id`, `status`).
- `ia_tokens` — PATs da Superficie B (uso na Fase 3).
- RLS: cada usuario so ve a propria linha; interno le tudo e pode desativar (kill-switch).

### Edge functions
- `supabase/functions/ia-config` — `status` / `salvar` / `testar` / `ativar`. Cifra a chave
  (AES-GCM com `IA_MASTER_KEY`); nunca devolve a chave em claro.
- `supabase/functions/ia-assistant` — loop de tool-use **read-only**. Executa as tools via
  client **RLS-escopado** (identidade do usuario); audita em `ia_acoes`.
- `supabase/functions/_shared/` — `cors`, `crypto`, `ia-redact`, `ia-providers` (adapters
  Anthropic + OpenAI, endpoints fixos), `ia-tools` (registry read-only com allowlist de colunas).

### Frontend
- `src/lib/ia/client.ts` — wrappers tipados das functions.
- `src/hooks/use-ia-assistant.ts` — estado da conversa.
- `src/components/ia/ia-assistant-panel.tsx` — painel de chat (texto sanitizado).
- `src/components/ia/ia-launcher.tsx` — botao flutuante (so aparece se ativo); montado em
  `src/routes/_authenticated.tsx`.
- `src/components/ia/integracao-ia-card.tsx` — card "Integracao de IA" em Configuracoes.

## Deploy / configuracao (precisa fazer)

1. **Aplicar a migration** no projeto de producao `llugytkdsfsrciavhrfw`:
   `node scripts/msc-sql.mjs --file planning/sql-migrations/migration_ia_plugin.sql`
2. **Gerar e setar o secret `IA_MASTER_KEY`** (base64 de 32 bytes), ex.:
   `openssl rand -base64 32` -> `supabase secrets set IA_MASTER_KEY=...`
3. **Deploy das functions:**
   `supabase functions deploy ia-config && supabase functions deploy ia-assistant`
4. Em Configuracoes -> Integracao de IA: escolher provedor/modelo, colar a chave,
   "Testar conexao", "Salvar e ativar". O botao do assistente passa a aparecer.

## Seguranca (resumo — ver `ia-seguranca.html`)

Chave cifrada em repouso; execucao sob RLS do proprio usuario; CPF mascarado e senha do
MEU INSS fora do alcance da IA; dados lidos tratados como nao-confiaveis (anti prompt-injection);
auditoria de tudo; zero ferramentas destrutivas.

### Limites conhecidos da Fase 0
- Sem streaming (resposta em bloco) — streaming fica para a Fase 2.
- Conversa nao persiste entre aberturas do painel (estado em memoria).
- Escrita (criar/atualizar) ainda nao habilitada — Fase 1.

## LGPD

Usar LLM de terceiro com dado previdenciario tem exposicao inerente. Provedores enviados:
Anthropic / OpenAI (Superficie A, chave do usuario). Habilitar modos de nao-treino /
retencao-zero e minimizar campos. Decisao de habilitar e da controladora (Naira).

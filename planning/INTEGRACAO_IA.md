# Plugin de IA (CRUD por conversa) — Documentacao do pacote

> Estado: **Fases 0, 1 e 3 implementadas e no ar.** Leitura + escrita com confirmacao,
> nas duas superficies (chat in-app e MCP no Claude). Sem delecao.
>
> MODELO: cliente -> 1 PASTA (caso, 1 por cliente) -> PROCESSOS (cada beneficio) -> ANDAMENTOS.
>
> Ferramentas de escrita: cadastrar_caso (cliente+pasta+1o processo), cadastrar_processo,
> criar_andamento (interno, vincula a processo), atualizar_caso, atualizar_cliente (interno),
> criar_comentario, responder_solicitacao_documento, criar_solicitacao_documento (interno),
> preparar_upload_documento (link de upload assinado, arquivo vai direto ao Storage sem passar pela IA).
> Leitura inclui listar_processos. No chat in-app a escrita pede confirmacao (card HMAC, anti-TOCTOU).
> No MCP, a aprovacao do tool no Claude e a confirmacao; o token precisa ter escopo 'completo'.
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

> Para o jurídico/DPO bater o martelo antes de habilitar em produção para clientes reais.
> Isto é um resumo técnico, não parecer jurídico.

### Enviar dado ao MCP/IA é "data breach"? NÃO.

- **Data breach** (incidente de segurança da LGPD) = acesso/vazamento/perda **não autorizado**.
- Mandar dado ao provedor de IA é uma **transferência intencional e controlada** a um terceiro
  (processador) que a controladora **escolheu integrar**. É **tratamento/compartilhamento** de dados,
  não vazamento. Só viraria incidente se: **token vazar** (acesso indevido), provedor **reter/treinar**
  contra os termos, ou enviar **sem base legal/DPA** (tratamento irregular).

### O que JÁ minimiza a exposição (implementado)

- **Mascaramento na leitura:** a IA recebe CPF, telefone (4 últimos), email (parcial) e endereço
  (`Rua da ***`) mascarados — nunca o dado completo. Senha MEU INSS **fora do alcance** (cifrada).
- **RLS + token por usuário:** só o usuário autorizado acessa, e só os dados dele.
- **Confirmação humana** em toda escrita; **zero ações destrutivas**.

### O que AINDA trafega (exposição inerente, honesto)

- **O que o usuário digita** (ex.: ao cadastrar, o endereço/telefone que ele mesmo escreve no chat)
  vai ao provedor como digitado — não há como mascarar o input do próprio usuário.
- **Nome completo + dados do caso** (benefício, status) para identificar o registro. Dado
  previdenciário pode tocar saúde (incapacidade) = dado sensível (art. 11).
- Provedores destinatários: **Anthropic / OpenAI**, nos EUA = **transferência internacional**.

### Checklist de conformidade (pendente — lado contratual/legal)

- [ ] **Base legal** definida (ex.: legítimo interesse, execução de contrato, ou consentimento).
- [ ] **DPA / Termos de Processamento de Dados** assinados com Anthropic e OpenAI.
- [ ] **No-training / retenção-zero** habilitados na conta de cada provedor.
- [ ] **Transparência:** aviso de privacidade informando que dados podem ser processados por IA.
- [ ] **Governança de token:** expiração, revogação, não expor o token; kill-switch por usuário.
- [ ] **Decisão de habilitar** registrada pela controladora (escritório Mara Sandra / Naira).

Enquanto o checklist não fechar, o recomendável é usar **só com dados de teste**.

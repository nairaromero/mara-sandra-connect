# Handoff — Plugin de IA (Mara Sandra Connect)

> Documento de continuidade. Lido por uma conversa nova para retomar o trabalho do
> plugin de IA sem perder contexto. Atualizado em 2026-06-09.

---

## 1. Visão geral do que existe (em produção)

O app tem um **plugin de IA** com duas superfícies que compartilham o mesmo
registry de tools + RLS + auditoria:

- **Superfície A — Chat in-app (BYOK):** cada usuário cola a própria API key
  (Anthropic/OpenAI). Painel flutuante. Escrita exige confirmação (propor →
  confirmar, assinado no servidor). Função: `ia-assistant`.
- **Superfície B — Claude/ChatGPT externos (MCP):** o usuário conecta o próprio
  Claude/ChatGPT via Personal Access Token (PAT). Função: `ia-mcp`. Servidor MCP
  publica as mesmas tools. Usa service-role para interno; recusa parceiro (projeto
  está em chaves JWT assimétricas, sem segredo HS256).
- **Análise técnica por IA** ("Analisar com IA" na aba Análise do caso): função
  `ia-analise`. Hoje no **Nível 2 + persona Dr. Cláudio** (ver seção 3).

### Modelo de dados (importante)
`cliente → 1 pasta (caso, 1 por cliente) → processos (benefícios) → andamentos`.
O `caso` é um container invisível ("pasta"); os benefícios são `processos_admin`.
Tudo do cliente aparece numa tela só. **Nunca** existem tools destrutivas (sem delete).

### Segurança/LGPD (transversal)
- Chaves de IA cifradas em repouso (AES-GCM, secret `IA_MASTER_KEY`).
- CPF mascarado, telefone (4 últimos), email parcial, endereço ("Rua da ***").
- Senha MEU INSS **nunca** exposta à IA.
- Toda ação auditada; confirmação humana antes de escrever.
- Uso de LLM de terceiro com dado previdenciário tem exposição LGPD inerente —
  decisão da controladora (Naira); doc em `planning/INTEGRACAO_IA.md`.

---

## 2. Arquivos-chave

**Edge functions** (`supabase/functions/`)
- `_shared/ia-tools.ts` — registry central de tools (READ + WRITE), papéis, preview, masking.
- `_shared/ia-providers.ts` — adapter multiprovider (`chatWith`). **`maxTokens` agora é
  por chamada** (default 1536 p/ chat; `ia-analise` usa 8000).
- `_shared/ia-redact.ts` — mascaramento (maskCpf, maskTelefone, maskEmail, maskEndereco).
- `_shared/crypto.ts` — AES-GCM + HMAC (assinatura anti-TOCTOU).
- `_shared/tokens.ts` — geração/hash de PAT.
- `ia-config/index.ts` — status/salvar/testar/ativar + tokens.
- `ia-assistant/index.ts` — chat in-app (propor→confirmar).
- `ia-mcp/index.ts` — servidor MCP (verify_jwt=false via config.toml).
- `ia-analise/index.ts` — análise técnica/viabilidade (Nível 2 + Dr. Cláudio).

**Frontend** (`src/`)
- `lib/ia/client.ts` — wrappers (`iaConfig`, `iaTokens`, `iaAssistant`, `iaAnalise`).
- `components/ia/ia-assistant-panel.tsx`, `ia-launcher.tsx`, `integracao-ia-card.tsx`, `conexao-claude-card.tsx`.
- `routes/_authenticated/casos.$id.tsx` — aba Análise tem botão "Analisar com IA"; aba renderiza `resultado_json.observacoes` com `whitespace-pre-wrap`.
- `routes/upload.tsx` — página pública `/upload` (PUT do arquivo em signed URL; binário nunca passa pela IA).

**Doc/planning**
- `planning/INTEGRACAO_IA.md` — doc do pacote.
- `planning/sql-migrations/migration_ia_plugin.sql` — migração.

---

## 3. Estado da `ia-analise` (foco atual)

### Como funciona hoje
1. Recebe `{caso_id}` (JWT de interno; só interno gera análise).
2. Reúne contexto (cliente mascarado, pasta, processos, andamentos, solicitações, documentos).
3. **Nível 2 — lê o conteúdo dos PDFs:**
   - Baixa do Storage (bucket `documentos`), extrai texto com **unpdf**.
   - **Fix crítico:** o unpdf carrega o pdf.js via `import()` dinâmico, que o
     eszip do Supabase Edge NÃO empacota → dava `"PDF.js is not available"`.
     Solução: importar o build serverless do pdf.js **estaticamente**
     (`import { resolvePDFJS } from "unpdf@0.12.0/pdfjs"`) + `configureUnPDF`,
     mais polyfill de `Promise.withResolvers`.
   - **Prioriza por tipo:** `cnis > laudo_medico > outro > resto`; orçamento de
     60k chars / 14 docs (o CNIS sempre entra).
   - PDFs escaneados/imagem saem vazios ou com texto mínimo → **sinalizados como
     "precisa OCR"** (campo `via` em `resultado_json.debug_docs`, p/ diagnóstico).
4. **Persona Dr. Cláudio (adaptada p/ triagem):** o `SYSTEM` segue a estrutura de
   9 seções (resumo, questões, fundamentação legal, jurisprudência STF>STJ>TNU>TRF,
   análise aplicada, pontos fortes/fracos, riscos — decadência/prescrição/Tema 350/
   Tema 555, estratégias, conclusão + PONTOS A CONFIRMAR). Não inventa julgado
   (`[JURISPRUDÊNCIA A VALIDAR]`); confirma RGPS×RPPS; não presume dados faltantes.
5. **Saída:** a IA responde a análise rica (texto) + rodapé `<<<META>>>{json}<<<END>>>`
   com veredito/benefício/docs faltantes/próximos passos/resumo_parceiro. A função
   separa os dois (robusto contra quebra de JSON) e salva nova versão em `analises_tecnicas`.

### Limites honestos (declarados ao usuário no resultado)
- **NÃO** tem o índice de normas pós-maio/2025, **NÃO** gera peças, **NÃO** usa
  papéis timbrados. É **triagem de viabilidade**, não a Skill Dr. Cláudio completa.
- **PDFs escaneados não são lidos** → recomenda OCR/leitura manual (não conclui sobre
  o que não viu). É o gap mais sensível para casos de incapacidade (laudos são imagem).

### Verificado em produção (caso José Fernandes, `da62337a-...`)
CNIS lido (6552 chars), Laudos Periciais (29480), Laudo INSS (2190); scans
corretamente marcados. Primeira análise saía genérica por causa do teto de 1536
tokens (corrigido p/ 8000) e do prompt genérico (corrigido p/ Dr. Cláudio).

---

## 4. TODO — daqui por diante (prioridade)

### A. Calibrar e validar o Dr. Cláudio na `ia-analise` (próximo passo imediato)
- [ ] Naira testar "Analisar com IA" no caso do José e avaliar a profundidade.
- [ ] Ler o resultado no banco e calibrar prompt/tamanho se necessário:
      `node scripts/msc-sql.mjs "select versao, left(resultado_json->>'observacoes',4000), resultado_json->'debug_docs' from analises_tecnicas where caso_id='<id>' order by versao desc limit 1"`
- [ ] Se aprovado, **commitar** (já commitado em 2026-06-09 — confirmar) e seguir.

### B. Ler PDFs escaneados (OCR) — fecha o caso do José
Decisão pendente da Naira. Opção recomendada: **mandar o PDF escaneado direto
ao provider do usuário (BYOK)** — Claude lê PDF escaneado nativamente (qualidade OCR),
sem serviço novo.
- [ ] Estender `ia-providers.chatWith` para aceitar **anexos** (document/image block).
      Anthropic: bloco `document` base64 (PDF, até ~32MB/100 págs). OpenAI: vision/PDF
      conforme modelo.
- [ ] Em `ia-analise`, para docs `pdf_vazio`/`pdf_curto`, anexar o PDF bruto em vez de só texto.
- [ ] Cuidar de custo (base64 é pesado) e de limite de páginas; talvez só p/ tipos
      `cnis`/`laudo_medico`/`outro`.
- Alternativa descartada por enquanto: serviço OCR dedicado (Google Vision/Textract) —
  exige credencial/custo no escritório (não-BYOK).

### C. Renderização do resultado na aba (qualidade de leitura)
- [ ] Hoje a aba mostra `observacoes` com `whitespace-pre-wrap` (texto puro). A análise
      Dr. Cláudio é longa e estruturada → considerar render **markdown** (títulos,
      negrito, listas) na aba Análise para leitura melhor. (Arquivo: `casos.$id.tsx`,
      ~linha 5242, componente da aba Análise.)

### D. Auto-refresh do caso (parar de precisar F5)
- [ ] Escritas externas (MCP) e da IA não aparecem na UI sem recarregar. Implementar
      refresh (refetch/subscription) na tela do caso após ação de IA/MCP.

### E. Higiene de Storage / dados de teste
- [ ] Limpar órfãos de storage (arquivos de 22 bytes de testes antigos, etc.).
- [ ] Link de upload com validade maior (hoje ~2h).

### F. Notificação por e-mail (além do sino)
- [ ] Opcional: e-mail ao interno quando o parceiro salva novo caso (hoje só notificação no sino).

---

## 5. Comandos úteis

```bash
# Rodar SQL em produção (recusa DELETE/UPDATE sem WHERE; allowlist)
node scripts/msc-sql.mjs "<SQL>"

# Deploy de edge function (SUPABASE_ACCESS_TOKEN vem do .env.local)
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2-)
supabase functions deploy <nome> --project-ref llugytkdsfsrciavhrfw

# Checar boot de uma function (401 = ok; 500 = quebrou no carregamento)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/<nome>" \
  -H "apikey: <publishable_key>" -H "Authorization: Bearer <publishable_key>" \
  -H "content-type: application/json" -d '{}'
```

- Projeto Supabase (prod): `llugytkdsfsrciavhrfw`.
- `ia-mcp` precisa de `[functions.ia-mcp] verify_jwt=false` no `config.toml` (já está).
- Cloudflare faz auto-deploy do frontend no push para `main`.
- Logs de console das functions: tabela `function_logs` via Management API
  (`/v1/projects/<ref>/analytics/endpoints/logs.all?sql=...`). Atenção: console.error
  do código nem sempre aparece; para diagnóstico, gravar no `resultado_json` e ler via SQL
  (foi assim que se achou o erro do pdf.js — campo `debug_docs`).

## 6. Armadilhas conhecidas
- **NUNCA usar CPF de teste que possa colidir** com cliente real. Já houve perda de
  caso de teste por cascade-delete. Usar CPF garantidamente único e conferir antes de apagar.
- Router-generator regenera `routeTree.gen.ts` no `npm run build`; `tsc` roda DEPOIS do build.
- Classifier bloqueia leitura de service-role/secrets de produção — não insistir; gravar
  diagnóstico no banco e ler via `msc-sql`.
- Git: aprovar antes de commit/push (exceto quando a Naira pedir explicitamente).

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
  - **Leitura de documentos (2026-06-09):** tool `ler_documentos_caso` (interno-only)
    devolve o TEXTO dos PDFs/TXT digitais e os PDFs **escaneados como blocos
    `resource`** (base64) — a IA da pessoa (Claude/ChatGPT, com Skill Dr. Cláudio +
    Visual Law) faz a análise e redige a peça. Extração compartilhada em
    `_shared/ia-docs.ts`. ⚠️ A renderização do `resource` PDF depende do cliente MCP
    (claude.ai) — **a validar** (ver §4.G).
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
   - **OCR via provider (BYOK) — implementado 2026-06-09:** PDFs escaneados
     (`pdf_vazio`/`pdf_curto`) dos tipos `cnis`/`laudo_medico`/`outro` são
     **anexados brutos** (base64) à chamada da IA, que os lê nativamente
     (`chatWith` aceita `attachments`; Anthropic bloco `document`, OpenAI bloco
     `file`/`file_data`). Tetos p/ não estourar o worker: 8 anexos, **5MB/arquivo**,
     12MB total. PDFs **acima de 5MB NÃO são parseados nem anexados** (pdf.js em
     scan grande estoura a memória → `WORKER_RESOURCE_LIMIT`): marcados
     `pdf_grande` → leitura manual. `pdf.destroy()` por doc libera memória.
     `debug_docs[].via` ganha sufixo `+anexado` quando o PDF foi anexado.
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
- **PDFs escaneados pequenos (≤5MB) agora SÃO lidos** via anexo (OCR do provider).
  Scans **>5MB** ainda não (risco de memória) → recomenda leitura manual.

### Verificado em produção (caso José Fernandes, `da62337a-...`)
- **v7** (texto-only): CNIS lido (6552), Laudos Periciais (29480), Laudo INSS (2190);
  laudos particulares (scans) NÃO lidos → veredito `precisa_mais_dados`.
- **v8** (com OCR/anexos, 2026-06-09): 8 laudos escaneados anexados (`+anexado`),
  lidos por OCR nativo; a análise passou a citar CIDs (H40 glaucoma), datas e
  procedimentos reais; **veredito virou `viavel`**. Input ~17k tokens (custo baixo).
  Só "13 - Documento.pdf" (8.6MB) ficou `pdf_grande` (leitura manual). ✅
- ⚠️ **gpt-4.1 será desligado na API OpenAI em ~14/out/2026** — planejar migração de
  modelo da integração de análise antes disso (ex.: gpt-5.x ou Claude).

---

## 4. TODO — daqui por diante (prioridade)

### A. Calibrar e validar o Dr. Cláudio na `ia-analise` — ✅ FEITO (2026-06-09)
- [x] Naira testou no caso do José; persona aprovada (saída rica, 9 tópicos, usa
      números do CNIS, marca `[JURISPRUDÊNCIA A VALIDAR]`, honesta sobre o não lido).
- [x] v8 validada no banco; veredito coerente com a prova (virou `viavel` após OCR).
- [ ] Pendente: commit + (eventual) ajuste fino futuro de prompt.

### B. Ler PDFs escaneados (OCR) — ✅ FEITO (2026-06-09), via BYOK/anexo
Implementado conforme a opção recomendada (anexar PDF bruto ao provider; ver §3).
Decisão da Naira: **BYOK/anexo** + escopo **só `cnis`/`laudo_medico`/`outro`**.
- [x] `chatWith` aceita `attachments` (Anthropic `document`, OpenAI `file`).
- [x] `ia-analise` anexa scans pequenos; tetos de memória; `pdf_grande` p/ >5MB.
- [ ] **Próximo refino possível:** scans grandes (>5MB, ex. "13 - Documento.pdf")
      ainda não lidos. Opções: dividir o PDF por página (anexar só algumas), ou
      converter páginas em imagens menores. Avaliar custo/necessidade caso a caso.
- Alternativa descartada: serviço OCR dedicado (Google Vision/Textract) — não-BYOK.

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

### G. Leitura de documentos via MCP — ✅ VALIDADO (2026-06-09)
Tool `ler_documentos_caso` no MCP (`ia-mcp` + `_shared/ia-docs.ts`). Ideia: a IA da
própria pessoa (com as Skills) lê os documentos e redige análise/peça — o MCP só
fornece o conteúdo (texto + scans como `resource` PDF). MVP: **só leitura** (não
salva de volta).
- [x] Extrator compartilhado `_shared/ia-docs.ts` (unpdf lazy + tetos de memória).
- [x] `ler_documentos_caso` (interno-only por LGPD; conteúdo bruto = PII/dados médicos).
- [x] `ia-mcp` expande `_anexos` em blocos `resource`; `ia-assistant` descarta `_anexos`.
- [x] **VALIDADO via cliente MCP real (Claude Code):** chamada `ler_documentos_caso`
      no caso do José devolveu CNIS/Laudos/Laudo-INSS como texto e os 8 scans como
      `resource` PDF; o modelo LEU um atestado escaneado por OCR nativo (CID H40.1,
      CRM 9034, data). "13 - Documento.pdf" (8.3MB) corretamente pulado (`pdf_grande`).
- [ ] (Nice-to-have) Naira dar o teste final no **claude.ai** dela p/ confirmar a UX
      (claude.ai injeta o `resource` direto no contexto; mecanismo já provado).
      Se algum cliente NÃO ler: plano B = (a) rasterizar página→imagem (bloco `image`),
      (b) URL assinada de download. Reconectar o connector p/ a tool nova aparecer.
- [ ] Futuro (fora do MVP): tool de ESCRITA p/ salvar a análise/peça de volta no caso
      (aba Análise como nova versão de `analises_tecnicas`, ou como documento/comentário).
- Nota: `ia-docs.ts` duplica a extração que a `ia-analise` faz inline — dedup futura
  possível (fazer a `ia-analise` usar `extractCasoDocs`), com re-teste.

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

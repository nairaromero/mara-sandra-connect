# Plano de integração — WhatsApp (Evolution API) → Mara Sandra Connect

> Documento de planejamento da integração com WhatsApp para os **parceiros**
> (e, no futuro, **clientes**). Para arquitetura geral do app, ver
> [ARQUITETURA.md](ARQUITETURA.md). Para o padrão de outbox/webhooks de saída
> que aqui reaproveitamos, ver [sql-migrations/migration_webhooks.sql](sql-migrations/migration_webhooks.sql)
> e [webhooks/n8n-workflow.json](webhooks/n8n-workflow.json).
>
> **Status: PLANEJAMENTO. Nenhuma linha de código escrita ainda.** (2026-05-30)

---

## 0. Objetivo

Permitir que o **parceiro** interaja com o app pelo WhatsApp, sem precisar
abrir o navegador, para:

1. **Adicionar comentário** num caso.
2. **Responder a comentário** existente (1 nível, igual à UI).
3. **Anexar documento** (foto/PDF mandado no WhatsApp → bucket `documentos`).
4. **Receber solicitação de documento** e **cumpri-la** pelo WhatsApp.
5. **Extras já prontos no app** que valem entrar (saída/notificação):
   novo andamento, mudança de status/fase do caso, decisão administrativa.

Decisões já tomadas com a Naira (2026-05-30):
- Provedor: **Evolution API** (não-oficial, Baileys), porque Z-API é pago.
- Hospedagem: **na mesma máquina do n8n** (`nairavian-n8n.de`).
- Interação: **menu numerado** (não botões — ver §3.3).
- Público inicial: **só parceiros**, mas já deixar o caminho pronto para
  clientes sem retrabalho (ver §9).

---

## 1. O que a Evolution API entrega

Projeto open-source (Apache 2.0), self-hosted. Conexão WhatsApp via **Baileys**
(WhatsApp Web não-oficial) — sem custo de licença nem por mensagem, sem
aprovação de template. Repo: `https://github.com/EvolutionAPI/evolution-api`.
Doc: `https://doc.evolution-api.com/v2`.

### 1.1 Conexão / instância
- `POST /instance/create` — cria a instância. Body: `{ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true, number }`.
  A resposta traz um `hash` = **token da instância** (usado para enviar).
- A conexão é feita lendo um **QR code** no celular (chip dedicado).
  Se a sessão cair, precisa reler o QR.

### 1.2 Envio (saída) — autenticação por header `apikey`
| Endpoint | Uso |
|---|---|
| `POST /message/sendText/{instance}` | Texto. Body: `{ number, text, delay?, quoted? }` |
| `POST /message/sendMedia/{instance}` | Imagem/vídeo/documento. `{ number, mediatype, media (base64 ou URL), fileName, caption }` |
| `POST /message/sendWhatsAppAudio/{instance}` | Áudio |

- Mídia: base64 para arquivos pequenos (< ~3MB) ou **URL** para maiores.
  Limite prático de mídia ~**16MB**. Documentos maiores → mandamos **link**.

### 1.3 Recebimento (entrada) — webhooks
- Configurável por instância (`POST /webhook/set/{instance}`) ou global via env
  (`WEBHOOK_GLOBAL_URL`, `WEBHOOK_GLOBAL_ENABLED`).
- Evento que importa: **`MESSAGES_UPSERT`** (`messages.upsert`). Dispara para
  mensagem recebida E enviada — precisamos **ignorar `data.key.fromMe === true`**.
- Payload (resumido):
  ```json
  {
    "event": "messages.upsert",
    "instance": "mara",
    "data": {
      "key": { "id": "...", "fromMe": false, "remoteJid": "5518999998888@s.whatsapp.net" },
      "pushName": "Dr. Fulano",
      "message": { "conversation": "texto..." }
    }
  }
  ```
  Mídia recebida vem em `message.imageMessage` / `documentMessage` etc.; o
  arquivo é baixado via endpoint da própria Evolution (base64) usando o
  `message.key.id`.
- **Evolution NÃO assina o webhook** (sem HMAC nativo) → protegemos com token
  secreto na URL/header (ver §6.2).

### 1.4 Limitações conhecidas (issue tracker do projeto)
- Webhooks podem **duplicar** mensagem → dedupe por `data.key.id`.
- Mensagens `fromMe` chegam no mesmo evento → filtrar.
- Payloads de imagem grandes podem estourar.

---

## 2. Por que isto é viável: mapeamento no que já existe

A entidade central continua sendo o **caso** (`casos`). Tudo que o parceiro
faria no WhatsApp já tem tabela e regra de RLS no app:

| Ação no WhatsApp | Onde já existe | Migration de referência |
|---|---|---|
| Adicionar comentário | `comentarios` (insert) | [migration_comentarios.sql](sql-migrations/migration_comentarios.sql) |
| Responder comentário | `comentarios.parent_id` (1 nível) | idem |
| Anexar documento | `documentos` + bucket `documentos` (`<caso_id>/<nome>`) | [migration_parceiro_cumprir_solicitacao.sql](sql-migrations/migration_parceiro_cumprir_solicitacao.sql) |
| Receber solicitação | `solicitacoes_documento` (status `pendente`) | idem |
| Cumprir solicitação | update status `atendido` + insert documento | idem |
| Notificar andamento/status/decisão | **outbox já enfileira** esses eventos | [migration_webhooks.sql](sql-migrations/migration_webhooks.sql) |

> Já existe a função `caso_do_parceiro(caso_id)` que checa
> `casos.parceiro_id = auth.uid()`. No fluxo WhatsApp não há `auth.uid()`
> (rodamos com service-role), então **reimplementamos a checagem
> explicitamente** (ver §6.3).

---

## 3. Trade-offs da decisão (Evolution / Baileys)

### 3.1 A favor
- **Custo zero** de licença e por mensagem; só hospedagem (vai junto do n8n).
- Self-hosted, combina com a stack atual (n8n + Supabase).
- Sem aprovação de template, qualquer tipo de mídia.

### 3.2 Contra / riscos (registrados honestamente)
1. **Manutenção de infra MAIOR que SaaS.** Hospedar Evolution = Docker +
   Postgres + Redis e **sessão do WhatsApp que pode cair** (re-ler QR). O
   *código* é baixa manutenção e o Claude cuida; o *servidor vivo* é ops da Naira.
2. **Risco de ban** (Baileys é WhatsApp Web não-oficial). Mitigação: **chip
   dedicado**, aquecer aos poucos, priorizar **responder** (inbound) e evitar
   disparo em massa.
3. **Botões interativos não confiáveis** no Baileys → usamos **menu numerado**.
4. **Mídia ~16MB** → documentos maiores viram **link** em vez de arquivo.
5. Bugs do projeto (webhook duplicado, `fromMe`) → tratados no código.

### 3.3 Consequência de design
O menu é **numerado** ("responda *1*, *2*, *3*"). Funciona igual de bem,
só não é botão clicável. Toda chamada ao provedor passa por uma camada de
abstração `whatsapp/provider.ts`, então trocar para Z-API ou API oficial
depois é reescrever **um** arquivo.

---

## 4. Arquitetura proposta

Reaproveita **os dois padrões que já funcionam** no app:

```
                 ENTRADA (parceiro -> app)
  WhatsApp --> Evolution --webhook--> Edge Function `whatsapp-inbound`
                                         |  (máquina de estados / menu)
                                         |  resolve telefone -> parceiro
                                         |  executa ação (RLS reimplementada)
                                         +--> responde via provider.sendText

                 SAÍDA (app -> parceiro)
  Triggers/eventos --> whatsapp_outbox  (fila, mesmo padrão do webhook_eventos)
                          |
        n8n (mesmo carteiro) faz polling: whatsapp_claim_batch()
                          |
                          +--> Evolution sendText --> mark_result (backoff)
```

- **Entrada:** uma Edge Function Deno (`whatsapp-inbound`) — mesmo modelo das
  funções `sync-ti`, `notify-*` já existentes, invocadas/deployadas via Supabase.
- **Saída:** fila `whatsapp_outbox` espelhando `webhook_eventos`, com
  `whatsapp_claim_batch()` / `whatsapp_mark_result()`. O **mesmo n8n** ganha um
  workflow irmão do atual (`webhooks/n8n-workflow.json`). Diferença: aqui o
  corpo não precisa de HMAC (o destino é a Evolution, autenticada por `apikey`).
- **Provider:** `whatsapp/provider.ts` encapsula as chamadas à Evolution
  (sendText, sendMedia, downloadMedia), lendo URL+apikey do Vault.

---

## 5. Modelos de dados novos (a criar)

Tudo idempotente, mesmo estilo das migrations atuais.

### 5.1 `whatsapp_sessoes` — estado da conversa (máquina de estados)
```
telefone        text primary key      -- E.164 normalizado, ex 5518999998888
parceiro_id     uuid references usuarios(id)   -- resolvido (null se desconhecido)
estado          text not null default 'menu'   -- menu | escolhe_caso | comentar | ...
contexto        jsonb not null default '{}'    -- ex: { caso_id, solicitacao_id, lista:[...] }
atualizado_em   timestamptz not null default now()
expira_em       timestamptz                    -- sessão expira (ex: 30 min) e volta ao menu
```

### 5.2 `whatsapp_outbox` — fila de saída (espelha `webhook_eventos`)
```
id              uuid pk default gen_random_uuid()
telefone        text not null              -- destino
tipo            text not null              -- comentario.novo | andamento.novo | ...
texto           text                       -- corpo já renderizado
midia_url       text                       -- opcional
status          text not null default 'pendente'  -- pendente|enviando|enviado|falhou
tentativas      int not null default 0
proxima_tentativa_at timestamptz
created_at      timestamptz default now()
enviado_at      timestamptz
http_status     int
erro            text
```
+ funções `whatsapp_claim_batch(p_limit int)` e
  `whatsapp_mark_result(id, ok, http_status, erro)` — cópia direta da lógica de
  backoff de [migration_webhooks.sql](sql-migrations/migration_webhooks.sql)
  (1m/5m/30m/2h, 5ª falha → `falhou`), **sem** a parte de HMAC.

### 5.3 `whatsapp_mensagens` (opcional, recomendado) — log/auditoria
Registro append-only de entrada e saída (telefone, direção, conteúdo,
`evolution_message_id`) para depuração, dedupe e LGPD (purga após N dias,
igual `webhook_purge_payloads`).

---

## 6. Identificação e segurança

### 6.1 Normalização de telefone (E.164, agnóstico de país)
`remoteJid` vem como `<código_país><número>@s.whatsapp.net`. O resolvedor é
**agnóstico de país** (compara dígitos em E.164, com código do país):
1. tira o sufixo `@s.whatsapp.net`, mantém só dígitos;
2. compara com `usuarios.telefone` normalizado (só dígitos).

**Caso BR (produção):** números BR têm a ambiguidade do **9º dígito** (celular
com/sem o 9). A comparação tolera presença/ausência desse dígito para `+55`.

**Caso teste (2026-05-30):** os números de teste são **espanhóis (+34)**, que
NÃO têm a ambiguidade do 9º dígito — casam direto. Logo, o teste **não exercita**
a regra do 9º dígito BR; ela precisa ser validada à parte antes de produção (onde
os parceiros reais são `+55`). Em produção, usar uma **linha BR dedicada** (ver §11).

### 6.2 Proteção do webhook de entrada
Evolution não assina. A Edge Function `whatsapp-inbound` só aceita requisições
com um **token secreto** combinado (na URL como path/query ou header), guardado
no Vault. Requisição sem token correto → 401.

### 6.3 Autorização (a função fura a RLS)
A Edge roda com **service-role**, então a RLS não protege automaticamente.
**Toda ação reimplementa a checagem**: o `parceiro_id` resolvido tem que ser
dono do `caso_id` alvo (`casos.parceiro_id = parceiro_id`). Sem isso, recusa.

### 6.4 Números desconhecidos
Telefone que não casa com nenhum `usuarios.telefone` (parceiro) → resposta
genérica ("Não reconhecemos este número. Fale com o escritório.") e **nenhuma**
ação. Nunca vaza dado de caso.

### 6.5 Dedupe e `fromMe`
Ignora `data.key.fromMe === true`. Dedupe por `data.key.id` contra
`whatsapp_mensagens` para não processar o mesmo evento 2×.

---

## 7. Desenho do menu (numerado)

Sessão começa no **menu principal**. Tudo por número; "0" volta; "menu"
reinicia. Estados ficam em `whatsapp_sessoes.estado` + `contexto`.

```
[Menu principal]
Olá, Dr(a). {nome}. O que deseja?
1) Meus casos
2) Pendências de documento ({n})        -- conta solicitacoes pendentes do parceiro
3) Comentar um caso
0) Sair

-> "1": lista os casos do parceiro numerados (id curto + cliente + status).
        escolhe N -> [Menu do caso]

[Menu do caso  (contexto.caso_id setado)]
Caso {cliente} — {status}
1) Ver últimos andamentos
2) Ver/!responder comentários
3) Adicionar comentário
4) Enviar documento
5) Pendências deste caso
0) Voltar

-> "3" Adicionar comentário:
     estado=comentar; pede o texto; ao receber, INSERT em comentarios
     (autor_id = parceiro_id, caso_id do contexto); confirma.
     [reusa notify-novo-comentario p/ avisar o interno por email]

-> "2" Ver/responder: lista comentários top-level numerados; escolher N e
     responder cria reply (parent_id = N), 1 nível (igual UI).

-> "4" Enviar documento:
     estado=aguardando_midia; instrui "mande a foto/PDF agora".
     ao receber mídia: baixa da Evolution -> upload bucket documentos
     (path <caso_id>/<nome>) -> INSERT documentos. Pede o NOME do doc
     (obrigatório, igual à regra recente "nome obrigatorio em cumprir solicitacao").

[Cumprir pendência]  (a partir do menu 2 global ou 5 do caso)
Lista solicitacoes_documento pendentes do parceiro, numeradas.
Escolher N -> mostra a descrição -> "mande o documento agora" ->
recebe mídia -> upload -> INSERT documentos -> UPDATE solicitacao status='atendido'
-> confirma.
```

Regras de robustez: entrada inválida → repete o menu atual; sessão sem
atividade por 30 min → `expira_em` vence → volta ao menu na próxima mensagem.

---

## 8. Saída: quais eventos viram WhatsApp

O outbox de webhooks **já enfileira** estes eventos (triggers existentes). Para
o WhatsApp, em vez de assinar e mandar para a URL do parceiro, enfileiramos um
texto em `whatsapp_outbox` para o **telefone do parceiro do caso**:

| Evento (já existe) | Mensagem ao parceiro |
|---|---|
| `comentario` novo (interno comentou) | "Novo comentário no caso {cliente}: …" |
| `andamento.created` | "Novo andamento no caso {cliente}: {titulo}" |
| `caso.status_changed` / `caso.fase_changed` | "Caso {cliente} mudou para {status/fase}" |
| `solicitacao_documento.created` | "Solicitamos um documento no caso {cliente}: {descricao}. Responda por aqui para enviar." |
| `processo_admin.decisao` | "Decisão administrativa no caso {cliente}: {decisao}" |

Implementação — **DECIDIDO (2026-05-31): fila dedicada e desacoplada.** Triggers
próprios chamam `whatsapp_enqueue(parceiro_id, caso_id, tipo, texto)`, que
resolve o telefone do parceiro e insere em `whatsapp_outbox` **quando o parceiro
tem telefone** — independente de webhooks. NÃO derivamos de `webhook_eventos`
porque (1) `webhook_enqueue` só enfileira se o parceiro tiver um `webhook_destino`
ativo e inscrito (quase nenhum terá), e (2) "comentário novo" nem passa pelo
outbox de webhooks. Ver `sql-migrations/migration_whatsapp_outbox.sql`.

Começamos ligando **um só** evento (**comentário novo do interno**) para validar
o caminho de saída sem risco — ver Fase 1. **STATUS: Fase 1 implementada**
(migration + workflow `whatsapp/n8n-workflow-saida.json` + `whatsapp/RUNBOOK_FASE1.md`).

---

## 9. Preparado para clientes (sem retrabalho)

O ponto único que decide "quem é este telefone" é o **resolvedor de contato**.
Hoje:
```
resolve(telefone) -> usuarios where tipo='parceiro' and telefone ~ telefone
```
Amanhã, adicionar clientes é só estender a mesma função:
```
resolve(telefone) -> { tipo:'parceiro'|'cliente', id }
   1. tenta usuarios (parceiro)
   2. senão tenta clientes.telefone
```
O menu então ramifica por `tipo`. Cliente teria um menu mais restrito (ver
status do seu caso, mandar documento) e **regras de autorização próprias** —
nada do fluxo de parceiro precisa mudar. Nesta fase **não** implementamos
cliente, só garantimos que a fronteira está nesse único ponto.

---

## 10. Infra Evolution na máquina do n8n

A Naira já tem o host do n8n (`nairavian-n8n.de`). Subir a Evolution lá via
Docker, mesma rede do n8n:
```
- Container evolution-api (imagem evoapicloud/evolution-api)
- Postgres (pode ser o mesmo já usado pelo n8n, schema separado) + Redis
- Variáveis: AUTHENTICATION_API_KEY (global), DATABASE_*, REDIS_*,
  WEBHOOK_GLOBAL_URL (aponta para a Edge Function whatsapp-inbound + token)
- Porta atrás do mesmo proxy/HTTPS do n8n (subdomínio, ex evo.nairavian-n8n.de)
```
Passos: subir container → `POST /instance/create` → ler QR no celular do chip
dedicado → testar `sendText` → configurar webhook global.

Segredos guardados no **Vault** (`set_secret`): `EVOLUTION_URL`,
`EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `WHATSAPP_WEBHOOK_TOKEN`.

> Esses campos são gerenciados pela **aba "Integrações"** (UI), não por env do
> Supabase — ver [INTEGRACOES.md](INTEGRACOES.md) §7. A mesma aba também passa a
> gerenciar TI e Legalmail, e contém (em seção separada) os webhooks.

---

## 11. Decisões pendentes (confirmar com a Naira antes de codar)

1. **Chip dedicado** — DECIDIDO (2026-05-30) para a fase de teste: usar o número
   da **Naira como instância** (o "bot"/WhatsApp do escritório no Evolution) e o
   número do **marido como parceiro de teste** (cadastrado em `usuarios.telefone`).
   Trocar para uma **linha dedicada do escritório** quando for produção — não usar
   o número pessoal principal nem o que os clientes já usam, pelo risco de ban do
   Baileys. Cuidado no teste: as respostas automáticas saem do WhatsApp pessoal da
   Naira (Baileys conecta como aparelho vinculado); manter volume baixo e mensagens
   só entre os dois números.
2. **Saída — trigger duplicado ou derivar de `webhook_eventos`?** — DECIDIDO
   (2026-05-31): **fila dedicada e desacoplada** (trigger próprio →
   `whatsapp_enqueue`), porque `webhook_eventos` só existe quando o parceiro tem
   webhook assinado. Ver §8.
3. **Quais eventos de saída** entram já na Fase 4 (todos da tabela §8 ou subset).
4. **Expiração de sessão** (sugerido 30 min) e texto das mensagens (tom/marca).
5. **Documento sem caso definido**: se o parceiro manda mídia fora de um fluxo,
   o que fazer? (sugerido: pedir para escolher o caso primeiro.)
6. **LGPD**: prazo de purga de `whatsapp_mensagens` (sugerido 90 dias, igual webhooks).

---

## 12. Plano em fases (ordem de implementação)

- **Fase 0 — Infra Evolution** (§10): subir na máquina do n8n, conectar chip,
  guardar segredos no Vault, testar `sendText` manual. *Ops da Naira + Claude.*
- **Fase 1 — Saída mínima** (mais segura, sem ação destrutiva): ✅ IMPLEMENTADA
  (2026-05-31). `whatsapp_outbox` + `whatsapp_claim_batch`/`mark_result` +
  `whatsapp_enqueue` + trigger `comentario.novo` (interno→parceiro) + workflow
  n8n irmão (`whatsapp/n8n-workflow-saida.json`). Deploy: `whatsapp/RUNBOOK_FASE1.md`.
- **Fase 2 — Entrada + comentários**: Edge `whatsapp-inbound`, `whatsapp_sessoes`,
  resolvedor de contato (§6/§9), menu principal e menu do caso, ação
  **adicionar/responder comentário**.
- **Fase 3 — Documentos e solicitações**: receber mídia → upload bucket
  `documentos`; cumprir `solicitacoes_documento` (com nome obrigatório).
- **Fase 4 — Extras de saída**: andamento, status/fase, decisão administrativa.
- **Fase 5 (futuro) — Clientes**: estender o resolvedor (§9) e menu de cliente.

Cada fase é uma sessão dedicada de implementação, com sua migration SQL e/ou
Edge Function. Ver [TODO.md](TODO.md) para o checklist quando começarmos.

---

## 13. Resumo do veredito

**É viável e de baixo custo de licença.** Tudo que a Naira pediu já tem modelo
de dados e regra no app; reaproveitamos o outbox (saída) e o padrão de Edge
Function (entrada), e isolamos o provedor atrás de uma camada fina. O preço real
do "grátis" é **ops do servidor Evolution** e **risco de ban do Baileys** —
mitigáveis com chip dedicado, uso majoritariamente reativo e a opção de migrar
para Z-API/oficial trocando um arquivo.

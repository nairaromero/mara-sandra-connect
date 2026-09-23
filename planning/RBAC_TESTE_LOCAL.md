# RBAC multi-tenant — como testar no ambiente local

Branch `feat/rbac-multi-tenant`. **Tudo aqui é local**: nada foi aplicado no staging nem em
produção. O desenho está em [MULTI_TENANT_RBAC.md](MULTI_TENANT_RBAC.md); o que foi construído,
os desvios e o que falta estão no fim deste arquivo.

## 1. Subir o ambiente

Docker aberto. Da raiz do repositório:

```bash
bun run local:copiar   # banco local = cópia do staging (~3 min). Só se quiser zerar.
bun run local:rbac     # aplica as 12 migrations do RBAC + cria escritório canário, contas e QG
bun run dev:local      # app em http://localhost:8080
```

`local:rbac` é idempotente — pode rodar de novo a qualquer momento. Depois de um
`local:copiar` ele é obrigatório (a cópia vem do staging, que ainda não tem as migrations).

Dois endereços, **duas sessões separadas** (o navegador guarda o login por endereço):

| Endereço | O que é |
|---|---|
| http://localhost:8080 | o sistema do escritório |
| http://qg.localhost:8080 | o QG da plataforma (superadmin) — `*.localhost` já resolve sozinho |

## 2. Contas

**Senha de todas:** o valor de `STAGING_SYNTH_PASSWORD` no `.env.local`.

### Escritório 1 — Mara Vian Advocacia (os dados de sempre, 453 casos)

| Conta | Papel | Para ver |
|---|---|---|
| `e2e+admin@marasandraconnect.com` | Administrador | tudo, inclusive Equipe e Auditoria |
| `e2e+interno@marasandraconnect.com` | Advogado | o interno de hoje |
| `rbac+assistente@marasandraconnect.com` | **Assistente** (novo) | vê os casos; só mexe nas tarefas dele |
| `rbac+financeiro@marasandraconnect.com` | **Financeiro** (novo) | lê casos e repasses; não edita |
| `e2e+parceiro@marasandraconnect.com` | Parceiro | só os casos que indicou |

### Escritório 2 — Canário Advocacia (criado pelo QG, 4 clientes fictícios)

| Conta | Papel |
|---|---|
| `canario+admin@marasandraconnect.com` | Administrador |
| `canario+advogado@marasandraconnect.com` | Advogado |
| `canario+assistente@marasandraconnect.com` | Assistente |
| `canario+financeiro@marasandraconnect.com` | Financeiro |
| `canario+parceiro@marasandraconnect.com` | Parceiro (2 dos 4 casos) |

### Nos dois escritórios

| Conta | Papel |
|---|---|
| `rbac+duplo@marasandraconnect.com` | Parceira no escritório 1 **e** no Canário — é quem mostra o seletor |

### QG da plataforma — entrar em http://qg.localhost:8080

| Conta | Papel no QG |
|---|---|
| `qg+dono@marasandraconnect.com` | Dono (com break-glass) |
| `qg+dono2@marasandraconnect.com` | Dono — a **segunda pessoa** que a eliminação exige |
| `qg+suporte@marasandraconnect.com` | Suporte (vê painéis e pede acesso; não gerencia) |

Staff do QG **não é membro de escritório nenhum**: em `localhost:8080` essas contas caem na
tela "Você não tem acesso a nenhum escritório" — é o esperado.

> **Não use `e2e+interno` enquanto a suíte E2E roda** (duas sessões na mesma conta se derrubam).

## 3. Lista de conferência

Marque conforme for testando. Onde diz "não pode", o esperado é a tela não oferecer **e**, se
você forçar pela URL/console, o banco recusar.

### Resumo do lote de 23/09 — o que falta validar

Marque cada item na seção dele; esta tabela só resume onde está cada coisa e com que conta testar.

| # | Item do lote | Seções | Conta(s) | Estado |
|---|---|---|---|---|
| 1 | Tela do escritório para aprovar suporte | G | `canario+admin`, `qg+suporte` (QG) | **validado por Naira em 23/09** |
| 2 | Integrações INSS/DJEN/WhatsApp por escritório | L | `canario+admin` | a validar |
| 3 | Marca por escritório (+ marca Legal Connect do produto) | M, N | `canario+admin`, `canario+advogado` | a validar |
| 4 | MFA no login e QG exigindo duas etapas | O | `canario+admin`, `qg+dono` | a validar |
| 5 | Token do MCP para outra pessoa (#385) | P | `canario+admin`, `canario+advogado` | a validar |
| 6 | A tela só oferece o que o papel pode | Q | `canario+financeiro`, `canario+assistente`, `canario+advogado` | a validar |
| Base | Isolamento, papéis, equipe, dois escritórios, QG, encerrar/eliminar, glossário, paginação | A–H, J, K | várias (ver cada seção) | conferir se ainda não fez |
| Provas | Suíte E2E local: 119 testes (118 passam, 1 pulado) | I | — | rodada em 23/09 |

### A. O escritório de sempre não mudou

- [ ] Entrar como `e2e+admin`: Tarefas, Clientes (453), Agenda, Publicações, Parceiros, Equipe e Auditoria abrem como antes.
- [ ] No cabeçalho aparece **"Mara Vian Advocacia"** e o papel **"Administrador"** (antes dizia "interno").
- [ ] Abrir um caso, criar uma tarefa, concluir, criar um andamento — tudo grava.
- [ ] Entrar como `e2e+parceiro`: só os casos dele; kanban de Tarefas normal.

### B. Isolamento entre escritórios

- [ ] Entrar como `canario+advogado`: **4 clientes** (Helena, Ivo, Joana, Kleber). Nenhum cliente do escritório 1.
- [ ] Buscar em Clientes por um nome que só existe no escritório 1 → nada.
- [ ] Copiar a URL de um caso do escritório 1 (logado como `e2e+admin`) e abrir logado como `canario+advogado` → **"Caso não encontrado"**.
- [ ] Em Equipe (como `canario+admin`): só as 4 pessoas do Canário.
- [ ] Em Parceiros (como `canario+admin`): Gilda e a [RBAC] Parceira — nenhum parceiro do escritório 1.
- [ ] Cadastrar um cliente no Canário com o **mesmo CPF** de um cliente do escritório 1 → aceita (o CPF é único por escritório).

### C. Papéis novos

- [ ] `canario+financeiro`: o menu **não tem** Comercial, Processos, Publicações, Parceiros, Etiquetas; **não há** botão "Novo caso" nem "Importar Excel". Vê os 4 clientes.
- [ ] `canario+financeiro`: abrir um caso e tentar criar tarefa/andamento → o banco recusa (erro na tela).
- [ ] `canario+assistente`: consegue alterar uma tarefa **atribuída a ele**; numa tarefa do Diego, salvar não tem efeito.
- [ ] `canario+advogado`: **não** vê Equipe nem Auditoria no menu.
- [ ] `canario+advogado`: abrir um cliente → **não** há botão "Excluir cliente"; em Parceiros não há a lixeira do
      convite. Como `canario+admin`, os dois aparecem. (Decisão de 22/09: excluir é só do admin — `migration_rbac_08`.)

### D. Equipe (como `canario+admin`, em /equipe)

- [ ] A lista mostra o papel de cada um (admin, assistente, financeiro).
- [ ] Menu ⋮ da Elisa → "Tornar financeiro" → o selo muda. Voltar para "Tornar assistente".
- [ ] No seu próprio ⋮, as opções de papel ficam desabilitadas ("não de si").
- [ ] Convidar alguém com papel "Assistente" → aparece na lista (o e-mail do convite fica em http://127.0.0.1:55324).
- [ ] Convidar o e-mail `e2e+interno@marasandraconnect.com` (já tem conta no escritório 1) → "já tinha conta: foi adicionado(a) a este escritório". Entrando com essa conta, aparece o **seletor**.
- [ ] Desligar o Diego (precisa escolher quem assume as tarefas) → ele some dos ativos; Reativar devolve.
- [ ] Tentar rebaixar/desligar o **único admin** → recusado ("o escritório precisa de pelo menos um administrador ativo").

### E. Pessoa em dois escritórios (`rbac+duplo`)

- [ ] No cabeçalho aparece o **seletor de escritório** com os dois.
- [ ] Trocar para o Canário → a página recarrega e mostra só o que é do Canário (o caso do Kleber). Trocar de volta → só o do escritório 1.
- [ ] Abrir duas abas, uma em cada escritório → cada aba fica no seu (o escritório vale por aba).

### F. QG — http://qg.localhost:8080 (como `qg+dono`)

- [ ] **Escritórios**: lista os dois, com status, equipe, casos e último acesso. Nenhum nome de cliente em lugar nenhum.
- [ ] Abrir o **Canário**: cadastro, "Uso" (só contagens) e "Quem usa o sistema" (equipe e parceiros — **nunca clientes**).
- [ ] Editar o nome ou o plano → Salvar.
- [ ] **Novo escritório** (nome, slug, nome e e-mail do primeiro admin) → aparece na lista como Ativo; o convite do admin está em http://127.0.0.1:55324; ele nasce com templates e tipos de benefício padrão.
- [ ] **Suspender** o Canário (motivo obrigatório) → em outra janela, `canario+advogado` passa a ver **"Canário Advocacia está suspenso"**. **Reativar** → volta ao normal.
- [ ] **Operação**: abas Saúde, Suporte, Aprovações e Auditoria. A Auditoria lista o que você acabou de fazer.
- [ ] **Equipe do QG**: os três; trocar o papel do suporte e voltar; não dá para rebaixar a si mesma.
- [ ] Entrar no QG como `canario+admin` → **"Acesso restrito à equipe da plataforma"** (admin de escritório não é staff).
- [ ] Entrar no QG como `qg+suporte` → vê tudo, mas **não há** botões de Suspender/Encerrar/Novo escritório.
- [ ] Abrir `http://localhost:8080/qg` (host do produto) → "O QG fica em outro endereço".
- [ ] Abrir `http://qg.localhost:8080/tarefas` → volta para o QG (o produto não abre lá).

### G. Suporte: conteúdo só com aprovação do escritório

- [ ] No QG (como `qg+suporte`), abrir o Canário → **Pedir acesso de suporte** (motivo, 1 h).
- [ ] Em `localhost:8080`, entrar como `qg+suporte` → ainda **sem acesso** a nada.
- [ ] Entrar como `canario+admin` → aparece a **faixa âmbar no topo** "A equipe da plataforma pediu acesso de
      suporte a este escritório · Ver pedido". (`canario+advogado` não vê a faixa nem a aba.)
- [ ] "Ver pedido" leva a **Configurações → aba Suporte**: o pedido com quem pediu, motivo, ticket e prazo.
      **Aprovar por 1 h** → passa para "Acessos em andamento" (desde/até); a faixa do topo some na hora.
- [ ] Voltar como `qg+suporte` em `localhost:8080` → o Canário abre, com a **faixa âmbar "Sessão de suporte —
      somente leitura"**. Tentar salvar qualquer coisa → recusado.
- [ ] Como `canario+admin`, **Auditoria** → card "Plataforma e suporte neste escritório": o pedido, a aprovação
      e **cada tela que o suporte abriu** (ex.: `/casos`), com o nome de quem fez.
- [ ] Configurações → Suporte → **Encerrar agora** → o acesso some na hora para o suporte (recarregar como
      `qg+suporte`: sem escritório); o pedido vai para o Histórico como "encerrado" e a Auditoria registra.
- [ ] Novo pedido → **Recusar** → Histórico "recusado"; suporte continua sem nada. (No QG → Operação → Suporte
      o staff também pode encerrar o próprio acesso.)

### H. Encerrar e eliminar (só com escritório descartável!)

- [ ] Criar um escritório de teste pelo QG. **Encerrar** (motivo) → sai do ar.
- [ ] **Pedir eliminação dos dados** → vai para Operação → Aprovações. Como `qg+dono`, o botão diz "aguarda outra pessoa".
- [ ] Entrar no QG como `qg+dono2` → **Aprovar e eliminar** → some da lista. (No local a carência é 0 dias; em produção, 30.)
- [ ] O escritório padrão (Mara Vian) **não** tem botão de Suspender nem de Encerrar.

### J. Glossário (qualquer conta; `/glossario` e, no QG, `/qg/glossario`)

- [ ] Na sidebar, **Glossário** (ao lado de Configurações) abre a página com busca e as categorias.
- [ ] Buscar `assistente` → o card **Assistente** aparece com "O que pode no escritório" e as permissões
      **lidas do banco** (ex.: "Criar, editar e concluir tarefas" com o selo "só o que está atribuído a mim").
- [ ] Buscar `captador` (sinônimo) → acha **Parceiro**. Buscar `trilha de auditoria` (texto de uma permissão)
      → acha só **Administrador**.
- [ ] Buscar algo inexistente → "Nenhum termo com …", sem categoria vazia.
- [ ] Num card, clicar num link de "Veja também" → limpa a busca e rola até o termo.
- [ ] O card do **seu** papel traz o selo "seu papel" (entre como `canario+financeiro` e busque `financeiro`).
- [ ] Como `e2e+parceiro`: sem a categoria **Ambientes e técnica**, sem "Token do MCP" nem "Equipe";
      o "Veja também" do Administrador não oferece o que o parceiro não vê.
- [ ] Mandar link com a busca: `http://localhost:8080/glossario?q=repasse` abre já filtrado.
- [ ] No QG (`qg+dono`): **Glossário** no menu; categoria **Plataforma e QG** vem primeiro, com Break-glass,
      Eliminação e os papéis do QG (Dono com "seu papel").
- [ ] Trocar o papel de alguém em Equipe e voltar ao glossário → a lista de permissões acompanha (é do banco).

### K. Paginação e listas sem corte (QG e produto)

Padrão em toda lista longa: rodapé **"1–25 de 32"**, botões primeira / anterior / números / próxima /
última e o seletor de itens por página (10 · 25 · 50 · 100). Só a página escolhida é buscada no banco;
o tamanho escolhido fica lembrado por lista neste navegador.

- [ ] QG → **Escritórios**: busca e filtro de status acima; rodapé "1–N de M escritórios". Buscar `canár`
      (com acento) → só o Canário, "1–1 de 1".
- [ ] QG → ficha do **Mara Vian** → "Quem usa o sistema (34)": mostra **10**, rodapé "1–10 de 34 pessoas";
      **›** → "11–20 de 34" (o número 2 fica marcado); **»** → última página e o › desabilita; trocar
      para **25** por página → "1–25 de 34". Buscar `rbac+financeiro` → "1–1 de 1". Filtro "Desativados"
      lista só desativados; "Todos" inclui todos.
- [ ] QG → Operação: continua abrindo normal (usa a lista leve de nomes).
- [ ] **Publicações** (como `e2e+admin`): "1–50 de 389 publicações"; › → "51–100"; » → última página.
- [ ] **Conversas**: "1–25 de N conversas" (conta conversas, não comentários); ao abrir uma conversa a
      thread vem inteira. Responder **mantém** a página; "Nova conversa" volta pra página 1.
- [ ] **Processos**: badges do topo (ex.: "1684 processos · 278 administrativos · 1406 judiciais") batem
      com o banco — a spec cria 1.100 processos temporários pra provar que não trava em 1.000. A tabela
      pagina no navegador (25 por página, seletor 25/50/100).
- [ ] **Clientes**: mesmo paginador (10 por padrão), no lugar do "Anterior / Próxima" antigo.
- [ ] **Auditoria**: 25 por página; os cards Leituras/Escritas contam o **total** do período (banco).
- [ ] Processos → **Movimentações**: 25 por página, com total.
- [ ] Em qualquer lista: trocar o tamanho da página volta pra página 1; mudar filtro/busca também.

### L. Integrações por escritório (Gmail do INSS, DJEN, WhatsApp)

Cada escritório tem as suas: a caixa do INSS conectada, as OABs monitoradas e a instância do WhatsApp.
As rotinas (cron/n8n) rodam **uma vez por escritório**, cada uma presa ao seu. No local não há Google,
DJEN nem Evolution de verdade — o que dá pra conferir é a configuração, o isolamento e o webhook.
**Pré-requisito local:** a chave que cifra segredos precisa existir nas functions — `supabase/functions/.env`
(gitignored) com `IA_MASTER_KEY=<base64 de 32 bytes>` — gere com `openssl rand -base64 32`; a pilha lê o arquivo ao subir
(`bunx supabase stop && bunx supabase start`). Chave só de desenvolvimento: o que for cifrado com ela só abre aqui.
Sem ela, salvar a chave do WhatsApp devolve "não consegui cifrar" e a spec correspondente é pulada.

- [ ] Como `canario+admin` → Configurações → **Integrações**: os cards **Gmail (INSS)** ("nenhuma caixa
      conectada neste escritório") e **WhatsApp (Evolution)** ("não configurado"). Como `canario+advogado`
      a aba Integrações nem aparece.
- [ ] WhatsApp: preencher URL (`https://evo.exemplo.com`), instância (`canario`), chave qualquer → **Salvar**
      → badge "ativo"; a chave some do campo e aparece "definida em …" (ela fica cifrada; nem o admin a
      relê). **Gerar token** → a URL do webhook aparece com o token; **Copiar**.
- [ ] **Testar conexão** → "Falhou: não alcancei o Evolution" (esperado no local, não há servidor).
- [ ] Como `e2e+admin` (escritório 1) → Integrações → WhatsApp "não configurado" (a do Canário não aparece).
- [ ] Simular o Evolution (terminal): `curl -X POST "http://127.0.0.1:55321/functions/v1/whatsapp-inbound?token=<token>"
      -H 'content-type: application/json' -d '{"event":"messages.upsert","instance":"canario","data":{"key":{"remoteJid":"5511999990000@s.whatsapp.net","fromMe":false,"id":"teste-1"},"message":{"conversation":"oi"},"messageType":"conversation"}}'`
      → `{"ok":true}`; com token errado ou instância desconhecida → 401. No banco:
      `select escritorio_id from whatsapp_mensagens where evolution_message_id='teste-1'` = o Canário.
- [ ] Gmail: **Conectar Gmail** só funciona com as credenciais do Google no staging — aqui basta ver que o
      botão está lá e que o card fala do escritório. (No staging: conectar com a caixa do Canário e rodar
      `inss-email-processor` como admin do Canário: só os casos do Canário recebem andamentos.)
- [ ] DJEN: `oabs_monitoradas` tem `escritorio_id`; a rotina só processa escritórios com OAB ativa. Se
      quiser ver o loop: `select escritorio_id, count(*) from oabs_monitoradas where ativo group by 1`.



### M. Marca Legal Connect (produto) × marca do escritório

- [ ] `http://localhost:8080/login` (deslogado): logo **Legal Connect** (dois anéis) e o texto "Gestão de casos
      previdenciários para escritórios e parceiros" — nada do Mara Sandra Vian. Idem em "Esqueci a senha" e na
      tela de criar senha do convite.
- [ ] Aba do navegador: título **Legal Connect** e o favicon com os anéis.
- [ ] Logado em qualquer escritório: o topo continua com a marca do escritório; no **rodapé da sidebar** aparece
      "por Legal Connect" (só o ícone quando a sidebar está recolhida).
- [ ] QG (`qg.localhost:8080`): logo Legal Connect em fundo escuro + selo "QG" no cabeçalho.
- [ ] Mailpit (http://127.0.0.1:55324): convidar alguém → o e-mail chega com o cabeçalho **Legal Connect** e o
      rodapé "Legal Connect · marasandraconnect.com" (o corpo ainda cita o escritório padrão — item 3, marca por
      escritório).
- [ ] Instalar como app (Chrome → Instalar): nome e ícone Legal Connect.

### N. Marca por escritório (Configurações → Escritório)

O topo do sistema, os e-mails e as mensagens usam a marca **do escritório ativo** (nome de exibição, logo, cor
— `escritorio_config.marca`). O seed dá ao Canário um logo SVG verde; o escritório 1 continua com o de sempre.

- [ ] Como `canario+admin`: o topo e a sidebar mostram o logo verde **"Canário Advocacia"** (não mais o Mara
      Sandra Vian). Recolher a sidebar → iniciais "CA" num quadrado verde.
- [ ] Configurações → **Escritório** (aba nova, só admin): prévia, nome de exibição, cor e logo. Trocar o nome
      para "Canário & Associados" e a cor → **Salvar** → o topo muda na hora, sem recarregar.
- [ ] **Trocar logo** com um PNG/SVG seu (até 1 MB) → o topo mostra o novo; a URL é pública
      (`…/storage/v1/object/public/marcas/<id>/logo.png`). **Remover logo** → o nome aparece em texto, na cor.
- [ ] Como `e2e+admin` (escritório 1): tudo igual a antes (logo Mara Sandra Vian); a aba Escritório mostra a marca
      dele. Como `canario+advogado`: a aba não existe.
- [ ] Convidar alguém pelo Canário (Equipe → Convidar): o convite leva o nome do escritório (no local dá pra
      conferir em `auth.users.raw_user_meta_data->>'escritorio_nome'`; o Mailpit local mostra o template padrão do
      Supabase porque o `send-email-hook` só está ligado no Auth do staging/produção — lá o assunto vira
      "Você foi convidado(a) - Canário Advocacia" e o corpo cita o escritório, com cabeçalho e rodapé Legal Connect).
- [ ] `qg+suporte` em sessão de suporte no Canário vê a marca do Canário no topo (a faixa âmbar continua).

### O. Verificação em duas etapas (MFA) e o QG

Qualquer pessoa pode ativar o segundo fator (aplicativo autenticador) em **Configurações → Segurança**; quem tem,
digita o código depois da senha. O QG **exige** (`app_config.qg_exigir_aal2`): nasce ligado no staging/produção
(`migration_rbac_11`) e desligado no local pelo seed — pra ensaiar, ligue com
`node scripts/msc-sql.mjs --local "update app_config set valor='true' where chave='qg_exigir_aal2'"`
(e volte pra `'false'` no fim). Precisa de um app autenticador no celular (Google Authenticator, Authy, 1Password…).

- [ ] Como `canario+advogado` → Configurações → **Segurança** → card "Verificação em duas etapas: não ativa" →
      **Ativar** → QR + chave → ler no app → digitar o código → "ativa desde …".
- [ ] Sair e entrar de novo com `canario+advogado`: depois da senha aparece **"Verificação em duas etapas"**;
      código errado → "Código inválido ou expirado"; código certo → entra.
- [ ] Segurança → **Desativar** → (pede o código se a sessão ainda não o digitou) → "não ativa". Entrar de novo:
      sem etapa do código.
- [ ] QG com a exigência ligada (comando acima): `http://qg.localhost:8080` como `qg+suporte` → tela **"O QG exige
      verificação em duas etapas"** com QR e chave → código → **Ativar e entrar** → lista de escritórios abre.
      Sair e entrar: pede o código antes do QG. Sem código, as funções do QG recusam no banco (não é só tela).
- [ ] QG → Equipe do QG e a lista de escritórios ("admins sem verificação em duas etapas") passam a refletir quem
      tem o fator.
- [ ] Desligar a exigência de novo (`'false'`) e remover o fator do `qg+suporte` (Segurança → Desativar), pra não
      travar o resto dos testes.



### P. Token do MCP para outra pessoa (#385)

Só quem concede o MCP (admin, `ia:mcp_conceder`) emite tokens — para si ou para qualquer pessoa ativa do
escritório. O token roda **como a pessoa** (o Claude dela vê o que ela vê no sistema); o emissor precisa seguir
admin. Quem vê e revoga: o dono e o emissor — outro admin não vê.

- [ ] Como `canario+admin` → Configurações → Integrações → **Conectar Claude / ChatGPT**: o campo **"Para quem"**
      lista as pessoas do Canário (Para mim, Gilda · Parceiro, Elisa · Assistente, …).
- [ ] Escolher **Gilda Moura (parceira)**, "Somente leitura", **Gerar token** → o token aparece uma vez com o aviso
      "Token de Gilda…: envie a essa pessoa". Na lista: "Claude de Gilda… · de Gilda Moura".
- [ ] Usar o token (terminal, simulando o Claude):
      `curl -s -X POST http://127.0.0.1:55321/functions/v1/ia-mcp -H "Authorization: Bearer <token>" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"buscar_casos","arguments":{"limite":10}}}'`
      → só os casos da Gilda (Helena e Ivo), nunca Joana/Kleber. Em Auditoria (banco: `ia_acoes`) fica
      `usuario_id` = Gilda e `emitido_por` = admin.
- [ ] Como `canario+advogado`: a aba Integrações não existe, e pela API `token_criar` responde 403.
- [ ] Promover Diego (advogado) a admin em Equipe → como `canario+advogado`, o card não mostra o token da Gilda
      (foi outro admin que emitiu). Rebaixar de volta.
- [ ] **Revogar** o token da Gilda → o curl acima responde 401. Emitir de novo, rebaixar/desligar o emissor → 403.



### Q. A tela só oferece o que o papel pode (limpeza fina dos botões)

O banco já barrava tudo isto desde a Fase 5; o que muda é que a tela deixou de oferecer o botão que ia
falhar. Regra: ação de escrita aparece só com `isInterno && pode("permissão")`; página de gestão confere a
permissão além do tipo. Nada mudou para o parceiro (a tela dele é outra).

- [ ] Como `canario+financeiro` (só `casos:ler` + `repasses:ler`) → abrir o caso do **Kleber**: sem o menu
      "Ações do caso" (⋯), sem Telefone/E-mail do cliente, sem bloco da senha do INSS, sem "Excluir cliente";
      aba Documentos sem envio, renomear ou lixeira; aba Processos sem "Novo" (administrativo e judicial), sem o
      menu ⋯ de cada processo e sem a busca no Legalmail. Como `canario+advogado` tudo isso volta.
- [ ] Ainda como financeiro: **/comercial** e **/etiquetas** mostram "Área restrita a quem gerencia…";
      **/processos**, **/casos/novo**, **/publicacoes** e **/parceiros** devolvem para /casos; **Agenda** abre,
      mas sem "Novo evento"; **Clientes** sem o botão "Perícia" na linha.
- [ ] Como `canario+assistente`: no caso do Kleber há "Ações do caso", Telefone, envio e renomear de documento
      — mas **não** a lixeira do documento (`documentos:excluir` é de advogado/admin). /comercial e /etiquetas
      fecham; /processos abre.
- [ ] Como `canario+advogado`: Publicações → "Vincular" aparece; Etiquetas e Comercial abrem. Como
      `canario+parceiro`: nada diferente de antes (nenhum botão interno vazou para a tela do parceiro).



### I. Provas automáticas (rodar e conferir os números)

```bash
bun run e2e:local                                         # suíte inteira: 119 testes (1 pulado no local: assunto do convite)
bun run e2e:local e2e/tests/rbac-isolamento.spec.ts       # 16 ataques entre os dois escritórios
bun run e2e:local e2e/tests/rbac-edge-functions.spec.ts   # 7 ataques nas edge functions
bun run e2e:local e2e/tests/glossario.spec.ts             # 3: busca, permissões do banco, parceiro
bun run e2e:local e2e/tests/qg-paginacao.spec.ts          # 2: página/total/busca na API e na tela do QG
bun run e2e:local e2e/tests/listas-carregar-mais.spec.ts  # 3: 1.100 processos contados; publicações e conversas paginadas
bun run e2e:local e2e/tests/suporte-escritorio.spec.ts    # 2: aviso + aba Suporte (aprovar/encerrar/recusar) e trilha na Auditoria
bun run e2e:local e2e/tests/integracoes-escritorio.spec.ts # 3: WhatsApp por escritório (segredo cifrado, isolamento, webhook), Gmail status
bun run e2e:local e2e/tests/marca-escritorio.spec.ts       # 3: nome/cor/logo pelo admin, topo acompanha; advogado recusado; convite com o nome do escritório (assunto só onde o hook está ligado)
bun run e2e:local e2e/tests/mfa.spec.ts                   # 2: código no login e desativar em Segurança; QG exige AAL2 (cadastro pela tela, código TOTP calculado na spec)
bun run e2e:local e2e/tests/mcp-terceiro.spec.ts          # 4: emitir para parceiro/assistente (MCP roda como o dono), não-admin não emite, dono/emissor veem, revogar e emissor rebaixado
bun run e2e:local e2e/tests/marca-legal-connect.spec.ts   # 2: marca do produto no login/QG/rodapé; marca do escritório no topo
bun run e2e:local e2e/tests/rbac-telas.spec.ts            # 3: financeiro, assistente e advogado no mesmo caso — a tela oferece só o que o papel pode
```

- [ ] 119 passam. Os 23 do RBAC são ataques via API com a sessão real de cada papel: header
      forjado, filho apontando para pai de outro escritório (inclusive com service role), RPC
      com id alheio, vínculo desativado com o JWT ainda válido, staff lendo tabela de domínio,
      suporte escrevendo, eliminação sem segunda pessoa.

## 4. O que foi construído

| Camada | O quê |
|---|---|
| Banco — `migration_rbac_01…05` | `escritorios`, `membros`, 5 papéis × 26 permissões (matriz §4.3); `escritorio_id NOT NULL` em 41 tabelas com herança por gatilho; 41 policies restritivas de isolamento + 58 de permissão; helpers de papel sobre o vínculo; guard de escritório nas RPCs; equipe sobre vínculos (`definir_papel`); QG (`plataforma_staff`, `acessos_suporte`, `auditoria`, `ops.*`, 22 funções `qg_*`) |
| Front | header `x-escritorio-id` em toda chamada; escritório ativo, vínculos e permissões no `useAuth` (`pode()`); seletor; faixa de suporte; tela "sem escritório"; menu por permissão; Equipe por papéis; QG em `/qg` (só no host `qg.`); **Configurações → Suporte** (aprovar/recusar/encerrar acesso de suporte) + aviso no topo para o admin + trilha "Plataforma e suporte" na Auditoria (`migration_rbac_07`) |
| Edge functions | `exigirUsuario` por vínculo e escritório; `exigirRecurso`; client de service role preso ao escritório (`escopado`, que também carimba `escritorio_id` nas linhas novas) no digest, e-mails do INSS e DJEN; convite por escritório e papel; MCP no escritório do token; `qg-escritorios`; **integrações por escritório** (`migration_rbac_09`): caixa do INSS ligada ao escritório e `inss-email-processor` rodando por escritório; `sync-djen-publicacoes` por escritório com OAB (publicação única por escritório); `escritorio_integracoes` + `integracoes-escritorio` (WhatsApp: instância, chave cifrada, token de entrada, teste) e `whatsapp-inbound` resolvendo o escritório pela instância |
| Paginação | `<Paginador>` (1–25 de N · « ‹ 1 2 › » · itens por página) + `useListaPaginada`/`usePaginaLocal`: QG (escritórios e pessoas, 10, busca sem acento e filtro no banco — `migration_rbac_06`), Publicações (50), Conversas (25 threads, RPC `conversas_threads`), Movimentações, Auditoria, Processos e Clientes; `/processos` carrega até o fim e reduz o último andamento no banco (`processos_ultimo_andamento`) — nada mais usa `.limit(n)` fixo pra listar tudo |
| MCP para terceiro (#385) | `ia_tokens.emitido_por` (`migration_rbac_12`); `ia-config` emite para uma pessoa escolhida (só `ia:mcp_conceder`), lista/revoga o que é do dono ou do emissor; `ia-mcp` roda como o dono e exige emissor admin ativo; card Conectar Claude com "Para quem" |
| MFA (duas etapas) | Cadastro do autenticador (TOTP) em Configurações → Segurança, etapa do código no login e na entrada do QG (`migration_rbac_11` liga `qg_exigir_aal2` fora do local); `private.exigir_staff` já recusava AAL1 no banco. Pré-requisito no Supabase: MFA TOTP habilitado no Auth do projeto |
| Marca por escritório | `escritorio_config.marca` (nome de exibição, logo, cor) editada em Configurações → Escritório (`migration_rbac_10`: bucket público `marcas`, RPC `escritorio_definir_marca`, vínculos devolvem a marca); topo e sidebar (`<MarcaEscritorio>`), e-mails de andamento/comentário/solicitação/digest (`_shared/marca.ts`) e o convite (`send-email-hook` lê `escritorio_nome` do `user_metadata`) usam a marca do escritório |
| Marca | `public/marca/` (SVG vetorial + PNG para manifest/apple-touch/e-mail) e `<MarcaLegalConnect>`: login, esqueci/criar senha, favicon, título, manifest, cabeçalho do QG, rodapé da sidebar e cabeçalho dos e-mails do Auth. A marca do escritório continua no topo, dentro do sistema |
| Glossário | `/glossario` (produto) e `/qg/glossario` (QG): busca por nome, sinônimo, definição e permissão; os cards de papel mostram as permissões **lidas do banco**; termos em `src/lib/glossario/termos.ts` (76), com público por termo (todos / equipe / QG) |
| Provas | `rbac-isolamento` (16), `rbac-edge-functions` (7), `glossario` (3), `scripts/rbac-diff-visibilidade.mjs` (o escritório 1 vê exatamente as mesmas linhas de antes) |

### Como funciona, em uma frase

O navegador diz em que escritório está (`x-escritorio-id`); o banco **confere o vínculo** e só então
aceita — `private.escritorio_ativo()`. Uma policy restritiva por tabela prende toda consulta a esse
escritório, e as 143 policies que já existiam continuam decidindo o resto, intactas. Por isso o
escritório 1 não mudou, e forjar o header não abre nada.

### Desvios do plano (decididos com a suíte E2E na mão)

1. **FK simples + gatilho, em vez de FK composta.** O PostgREST não resolve embed por nome de
   coluna (`cliente:cliente_id(...)`, ~35 usos) sobre FK composta, e a simples ao lado da composta
   deixa ambíguo todo embed por tabela. O gatilho de herança valida o pai em INSERT e UPDATE, para
   qualquer role — mesma garantia. Volta a ser FK composta quando os embeds migrarem para hint.
2. **Escritório ativo por header**, e não "todos os meus escritórios": as telas ficam escopadas
   sem tocar nas ~100 consultas do front, e trocar de escritório é trocar o header.
3. **Funções do QG em `public` com prefixo `qg_`**, e não num schema `plataforma` exposto — para
   não depender de configuração do PostgREST por ambiente. Continua sendo só função, nenhuma tabela.

### Falhas antigas que apareceram e foram fechadas no caminho

- `aplicar_template` não conferia **nada**: criava tarefa em qualquer `caso_id`.
- 10 policies (agenda, comentários, tarefas, templates) e 6 edge functions decidiam por
  `usuarios.tipo` **sem olhar `ativo`** — pessoa desligada ainda passava.
- `excluir_cliente` e as três RPCs da senha do MEU INSS, idem.
- Compartilhar a chave de IA descompartilhava a de todo mundo (sem filtro); a chave compartilhada
  era "a do banco", não a do escritório.

## 5. O que falta (não bloqueia o teste local)

| Item | Por quê ficou |
|---|---|
| **Legalmail e TI por escritório** | A tabela `escritorio_integracoes` já aceita os tipos; as functions dessas duas ainda usam as credenciais globais (escritório 1) |
| **n8n: fila do WhatsApp por escritório** | O workflow que drena `whatsapp_outbox` precisa ler a instância/chave em `escritorio_integracoes` pelo `escritorio_id` da linha (hoje usa uma instância só) |
| **Botões que a tela ainda oferece a papéis novos** | O banco barra (testado), mas o financeiro ainda vê, por exemplo, "Perícia" na linha do cliente. A limpeza fina das telas é o codemod da Fase 5 |
| **Colunas antigas de `usuarios`** (`tipo`, `eh_admin`, `ativo`…) | Seguem sincronizadas para o código antigo; nenhuma decisão de acesso as lê mais. Sair é a Fase 7 |
| **pgTAP no CI** | As provas estão em Playwright (API). O harness pgTAP e o CI obrigatório são a Fase 1 do plano |

## 6. Antes de ir para o staging

Nada disto foi aplicado fora do local. Para o staging: as 12 migrations com
`node scripts/msc-sql.mjs --staging --file …` **na ordem**, deploy das 26 edge functions alteradas
(+ `qg-escritorios`), e só então o front. Como a #02 mexe em 41 tabelas, vale ensaiar de novo numa
cópia fresca (`bun run local:copiar && bun run local:rbac`) no dia — leva ~4 min.

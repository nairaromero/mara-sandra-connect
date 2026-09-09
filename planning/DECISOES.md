# Decisões e trade-offs — Mara Sandra Connect

> Registro único das decisões que moldaram o sistema, com o **porquê** de cada
> uma: o contexto da época, as alternativas consideradas, o que pesou, o que
> custou e quando vale revisitar. Serve como estudo de caso — pra quem chega
> depois entender por que o sistema é assim, e não só como é.
>
> Complementa [ARQUITETURA.md](ARQUITETURA.md) (o que existe) e
> [TODO.md](TODO.md) (o que falta). Ordem: por área, cronológica dentro de cada.
> Revisado em 2026-08-23.

Formato de cada decisão: **Contexto → Opções → Decisão → O que pesou → O que
custou → Revisitar quando**. "Custou" é o preço que estamos pagando de fato, não
risco teórico.

---

## 1. Produto e modelo

### D1 · Cliente final não loga (2026-05)

- **Contexto.** O escritório atende segurado do INSS via parceiros (escritórios
  menores) e direto. O segurado típico tem pouca familiaridade digital e contato
  esporádico com o caso.
- **Opções.** (a) Portal do cliente com login; (b) cliente sem login — o
  parceiro e o escritório operam por ele; comunicação por WhatsApp/e-mail.
- **Decisão.** (b). Só **interno** e **parceiro** têm conta.
- **O que pesou.** Cada papel com login é uma superfície de suporte, RLS e
  onboarding. O parceiro já é o ponto de contato do segurado; duplicar isso no
  app não reduzia trabalho de ninguém.
- **O que custou.** Tudo que o cliente precisa saber passa por alguém. A "senha
  MEU INSS" do cliente fica guardada (cifrada) no sistema, porque é o
  escritório que acessa o portal do INSS por ele.
- **Revisitar quando.** Houver demanda real de cliente acompanhar o próprio
  caso — e aí começar por leitura, nunca por escrita.

### D2 · Frontend fala direto com o Supabase, sem backend intermediário (2026-05)

- **Opções.** (a) API própria entre app e banco; (b) supabase-js no browser,
  segurança por RLS, lógica sensível em edge functions.
- **Decisão.** (b).
- **O que pesou.** Uma pessoa desenvolve e opera. Uma camada a menos pra
  escrever, deployar e depurar. RLS força a regra de acesso a viver no banco —
  vale pra UI, pra IA e pra qualquer cliente futuro.
- **O que custou.** Toda regra de acesso precisa estar certa **no banco**; erro
  de policy vaza dado. Pegadinhas que já doeram: PostgREST trunca em 1000
  linhas sem avisar; service role precisa de GRANT explícito em tabela nova.
- **Revisitar quando.** Aparecer lógica que não cabe em SQL/edge function (ex.:
  processamento pesado, fila com estado).

### D3 · Papel comercial separado do modo de acesso (2026-08-10)

- **Contexto.** "Parceiro" significava duas coisas: *como a pessoa entra*
  (visão restrita) e *com quem o escritório divide honorário*. Um interno podia
  ser parceiro comercial; um parceiro comercial podia nem ter conta.
- **Decisão.** `usuarios.tipo` (interno × parceiro) = modo de acesso;
  `usuarios.eh_parceiro` = papel comercial. Em 2026-08-19 entrou o terceiro
  eixo, `eh_admin` (só Naira e Mara): gestão da equipe, webhooks, auditoria,
  integrações.
- **O que pesou.** Os dois conceitos já divergiam nos dados; forçar um só campo
  gerava casos especiais no código.
- **O que custou.** Três flags pra raciocinar em cada tela e policy. Está
  documentado no CLAUDE.md pra não se perder.

---

## 2. Fontes de dados judiciais e administrativas

### D4 · TI e Legalmail só leitura; match por CPF e por nome fuzzy (2026-05-27)

- **Contexto.** Os dados viviam no Tramitação Inteligente (TI, administrativo
  INSS) e no Legalmail (judicial). O app precisava deles sem virar mais uma
  fonte de verdade concorrente.
- **Decisão.** O app **nunca escreve** nos dois. Match TI por **CPF**;
  Legalmail por **nome fuzzy** (a API não expõe CPF); ambíguo vira **órfão**
  pra triagem humana, nunca auto-vincula.
- **O que pesou.** Vínculo errado entre processo e cliente é o pior erro
  possível num escritório (peça no processo errado). Órfão é barato de
  resolver; vínculo errado é caro de descobrir.
- **O que custou.** Fila de publicações órfãs que precisa de gente (ver §7.1
  do ARQUITETURA: 96 pertencem a processos já cadastrados — o risco real é
  o processo **não** cadastrado, e esse a fila não resolve).

### D5 · Sair do TI por MVPs, não por big-bang (2026-06-15 → desligado 2026-08-11)

- **Contexto.** O TI cobria duas coisas: feed administrativo do INSS (único
  canal automatizado, via scraping autenticado) e gestão operacional
  (tarefas/prazos/agenda), esta sem API de criação — obrigava operar no Chrome.
- **Opções.** (a) Manter o TI e integrar; (b) substituir tudo de uma vez;
  (c) substituir por MVPs a parte de UX ruim e manter o TI como feed read-only
  até decidir.
- **Decisão.** (c). MVP1 pipeline INSS por e-mail, MVP2 tarefas/kanban, MVP3
  prazos/perícias — entregues. O feed do TI virou desnecessário quando o e-mail
  do INSS passou a ser lido direto; o TI foi **desligado em 2026-08-11**, antes
  do previsto. MVP4 (Google Calendar) e MVP5 (mobile/push) seguem abertos.
- **O que pesou.** Cada MVP entregava valor sozinho e reduzia dependência sem
  exigir que tudo estivesse pronto.
- **O que custou.** Migração de dados (D6) e 77 clientes sem CPF que não
  puderam migrar. Os planos originais (SUBSTITUIR_TRAMITACAO, INTEGRACOES,
  MIGRACAO_TI) foram removidos em 2026-08-23; ficam no histórico do git.

### D6 · Migração do TI: caso automático, extras em JSON, só clientes com tag (2026-07-20)

- **Decisão.** Todo cliente migrado ganha 1 caso `a_definir` (andamento exige
  caso); campos extras do TI vão íntegros pra `clientes.ti_dados` (jsonb);
  primeira leva só clientes **com tag** (360 de 749); parceiros mapeados por tag
  `PARCERIA_*`, idempotente.
- **O que pesou.** Schema do app é mais estrito que o TI; guardar o que não
  cabe em JSON evita perda e adia decisão de coluna até a UI precisar.
- **O que custou.** Casos "a definir" que precisaram ser classificados depois
  (feito por etiqueta em agosto). Fuso: timestamps do TI sem offset eram
  horário local — custou correção e entrou como pegadinha.

### D7 · Judit descartada; autos via MNI em conector local (2026-07-29)

- **Contexto.** Faltava só uma coisa que DataJud + DJEN não dão de graça:
  inteiro teor dos autos (PDFs de petições).
- **Opções.** (a) Judit, ~R$ 1.000/mês; (b) consultar manualmente no PJe;
  (c) webservice MNI oficial do CNJ (SOAP), grátis, com credencial do advogado.
- **Decisão.** Descartar a Judit (R$ 12k/ano pelo que já existe). Piloto do MNI
  como **conector local** na máquina da Naira: credenciais nunca saem do
  `.env.local`; a nuvem recebe só os PDFs.
- **O que pesou.** Custo × volume do escritório; e a credencial do PJe não
  deveria viver na nuvem.
- **O que custou.** Piloto parado esperando senha do PJe; TRF1/TRF3 exigem
  credenciamento; TJSP (e-SAJ) não tem MNI. Código da Judit fica no histórico
  (commit `14028ee`) se a conta mudar.
- **Revisitar quando.** Volume crescer muito, ou consulta manual de autos virar
  gargalo de horas.

### D8 · Descoberta por OAB não auto-cria caso; prazos D+1 e fatal−1 (2026-07-28/29)

- **Decisão.** Publicação encontrada pela OAB sem processo cadastrado vira
  **órfã pra triagem**, nunca caso novo. Publicação gera ciência **D+1** e,
  havendo prazo, tarefa com **fatal − 1**.
- **O que pesou.** Mesmo princípio de D4: automação cria trabalho de revisão,
  não decisão jurídica. A margem de um dia no prazo é seguro barato contra
  contagem errada.

---

## 3. Comunicação com parceiros

### D9 · WhatsApp com Evolution/Baileys no número pessoal — e a pausa (2026-05 → pausado 2026-08-21)

- **Contexto.** Parceiro queria comentar, anexar e cumprir solicitação sem
  abrir o app. A única opção grátis era Evolution API (Baileys, não oficial).
- **Decisão inicial.** Implementar fases 1–3 (saída com fila, entrada com menu,
  mídia) no número pessoal da Naira, pra validar.
- **O que custou.** Três problemas com a mesma raiz (número pessoal + provedor
  não oficial): conversas pessoais gravadas no banco (limpas: 70 mensagens de 9
  contatos), instabilidade de descriptografia multi-dispositivo e risco de ban
  do número pessoal. A instância caiu (HTTP 500 desde 12/08); a fila acumulava
  falha em silêncio.
- **Decisão de 2026-08-21.** **Pausar a saída**: trigger
  `trg_whatsapp_comentario_novo` desabilitado, pendentes cancelados, histórico
  preservado (62 enviadas, 123 recebidas). Nenhum parceiro tinha sido avisado
  da funcionalidade; o aviso por e-mail segue intacto.
- **Decisão pendente.** Linha dedicada — chip + Evolution (grátis, mesmo risco
  de ban) ou API oficial (custo por mensagem, estável). Ver
  [whatsapp/PLANO_LINHA_DEDICADA.md](whatsapp/PLANO_LINHA_DEDICADA.md).
- **Lição.** Integração não oficial num número pessoal não é "teste barato":
  o custo apareceu em privacidade, não em dinheiro.

### D10 · Webhooks de saída construídos, nunca usados (2026-05-30)

- **Contexto.** Módulo completo (HMAC, retry, tela, workflow n8n) pra parceiro
  receber eventos. Hoje: 0 destinos cadastrados.
- **Lição.** Construído antes da demanda. Fica registrado em §11 do
  ARQUITETURA como superfície morta pra ninguém investir nele sem pedido.

---

## 4. Documentos e Drive

### D11 · Conta Google única do escritório; credenciais do Picker hardcoded (2026-08-05)

- **Contexto.** Sem Google Workspace (contas @gmail avulsas). O OAuth do Drive
  está em modo *Testing*: só "test users" autorizam.
- **Opções.** (a) Cada pessoa com a própria conta Google; (b) uma conta do
  escritório, usada por todos no popup do Google.
- **Decisão.** (b). Dono das pastas é o escritório; alguém sair não deixa pasta
  órfã. O rastro de *quem* mexeu fica na auditoria do Connect, não no Drive.
- **Credenciais hardcoded** em `src/lib/google-drive.ts`, sem env var: o
  Vite/Cloudflare injetava `VITE_GOOGLE_CLIENT_ID` truncado e o tree-shaking
  removia o fallback. São credenciais públicas por design (Picker roda no
  browser); a proteção real são as origens autorizadas e as restrições da API
  key no Google Cloud.
- **O que custou.** Drive só funciona em origem cadastrada no Google Cloud —
  produção e, se cadastrada, `staging.marasandraconnect.com`. Rotação de
  credencial = commit.

---

## 5. IA

### D12 · IA BYOK, só pra interno, nunca apaga (2026-06 → 2026-08)

- **Opções.** (a) Chave de IA do escritório, custo centralizado; (b) cada
  usuário cola a própria chave (BYOK), cifrada no banco.
- **Decisão.** (b), com duas superfícies (chat in-app e MCP pro Claude
  externo) sobre o mesmo núcleo de tools com RLS. Escrita só com confirmação;
  **deleção nem existe como tool**. Desde 2026-08-19, IA e integrações
  aparecem só pra `tipo='interno'`; os cards de configuração, só pra admin.
- **O que pesou.** LGPD: dado de cliente de um parceiro não deve passar pela
  chave (e pelo provedor) escolhido pelo escritório sem base clara; BYOK
  empurra a decisão e o custo pra quem usa. "Nunca apaga" limita o pior caso de
  uma tool mal usada.
- **O que custou.** Onboarding de IA por pessoa; checklist LGPD de IA ainda
  aberto (INTEGRACAO_IA.md).

---

## 6. Infra, ambientes e processo

### D13 · Bancos de produção e staging separados; espelho anonimizado semanal (2026-08-03)

- **Contexto.** Um projeto Supabase pra tudo: E2E e dev rodavam em produção com
  marcador `[E2E]` e cleanup. Já houve perda por cascade delete com CPF de
  teste que colidiu com cliente real.
- **Opções.** (a) Continuar no banco único com disciplina; (b) staging com
  dados sintéticos; (c) staging = espelho de produção anonimizado.
- **Decisão.** (c). Dados realistas (398 clientes, 4 mil andamentos) com PII
  mascarada inclusive em texto livre; auth sintético com mesmos UUIDs e senha
  única; tabelas sensíveis (tokens, OAuth, WhatsApp) nunca saem de produção.
- **O que pesou.** Bug de produto aparece em dado real (nome composto, caso sem
  parceiro, publicação órfã), não em fixture. Anonimizar é tratamento de dado
  pessoal (ANPD/2023) — está justificado por legítimo interesse e documentado.
- **O que custou.** Dois projetos pra manter migrations e edge functions em
  sincronia (regra: staging primeiro, depois produção). Projeto free pausa
  após ~1 semana sem uso — o espelho semanal mantém vivo.

### D14 · Espelho: produção só com role de leitura + travas antes de truncar (2026-08-23)

- **Contexto.** O espelho conectava em produção como `postgres` (DDL/DML
  irrestrito) só pra fazer `pg_dump`. Nada conferia que o alvo do `truncate`
  era o staging; a segurança dependia de duas constantes no script.
- **Decisão.** Role `espelho_leitura` (só `SELECT`), policies explícitas de
  leitura em toda tabela com RLS (o `postgres` do Supabase não é superuser e
  não pode dar `BYPASSRLS`), marcador `comment on schema public is
  'ambiente=staging'` (`ALTER DATABASE SET` também não é permitido). O script
  aborta se a conexão de produção não for esse role, se faltar policy, ou se o
  destino não se declarar staging.
- **O que pesou.** Um erro de edição futura no script não pode ter produção
  como raio de dano. E, no GitHub Actions, o secret guardado vira uma
  credencial de leitura, não a senha do Postgres.
- **O que custou.** Tabela nova com RLS exige rodar a migration de novo (ela é
  idempotente e o script avisa).

### D15 · Remover o scaffold da Lovable (2026-08-21)

- **Contexto.** O projeto nasceu no Lovable. O preset
  `@lovable.dev/vite-tanstack-config` escondia a config do Vite, e 8 pacotes
  vinham presos num registry privado — `bun install` saía com código 0
  escondendo 403.
- **Decisão.** `vite.config.ts` próprio reproduzindo o caminho não-sandbox do
  preset; dependências apontadas pro registry público; `bunfig.toml` com
  `minimumReleaseAge = 86400` (pacote precisa ter 24h de publicado) como freio
  contra supply chain.
- **O que pesou.** Build reproduzível fora do ambiente da Lovable e controle
  sobre o que entra no bundle.
- **O que custou.** Um dia de trabalho e um upgrade de 206 versões no mesmo
  lote; `miniflare` em alpha por dependência transitiva (só afeta dev local).

### D16 · Staging como worker separado com domínio próprio; sem preview de PR (2026-08-22)

- **Contexto.** A preview URL do staging (`*.workers.dev`) resolvia num range
  de IP inalcançável da rede de quem valida (WiFi e 5G). Tentativas de
  deployar o staging a partir do projeto de produção (`--env staging`, patch do
  config gerado) **sobrescreveram produção com o banco de staging** — incidente
  com rollback no mesmo dia.
- **Opções.** (a) Insistir na preview URL; (b) `wrangler deploy` pro staging
  dentro do projeto de produção; (c) segundo projeto Workers Builds, worker
  `mara-sandra-connect-staging`, build com `CLOUDFLARE_ENV=staging`, domínio
  `staging.marasandraconnect.com`.
- **Decisão.** (c), com trava no comando de deploy (só deploya se o config
  gerado tiver o nome do worker de staging) e "builds de outras branches"
  desligado nos dois projetos. Preview de PR deixou de existir: validar =
  merge na `staging` e conferir no domínio.
- **O que pesou.** O token de build de um projeto Workers Builds só enxerga o
  worker daquele projeto — qualquer deploy de lá cai em produção,
  independente de flag. Separar projetos é a única fronteira real.
- **O que custou.** Feature só é visível depois de mergeada na `staging`; quem
  precisa ver antes roda local. Um projeto a mais pra manter.

### D17 · `staging → main` por merge commit, sem comandos destrutivos (2026-08-22 → revisto 2026-08-23)

- **Contexto.** Em 22/08 o lote passou a ir pra `main` por **squash** (um
  commit, revert simples). Squash descarta a história da `staging`; pra ela
  não divergir, era preciso `reset --hard` + `push --force-with-lease` depois
  de cada lote. Sem isso, o PR seguinte listava os commits antigos (chegou a
  59 commits pra 14 arquivos).
- **Opções.** (a) Squash + reset/force após cada lote; (b) squash + realinhar
  por merge, aceitando o ruído no PR; (c) **merge commit** em `staging → main`:
  a `main` passa a conter a história da `staging`, nada diverge, nada precisa
  ser reescrito.
- **Decisão (23/08).** (c). E uma regra explícita: **nenhum comando git
  destrutivo** no repo — sem `reset --hard`, `push --force` ou
  `--force-with-lease`, nem em branch própria; erro já pushado se corrige com
  commit por cima.
- **O que pesou.** Branch compartilhada reescrita é o tipo de operação que
  apaga trabalho sem aviso; o Yuri pediu que isso ficasse fora do fluxo. O
  preço do merge commit (revert de lote vira `git revert -m 1 <sha>`, história
  com merges) é pequeno perto disso.
- **O que custou.** A história da `main` deixa de ser "um commit por lote".
  Revert exige o `-m 1`.

### D18 · Contas de staging por papel (2026-08-23)

- **Contexto.** Todo mundo validava com `e2e+interno`, a mesma conta da suíte
  E2E. Duas sessões na mesma conta se derrubam pela rotação de refresh token —
  foi o gatilho do bug de sessão morta (D19).
- **Decisão.** `e2e+admin`, `e2e+interno`, `e2e+parceiro`, senha única do
  espelho, recriadas pelo seed no fim de cada espelho. Suíte usa `interno`;
  pessoa usa a conta do papel que quer ver.

---

## 7. Robustez do app (bugs que viraram regra)

### D19 · Sessão morta: reagir ao 401 num ponto só (2026-08-22)

- **Contexto.** O supabase-js só descobre que a sessão acabou quando **ele**
  tenta renovar o token, e decide isso pelo relógio local. O servidor decide
  pelo `exp` do JWT. Quando discordam (relógio atrasado, token revogado por
  fora), toda query volta 401, os 7 pollings de 60s repetem pra sempre e
  nenhum lia `error`.
- **Opções.** (a) Helper chamado em cada um dos 7 pollings; (b) `fetch`
  customizado no `createClient`, por onde **toda** chamada passa.
- **Decisão.** (b): 401 de `/rest/v1` ou `/storage/v1` encerra a sessão local
  (`SIGNED_OUT` → layout redireciona pro `/login`); 401 de `/functions/v1`
  confirma com `getUser()` antes (edge function pode dar 401 por outro
  motivo); `/auth/v1` fica de fora pra não virar loop.
- **Lição.** Tratamento de erro transversal em um lugar, não em N. Reproduzido
  e validado com Playwright contra o staging antes e depois.

### D20 · Executor async em Promise: helper em vez de reescrever (2026-08-23)

- **Contexto.** `new Promise(async …)` engole qualquer throw síncrono depois
  do `await`. A análise inicial (issue #180) concluiu que era inalcançável; a
  reprodução mostrou o contrário (script do Google Identity chegando vazio →
  spinner eterno).
- **Decisão.** `promiseComExecutorAsync` — executor async cujo throw vira
  `reject` — nos 3 blocos, sem reindentar o código de OAuth.
- **Lição.** "Não é alcançável" precisa de reprodução, não de leitura. O spec
  de regressão ficou.

### D21 · Verificar UI sempre com Playwright e vídeo (2026-08-21)

- **Decisão.** Toda validação de tela é um spec Playwright contra o staging,
  com vídeo e cursor visível; o vídeo de um teste que **passa** é o registro
  de validação do lote. Nunca "clique e me diga".
- **O que pesou.** Prova reproduzível; e o histórico deste projeto tem vários
  "funcionava na minha máquina" que eram rede, DNS ou conta compartilhada.

---

## 8. Storage por parceiro e caminho pra SaaS

### D22 · Storage por parceiro em três degraus; só o primeiro construído (2026-08-23)

- **Contexto.** Medido no banco: **1 parceiro concentra ~62%** dos 3,9 GB do
  bucket `documentos`; os 3 maiores somam 95%. Ratear custo de storage
  igualmente entre parceiros seria injusto — e há a intenção de vender planos
  de assinatura pra outros escritórios. Ao mesmo tempo, o custo real hoje é
  **zero** (3,9 GB dos 100 GB inclusos no plano Pro).
- **Opções.** (a) Cobrar/limitar já, construindo quota + bloqueio; (b) uma
  escada de três degraus, subindo um por vez conforme a necessidade real.
- **Decisão.** (b). Os degraus, e o gatilho de cada um:

  | Degrau | O que é | Gatilho pra subir | Estado |
  |---|---|---|---|
  | **1 · Medir** | RPC `uso_storage_parceiro()` (SECURITY DEFINER; interno vê tudo, parceiro só a própria linha, anon negado) + card em `/parceiros` com total, barra, arquivos e % | — | ✅ no ar (2026-08-23, `migration_uso_storage_parceiro.sql`) |
  | **2 · Quota com aviso** | `quota_storage_bytes` por parceiro/plano; barra muda de cor, aviso no sino/e-mail ao cruzar; excedente vira **linha de cobrança**, nunca parede | existir plano/preço definido, ou o uso sair da faixa em que o custo é irrelevante | adiado |
  | **3 · Enforcement** | recusa de upload acima do limite: checagem num **ponto único** antes de emitir a permissão + contador materializado (`uso_storage` por trigger em `documentos`, leitura O(1)); mensagem digna e válvula de escape do admin | só no cenário SaaS multi-tenant, se a conversa comercial do degrau 2 deixar de bastar | adiado |

- **O que pesou.** No degrau 2: bloquear upload num escritório de advocacia
  pode segurar a peça do prazo de amanhã — o custo de 2 GB excedentes é
  centavos; o de um documento que não entrou é um prazo. Aviso + cobrança
  transfere o problema pra onde ele pertence: conversa comercial com número na
  mão. No degrau 3: cada peça (contador, trigger, recusa) é estado novo e modo
  de falha novo — construir antes da demanda vira superfície morta (princípio 7;
  o módulo de webhooks está aí de prova).
- **Como a atribuição funciona.** Com o que já existe: o caminho do objeto no
  bucket começa com o `caso_id`, e `casos.parceiro_id` diz de quem é o caso.
  Nenhuma coluna nova foi necessária pro degrau 1.
- **Revisitar quando.** Planos de assinatura saírem do papel — aí o degrau 2
  entra junto com a tabela de planos, e a decisão multi-tenant (abaixo) precisa
  ser tomada antes.

### Decisão AINDA NÃO tomada · multi-tenant pra vender a outros escritórios

Registrada aqui pra não se perder o raciocínio de 2026-08-23:

- **(a) Coluna `escritorio_id` + RLS por tenant num banco só** — caminho de
  SaaS de centenas de clientes, mas exige reescrever as ~46 tabelas e ~133
  policies, e o modo de falha é o pior possível do ramo: uma policy errada =
  escritório A vendo processo do escritório B (dado de saúde, art. 11 LGPD).
- **(b) Um projeto Supabase + um worker por escritório** — isolamento físico
  (vazamento entre tenants estruturalmente impossível — princípio 2), billing
  por tenant = fatura do projeto, LGPD como argumento de venda. Custo: operação
  ×N (migrations, edge functions, seed — automatizável; os scripts já são
  parametrizados por ref). Recomendação atual: **(b) enquanto os clientes se
  contarem em dezenas**; revisitar (a) além de ~20-30 tenants.

Quando a decisão for tomada, ela vira o D23 com o formato padrão.

---

## Princípios que emergiram (o padrão por trás das decisões)

1. **Automação cria trabalho de revisão, nunca decisão jurídica.** Órfão >
   vínculo errado (D4, D8).
2. **Fronteira de segurança é estrutural, não de flag.** Projetos Workers
   separados, bancos separados, role só-leitura — não `--env`, não "cuidado"
   (D13, D14, D16).
3. **Custo recorrente precisa de conta feita contra o que já é grátis** (D7).
4. **Não oficial + pessoal não é teste barato** (D9).
5. **Uma pessoa opera: menos camadas, regra no banco, tratamento transversal
   num ponto só** (D2, D19).
6. **Reproduzir antes de concluir; vídeo antes de declarar validado** (D20, D21).
7. **Construir antes da demanda vira superfície morta** (D10) — registrar pra
   ninguém reinvestir sem pedido.

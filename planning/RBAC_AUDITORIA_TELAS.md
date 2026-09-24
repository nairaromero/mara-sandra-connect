# Auditoria: a tela oferece o que o servidor recusa (classe do defeito do item 6)

**Quando:** 24/09/2026, depois que a gravação do filme do lote RBAC no staging revelou dois
botões sem trava na tela do caso.
**Pergunta que motivou:** o que aconteceu naquele item, e ainda existem defeitos iguais?
**Resposta curta:** sim, muitos. O item 6 consertou uma amostra, não a classe. A varredura
completa achou ~40 pontos com o mesmo defeito, quase todos fora dos arquivos que o item 6 tocou.

Este documento é o laudo. Nada aqui foi corrigido ainda, exceto os dois pontos de 23-24/09
(`casos.$id.tsx` "Editar" dos dados do cliente e `etiquetas-cliente.tsx`), já em `e63225d`.

---

## 1. O que aconteceu no item 6

O commit `8aa137e` ("telas só oferecem o que o papel pode") fez o seguinte:

| Fez | Não fez |
|---|---|
| Trocou 42 gates em `casos.$id.tsx` de `isInterno` para `isInterno && pode("…")` | Não olhou nenhum arquivo de `src/components/` |
| Pôs guard de permissão em 6 páginas de gestão (Comercial, Etiquetas, Parceiros, Processos, Novo caso, Publicações) | Não enumerou as escritas: partiu dos gates que já existiam |
| Criou `e2e/tests/rbac-telas.spec.ts` com 3 testes (financeiro, assistente, advogado) | Os 3 testes olham só a tela do caso e as páginas de gestão |

Números que explicam o tamanho do ponto cego:

| Medida | Valor |
|---|---|
| Arquivos em `src/` que escrevem no banco | 43 |
| Arquivos que o item 6 tocou | 5 |
| Arquivos que escrevem e nunca foram olhados | 38 |
| Chamadas de escrita em `src/routes` | 82 |
| Chamadas de escrita em `src/components` + `src/lib` | 86 |
| Arquivos que escrevem e não consultam `pode()` em lugar nenhum | 36 de 43 |

## 2. Por que os dois botões escaparam — três causas, não uma

**Causa 1 · O método procurava gates, não escritas.** A varredura transformou
`isInterno && …` em `isInterno && pode("…")`. Um botão **sem gate nenhum** — como o "Editar"
dos dados do cliente — é invisível para esse método: não havia o que transformar. Foi assim
que ele sobreviveu numa passada que mexeu em 42 pontos do mesmo arquivo.

**Causa 2 · O raio de ação parou nas rotas.** Metade das escritas do sistema mora em
componentes (`src/components/tarefas/**`, `src/components/agenda/**`) e em `src/lib`. O
`EtiquetasCliente` é renderizado por `casos.$id.tsx`, mas mora noutro arquivo — e o commit
não abriu nenhum componente.

**Causa 3 · A rede de proteção tem o mesmo formato do erro.** Os três testes de papel
verificam a tela do caso e as páginas de gestão, que são justamente onde a varredura passou.
Nenhum teste abre `/tarefas`, `/agenda`, `/documentos` ou a aba de Tipos de benefício com um
papel restrito. Por isso a suíte ficou verde com ~40 defeitos vivos.

## 3. As quatro formas que o defeito assume

| # | Forma | Exemplo já corrigido | Quantos achados |
|---|---|---|---|
| A | Escrita **sem gate nenhum** | "Editar" dos dados do cliente | ~20 |
| B | Gate só de **tipo** (`isInterno`) numa tabela que exige permissão | "+ Etiqueta" do cliente | ~12 |
| C | Gate da **permissão errada** (existe `pode()`, mas de outra permissão) | — (nova) | 5 |
| D | **Escopo ignorado**: a tela confere a permissão, o banco exige o escopo `todos` | — (nova) | 2 tabelas, papel inteiro |

A forma D é a mais silenciosa e a de maior alcance. Está detalhada na seção 5.

## 4. Achados por área

Legenda de quem sofre: **F** = financeiro (só `casos:ler` e `repasses:ler`), **A** = assistente,
**Adv** = advogado.

### 4.1 Tarefas e agenda — 28 pontos (o pior caso)

Em todo o escopo de tarefas e agenda existe **um único** `pode()`: o "Novo evento" em
`agenda.tsx:256`. Todo o resto escreve sem conferir nada.

| Onde | O que escreve | Exige | Gate hoje | Sofre |
|---|---|---|---|---|
| `agenda.tsx:332` + `agenda-mes.tsx:238` | lixeira do calendário → DELETE `agenda_eventos` | `agenda:gerenciar` | nenhum | F |
| `agenda-sheet.tsx:1135` ("Salvar") | `agenda_eventos` + `andamentos` + `documentos` + storage + `tarefas` | 4 permissões | nenhum | F |
| `agenda-sheet.tsx:1104 / :1119` | Excluir / Concluir evento | `agenda:gerenciar` | só `editando` | F |
| `caso-tarefas-tab.tsx:130 / :175` | "Nova tarefa" e abrir evento para editar | `tarefas:gerenciar`, `agenda:gerenciar` | só `isInterno` | F |
| `tarefa-sheet.tsx:1875 / :1890` | Salvar e Excluir tarefa (+ `andamentos`) | `tarefas:gerenciar`, `casos:editar` | nenhum | F |
| `concluir-tarefa-dialog.tsx:223 / :276 / :367` | Concluir, Excluir, próxima tarefa | `tarefas:gerenciar` | nenhum | F |
| 11 botões de etapa em `tarefa-card.tsx:292-375` (etapas-acompanhamento, acompanhamento-pericia, acompanhamento-implementacao, analise-caso-novo, analise-indeferimento, comparecimento-pericia, montagem-inicial, etapa-cumprimento-exigencia, etapa-protocolo-realizado, enviar-aviso-parceiro) | `tarefas` + `andamentos` + `processos_*` | `tarefas:gerenciar` + `casos:editar` | nenhum | F |

Achado adicional: `caso-agenda-tab.tsx:82` ("Nova perícia", sem gate) e
`lib/tarefas/queries.ts:251` (`aplicarTemplate`) são **código morto** — nenhum render site.
Ficam como armadilha para quem plugar a tela depois.

### 4.2 Tela do caso e do cliente — 8 pontos

| Onde | O que escreve | Exige | Gate hoje | Sofre |
|---|---|---|---|---|
| `casos.$id.tsx:5378` `<UploadDoc>` | storage + `documentos` | `documentos:enviar` | **nenhum** | F |
| `casos.$id.tsx:5236` "Excluir" do menu Ações | `documentos` DELETE + storage | `documentos:excluir` | `documentos:enviar` (forma C) | A |
| `casos.$id.tsx:5279` "Sync pasta" | apaga documentos | `documentos:excluir` | `documentos:enviar` (forma C) | A |
| `casos.$id.tsx:5194` "Desvincular pasta" | `casos` UPDATE | `casos:editar` | só `isInterno` | F |
| `casos.$id.tsx:5923-5960` anexo do cumprimento | `documentos` | `documentos:enviar` | só `isInterno` | F |
| `caso-tarefas-tab.tsx:130 / :175` | (mesmos da seção 4.1) | | | F |
| `importar-clientes-excel-dialog.tsx:211` | cria `etiquetas` | `etiquetas:gerenciar` | `casos:editar` (forma C) | A |

Dois agravantes nesta área, que são bugs por si só:

- `casos.$id.tsx:4356` — o `delete()` do "Sync pasta" **não confere `error`**, então
  `removidos++` roda sempre e a tela informa "N removido(s)" mesmo quando o banco recusou
  tudo. É exatamente o padrão "falha de query engolida" da checagem de regressão do CLAUDE.md.
- `importar-clientes-excel-dialog.tsx:298 e :355` — as falhas de etiqueta e de tarefa são
  engolidas em `console.warn`. A planilha entra "com sucesso", sem etiquetas e sem a tarefa de
  análise, e ninguém fica sabendo.

### 4.3 Gestão — 4 pontos

| Onde | O que chama | Exige | Gate hoje | Sofre |
|---|---|---|---|---|
| `documentos.tsx:1027` "Atendido" + anexo | `documentos` + storage | `documentos:enviar` | só `isInterno`; a rota não tem guard e o item da sidebar (`app-sidebar.tsx:49`) é o único sem `permissao` | F |
| `parceiros.tsx:867 / :998 / :1126` lápis Editar | edge `update-parceiro`, que exige **admin** | admin | só o guard de `parceiros:gerenciar` | Adv |
| `importar-clientes-excel-dialog.tsx:211 / :329` | `etiquetas`, `tarefas` | `etiquetas:gerenciar`, `tarefas:gerenciar` | `casos:editar` | A |

### 4.4 Configurações — 4 pontos

A aba **Tipos de benefício** é montada só com `ehInterno` e o cartão não importa `useAuth`:
"Incluir" (`tipos-beneficio-card.tsx:166`), "Desativar/Reativar" (`:202`) e "Excluir" (`:217`)
escrevem em `tipos_beneficio`, que exige `templates:gerenciar` (admin e advogado). A permissão
`templates:gerenciar` **não é conferida em nenhum lugar de `src/`**. Sofrem: assistente e financeiro.

O resto de Configurações está bem: marca, Gmail, WhatsApp, MCP e o QG inteiro conferem
permissão de verdade.

## 5. Forma D: o escopo que a tela joga fora (o achado mais importante)

O modelo tem permissão **e escopo**: `papel_permissoes(permissao, escopo)`. Na matriz do
desenho (§4.3 do MULTI_TENANT_RBAC), o assistente gerencia tarefas e agenda **dos casos
atribuídos a ele** — escopo `atribuidos`.

O que existe hoje, conferido no banco de staging:

1. As policies de `tarefas` e `agenda_eventos` exigem `tem_permissao('…', 'todos')`.
2. O assistente tem essas permissões com escopo `atribuidos`.
3. Logo, **o banco nega o assistente por completo** nessas duas tabelas. Provado com a conta
   `canario+assistente` no staging: `INSERT` em `tarefas` e em `agenda_eventos` devolve `42501`,
   enquanto o advogado passa.
4. O front chama `minhas_permissoes()`, que devolve `(permissao, escopo)`, e **descarta o
   escopo** (`use-auth.tsx:222`): `pode("tarefas:gerenciar")` é verdadeiro para o assistente.

Resultado: além do financeiro, o **assistente** enxerga todos os botões de tarefa e agenda e
todos falham. E a intenção do desenho ("gerencia os atribuídos") não está implementada em
lugar nenhum: hoje é tudo ou nada.

## 6. A classe inversa: onde o servidor é mais frouxo que a tela sugere

Aqui o risco muda de natureza: não é botão que falha, é ação que passa sem a permissão.

- **Tabelas de domínio sem exigência de permissão** (só isolamento por escritório):
  `solicitacoes_documento`, `comentarios`, `notificacoes`, `repasses`, `analises_tecnicas`,
  `alertas_duplicidade`, entre outras. Efeito concreto: o financeiro **consegue** apagar uma
  solicitação de documento para sempre (`documentos.tsx:371`).
- **RPC `SECURITY DEFINER` sem checagem**: `aplicar_template` cria tarefas e não confere
  permissão; por ser definer, a policy de `tarefas` não se aplica. Chamada pelo assistente no
  staging, ela passou da autorização e só parou numa restrição de dados.
- **Edge functions que exigem só o tipo**: 19 das 27 functions de pessoa pedem apenas
  `tipo: "interno"`. Entre elas `ia-triagem-andamentos` e `sync-datajud-movimentacoes`, que
  gastam IA e cota externa sem exigir `ia:usar`, e `ia-config`, `sync-*`, `listar-*`.
- **`pode()` abre tudo quando o RBAC falha** (`use-auth.tsx:322`): qualquer erro de
  `meus_vinculos` liga `rbacIndisponivel` e todo `pode()` passa a devolver verdadeiro. É
  deliberado (front publicado antes do banco), mas basta uma falha de rede para a tela voltar
  a oferecer tudo a todo mundo. A trava do banco continua de pé; a da tela some.

## 7. Qual é o risco de verdade

**O banco segurou em todos os casos da seção 4.** Nenhum achado é escalada de privilégio: quem
clica recebe `42501` e a escrita não acontece. O dano é de confiança e de operação: a pessoa é
levada a um caminho que termina em erro, e em três lugares o erro é **engolido** e vira um
sucesso falso (sync de pasta e as duas falhas da importação de planilha).

O risco real de privilégio está na seção 6, que é outra conversa: tabelas e funções onde
ninguém confere permissão nenhuma.

## 7b. O que já foi feito (24/09, commit `edd080a`)

| Recomendação | Situação |
|---|---|
| P0 · escopo na tela | **feito**: `pode()` considera o escopo; `podeEscrever` resolve pelo espelho |
| P0 · escopo no banco (implementar `atribuidos`) | **pendente de decisão** — ver §8.1 |
| P0 · tarefas e agenda (28 pontos) | **feito** |
| P1 · gates de permissão errada (forma C) | **feito** |
| P1 · falhas engolidas | **feito** (sync de pasta e as duas da importação) |
| P2 · `isAdmin` onde a regra é permissão | **feito** em Configurações, Equipe e Auditoria |
| P2 · rede de proteção | **feito**: 3 testes de papel novos + `rbac-exigencias` |
| Classe inversa (§6) | **pendente** — ver §8.2 |

O mecanismo: `src/lib/rbac/exigencias.ts` é o espelho do que o servidor exige;
`podeEscrever`/`podeChamar`/`<AcaoProtegida>` leem dele; e
`scripts/rbac-conferir-exigencias.mjs` (rodado pela spec `rbac-exigencias`)
compara o espelho com o banco a cada suíte.

### 8.1 A decisão que sobrou: o escopo `atribuidos`

Hoje o assistente não escreve tarefa nem evento nenhum — o banco exige escopo
`todos`. A matriz do desenho promete que ele gerencie **os atribuídos a ele**.
São dois caminhos:

- **Implementar a promessa**: as policies passam a aceitar
  `tem_permissao('…','todos') or (tem_permissao('…','atribuidos') and <a linha é dele>)`.
  Custo: uma migration por tabela e decidir o que é "dele" (responsável? dono do
  caso?). A tela já está pronta para os dois casos.
- **Tirar o escopo do modelo**: o assistente passa a ter `todos` ou não ter a
  permissão. Custo: uma migration de uma linha; a matriz do desenho muda.

Enquanto não se decide, a tela e o banco dizem a mesma coisa — que é o que
importava para a pessoa não levar erro.

### 8.2 A classe inversa continua aberta

Nada da §6 foi mexido: tabelas de domínio sem exigência de permissão,
`aplicar_template` (`SECURITY DEFINER` sem checagem) e as 19 edge functions que
pedem só `tipo: "interno"`. Ali o risco é o oposto — a pessoa CONSEGUE o que o
papel dela não deveria permitir — e cada caso é uma decisão de produto, não uma
correção mecânica.

## 8. Recomendação, em ordem

1. **P0 — Escopo (forma D).** Decidir entre implementar `atribuidos` de verdade nas policies de
   `tarefas`/`agenda_eventos` (o que a matriz promete) ou tirar o escopo do modelo. Enquanto
   isso, fazer `pode()` respeitar o escopo, para a tela parar de mentir para o assistente.
2. **P0 — Tarefas e agenda (28 pontos).** É a área mais usada do sistema e a que não tem
   nenhum gate. Passar a decisão por props a partir de quem já sabe (`pode()` no topo) ou criar
   um componente `<AcaoProtegida permissao="…">`.
3. **P1 — Os 5 gates de permissão errada (forma C).** São os mais enganosos: parecem corretos
   numa revisão rápida.
4. **P1 — As três falhas engolidas** (sync de pasta, etiquetas e tarefa da importação).
5. **P2 — `isAdmin` onde a regra é permissão.** Configurações, Equipe e Auditoria decidem por
   `usuarios.eh_admin`, a coluna legada que o CLAUDE.md manda não usar para acesso. Hoje dá no
   mesmo; quebra no dia em que um papel novo ganhar a permissão.
6. **P2 — A rede de proteção.** Um teste por papel que percorra `/tarefas`, `/agenda`,
   `/documentos` e as abas de Configurações, e um teste que leia as policies do banco e
   confirme que toda permissão exigida aparece em algum `pode()` do front.

## 9. Como não repetir

O erro de método foi partir da tela. O caminho que funciona é o inverso, e foi o desta
auditoria: **partir do banco**. A lista de `perm_*` (tabela → permissão) e a de RPCs e functions
com permissão são pequenas e estáveis; cada item dessa lista tem que ter um dono na tela. Um
script que cruze as duas listas cabe num teste e responde sozinho a pergunta "ainda falta algum?".

# Comunicado à equipe — o que muda quando este lote entrar em produção

Escrito em 27/09/2026, para ser lido **antes** do release (17 PRs, 29 migrations).
O plano de execução é o `planning/RELEASE_PRODUCAO.md`; aqui está só o que a
equipe precisa saber e fazer.

---

## Em uma frase

Cada pessoa passa a ter um **papel**, e o sistema só mostra e só aceita o que o
papel dela permite — a mesma regra na tela e no banco.

Até hoje o freio era a tela: quem soubesse o endereço chegava em quase tudo.
Agora quem decide é o banco, e a tela apenas espelha o que ele aceitaria.

---

## 1. Quem vira o quê no primeiro login

Ninguém escolhe, ninguém cadastra nada: a conta de cada um recebe um papel de
acordo com o que ela já era.

| Pessoa | Vira | Por quê |
|---|---|---|
| Naira Romero, Mara Vian | **Administrador** | eram admin |
| Mariane Fernandes, Sebastião Correa, Beatriz Santiago | **Advogado** | eram internos |
| Os 23 parceiros ativos | **Parceiro** | já eram parceiros |

**Ninguém vira Assistente nem Financeiro automaticamente.** Esses dois papéis
existem, mas entram só quando a Naira escolher, em Equipe → menu da pessoa.
Vale ler o item 4 antes de mexer nisso: Assistente é mais restrito do que
parece.

Entrar continua igual: mesmo e-mail, mesma senha, mesmo endereço. Quem estiver
com o sistema aberto na hora do deploy talvez precise de um F5.

---

## 2. A regra número 1: se o botão não está lá, não é bug

O sistema **esconde** o que o servidor recusaria, em vez de deixar clicar e dar
erro. Então a experiência mais comum não é uma mensagem vermelha — é um botão
que sumiu, um item de menu que não aparece, um "..." com menos opções.

Antes de abrir chamado:

1. Confira seu papel: ele aparece na **etiqueta ao lado do seu nome**, no alto da tela ("Administrador", "Advogado", "Assistente", "Financeiro").
2. Compare com o **Glossário** (menu lateral → Glossário): cada papel tem um
   verbete com a lista de permissões **lida do banco em tempo real** — é a
   resposta oficial para "isso é do meu papel?".
3. Se for algo que você precisa fazer no dia a dia, fale com a Naira ou a Mara:
   elas podem conceder **aquela permissão específica** sem te tornar
   administradora (item 12).

---

## 3. Excluir cliente ou parceiro: só administrador

**O que mudou.** Antes qualquer interno excluía. Agora é só administrador,
porque não tem volta.

**Caso real — cliente cadastrado duas vezes.** Você acha a duplicata e quer
apagar. O botão **Excluir cliente** (dentro de Editar cliente, na tela do caso)
não aparece mais para você. O que fazer: mande para a Naira ou a Mara o nome e o
CPF, dizendo que é duplicata.

E vale saber o tamanho do que se pede: excluir cliente leva embora **todos os
casos dele** e, com eles, documentos, andamentos, solicitações, processos,
repasses e conversas — inclusive os arquivos guardados. Não tem volta. Quando o
cliente é real e só o cadastro está duplicado, o certo é excluir a **duplicata
vazia**, não a que tem o caso.

**Caso real — parceiro que saiu do escritório.** Igual: excluir é da
administração. Mas repare que na maioria dos casos o certo não é excluir, é
**desligar** (Parceiros → menu → Desligar): desligar preserva o histórico, os
casos e os repasses, e só fecha a porta. Excluir apaga.

---

## 4. Tarefas e agenda: o Assistente só mexe no que é dele

Hoje ninguém é Assistente, então **isso não afeta a equipe no dia 1**. Mas é a
diferença mais importante entre os papéis, e é o que a Naira precisa entender
antes de transformar alguém em Assistente:

- **Advogado**: mexe em qualquer tarefa e em qualquer compromisso do escritório.
- **Assistente**: vê tudo, mas só **cria, edita e conclui as tarefas e os
  compromissos atribuídos a ela**. Na tarefa de outra pessoa os botões não
  aparecem.

**Caso real.** Pede-se a quem é Assistente que conclua uma tarefa atribuída a
outra pessoa. A tarefa abre, mas o botão de concluir não aparece. O caminho é
reatribuir a tarefa a quem vai executá-la — quem pode editar tarefas faz isso —
e então o botão aparece.

Se esse limite não serve para o dia a dia de alguém, o papel certo para essa
pessoa é Advogado — ou o ajuste do item 12, trocando o alcance de "só os
atribuídos" para "todos" apenas em tarefas.

---

## 5. Documento: enviar e apagar são coisas diferentes

Enviar documento e **excluir** documento são duas permissões. Um papel pode ter
a primeira e não a segunda.

**Caso real.** Você subiu o CNIS no caso errado. Se o botão de excluir não
aparece no documento, não tente pelo Drive: peça para quem tem a permissão
apagar, e suba de novo no caso certo. O arquivo no Drive e o registro no sistema
andam juntos — apagar só de um lado deixa sujeira.

---

## 6. Legalmail, Tramitação Inteligente e WhatsApp continuam funcionando

As credenciais dessas integrações passaram a ser **por escritório**, guardadas
cifradas no banco. Para o escritório Mara Sandra **nada muda no dia 1**: ele
continua usando as credenciais que já estão configuradas no servidor.

O que você pode ver, e quando: se algum dia aparecer

> **Legalmail não está configurado neste escritório**

é a mensagem de escritório **sem credencial cadastrada** — não é senha errada
nem o serviço fora do ar. O caminho é Configurações → Integrações (só
administrador).

A saída de **WhatsApp continua pausada**, como hoje. Nada passa a ser enviado
por causa deste lote.

---

## 7. Publicações do DJEN entram sozinhas, agora por dentro do sistema

A busca diária de publicações saiu do n8n e passou a rodar dentro do próprio
banco (pg_cron). Para quem usa, o resultado é o mesmo — as publicações aparecem
em Publicações e viram rascunho de andamento no caso.

**Atenção nos primeiros dois dias:** se aparecer **publicação em dobro**, avise
imediatamente. Significa que o fluxo antigo do n8n não foi desligado e os dois
estão buscando. Não é para sair apagando: o aviso resolve na origem.

---

## 8. Caso encerrado não volta sozinho por causa de robô

**O que mudou.** Antes, qualquer coisa que chegasse num caso finalizado podia
reabri-lo — inclusive automação. Agora reabre só quando **há gente por trás**.

Na prática, num caso finalizado:

| O que chega | O caso reabre? |
|---|---|
| Tarefa criada por automação | **Não** |
| Pedido/tarefa criada por uma pessoa | **Sim** |
| Publicação trazida pelo DJEN | **Não** — cria o rascunho e fica ali |
| Audiência ou perícia nova marcada | **Sim** |

**Caso real.** Chegou publicação num caso que você finalizou no mês passado. O
caso segue finalizado e o rascunho fica esperando. Se aquilo exige trabalho de
novo, **reabra você mesma** — é essa decisão que o sistema deixou de tomar
sozinho.

---

## 9. A fase do caso passa a se manter sozinha

A fase (Em análise · Administrativo · Judicial) virou um **resumo dos processos
do caso**, mantido pelo sistema:

- ação ajuizada → **judicial**;
- requerimento **protocolado** → administrativo (requerimento sem protocolo
  **não** promove — decisão de 18/09);
- nada disso ainda → em análise.

A fase **só avança** (nunca volta sozinha), e caso finalizado não é mexido por
cadastro de processo.

**Caso real.** Você cadastra a ação ajuizada e a fase do caso vira Judicial
sozinha — não é engano nem alguém mexendo, é o cadastro do processo. Se a fase
está "errada", olhe primeiro os processos do caso: é de lá que ela vem.

**Para os parceiros**, a mesma mudança tem outro efeito visível: no kanban
deles, a coluna de cada item vem do **processo daquele item**. Um cliente que
corre nas duas frentes passa a aparecer **nas duas colunas** — são 95 casos
assim hoje, que antes caíam todos em judicial.

---

## 10. Datas e horas sempre no calendário de Brasília

Alguns pontos da tela usavam o fuso **do computador de quem olhava**. Quem
trabalha no Brasil quase não via diferença; quem abriu o sistema de fora, sim —
e aí um prazo que vence às 23h59 aparecia como **do dia seguinte**.

Corrigido nos lugares onde doía: o "Enviar até" da solicitação (na tela do caso
e em Documentos pendentes) e a linha do tempo de andamentos — andamento que vem
só com a data (importação de planilha, DJEN) não cai mais na véspera nem inventa
hora.

**Caso real.** Se em setembro você viu um prazo marcando um dia a mais do que o
combinado, era isto. O que a tela mostra agora é o calendário de Brasília.

---

## 11. Duas etapas (2FA) — opcional para a equipe

Qualquer pessoa pode ligar a verificação em duas etapas em **Configurações →
Segurança**, com um aplicativo autenticador (Google Authenticator, Authy, 1Password).
Depois disso o login pede o código de seis dígitos depois da senha.

É **opcional** para a equipe e **obrigatório** para quem entra no painel da
plataforma (QG), que é outro assunto — ninguém da equipe usa o QG.

Recomendação: Naira e Mara ligarem, porque são as contas que podem tudo.

---

## 12. Permissão por pessoa: a saída para "ela precisa só disso"

Novidade que vale conhecer: a administradora pode somar ou tirar **uma
permissão** de **uma pessoa**, por cima do papel — em Equipe → menu da pessoa →
**Permissões**.

Serve exatamente para o caso "a Mariane precisa ver a auditoria, mas não vou
torná-la administradora". Detalhes que importam:

- a linha ajustada aparece com a etiqueta **"ajustado"** e um **"voltar ao papel"**;
- guarda-se só a diferença, então melhorar o papel depois continua alcançando a pessoa;
- **trocar o papel desfaz os ajustes** — quem quiser mantê-los refaz no papel novo;
- ninguém ajusta as próprias permissões, e ninguém concede o que não tem;
- sete permissões são **sensíveis** (gerenciar equipe, configurar escritório, ler
  auditoria, integrações, excluir cliente, excluir parceiro, emitir token do MCP)
  e a tela pede confirmação escrevendo o que a pessoa passa a poder;
- **tudo fica na auditoria**, com quem mexeu, em quem, o que era e o que ficou.

---

## 13. Se alguém da plataforma pedir acesso ao escritório

Existe agora um canal formal: quem dá suporte **pede** acesso, com motivo e
prazo (até 72 horas), e o pedido recebe um número automático no formato
**SUP-2026-0001**.

Como isso aparece para vocês: um aviso no topo da tela para a administradora,
que aprova ou recusa em **Configurações → Suporte**.

Se aprovado: o acesso é **somente leitura**, a sessão de suporte mostra uma
faixa âmbar na tela, cada tela aberta fica na auditoria do escritório, e o
acesso **expira sozinho** no prazo. Pode ser encerrado antes, a qualquer
momento, pela administradora.

Regra prática: **pedido que chegar por WhatsApp, e-mail ou telefone não existe.**
Se não está na tela de Configurações → Suporte, com número, não aprove nada.

---

## 14. Textos que vão aparecer — e o que fazer

| O que você vê | Significa | O que fazer |
|---|---|---|
| O botão/menu simplesmente não está lá | Não é do seu papel | Conferir no Glossário; pedir a permissão se for do seu dia a dia |
| **Área restrita a administradores** | Página só da administração (Equipe, Auditoria) | Nada a fazer; pedir o dado a quem tem acesso |
| **Área restrita a quem gerencia etiquetas** / **o comercial** | Falta a permissão daquela área | Pedir a permissão (item 12) |
| **Sem permissão: apenas quem gerencia a equipe altera papéis** | Tentativa de mexer em papel sem a permissão | Pedir para Naira ou Mara |
| **Sem permissão para aplicar template neste caso** | Templates de tarefa exigem permissão de tarefas | Pedir a permissão |
| **O escritório ficaria sem ninguém para gerenciar a equipe** | Tentou tirar a última pessoa que administra | Promover outra pessoa primeiro |
| **Há N tarefa(s) aberta(s) com essa pessoa: escolha quem assume** | Desligamento com tarefas abertas | Escolher quem herda; o sistema migra tarefas e agenda futura |
| **Motivo da exclusão é obrigatório** | Ao excluir uma **tarefa** (esse fluxo pede justificativa e guarda em `tarefas_excluidas`) | Escrever o motivo |
| **Legalmail não está configurado neste escritório** | Escritório sem credencial | Configurações → Integrações (administrador) |
| **quem emitiu este token nao pode mais conceder acesso ao MCP** | O token do Claude morreu porque quem o emitiu perdeu a permissão | Pedir um token novo |
| Erro falando de **permissão** ou **política** vindo do banco | A tela deixou passar algo que o banco recusa | Avisar — isso é bug de verdade, e é o único caso desta tabela que é |

A última linha é o combinado importante: **botão que some é regra; erro de
permissão depois de clicar é bug.** Se acontecer, mande a tela e o que você
estava fazendo.

---

## 15. Só a administração pode, a partir de agora

- Equipe: convidar interno, trocar papel, desligar, reativar, **ajustar permissões**
- Auditoria
- Configurações → Integrações (IA, Google, Legalmail, TI) e Webhooks
- Excluir cliente e excluir parceiro
- Emitir token do MCP (Claude Desktop)
- Aprovar ou recusar acesso de suporte da plataforma

---

## 16. O que avisar aos 23 parceiros

Para eles muda pouco, e é bom que saibam o pouco:

- continuam vendo **só os casos que indicaram**, com os andamentos marcados como
  visíveis, os documentos, as solicitações e os próprios repasses;
- no **kanban de tarefas deles**, um cliente que corre nas duas frentes passa a
  aparecer nas duas colunas, cada item na coluna do processo a que pertence
  (item 9) — é a mudança mais visível do lado do parceiro;
- quem ainda não aceitou os termos continua sendo levado ao aceite no primeiro acesso;
- as listas longas agora vêm **paginadas** ("1–25 de N", com « ‹ 1 2 3 › »), em
  vez de carregar tudo de uma vez — inclusive no celular.

---

## 17. O que **não** muda

- E-mail, senha e endereço de acesso.
- Os casos, clientes, documentos, tarefas, agenda, repasses: nada é apagado nem movido.
- A marca no topo e nos e-mails continua **Mara Sandra Vian Advocacia**.
- Legalmail, Tramitação Inteligente, Gmail do INSS e DataJud seguem ligados.
- Os fluxos de exigência, perícia e implantação continuam iguais.

---

## 18. Nos primeiros dias, avise se vir

1. **Publicação em dobro** (item 7).
2. **Erro de permissão depois de clicar** num botão que a tela ofereceu (item 14).
3. **Hora errada** em card de agenda ou perícia (item 10).
4. Caso que **reabriu sozinho** sem ninguém ter feito nada (item 8).
5. Qualquer tela que abra **vazia** onde antes havia dado — isso não é papel, é
   coisa para olhar na hora.

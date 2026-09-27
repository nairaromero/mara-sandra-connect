# "Tudo deve ser auditável" — blast radius

Escrito em 27/09/2026, depois de achar que trocar o papel de alguém não deixava
rastro nenhum. A pergunta da Naira: **ainda existem gaps?**

**Resposta curta: sim, três que valem fechar, e eles não são de acesso — são de
destruição de dado e de troca de e-mail de login.** O que era de acesso ficou
fechado pela `migration_rbac_25`.

---

## 1. Como varri

Quatro frentes, para não confiar em memória:

1. **Funções do banco que escrevem na trilha**: `pg_proc` cruzado com
   `position('private.auditar' in pg_get_functiondef(oid))` — 19 funções antes
   da `rbac_25`, 25 depois.
2. **Trilhas dedicadas**: tabelas que guardam histórico próprio
   (`acessos_senha_inss`, `tarefas_excluidas`, `inss_email_log`) e gatilhos de
   histórico nas tabelas de domínio (`pg_trigger`).
3. **Rastro na própria linha**: colunas `%_por` / `%_em`
   (`membros.convidado_por`, `membros.desativado_por`, `ia_tokens.emitido_por`,
   `clientes.created_by`, `tarefas.created_by`…). Rastro de **estado atual**,
   não de história — e alguns são apagados por ação posterior.
4. **Edge functions**: `grep` por `auditoria` nas 33 que o release leva.

O que **não** está no escopo: leitura de dado comum. Registrar toda leitura de
caso viraria ruído e não é o que se pediu. A exceção é a senha do MEU INSS, que
tem trilha de leitura própria por decisão anterior.

---

## 2. O mapa

### 2.1 Mudança de acesso — **fechado**

| Ação | Onde fica registrada |
|---|---|
| Conceder/remover **uma permissão** de uma pessoa | `auditoria` · `equipe.permissao_ajustada` (antes/depois) — `rbac_20` |
| Voltar tudo ao papel | `auditoria` · `equipe.permissoes_resetadas` — `rbac_20` |
| **Trocar o papel** | `auditoria` · `equipe.papel_alterado` (de → para, ajustes derrubados) — **`rbac_25`** |
| Tornar/remover admin (`definir_admin`) | idem: delega para `definir_papel` |
| **Desligar** pessoa da equipe | `auditoria` · `equipe.desligado` (nome, quem assumiu, tarefas e eventos movidos) — **`rbac_25`** |
| **Reativar** pessoa da equipe | `auditoria` · `equipe.reativado` — **`rbac_25`** |
| **Desligar/reativar parceiro** | `auditoria` · `parceiro.desligado` / `parceiro.reativado` — **`rbac_25`** |
| Suspender, encerrar, eliminar escritório; trocar titular; staff do QG | `auditoria` (família `qg_*`) — `rbac_05`/`rbac_07` |
| Pedir, aprovar, encerrar acesso de suporte | `auditoria` (`suporte.*`), com o número do ticket — `rbac_07`/`rbac_19` |

As duas de reativação mereciam atenção especial e é por isso que entraram:
elas **limpam** `desativado_em`/`desativado_por` da linha. Antes da `rbac_25`,
reativar alguém apagava o único rastro de que houve desligamento.

### 2.2 Dado sensível — **já estava fechado**

| Ação | Onde |
|---|---|
| Ler a senha do MEU INSS de um cliente | `acessos_senha_inss` (ação `leitura`) |
| Gravar/alterar a senha | `acessos_senha_inss` (`escrita`), inclusive quando vem do pedido ao parceiro (`cumprir_troca_senha_meu_inss` delega para `set_senha_meu_inss`) |
| Remover a senha (na exclusão do cliente) | `acessos_senha_inss` (`escrita_remocao`) |

### 2.3 Destruição de dado — **um fechado, dois em aberto**

| Ação | Onde | Situação |
|---|---|---|
| Excluir **tarefa** | `tarefas_excluidas`, com motivo obrigatório | ok |
| Excluir **cliente** (leva casos, documentos, andamentos, processos, repasses e conversas) | `auditoria` · `cliente.excluido` (nome + nº de casos) — **`rbac_25`** | ok |
| Excluir **documento** | — | **GAP 1** |
| Excluir **andamento** | — | **GAP 2** |

### 2.4 Integrações, tokens e sessão

| Ação | Onde | Situação |
|---|---|---|
| Salvar/testar credencial de integração | `auditoria` (`integracao.salvar`, `integracao.testar`) — pela edge `integracoes-escritorio` | ok |
| Emitir/revogar token do MCP | `ia_tokens` (`usuario_id`, `emitido_por`, `criado_em`, `revogado_em`) | aceitável: a própria linha conta a história inteira |
| Ligar/desligar 2FA | `auth.audit_log_entries` (trilha do Supabase) | aceitável: é fora da nossa trilha, mas existe |
| Convidar pessoa (interno ou parceiro) | `membros.convidado_por` | **GAP 3**, parcial |
| **Trocar o e-mail de login de um parceiro** (`update-parceiro`) | — | **GAP 4** |
| Excluir parceiro (edge `excluir-parceiro`) | — | **GAP 5** |

---

## 3. Os gaps que sobram, em ordem de quanto doem

### GAP 4 · Trocar o e-mail de login de um parceiro — o mais grave

`update-parceiro` troca o e-mail em `auth.users` com `email_confirm: true` e
manda o magic link para o **endereço novo**. Foi exatamente o abuso demonstrado
no staging em 20/09 que fez a função virar admin-only. E **essa ação não deixa
rastro nenhum**: nem na trilha, nem numa coluna.

A ação cuja única defesa é "só a administração faz" é a que ninguém consegue
auditar depois. Se um dia houver dúvida sobre "quem apontou o acesso da Beatriz
para outro e-mail?", não há resposta.

**Recomendação: fechar agora**, na própria function (ela já tem `escritorioId` e
`quem`): registrar `parceiro.email_alterado` com o de → para. Vai junto com a
issue [#403](https://github.com/nairaromero/mara-sandra-connect/issues/403), que
já mexe nessa function para trocar o papel por permissão.

### GAP 1 e 2 · Excluir documento e andamento

Apagar um CNIS do caso, ou apagar um andamento, não deixa nada — some do banco e
do storage. Tarefa tem `tarefas_excluidas` com motivo; documento e andamento
não têm equivalente.

Dói em dois cenários reais: documento apagado por engano ("estava aqui ontem") e
andamento que alguém apagou para "limpar" a linha do tempo de um caso.

**Recomendação: fechar, no mesmo formato do `tarefas_excluidas`** — gatilho
`before delete` que copia a linha para `documentos_excluidos` /
`andamentos_excluidos` com quem apagou e quando. Gatilho em vez de RPC porque a
exclusão hoje passa direto pela RLS (`documentos:excluir`), sem função no meio.

### GAP 5 · Excluir parceiro

A edge `excluir-parceiro` exige `parceiros:excluir` (sensível, só admin por
padrão) e apaga a pessoa. Sem rastro. Mesma família do GAP 4 e do
`cliente.excluido` que a `rbac_25` fechou.

**Recomendação: fechar junto com o GAP 4** — as duas são edge functions, o mesmo
padrão de `insert into auditoria`.

### GAP 3 · Convite

`membros.convidado_por` diz quem convidou, e sobrevive enquanto a linha
existir — mas é estado, não história: se o vínculo for apagado, o convite
desaparece com ele. Menos grave que os outros, porque o convite tem um efeito
visível (uma pessoa nova na tela de Equipe) e o `desligado` agora fica na
trilha.

**Recomendação: fechar quando mexer na `convidar-usuario` por outro motivo.**
Não vale um PR só para isso.

---

## 4. O que não é gap, e por quê

- **Leitura de caso, cliente, documento**: por decisão de escopo. Auditar toda
  leitura viraria ruído; a exceção é a senha do MEU INSS, que já tem trilha.
- **Trabalho comum** (criar tarefa, mudar fase, subir documento, aplicar
  template): tem autoria na própria linha (`created_by`,
  `status_alterado_por/_em`) e não é mudança de acesso.
- **Token do MCP**: `ia_tokens` guarda dono, emissor, criação e revogação — a
  linha conta a história inteira, inclusive depois de revogado.
- **2FA**: fica na trilha do Supabase (`auth.audit_log_entries`). Vale saber que
  está lá, não vale duplicar.
- **Webhooks**: as tabelas são admin-only e a aba mostra "Em breve". Quando a
  entrega voltar por function, entra nesta lista.

---

## 5. A régua, para não abrir de novo

1. **RPC `SECURITY DEFINER` que muda acesso audita.** Papel, permissão, status
   do vínculo, titularidade, staff: se a função mexe em quem-pode-o-quê, ela
   chama `private.auditar` antes de retornar.
2. **Ação que apaga dado do cliente deixa rastro** — em tabela própria
   (`tarefas_excluidas`) ou na trilha (`cliente.excluido`).
3. **Função que LIMPA um rastro da linha** (como as reativações limpam
   `desativado_por`) tem obrigação de escrever na trilha antes.
4. **Edge function que muda acesso ou identidade audita ela mesma**, como a
   `integracoes-escritorio` já faz.
5. `tipo_ator = 'membro'` mantém a linha **dentro** do escritório: o
   `qg_auditoria` só lê `plataforma` e `suporte`. Nome de cliente na trilha é
   dado do escritório, e não vaza para a plataforma.

Uma automação possível, se isso voltar a escapar: estender o
`scripts/rbac-conferir-exigencias.mjs` com uma lista de funções que **devem**
auditar, conferida contra `pg_get_functiondef` — o mesmo truque do espelho de
exigências, que já pega sobra e falta de permissão.

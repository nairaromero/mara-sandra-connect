# "Tudo deve ser auditável" — blast radius

Escrito em 27/09/2026, depois de achar que trocar o papel de alguém não deixava
rastro nenhum. A pergunta da Naira: **ainda existem gaps?**

**Resposta em 27/09, depois de fechar tudo: não sobrou gap conhecido.** A
varredura achou cinco, todos fechados no mesmo dia — os de acesso pela
`migration_rbac_25`, os de destruição de dado pela `migration_rbac_26`, e os de
identidade nas três edge functions. O `scripts/rbac-conferir-exigencias.mjs`
passou a conferir isso sozinho, para não reabrir calado.

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

### 2.3 Destruição de dado — **fechado**

| Ação | Onde |
|---|---|
| Excluir **tarefa** | `tarefas_excluidas`, com motivo obrigatório |
| Excluir **cliente** (leva casos, documentos, andamentos, processos, repasses e conversas) | `auditoria` · `cliente.excluido` (nome + nº de casos) — `rbac_25` |
| Excluir **documento** | `documentos_excluidos` (linha inteira, quem apagou, quando) — **`rbac_26`** |
| Excluir **andamento** | `andamentos_excluidos` (idem) — **`rbac_26`** |

As duas trilhas novas são **gatilho `before delete`**, não RPC: a exclusão passa
direto pela RLS (`documentos:excluir`, `casos:editar`), sem função no meio, e o
gatilho pega todo caminho — tela, API e a cascata do `excluir_cliente`. A trilha
nunca impede o delete: se a gravação falhar, o aviso vai para o log e o trabalho
segue.

### 2.4 Integrações, tokens e sessão

| Ação | Onde | Situação |
|---|---|---|
| Salvar/testar credencial de integração | `auditoria` (`integracao.salvar`, `integracao.testar`) — pela edge `integracoes-escritorio` | ok |
| Emitir/revogar token do MCP | `ia_tokens` (`usuario_id`, `emitido_por`, `criado_em`, `revogado_em`) | aceitável: a própria linha conta a história inteira |
| Ligar/desligar 2FA | `auth.audit_log_entries` (trilha do Supabase) | aceitável: é fora da nossa trilha, mas existe |
| Convidar pessoa (interno ou parceiro) | `auditoria` · `equipe.convidado` / `parceiro.convidado` — **27/09** (antes: só `membros.convidado_por`) | ok |
| **Trocar o e-mail de login de um parceiro** (`update-parceiro`) | `auditoria` · `parceiro.email_alterado` (de → para) — **27/09** | ok |
| Excluir parceiro (edge `excluir-parceiro`) | `auditoria` · `parceiro.excluido` (nome, casos desvinculados, outros vínculos) — **27/09** | ok |

---

## 3. Os cinco gaps, e como cada um foi fechado

Ordem de quanto doíam. Todos fechados em 27/09, no mesmo dia em que a varredura
os encontrou.

### 1 · Trocar o e-mail de login de um parceiro — era o mais grave

`update-parceiro` troca o e-mail em `auth.users` com `email_confirm: true` e
manda o magic link para o **endereço novo**. Foi exatamente o abuso demonstrado
no staging em 20/09 que fez a função virar admin-only. E não deixava rastro
nenhum: nem na trilha, nem numa coluna. A ação cuja única defesa era "só a
administração faz" era a que ninguém conseguia auditar depois.

**Fechado**: a function registra `parceiro.email_alterado` com o de → para,
**antes** de trocar — depois, o e-mail antigo não existe mais em lugar nenhum.
Provado no staging:

```
parceiro.email_alterado  {"de":"e2e+trilha-…@…","para":"e2e+trilha-…-novo@…","enviar_link":false}
```

### 2 e 3 · Excluir documento e andamento

Apagar um CNIS do caso, ou apagar um andamento, não deixava nada — sumia do
banco e, no caso do documento, do storage. Tarefa tinha `tarefas_excluidas` com
motivo; esses dois não tinham equivalente. Dói em dois cenários reais: documento
apagado por engano ("estava aqui ontem") e andamento apagado para "limpar" a
linha do tempo de um caso.

**Fechado** pela `migration_rbac_26`: `documentos_excluidos` e
`andamentos_excluidos`, com a linha inteira em `dados jsonb`, quem apagou e
quando. Gatilho `before delete`, pelos motivos do §2.3. Leitura da equipe
interna do escritório (igual a `tarefas_excluidas`), escrita só do gatilho —
conferido: escrever de fora volta `42501`, e de outro escritório a consulta
devolve 0 linhas.

### 4 · Excluir parceiro

`excluir-parceiro` exige `parceiros:excluir` (sensível, só admin por padrão) e
apagava a pessoa sem rastro.

**Fechado**: `parceiro.excluido` com nome, casos desvinculados e outros vínculos,
gravado antes do cascade. Provado no staging:

```
parceiro.excluido  {"nome":"[Prova5] Parceiro descartável","casos_desvinculados":0,"outros_vinculos":1}
```

### 5 · Convite

`membros.convidado_por` dizia quem convidou, mas é **estado, não história**:
apagou o vínculo, o convite desaparecia com ele.

**Fechado**: `equipe.convidado` / `parceiro.convidado`, com nome, e-mail e
papel. (Na prova do staging o convite bateu no limite de e-mail do Supabase na
quarta tentativa seguida — vale saber que esse limite existe ao testar convite
em série.)

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

### A automação, que já está no lugar

O `scripts/rbac-conferir-exigencias.mjs` ganhou uma quarta conferência (27/09),
no mesmo truque do espelho de exigências:

- **`DEVEM_AUDITAR`** — 24 funções de `public` que, se existirem no banco-alvo,
  precisam chamar `private.auditar`. Função da lista sem a chamada = divergência.
- **`FN_DEVEM_AUDITAR`** — as 4 edge functions que auditam elas mesmas (o banco
  não as vê), conferidas por `grep` no código.
- **Gatilhos das trilhas** — `documentos` e `andamentos` têm de ter o
  `zz_trilha_exclusao` ligado quando a tabela da trilha existe.

Saída de hoje, no local e no staging:

```
  funções que devem auditar: 24 no banco + 4 edge
OK: o espelho do front bate com o servidor, e quem muda acesso audita.
```

E ele **pega de verdade**: tirando o `private.auditar` do `desligar_parceiro` no
banco local, a saída virou

```
  - NÃO AUDITA: desligar_parceiro muda acesso/apaga dado e não chama private.auditar
```

Entrada nova na lista = conserto de gap novo. É o que impede este documento de
virar retrato de um dia só.

A spec `rbac-exigencias` roda esse script na suíte, então a conferência vai junto
com todo `bun run e2e:local`.

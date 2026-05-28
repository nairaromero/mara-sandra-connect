# Visão do Parceiro — Mapeamento tela por tela

> Como a UI deve se comportar quando o usuário logado é `tipo='parceiro'` vs `tipo='interno'`. Para discussão e validação antes de implementar refinos.

---

## 1. Princípios gerais

1. **Parceiro só vê os casos dele** — RLS já garante via `casos.parceiro_id = auth.uid()`. Toda query do frontend já respeita isso (não há query "all casos").
2. **Parceiro lê, não edita** — exceto chat (pode mandar mensagem) e criação de caso novo (com auto-vínculo a ele mesmo).
3. **Dados sensíveis filtrados** — CPF mascarado (`***.123.456-**`), sem telefone/email do cliente, sem senha MEU INSS, sem observações internas.
4. **Andamentos filtrados por `visivel_parceiro=true`** — interno marca o que parceiro vê (default depende do contexto, ver INTEGRACOES).
5. **Botões de ação técnica escondidos** — Sync TI, Sync Legal, Buscar Legalmail, Editar caso/cliente/andamento, Excluir — tudo só interno.

---

## 2. Sidebar / Navegação ([app-sidebar.tsx](../src/components/app-sidebar.tsx))

### Itens visíveis a TODOS

- Casos (`/`)
- Documentos pendentes (`/documentos`)
- Repasses (`/repasses`) — tela ainda não existe
- Conversas (`/conversas`)
- Configurações (`/configuracoes`)

### Itens visíveis SÓ ao interno

- Parceiros (`/parceiros`) ✓ já filtrado

### Avaliações

- ✅ **OK como está.** "Documentos pendentes" e "Repasses" no menu fazem sentido pro parceiro também (ele vê só os dele).
- 🤔 **Avaliação futura:** rebatizar "Casos" pra "Meus casos" só na visão de parceiro? Detalhe estético.

---

## 3. `/` Dashboard ([index.tsx](../src/routes/_authenticated/index.tsx))

### Estado atual

| Aspecto | Interno | Parceiro |
|---|---|---|
| Métricas no topo | Visão geral do escritório | Métricas dele |
| Lista de casos | 10 mais recentes do escritório | "Meus casos" (todos os dele) |
| Coluna "Parceiro" na tabela | Sim | Não (redundante — todos são dele) |
| Título do card | "10 casos mais recentes" | "Meus casos" |

### O que pode melhorar

- 🔴 **Métricas pro parceiro precisam ser definidas** — hoje provavelmente mostra contagens genéricas. Ele se importa com: quantos casos ativos, quanto a receber (repasses pendentes), quanto recebeu no mês, etc.
- 🟡 **Card de "destaque/ação pendente"** — algo tipo "1 documento aguardando sua atenção" pra ele saber o que fazer ao logar.
- 🟢 **Avaliar tom da mensagem** — "Bem-vindo, Dr. <nome>" personalizado.

---

## 4. `/casos/novo` ([casos.novo.tsx](../src/routes/_authenticated/casos.novo.tsx))

### Estado atual

| Aspecto | Interno | Parceiro |
|---|---|---|
| Cadastrar caso | Sim | Sim |
| Toggle "Cliente interno do escritório" | Sim | Provavelmente escondido — verificar |
| Select de parceiro indicador | Sim (escolhe qualquer) | Auto-vinculado a ele mesmo |
| Checks de duplicidade no TI/Legalmail | TODO (não implementado ainda) | TODO (Curto prazo do TODO.md) |

### O que pode melhorar

- 🔴 **Confirmar:** o parceiro NÃO pode marcar "Cliente interno do escritório" — sempre vincula a ele. Verificar no código (linha 246 do `casos.novo.tsx` parece já tratar via `isInterno`).
- 🟡 **Aviso ao salvar** — "Esse caso será vinculado a você como parceiro indicador" pra ele ter clareza.
- 🟡 **Implementar checks TI + Legalmail** — quando parceiro digita CPF/nome, verificar se já existe (alerta de duplicidade). _(item Curto prazo)_

---

## 5. `/casos/$id` ([casos.$id.tsx](../src/routes/_authenticated/casos.$id.tsx))

A tela mais complexa, com 7 abas. 55 ocorrências de `isInterno` no arquivo.

### Header

| Elemento | Interno | Parceiro |
|---|---|---|
| Nome do cliente + tipo benefício | Visível | Visível |
| CPF | Completo (`123.456.789-10`) | Mascarado (`***.123.456-**`) ✓ |
| Tags TI coloridas | Visíveis | **Avaliação:** mostrar ou esconder? Algumas tags são internas (MARA/MT) outras refletem status (STATUS:ATIVO) — talvez filtrar |
| Botão "Sync TI" | Sim | Não ✓ |
| Botão "Sync Legal" | Sim | Não ✓ |

🤔 **Decisão pendente:** mostrar tags TI pro parceiro? Tem informação útil mas também tem códigos internos que confundem.

### Aba "Visão geral"

| Elemento | Interno | Parceiro |
|---|---|---|
| Card "Dados do cliente" | Tudo + botão Editar | Nome + CPF mascarado + nascimento (sem telefone/email/observações) ✓ |
| Card "Configurações do caso" | Linha discreta + botão Editar | **Avaliação:** mostrar ou esconder? Hoje provavelmente mostra |

🤔 **Decisão pendente:** parceiro vê o card "Configurações do caso" (linha discreta)? Se vê, ele vê só algumas coisas (tipo benefício, fase, status) ou esconde completamente o card?

### Aba "Andamentos"

| Elemento | Interno | Parceiro |
|---|---|---|
| Lista de andamentos | TODOS | Só `visivel_parceiro=true` ✓ |
| Card "Andamentos Administrativos" | Sempre | Aparece se há andamento visível admin |
| Card "Andamentos Judiciais" | Sempre se há processo jud | Aparece se há andamento visível jud |
| Card "Andamentos Gerais" | Se há sem vínculo | Aparece se há sem vínculo visível |
| Sub-seção "Sem processo" | Notas TI órfãs | **Avaliação:** parceiro precisa ver? São sem vínculo |
| Botões Editar/Excluir | Sim | Não ✓ |
| Botão "Novo andamento" | Sim | Não ✓ |
| Checkbox de seleção (transferir) | Sim | Não ✓ |
| Badges "visivel_parceiro / interno" | Sim | Não (irrelevante pra ele) ✓ |
| Accordions por processo | Sim | Sim (informação útil) |

🤔 **Decisão pendente:** parceiro pode mandar mensagem perguntando sobre um andamento? Hoje não tem botão "Comentar" em andamento — toda interação vai pra Chat.

### Aba "Documentos"

(Precisa verificar — vou listar o atual quando você validar)

### Aba "Análise técnica"

| Elemento | Interno | Parceiro |
|---|---|---|
| Análise completa (resultado_json, RMI, tokens, custo, etc.) | Sim | **Não** — só vê `resumo_parceiro` (campo já existe) |
| Botão "Nova análise" | Sim | Não |

✅ **Já implementado** — coluna `analises_tecnicas.resumo_parceiro` foi adicionada justamente pra isso. Verificar se UI respeita.

### Aba "Chat"

| Elemento | Interno | Parceiro |
|---|---|---|
| Ver mensagens | Sim | Sim |
| Enviar mensagem | Sim | Sim ✓ |
| Polling de novas msgs | Sim (30s) | Sim |

✅ **OK** — chat é justamente o canal de interação.

### Aba "Repasses"

| Elemento | Interno | Parceiro |
|---|---|---|
| Ver repasses do caso | Sim | Sim (só os dele — já é dele por definição se o caso é dele) |
| Marcar como pago | Sim | Não |
| Adicionar repasse | Sim | Não |

🤔 **Avaliação:** confirmar visibilidade. Hoje a tab provavelmente respeita `isInterno`.

### Aba "Processos"

| Elemento | Interno | Parceiro |
|---|---|---|
| Ver aba | Sim ✓ | **Não** ✓ |

✅ Já condicional ao `isInterno` (linha 699 da `casos.$id.tsx`).

🤔 **Reconsiderar?** O parceiro pode querer ver os processos do caso dele (CNJ do judicial pra mostrar ao cliente). Considerar mostrar uma versão **read-only** da aba.

---

## 6. `/parceiros` ([parceiros.tsx](../src/routes/_authenticated/parceiros.tsx))

### Estado atual

✅ **Bloqueada pra parceiro** — linha 160 redireciona se não for interno.

Nada a mudar.

---

## 7. `/documentos` ([documentos.tsx](../src/routes/_authenticated/documentos.tsx))

### Estado atual

Tela global de solicitações de documento pendentes.

| Aspecto | Interno | Parceiro |
|---|---|---|
| Solicitações visíveis | Todas | Só dos casos dele |
| Marcar como atendido | Sim | Provavelmente sim (parceiro atende solicitações enviando docs) |
| Marcar como dispensado | Sim | Não (só interno decide dispensar) |
| Criar nova solicitação | Sim (no contexto do caso) | Não |

🤔 **Avaliação:** precisa rever o que o parceiro pode fazer aqui. Idealmente:
- **Parceiro vê** "documentos que o escritório está pedindo" e **upload**
- **Interno vê** "documentos solicitados" + status + ações

---

## 8. `/conversas` ([conversas.tsx](../src/routes/_authenticated/conversas.tsx))

Lista de chats por caso (polling 30s).

| Aspecto | Interno | Parceiro |
|---|---|---|
| Conversas visíveis | Todas | Só dos casos dele |

✅ Provavelmente OK via RLS de `mensagens` por `caso_id` filtrado.

🤔 **Avaliação:** confirmar que parceiro só vê seus chats. Indicador de "mensagens não lidas" é útil pra ambos.

---

## 9. `/configuracoes` ([configuracoes.tsx](../src/routes/_authenticated/configuracoes.tsx))

Perfil pessoal + logout.

| Aspecto | Interno | Parceiro |
|---|---|---|
| Editar nome | Sim | Sim |
| Trocar senha | Sim | Sim |
| Editar OAB | Sim | Sim |
| Logout | Sim | Sim |

✅ **Provavelmente OK como está** — tela pessoal funciona igual pra ambos.

🟢 **Adição opcional:** parceiro vê opção "SLA de aprovação" (configurável por parceiro — decisão já tomada na ARQUITETURA §6.2).

---

## 10. `/repasses` (não criada)

Quando criar:

| Aspecto | Interno | Parceiro |
|---|---|---|
| Repasses visíveis | Todos do escritório, por parceiro | Só os dele |
| Filtros | Por parceiro, status, mês | Por caso, status, mês |
| Totais | Por parceiro / total geral | Total a receber, total recebido |
| Marcar como pago | Sim | Não |
| Exportar | Sim | Possivelmente (PDF do extrato) |

---

## 11. Checklist priorizado de implementação

### 🔴 Críticos antes de lançar com parceiro real

- [ ] **Aba "Análise técnica" — confirmar `resumo_parceiro`** — parceiro NÃO pode ver dados de tokens/custo IA, só o resumo redigido
- [ ] **Aba "Documentos" — revisar permissões** — o que parceiro pode atender/upload
- [ ] **Header — decidir sobre tags TI** — esconder, mostrar todas, ou filtrar?
- [ ] **Aba "Visão geral" card Configurações do caso** — esconder pro parceiro ou mostrar versão simplificada?

### 🟡 Importantes (primeiras semanas)

- [ ] **Dashboard pro parceiro** — métricas próprias (casos ativos, valor a receber, etc.)
- [ ] **Tela `/repasses` criada** — pra ambos os papéis
- [ ] **Aviso ao salvar `/casos/novo`** — "Será vinculado a você como parceiro"
- [ ] **Aba "Processos" read-only** — parceiro vê CNJ do processo (útil pra mostrar ao cliente)

### 🟢 Polimento

- [ ] **"Casos" → "Meus casos"** no sidebar do parceiro
- [ ] **Boas-vindas personalizadas** na dashboard
- [ ] **SLA de aprovação configurável** nas configurações do parceiro
- [ ] **Indicador de "ação pendente"** na sidebar/dashboard

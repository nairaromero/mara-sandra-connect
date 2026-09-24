# Classe inversa: onde o servidor deixa passar o que o papel não deveria permitir

Companheiro de `planning/RBAC_AUDITORIA_TELAS.md`. Lá o problema era a tela oferecer o que o
banco recusa (incômodo, sem risco de acesso). **Aqui é o contrário**: a pessoa consegue fazer,
e o único freio era a tela. Cada item tem uma **recomendação minha** — você aprova, corrige ou
descarta. Nada foi mexido ainda.

Levantado em 24/09/2026 contra o banco de staging, com as escritas do front conferidas arquivo
a arquivo (inclusive as encadeadas em várias linhas, que uma busca ingênua não pega).

---

## Grupo 1 · Tabelas de domínio que qualquer pessoa do escritório pode escrever

São 22 tabelas com `escritorio_id` que não têm policy de permissão: o banco confere só que a
linha é do escritório ativo. Elas se dividem em duas situações bem diferentes.

### 1a. A tela escreve nelas (8) — precisa de decisão de produto

| Tabela | O que é | Quem escreve hoje | Recomendação |
|---|---|---|---|
| `solicitacoes_documento` | o pedido de documento feito ao cliente ou parceiro | qualquer interno; **provado: o financeiro apaga um pedido para sempre** | **exigir `casos:editar`** para criar, editar e apagar. Quem não atende o caso não mexe no pedido. Parceiro continua podendo responder (a tela dele usa outro caminho) |
| `comentarios` | comentários do caso e das conversas | qualquer interno apaga o comentário de qualquer um | **criar exige `casos:ler`** (quem vê o caso comenta, inclusive parceiro); **apagar só o próprio autor, ou admin** |
| `notificacoes` | avisos na sineta | "Limpar todas" apaga as linhas **do escritório inteiro**, não as da pessoa | **restringir a escrita ao destinatário** (`usuario_id = auth.uid()`). É bug, não política: o mesmo erro já foi corrigido no "dispensar", que virou `notificacao_dispensada` |
| `webhook_destinos` | destinos de webhook | qualquer interno, mas a tela está "Em breve" e o componente é **código morto** | **revogar a escrita agora** e devolver junto com o módulo, por function |
| `conversa_leitura` | marca de "li até aqui" | a própria pessoa | **deixar como está** (a linha é dela; a policy já a prende ao escritório) |
| `notificacao_dispensada` | aviso dispensado por pessoa | a própria pessoa | **deixar como está** |
| `usuario_gmail_oauth` | conexão do Gmail da pessoa | a própria pessoa | **deixar como está** |
| `alertas_duplicidade` | registro de CPF repetido ao criar caso | quem cria caso | **exigir `casos:editar`**, que é quem chega nessa tela |

### 1b. A tela nunca escreve nelas (14) — não é decisão, é limpeza

`acessos_documento`, `acessos_senha_inss`, `comentario_email_throttle`, `contratos_parceria`,
`inss_email_log`, `mensagens`, `oabs_monitoradas`, `tarefas_excluidas`, `webhook_eventos`,
`whatsapp_ativacao_codigos`, `whatsapp_lid_map`, `whatsapp_mensagens`, `whatsapp_outbox`,
`whatsapp_sessoes`.

Quem escreve nelas é function com chave de serviço, gatilho do banco ou RPC privilegiada. O
navegador ainda tem permissão de inserir, alterar e apagar em todas — permissão que ninguém
usa e que vale por si só como porta aberta (`tarefas_excluidas` é o histórico de exclusões;
`acessos_documento` e `acessos_senha_inss` são trilha de auditoria; `whatsapp_outbox` é a fila
de envio).

**Recomendação: revogar `insert`, `update` e `delete` de `authenticated` nas 14.** Impacto no
produto: nenhum, porque nada na tela escreve nelas. Ganho: a trilha de auditoria e a fila de
mensagens deixam de ser graváveis por qualquer sessão de navegador.

---

## Grupo 2 · Funções privilegiadas do banco

Funções `SECURITY DEFINER` passam por cima das policies. Três são chamáveis pelo navegador e
escrevem em tabela de domínio:

| Função | O que faz | O que confere hoje | Recomendação |
|---|---|---|---|
| `aplicar_template` | cria o pacote de tarefas de um template no caso | é interno + o caso é do escritório | **somar `tarefas:gerenciar`**, a mesma permissão que a tabela exige. Hoje o financeiro cria tarefas por aqui, embora não possa criar uma diretamente |
| `vincular_publicacao_dje` | liga uma publicação a um caso e gera andamento | é interno + o caso é do escritório | **somar `casos:editar`**, igual à tabela `andamentos` |
| `set_senha_meu_inss` | grava a senha do MEU INSS do cliente | o caso é do escritório | **somar `senha_inss:ler`** (quem não pode nem ver a senha não deveria trocá-la) |

As outras duas encontradas (`_caso_fase_pelo_processo`, `_reabre_caso_finalizado`) são
gatilhos: não dá para chamá-las de fora. **Recomendação: tirar o `execute` de `anon` e
`authenticated` delas**, que é resto de configuração antiga.

---

## Grupo 3 · Edge functions que pedem só "ser interna"

Quinze functions de pessoa conferem apenas o tipo. Proposta de permissão para cada uma, usando
o que já existe na matriz:

| Function | O que faz | Permissão sugerida |
|---|---|---|
| `ia-assistant` | chat de IA dentro do sistema | `ia:usar`. **Atenção a uma contradição**: a function foi escrita para atender parceiro também (monta outro prompt e limita aos casos dele), mas o CLAUDE.md diz que IA é só para interno e a tela esconde o launcher do parceiro. Antes de somar a permissão, decida qual das duas vale — `ia:usar` hoje é de admin, advogado e assistente, então exigi-la fecha a porta do parceiro por tabela |
| `ia-triagem-andamentos` | classifica andamentos com IA | `ia:usar` |
| `sugerir-proxima-tarefa` | sugere a próxima tarefa com IA | `ia:usar` |
| `mensagem-parceiro-exigencia` | reescreve a exigência em linguagem simples com IA | `ia:usar` |
| `extrair-agendamento-pericia` | lê o comprovante de perícia com IA | `ia:usar` |
| `ia-config` | cofre de chaves de IA por pessoa | `ia:usar` para o uso comum (o caminho de emitir token para outra pessoa já exige `ia:mcp_conceder`) |
| `sync-datajud-movimentacoes` | puxa movimentações do DataJud | `casos:editar` (grava andamento) |
| `sync-djen-caso` | puxa o teor das publicações do caso | `casos:editar` |
| `sync-legalmail-caso` | importa processos do Legalmail | `casos:editar` |
| `sync-ti-cliente` | sincroniza o cliente com o Tramitação | `casos:editar` |
| `listar-processos-legalmail` | lista processos do provedor | `processos:ler` |
| `listar-clientes-ti` | lista clientes do provedor | `casos:ler` |
| `check-legalmail-nome` | busca processo por nome | `processos:ler` |
| `cnj-consulta-processo` | consulta pública do CNJ | **deixar como está**: é dado público e não escreve nada |
| `convidar-usuario` | convida pessoa | **já está certo**: confere `equipe:gerenciar` para interno e `parceiros:gerenciar` para parceiro |

Por que isso importa mais do que parece: as de IA **gastam dinheiro** por chamada, e as de
sincronização **consomem cota** dos provedores e gravam no caso.

---

## Ordem sugerida de execução

1. **Sem decisão nenhuma** (impacto zero no produto): revogar a escrita das 14 tabelas do 1b e
   o `execute` dos dois gatilhos. Uma migration.
2. **Bugs disfarçados de política**: notificações por destinatário e apagar comentário só do
   autor. Uma migration, corrige comportamento errado.
3. **As três funções do banco** ganham a permissão que a tabela já exige. Uma migration.
4. **As catorze functions** ganham a permissão sugerida. Um lote, testável no staging.
5. **Decisões de produto de verdade** (as suas): `solicitacoes_documento`, `webhook_destinos`,
   `alertas_duplicidade`. Uma migration depois da sua palavra.

Cada passo é reversível e nenhum mexe em dado, só em quem pode. O verificador
(`scripts/rbac-conferir-exigencias.mjs`) acusa qualquer exigência nova que a tela não espelhe,
então a tela e o servidor continuam dizendo a mesma coisa.

## O que eu não recomendo mexer

- `conversa_leitura`, `notificacao_dispensada` e `usuario_gmail_oauth`: a linha é da própria
  pessoa e o escritório já está travado.
- `cnj-consulta-processo`: consulta pública, sem escrita.
- Tabelas de leitura que já têm policy de permissão: estão cobertas.

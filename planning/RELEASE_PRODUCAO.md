# Release `staging → main` — plano de execução

Escrito em 27/09/2026. **Nada daqui foi executado.** É a ordem, os comandos e o
que conferir; cada passo em produção só roda com o OK da Naira.

Companheiro deste plano: `planning/COMUNICADO_PRODUCAO.md`, que é o que a equipe
recebe **antes** do release.

---

## 0. O que este release leva

`staging` está **17 PRs / 94 commits / 241 arquivos** à frente da `main`.

| Camada | O quê |
|---|---|
| Banco | **30 migrations** faltando em produção (a produção tem 23 registradas; o staging, 46) |
| Edge functions | **33** para deployar, **2** para apagar (`check-ti-cliente`, `sync-ti-todos`) |
| Front | RBAC em todas as telas, QG em host próprio, Configurações em abas, glossário, paginador, marca por escritório, MFA |
| Infra | `qg.marasandraconnect.com` (criado pelo deploy, via `wrangler.jsonc`), 2 cron novos, n8n sai da rotina do DJEN |

Os PRs, do mais antigo para o mais novo: #373, #375, #376, #379, #380, #377,
#383, #384, #387, #389, #391, #396, #399, #400, #402, #401, #394.

O grosso é o **RBAC multi-tenant** (#396) e o que veio depois dele (#399 ajuste
de permissões por pessoa, #402 MCP). O resto são correções que já estavam na
fila: escalada de privilégio na RLS (#373), functions abertas (#375), assinatura
de cron (#376), fuso de Brasília (#377), kanban por processo (#391), reabertura
de caso (#394).

A **`rbac_24`** nasceu depois deste plano ([#405](https://github.com/nairaromero/mara-sandra-connect/pull/405), achada filmando o comunicado): a auditoria passou a seguir a permissão `auditoria:ler` em vez do papel admin. Entra na lista do §3.4, logo depois da `rbac_23`.

**Seis migrations deste código já estão em produção** — foram hotfixes de
segurança aplicados antes do release (`migration_usuarios_guard_privilegios`,
`migration_rls_with_check_e_vinculos`, `migration_revoke_execute_anon`,
`migration_anon_sem_escrita`, `migration_chamadas_sistema_assinadas`,
`migration_remove_intake_trello_runs`). Rodar de novo é inofensivo, mas não
precisa: o registro já as tem.

---

## 1. Antes de abrir o PR de release

- [ ] **Naira validou o lote no staging**, com a conta do papel certo (guia v18, seções A–H e J–R).
- [ ] **O staging passou por um espelho semanal** depois do lote (prova que o espelho não destrói o RBAC — foi por isso que o passo 6/6 do `espelho-staging.sh` reaplica as migrations e o seed).
- [ ] **Suíte completa verde no local**: `bun run e2e:local`. Última rodada
      completa antes do merge do #394: 143 passed, 1 skipped, 1 failed — e a
      falha era justamente a migration do #394, que ainda não estava no banco.
      Aplicada, a spec passa (`frente-unica`, 9 passed). Rodar a completa de novo
      como gate, num local recém-copiado do staging.
- [ ] **`bunx tsc --noEmit`** limpo.
- [ ] **`node scripts/rbac-conferir-exigencias.mjs`** sem sobra nem falta (espelho da tela × banco).
- [ ] **Comunicado enviado à equipe** (`COMUNICADO_PRODUCAO.md`), com a janela combinada.
- [ ] **#398 e #393 ficam de fora** — são PRs abertos para a `staging`; não entram neste release.

```bash
gh pr create --base main --head staging --label release \
  --title "release: RBAC multi-tenant, QG, permissões por pessoa e o lote de setembro"
```

O label `release` é o que mantém o PR fora do board. **Merge com "Create a merge
commit"** — nunca squash: é o que garante que a `main` não divirja da `staging`.

---

## 2. A janela: este release não é sem parada

Código e banco vão juntos, e não há como fazê-los chegar no mesmo instante:

- **Migrations antes do front**: o front antigo não manda `x-escritorio-id`, e o
  banco novo responde "nada" — as telas ficam **vazias**, sem erro.
- **Front antes das migrations**: o front novo chama `meu_contexto()` e
  `minhas_permissoes()`, que ainda não existem — dá **erro na cara** e o login
  não completa.

Vazio é melhor do que erro, então a ordem é **banco primeiro, front por último**.
E as functions vêm antes das duas, porque são as mais demoradas e as menos
usadas de momento a momento.

| Fase | Duração | O que a equipe sente |
|---|---|---|
| Deploy das 33 functions | ~20 min | nada, exceto se alguém usar IA, convite ou sync naquele minuto (erro) |
| 30 migrations | ~5 min | **telas vazias** a partir da `rbac_03` |
| Merge + build do front | ~4 min | telas vazias até o build acabar |
| Conferência | ~10 min | normal |

**Janela real de sistema inutilizável: ~10 minutos.** Escolher um horário
**depois das 20h**, nunca de manhã: os cron rodam às 5h (INSS), 9h (DataJud),
9h45 (digest), 10h30 (DJEN rematch) e 11h (perícia, implantação, lembretes).

---

## 3. Execução, na ordem

### 3.1 Antes de tudo: TOTP ligado no Auth de produção

Dashboard do projeto `llugytkdsfsrciavhrfw` → **Authentication → Multi-factor →
TOTP habilitado**.

Isto vem primeiro porque a `migration_rbac_11` deixa `qg_exigir_aal2 = true`: sem
TOTP no Auth, **ninguém entra no QG** e ninguém consegue cadastrar o
autenticador.

### 3.2 Deploy das 33 functions (uma por vez, nunca `--no-verify-jwt`)

```bash
for f in check-legalmail-nome cnj-consulta-processo convidar-usuario digest-diario \
         excluir-parceiro extrair-agendamento-pericia extrair-dados-cliente \
         gmail-oauth-callback gmail-oauth-start ia-analise ia-assistant ia-config \
         ia-mcp ia-triagem-andamentos inss-email-processor integracoes-escritorio \
         listar-clientes-ti listar-processos-legalmail mensagem-parceiro-exigencia \
         notify-novo-andamento notify-novo-comentario notify-solicitacao-doc \
         qg-escritorios send-email-hook sugerir-proxima-tarefa \
         sync-datajud-movimentacoes sync-djen-caso sync-djen-publicacoes \
         sync-legalmail-caso sync-ti-cliente update-parceiro whatsapp-inbound \
         whatsapp-outbox-enviar; do
  echo "== $f"
  bunx supabase functions deploy "$f" --project-ref llugytkdsfsrciavhrfw || break
done
```

O `verify_jwt` de cada uma está declarado em `supabase/config.toml` e o deploy
respeita o que está lá — a flag na linha de comando sobreporia o arquivo.

**Apagar as duas que saíram** (a `check-ti-cliente` virou `sync-ti-cliente`, e a
`sync-ti-todos` saiu com o intake):

```bash
bunx supabase functions delete check-ti-cliente --project-ref llugytkdsfsrciavhrfw
bunx supabase functions delete sync-ti-todos   --project-ref llugytkdsfsrciavhrfw
```

### 3.3 Segredos (conferir, não recriar)

```bash
bunx supabase secrets list --project-ref llugytkdsfsrciavhrfw
```

| Segredo | Valor esperado em produção |
|---|---|
| `APP_BASE_URL` | `https://marasandraconnect.com` (já conferido por hash em 24/09) |
| `GMAIL_REDIRECT_URI` | `https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/gmail-oauth-callback`, e essa URL cadastrada no console do Google |
| `MSC_SYSTEM_SECRET` | existe **e** igual ao `msc_system_secret` do Vault — é o que assina as chamadas de cron |
| `IA_MASTER_KEY` | existe (cifra as credenciais de integração por escritório) |
| `LEGALMAIL_TOKEN`, `TI_TOKEN`, `EVOLUTION_*` | como hoje: é o legado do escritório padrão, e é o que faz Legalmail/TI/WhatsApp seguirem funcionando no dia 1 |
| `COMUNICA_BASE_URL`, `GOOGLE_*_URL`, `GMAIL_API_BASE`, `*_BASE_URL` dos mocks | **não devem existir** — são só do local |

### 3.4 As 30 migrations, nesta ordem (a mesma que o staging provou)

```bash
for m in migration_kanban_por_processo migration_solicitacao_responsavel_edicao \
         migration_frente_unica_e_dono_do_pedido \
         migration_rbac_01_modelo_acesso migration_rbac_02_escritorio_id \
         migration_rbac_03_isolamento migration_rbac_04_rpcs migration_rbac_05_qg \
         migration_rbac_06_qg_paginacao migration_rbac_07_suporte_escritorio \
         migration_rbac_08_excluir_so_admin migration_rbac_09_integracoes_por_escritorio \
         migration_rbac_10_marca_por_escritorio migration_rbac_11_qg_aal2 \
         migration_rbac_12_mcp_para_terceiro migration_rbac_13_integracoes_status \
         migration_rbac_14_whatsapp_outbox_por_escritorio \
         migration_cron_djen migration_cron_whatsapp_outbox \
         migration_rbac_15_escrita_so_por_funcao migration_rbac_16_notificacao_e_comentario \
         migration_rbac_17_rpc_com_permissao migration_rbac_18_solicitacoes_e_alertas \
         migration_rbac_19_ticket_de_suporte migration_rbac_20_permissoes_por_pessoa \
         migration_rbac_21_contexto_efetivo migration_rbac_22_papel_limpa_ajustes \
         migration_rbac_23_membro_pode migration_rbac_24_auditoria_por_permissao \
         migration_reabre_caso_so_com_autor; do
  echo "== $m"
  node scripts/msc-sql.mjs --file "planning/sql-migrations/$m.sql" || break
done
```

Pontos de atenção dentro desta lista:

- **`rbac_03_isolamento` é onde a janela começa.** Daí para a frente o front
  antigo mostra tela vazia.
- **`cron_djen` e `cron_whatsapp_outbox` só fazem efeito aqui.** No staging elas
  ficaram registradas como aviso (não há pg_cron lá). Em produção elas criam
  `msc-djen-sync` e `msc-whatsapp-outbox` de verdade.
- **Saída 3 do script** = a migration rodou mas não registrou; a mensagem traz o
  comando de `--registrar` para consertar. Não seguir sem resolver: o board
  depende do registro.
- `rbac_01` faz o backfill: todo usuário vira membro do escritório padrão
  (interno → advogado, `eh_admin` → admin, parceiro → parceiro).

### 3.5 Merge do PR de release

Botão **"Create a merge commit"**. O Workers Builds do projeto de produção
builda a `main` e publica `mara-sandra-connect` → marasandraconnect.com. O deploy
também cria o custom domain `qg.marasandraconnect.com` (está no
`wrangler.jsonc`); **DNS de terceiro nível pode levar alguns minutos** — no
staging levou.

Depois do merge, só:

```bash
git checkout staging && git pull
```

### 3.6 Staff do QG

Sem isto o QG sobe vazio: ninguém entra.

```bash
node scripts/msc-sql.mjs "insert into public.plataforma_staff (usuario_id, papel, ativo)
  select id, 'dono', true from public.usuarios
   where email in ('nairaromerovian@gmail.com','marasandra.adv@gmail.com')
  on conflict (usuario_id) do update set papel = 'dono', ativo = true"
```

Na primeira entrada em `qg.marasandraconnect.com` cada uma cadastra o
autenticador na própria tela (o QG exige o código).

### 3.7 Desligar o DJEN do n8n

Na máquina do Evolution, workflow `djen-sync` → **desativar**. Se ficar ligado,
as publicações entram em dobro (o `msc-djen-sync` do pg_cron já faz o mesmo
trabalho).

O n8n continua instalado, sem rotina nossa — não criar rotina nova nele.

---

## 4. Conferir de verdade (deploy verde ≠ funcionando)

```bash
# 1. as 30 entraram no registro (23 antes + 30 = 53)
node scripts/msc-sql.mjs "select count(*) from ops.migrations_aplicadas"

# 2. o modelo de acesso nasceu certo
node scripts/msc-sql.mjs "select (select count(*) from escritorios) escritorios,
  (select count(*) from membros) membros, (select count(*) from membros where status='ativo') ativos,
  (select count(*) from papeis) papeis, (select count(*) from permissoes) permissoes,
  (select count(*) from permissoes where sensivel) sensiveis,
  (select count(*) from papel_permissoes) papel_permissoes"
# esperado hoje: 1 escritório (produção não tem o Canário do staging), 31 membros /
#   28 ativos (um por usuário), 5 papéis, 26 permissões (7 sensíveis), 65 papel_permissoes

# 3. ninguém ficou sem papel nem com dado fora do escritório
node scripts/msc-sql.mjs "select count(*) as sem_membro from usuarios u
  where not exists (select 1 from membros m where m.usuario_id = u.id)"
node scripts/msc-sql.mjs "select count(*) as orfaos from casos where escritorio_id is null"

# 4. os dois cron novos (total 11) e a primeira execução
node scripts/msc-sql.mjs "select jobname, schedule, active from cron.job order by jobname"
node scripts/msc-sql.mjs "select jobname, status, start_time, return_message
  from cron.job_run_details order by start_time desc limit 10"

# 5. quem administra continua administrando
node scripts/msc-sql.mjs "select u.nome, p.chave from membros m
  join usuarios u on u.id=m.usuario_id join papeis p on p.id=m.papel_id
  where p.chave='admin' and m.status='ativo'"
# esperado: Naira e Mara
```

Na tela, com gente de verdade:

- [ ] **Naira** entra, vê o menu completo, abre Equipe, Auditoria e Configurações → Integrações.
- [ ] **Uma pessoa advogada** entra, vê os casos, cria tarefa, e **não** vê Equipe nem Auditoria.
- [ ] **Um parceiro** entra e vê só os casos que indicou.
- [ ] `qg.marasandraconnect.com` abre, pede o código, e o QG lista 1 escritório.
- [ ] Um caso qualquer abre com documentos, andamentos e tarefas (prova que a RLS não comeu nada).
- [ ] Logs das functions no painel sem 500: `integracoes-escritorio`, `ia-mcp`, `qg-escritorios`, `inss-email-processor`.

No dia seguinte:

- [ ] `cron.job_run_details` com `msc-djen-sync` verde, e **sem publicação duplicada**.
- [ ] `msc-inss-email` das 5h rodou e criou o que devia.

---

## 5. Se der errado

**Não existe "down" das migrations.** Elas criam tabelas, colunas
`escritorio_id not null`, policies e gatilhos. Reverter é:

1. `git revert -m 1 <sha-do-merge>` na `main` (devolve o front antigo) — e **isso
   sozinho não resolve**, porque o banco continua exigindo o header;
2. restaurar o banco por **PITR** para o instante anterior à primeira migration.

Ou seja: a decisão de reverter tem custo alto e precisa ser tomada **rápido**,
antes de entrar dado novo. É por isso que a janela é à noite, com as duas
administradoras acompanhando, e não no meio do dia.

Falhas parciais têm saída mais simples:

| Problema | Saída |
|---|---|
| Uma migration falhou no meio | O script para no erro (`|| break`). Corrigir e continuar da que falhou — são idempotentes |
| Front no ar e telas vazias | Conferir se o build da `main` terminou; um F5 resolve para quem estava com a aba aberta |
| Function respondendo 500 | Ver o log; quase sempre é segredo faltando (§3.3) |
| QG não abre | DNS do `qg.` ainda propagando, ou `plataforma_staff` vazio (§3.6) |
| Publicação em dobro | Workflow do n8n ainda ligado (§3.7) |

---

## 6. Depois

- [ ] **Board**: os cards do lote vão para **Produção** quando o commit está na
      `main` **e** a migration está no registro de produção. `node
      scripts/board-sync.mjs release --dry-run` mostra o que vai mover antes de
      mover.
- [ ] **Issues sem `Closes` em commit** não fecham sozinhas — fechar à mão
      (#395, #385 e as do lote de setembro).
- [ ] **Espelho semanal**: na segunda seguinte, conferir que ele rodou e que o
      staging continua com RBAC (passo 6/6).
- [ ] **Decidir os papéis de verdade**: hoje todo mundo virou advogado. Se
      Mariane ou Sebastião devem ser Assistente, é agora — lendo antes o item 4
      do comunicado, porque Assistente só mexe no que é dele.
- [ ] **Ligar 2FA** nas contas de Naira e Mara.
- [ ] **Credenciais por escritório**: quando a Mara quiser, cadastrar Legalmail e
      TI pela tela (Configurações → Integrações) e aí os segredos legados
      `LEGALMAIL_TOKEN`/`TI_TOKEN` podem sair do ambiente.
- [ ] **#398 e #393** voltam para a fila da `staging`.

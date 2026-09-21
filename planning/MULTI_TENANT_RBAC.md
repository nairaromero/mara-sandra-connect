# Plano de multi-tenant e RBAC

> **Status: proposta.** Depende da decisão (a) × (b) que [DECISOES.md](DECISOES.md) §8
> deixou em aberto — ela vira o D23. A **Fase 0 é urgente e não depende dessa decisão.**
> Escrito em 2026-09-14 a partir de uma auditoria somente-leitura do banco, das 32 edge
> functions, do frontend, dos scripts, workflows e testes, cruzada com documentação
> oficial (Supabase, PostgreSQL), OWASP, AWS e normas da ANPD e da OAB.
> **Revisto em 2026-09-19** contra os 75 commits que entraram na `staging` desde então,
> com os números do banco medidos de novo.
> Estimativa de esforço: **19 a 26 semanas** para 1–2 devs — estimativa, a recalibrar ao
> fim da Fase 1.

Onde este documento divergir do banco, vale o banco — e corrija aqui
(`node scripts/msc-sql.mjs "select ..."`).

---

## Em uma página

- **Existem falhas graves hoje**, antes de qualquer multi-tenant: um parceiro logado
  consegue se promover a admin, funções do banco devolvem CPF para quem não está logado e
  edge functions abertas enviam o resumo do dia para qualquer e-mail. O repositório é
  público. Isso vira a [Fase 0](#fase-0--contenção) e deve começar já. Na revisão de
  19/09, só as permissões de escrita de `ia_tokens` tinham sido corrigidas (PR #297).
- **Modelo recomendado: pool** — um projeto Supabase, `escritorio_id` em todas as tabelas,
  RLS. O esquema fica portável para que um escritório grande possa ganhar projeto próprio
  depois, com o mesmo código. Isso revisa a recomendação de 23/08 em DECISOES §8 (§3).
- **A autorização continua no Postgres.** A permissão é lida da tabela de vínculos a cada
  consulta, nunca só do JWT, para que desligar alguém corte o acesso na hora. Uma policy
  `RESTRICTIVE` por tabela garante o escritório; as permissivas decidem o papel. FKs
  compostas tornam impossível gravar um filho apontando para o pai de outro escritório.
- **O maior risco não está nas policies**: as 93 funções `SECURITY DEFINER` e as 29 edge
  functions com service role ignoram RLS. Cada uma será reescrita a partir da definição de
  produção e coberta por teste.
- **Oito fases aditivas**, cada uma com portão de saída e rollback. Nenhuma fase muda o que
  o escritório 1 vê até a matriz de testes entre dois escritórios estar verde, e o primeiro
  cliente externo só entra depois do DPA e do runbook de incidente.

---

## 1. Exposições que existem hoje

Encontradas lendo o catálogo de produção e o código, sem explorar nenhuma. Todas se agravam
num banco com vários escritórios, porque o "outro parceiro" vira "outro escritório".
**Revalidadas item a item em 19/09**: seguem abertas, exceto `ia_tokens`.

| Sev. | Achado | Detalhe |
|---|---|---|
| **Crítico** | Parceiro se promove a interno/admin | `usuarios_update_self` é `USING (id = auth.uid() OR is_interno())` **sem `WITH CHECK`**; `authenticated` tem UPDATE em todas as colunas; único trigger é o de `updated_at`. Um PATCH na própria linha com `tipo='interno', eh_admin=true` passa. |
| **Crítico** | Edge functions sem autenticação, em repositório público | 16 funções não checam quem chama e 29 usam service role. `digest-diario` aceita `para` e manda o resumo do dia a qualquer e-mail; `listar-clientes-ti` devolve nome, CPF, telefone e nascimento; `sync-legalmail-caso`, `sync-djen-caso` e `sync-ti-cliente` gravam em qualquer `caso_id`. Os crons chamam sem credencial. |
| Alto | CPF de qualquer cliente sem login | `webhook_cliente_ref(p_caso_id)` é `SECURITY DEFINER`, executável por `anon`, sem checagem. São 21 RPCs `SECURITY DEFINER` abertas a `anon` em produção (43 no staging). |
| Alto | Parceiro alcança cliente e arquivo de outro caso | `casos_update` não valida `cliente_id`; as policies de insert em `documentos` aceitam qualquer `storage_path`, e o Storage libera o objeto pelo path. São 9 policies de UPDATE/ALL sem `WITH CHECK`. |
| Alto | Troca de e-mail de login de qualquer parceiro | `update-parceiro` deixa qualquer interno trocar o e-mail com `email_confirm:true` e dispara magic link para o endereço novo. |
| Alto | Staging aberto | Signup ligado e `usuarios_insert_interno` sem restrição de `tipo`; `anon` com DML em 46 tabelas e EXECUTE em `_inss_get_key()`, que devolve a chave de cifra do Vault. |
| Médio | Segurança só na tela | Contato do cliente escondido do parceiro só no front; `download_parceiro` não vale no Storage; aba Integrações é "só admin" na UI, mas `ia-config` e `gmail-oauth-start` aceitam qualquer interno; `usuarios_select_internos` mostra endereço e documento da equipe a qualquer parceiro. |
| Médio | Sem rede de segurança para uma migração grande | PITR desligado; 6,4 GB de Storage sem backup; nenhuma CI nos PRs; nenhum teste de RLS; 13 tabelas centrais e 36 policies sem fonte no repositório; o espelho semanal falhou duas semanas sem alerta; a branch `docs/backup-restore` foi apagada sem merge. |
| ✅ Corrigido | Tokens do MCP (PR #297) | Policies de escrita de `ia_tokens` removidas, `authenticated`/`anon` sem INSERT/UPDATE/DELETE, leitura só do dono, e `desligar_interno` revoga os tokens. É o precedente do padrão que a Fase 5 generaliza. |

---

## 2. O sistema em números

Medido no catálogo de produção em 19/09/2026. É o tamanho da superfície que o multi-tenant
precisa tocar — e mostra que o risco é de lógica, não de volume: o banco inteiro tem 49 MB.

| Número | O quê |
|---:|---|
| 46 | tabelas em `public`; 38 recebem `escritorio_id` |
| 130 | policies (85 de app + 45 do espelho); nenhuma restritiva |
| 93 / 120 | funções `SECURITY DEFINER`; ~70 precisam mudar |
| 49 | triggers, em 19 tabelas |
| 9 | jobs de pg_cron, todos globais |
| 29 / 32 | edge functions usando service role |
| 295 | checagens de papel no frontend, em 22 arquivos |
| 7.025 | objetos no Storage (~6,4 GB), sem tenant no path |
| 23.439 | linhas no total; maior tabela ~7 mil |
| 31 | usuários: 7 internos, 24 parceiros, 2 admins |

### O que amarra o sistema a um escritório só

| Onde | Suposição de escritório único | Consequência com dois escritórios |
|---|---|---|
| Unicidades | `clientes.cpf`, `usuarios.email`, números de processo e requerimento, `djen_id`, `etiquetas.nome`, `tarefa_templates.nome`, `(origem, origem_ref)` | O escritório B descobre que um CPF é cliente de outro pela mensagem de duplicidade — checagens de unicidade ignoram RLS |
| Identidade | `tipo`, `eh_admin`, `ativo` e `percentual_parceiro` são da pessoa | Parceiro que indica para dois escritórios não cabe; desligar bane no Auth e derruba o acesso em todos |
| Responsáveis automáticos | `responsavel_padrao_analise()` compara com o e-mail da Mara; `admin_ativo_padrao()` pega o primeiro admin da base; triagem DJE usa o UUID da Naira | Tarefa do escritório B, com nome de cliente no título, atribuída a alguém do escritório A |
| Vínculo por número | `rematch_publicacoes_dje()`, DataJud e INSS e-mail casam por número/CPF na base inteira | Andamento de um escritório gravado, e visível ao parceiro, no caso de outro |
| Integrações | Uma caixa Gmail do INSS, um Drive, uma instância WhatsApp, um token TI/Legalmail, uma chave de IA compartilhada (índice único global) | Tudo vira configuração e segredo por escritório |
| Marca | Remetente, logo, CNPJ, OABs e textos jurídicos fixos em 6 edge functions, `termos.ts` e no site em `/` | E-mail do escritório B assinado como "Mara Vian Advocacia" |
| Storage | Path `<caso_id>/arquivo`; 5 policies fazem cast do primeiro segmento para uuid | Isolamento só por join; exportar ou apagar um escritório exige varrer tudo |

---

## 3. Decisão de arquitetura (D23)

Em 23/08, DECISOES §8 recomendou um projeto Supabase por escritório "enquanto os clientes
se contarem em dezenas". A auditoria muda a conta.

| Critério | Silo — um projeto por escritório | Pool — um projeto, `escritorio_id` + RLS |
|---|---|---|
| Isolamento | Físico; vazamento entre escritórios é estruturalmente impossível | Lógico; depende de policies, funções e edge functions corretas — e provadas por teste |
| Operação para 1–2 devs | Cada migration, deploy, segredo, cron, hook e espelho vezes N. Já há drift com N=2: **116 de 120** ACLs de função diferem, e `intake_trello_runs` só existe no staging | Uma de cada; o pipeline atual (local → staging → produção) continua valendo |
| Pré-requisito que falta hoje | Schema reproduzível e deploy automatizado por Management API — o repositório não recria nem as tabelas centrais | Harness de testes de isolamento e revisão das funções que ignoram RLS |
| Parceiro em dois escritórios | Um login por projeto | Um login, dois vínculos |
| Custo com PITR (estimativa) | ~US$590/mês com 5 escritórios; ~US$2.300 com 20 | ~US$130–275/mês de 1 a 20 |
| Restore e export de um escritório | Nativo | Precisa de ferramenta de export por `escritorio_id` (Fase 6) |

**Recomendação: pool agora, com portabilidade para silo.** O argumento decisivo não é
custo: o silo multiplica exatamente o tipo de erro que a auditoria encontrou — grants e
policies divergindo entre projetos — enquanto o pool concentra o risco num lugar que dá
para testar automaticamente. O princípio 2 do DECISOES ("fronteira de segurança é
estrutural, não de flag") continua respeitado com três estruturas: policy restritiva
obrigatória em toda tabela, FKs compostas e um teste de catálogo que falha o CI se uma
tabela nova nascer sem elas.

Um escritório só ganha projeto dedicado quando **todos** valerem: exigência contratual de
isolamento físico; receita que cubra ~US$115/mês de infraestrutura e a operação extra;
provisionamento e migrations em lote já automatizados; e o mesmo código e as mesmas
migrations do pool. A AWS chama isso de *tier-based isolation*: o silo é um clone do pool
que atende um escritório.

**Descartados.** Schema por tenant: Auth, Storage, Realtime, Vault e cron continuam
compartilhados, migrations rodariam N vezes e não há suporte oficial. Serviço externo de
autorização (OpenFGA, SpiceDB, Cerbos): o front fala direto com PostgREST, Storage e
Realtime, e só a RLS protege essas rotas sem um backend no meio.

---

## 4. Arquitetura-alvo

Os trechos de SQL e TypeScript são esboços para fixar o contrato — a versão final de cada
função parte da definição de produção (`pg_get_functiondef`), como exige o CLAUDE.md.

### 4.1 Modelo de dados de escritório e acesso

O que hoje é atributo da pessoa (`tipo`, `eh_admin`, `ativo`, `percentual_parceiro`,
`termos_versao`) passa para o vínculo, porque a mesma pessoa pode ser advogada num
escritório e parceira em outro. `usuarios` fica só com a identidade.

| Tabela | Papel no modelo | Observações |
|---|---|---|
| `escritorios` | O tenant | `slug`, nome, CNPJ, `status` (ativo, suspenso, encerrado). Escritório 1 = Mara Vian Advocacia |
| `escritorio_config` | O que hoje está chumbado | Marca, dados legais, OABs, responsáveis padrão, destinatários do digest, fuso, regras de prazo, versão dos termos |
| `escritorio_integracoes` | Segredos por escritório | Gmail INSS, Drive, IA compartilhada, Legalmail, TI, WhatsApp. Segredo no Vault (`escritorio:<id>:<tipo>`) ou cifrado com o `crypto.ts` atual; nunca devolvido ao navegador |
| `membros` | Vínculo pessoa × escritório | `papel_id`, `status` (convidado, ativo, desativado), `recebe_repasse`, `percentual_parceiro`, termos aceitos. `unique (escritorio_id, usuario_id)` |
| `permissoes` | Catálogo, definido em migration | Chave `recurso:acao` em tabela, não enum — enum não permite remover valor |
| `papeis` · `papel_permissoes` | Papéis e o que concedem | Papel de sistema (`escritorio_id` nulo) ou do escritório. Cada concessão tem escopo: `todos`, `atribuidos`, `indicados`, `proprios` |
| `convites` | Entrada no escritório | Só o hash do token, expiração, papel. Convite para e-mail já cadastrado cria vínculo em vez de erro |
| `auditoria` | Trilha legal | Só INSERT. Ator, tipo do ator (membro, suporte, sistema), ação, recurso, escritório. Referências e hashes, nunca o conteúdo |
| `plataforma_staff` · `acessos_suporte` | Equipe do SaaS | Fora de `membros`. Sem acesso a dado de cliente, exceto suporte temporário aprovado pelo escritório (§4.6) |

```sql
-- esboço: vínculo e helpers de autorização (schema private, fora da API)
create table public.membros (
  id                  uuid primary key default gen_random_uuid(),
  escritorio_id       uuid not null references public.escritorios (id),
  usuario_id          uuid not null references auth.users (id),
  papel_id            uuid not null references public.papeis (id),
  status              text not null default 'ativo'
                      check (status in ('convidado','ativo','desativado')),
  recebe_repasse      boolean not null default false,
  percentual_parceiro numeric(5,2),
  termos_versao       text,
  desativado_em       timestamptz,
  desativado_por      uuid,
  unique (escritorio_id, usuario_id)
);

create function private.meus_escritorios() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.escritorio_id
  from public.membros m
  join public.escritorios e on e.id = m.escritorio_id and e.status = 'ativo'
  where m.usuario_id = (select auth.uid()) and m.status = 'ativo'
$$;

create function private.escritorios_com(p_perm text, p_escopo text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct m.escritorio_id
  from public.membros m
  join public.papel_permissoes pp on pp.papel_id = m.papel_id
  where m.usuario_id = (select auth.uid()) and m.status = 'ativo'
    and pp.permissao = p_perm and pp.escopo = p_escopo
$$;

revoke all on function private.meus_escritorios(), private.escritorios_com(text, text)
  from public, anon;
grant usage on schema private to authenticated;   -- private não entra no db_schema do PostgREST
grant execute on function private.meus_escritorios(), private.escritorios_com(text, text)
  to authenticated;
```

**Por que a permissão é lida da tabela, e não do JWT.** O access token continua válido até
expirar (1 h), mesmo depois de sign-out. Se o vínculo vivesse só no JWT, desligar uma pessoa
levaria até uma hora para valer — a mesma falha corrigida em `ac2f486`, quando parceiro
desligado seguia listando casos. As funções acima rodam uma vez por statement quando
chamadas dentro de `(select …)` (initPlan): a documentação do Supabase mede 178 s → 12 ms
nesse padrão. O Custom Access Token Hook fica opcional e só para interface (escritório
ativo, papel para esconder botões); nenhuma policy lê claim.

### 4.2 Camadas de autorização

Cada camada fecha uma classe de erro diferente, para que um erro numa delas não vaze dado
sozinho.

| Camada | O que garante |
|---|---|
| **Isolamento** (policy `RESTRICTIVE`) | Uma por tabela com `escritorio_id`. O Postgres combina restritivas com **AND**, então uma permissiva descuidada — até um `USING (true)` — não atravessa escritório. Declarada `TO authenticated`, não afeta o `espelho_leitura` |
| **Papel e escopo** (policies `PERMISSIVE`) | Reescritas como permissão × escopo. O parceiro deixa de ser caso especial: é o papel `parceiro` com `casos:ler` no escopo `indicados` |
| **Integridade** (constraints) | `escritorio_id NOT NULL`; `unique (escritorio_id, id)` nos pais; FKs compostas; unicidade de negócio por escritório; índices começando por `escritorio_id`. Vale até para service role e `SECURITY DEFINER`, que ignoram RLS |
| **Colunas e transições** (triggers de guarda) | RLS protege linha, não coluna (lição de `800d60f`). Colunas de vínculo só mudam por RPC com permissão. Último admin ativo não pode ser desativado nem rebaixado |
| **Código privilegiado** | Helpers e RPCs `SECURITY DEFINER` em schema não exposto, `search_path = ''`, EXECUTE revogado de `public` e `anon`, checagem explícita do escritório do recurso recebido |
| **Prova** (testes de catálogo) | O CI falha se uma tabela nova não for classificada, se faltar a restritiva, a FK composta ou o índice, ou se uma `SECURITY DEFINER` ficar executável por `anon` |

```sql
-- esboço para casos; o mesmo par existe em cada tabela de domínio
create policy isolamento_escritorio on public.casos
  as restrictive for all to authenticated
  using      (escritorio_id = any (array(select private.meus_escritorios())))
  with check (escritorio_id = any (array(select private.meus_escritorios())));

create policy casos_ler on public.casos
  as permissive for select to authenticated
  using (
    escritorio_id = any (array(select private.escritorios_com('casos:ler', 'todos')))
    or (parceiro_id = (select auth.uid())
        and escritorio_id = any (array(select private.escritorios_com('casos:ler', 'indicados'))))
  );

-- integridade: o filho não consegue apontar para o pai de outro escritório
alter table public.casos add constraint casos_escritorio_uk unique (escritorio_id, id);
alter table public.andamentos
  add constraint andamentos_caso_mesmo_escritorio
  foreign key (escritorio_id, caso_id) references public.casos (escritorio_id, id)
  on delete cascade not valid;
alter table public.andamentos validate constraint andamentos_caso_mesmo_escritorio;
```

Tabelas-raiz (`clientes`, `casos`, `leads`) recebem `escritorio_id` do front e o
`WITH CHECK` valida o vínculo. Tabelas-filhas herdam do pai por trigger `BEFORE INSERT`.
Não usar default vindo de claim: fica ambíguo para quem tem dois vínculos.

### 4.3 Papéis e permissões v1

Derivado do que a interface e o banco controlam hoje. **Admin** corresponde a `eh_admin`,
**advogado** ao interno atual e **parceiro** ao parceiro atual — no escritório 1 ninguém
ganha nem perde acesso na migração. **Assistente** e **financeiro** são novos. Na v1 só
existem papéis de sistema.

| Permissão | Admin | Advogado | Assistente | Financeiro | Parceiro |
|---|---|---|---|---|---|
| `escritorio:configurar` | todos | — | — | — | — |
| `equipe:gerenciar` | todos | — | — | — | — |
| `auditoria:ler` | todos | — | — | — | — |
| `integracoes:gerenciar` | todos | — | — | — | — |
| `parceiros:gerenciar` | todos | todos | — | — | — |
| `clientes:excluir` · `parceiros:excluir` | todos | — | — | — | — |
| `casos:ler` | todos | todos | todos | todos | indicados |
| `casos:editar` | todos | todos | todos | — | indicados |
| `clientes:ler_contato` | todos | todos | todos | — | — |
| `senha_inss:ler` (auditado) | todos | todos | atribuidos | — | indicados |
| `andamentos:ler_internos` · `analises:ler` | todos | todos | todos | — | — |
| `tarefas:gerenciar` · `agenda:gerenciar` | todos | todos | atribuidos | — | — |
| `documentos:enviar` | todos | todos | todos | — | indicados |
| `documentos:excluir` | todos | todos | — | — | — |
| `processos:ler` · `publicacoes:ler` | todos | todos | todos | — | indicados |
| `comercial:gerenciar` | todos | todos | — | — | — |
| `repasses:ler` | todos | todos | — | todos | proprios |
| `ia:usar` | todos | todos | todos | — | — |
| `etiquetas:gerenciar` · `templates:gerenciar` | todos | todos | — | — | — |

**Mudanças de comportamento deliberadas, a aprovar:** excluir cliente e excluir parceiro
passam a ser só de admin (hoje qualquer interno); contato do cliente e `download_parceiro`
passam a valer no banco, não só na tela.

### 4.4 Funções privilegiadas, edge functions, cron, Storage e Realtime

**Funções `SECURITY DEFINER` (93).** Helpers e RPCs vão para o schema `private`; no `public`
fica só o que o front chama, com checagem explícita. RPC que recebe id (`excluir_cliente`,
`get_senha_meu_inss`, `aplicar_template`, `vincular_publicacao_dje`…) resolve o escritório do
recurso e exige a permissão nele. Triggers propagam o `escritorio_id` da linha e só procuram
responsável, etiqueta ou template dentro dele. Rotinas de cron revogadas de `anon`/
`authenticated` e reescritas para iterar escritórios ativos. `desligar_*` desativa o vínculo;
ban no Auth só se não sobrar vínculo ativo.

**Edge functions (32).** `_shared/auth.ts` com `exigirMembro(req, permissão, recurso)` e
`exigirSistema(req)` — consolida as ~16 cópias de `getUser` + `tipo`. Chamadas de cron e
trigger assinadas por HMAC com segredo do Vault; `verify_jwt` declarado por função no
`config.toml`. Leitura com o client do usuário (RLS) por padrão; service role só em trabalho
de sistema, sempre com `.eq('escritorio_id', …)` — verificado por lint no CI. `fetchT` com
timeout padrão e limite de uso por escritório. Chaves de dedup externas (`djen_id`,
`gmail_message_id`, `ti:<id>`) passam a incluir o escritório.

```ts
// contrato de uma edge function chamada pelo navegador
const ctx = await exigirMembro(req, {
  permissao: "ia:usar",
  escritorioDe: { tabela: "casos", id: body.caso_id },  // o recurso decide o escritório
});
if (ctx instanceof Response) return ctx;                  // 401, 403 ou 404
const { data: caso } = await ctx.rls.from("casos").select("…").eq("id", body.caso_id).single();

// e de uma chamada pelo cron
const sys = await exigirSistema(req, "cron:inss-email");  // HMAC + timestamp
for (const esc of await escritoriosCom(sys.admin, "gmail_inss")) await processar(esc);
```

**Storage.** Objetos novos em `<escritorio_id>/<caso_id>/<arquivo>`, com policy pelo primeiro
segmento. Os 7.025 objetos atuais continuam acessíveis por uma policy de legado que resolve o
`caso_id` para o escritório; migração por `move` da Storage API em lote, depois do backup
externo — nunca por SQL, que deixa órfão. Signed URL só depois de autorizar o objeto.

**Realtime e cron.** Os 4 canais do front passam a filtrar `escritorio_id=eq.<id>` e
reassinam ao trocar de escritório; `postgres_changes` não aplica RLS em DELETE, então o
evento vale como "só a chave". Um job por rotina, iterando escritórios em lotes (pg_cron roda
no máximo 8 simultâneos). Notificações sem destinatário deixam de ser "todos os internos" e
passam a ser "membros com a permissão, neste escritório".

### 4.5 Frontend e resolução de escritório

- **`EscritorioProvider`** carrega os vínculos e o escritório ativo; `pode(permissão)` é
  tri-estado (sim, não, carregando).
- **Guards em `beforeLoad`** com auth no contexto do router, substituindo os redirects em
  `useEffect`; sidebar e abas de Configurações declarativas por permissão.
- **As 295 checagens** migram por codemod, começando pelas telas de admin; `casos.$id.tsx`
  (8.590 linhas, issue #284) deixa de receber `isInterno` por prop.
- **Troca de escritório** grava a preferência e faz reload completo; chaves `msc:*` do
  localStorage passam a incluir escritório e usuário; token do Google em memória é descartado.
- **Tipos gerados** (`supabase gen types`) antes da Fase 3 — hoje o client não é tipado e
  adicionar `escritorio_id` não gera nenhum erro de compilação.
- **Resolução**: um domínio do produto com seleção de escritório depois do login. Marca antes
  do login e site público por subdomínio ou domínio próprio ficam para depois — Custom Domains
  da Cloudflare não aceitam curinga e as origens do Google OAuth também não. Slug e subdomínio
  nunca decidem acesso: só escolhem o escritório, e a RLS confere o vínculo.
- `marasandraconnect.com` continua servindo o escritório 1; o site institucional em `/` sai da
  raiz do produto. A escolha do domínio do produto se cruza com a issue #244.

### 4.6 Acesso da equipe da plataforma

Hoje quem desenvolve tem acesso total a produção (service role, PAT de Management API). Num
SaaS jurídico isso precisa virar exceção registrada.

- **Admin da plataforma ≠ admin do escritório.** `plataforma_staff` não aparece em nenhuma
  policy de tabela de domínio. O console vê escritórios, uso e status; não vê clientes.
- **Suporte com prazo.** `acessos_suporte` com motivo, ticket, escopo (padrão: leitura),
  aprovação de um admin do próprio escritório e expiração. `meus_escritorios()` só inclui o
  escritório enquanto o acesso é válido; cada leitura nesse modo vai para `auditoria`. O "ver
  como parceiro" atual passa a exigir `parceiros:ver_como` no escritório do parceiro.
- **Break-glass.** Duas contas nominais com MFA forte, alerta a cada uso, post-mortem
  registrado e teste trimestral.
- **MFA (AAL2)** obrigatório para admin de escritório e staff, por policy restritiva nas
  tabelas administrativas (`(select auth.jwt()->>'aal') = 'aal2'`). Fecha a issue #261.

---

## 5. Fases de execução

Cada fase é aditiva, cabe em PRs pequenos para `staging` e só libera a próxima quando o
portão de saída está verde. Até a Fase 4 nada muda no que o escritório 1 vê.

| Fase | O quê | Duração |
|---|---|---|
| [0](#fase-0--contenção) | Contenção | 1–2 sem (agora) |
| [1](#fase-1--fundações) | Fundações | 2–3 sem |
| [2](#fase-2--modelo-de-acesso) | Modelo de acesso | 2 sem |
| [3](#fase-3--escritorio_id) | `escritorio_id` | 2–3 sem |
| [4](#fase-4--isolamento) | Isolamento | 2 sem |
| [5](#fase-5--rbac) | RBAC | 4–5 sem |
| [6](#fase-6--produto) | Produto | 4–6 sem |
| [7](#fase-7--contração) | Contração | 2–3 sem + piloto |

### Fase 0 — Contenção

*Começa já; não depende da D23.*

- Guarda em `usuarios`: trigger que rejeita mudança de `tipo`, `eh_admin`, `eh_parceiro`,
  `ativo`, `percentual_parceiro` e `email` por não-admin, ou UPDATE só nas colunas de perfil.
  Restringir `usuarios_insert_interno`.
- `WITH CHECK` nas 9 policies de UPDATE/ALL que não têm; `storage_path` do documento precisa
  começar pelo `caso_id` dele.
- `revoke execute … from public, anon` em todas as `SECURITY DEFINER` (e de `authenticated`
  quando não forem RPC do front); `alter default privileges` para as novas nascerem fechadas.
- Edge functions: autenticação de usuário ou de sistema nas 16 que ainda não têm; fim do
  override `para` no `digest-diario`; HMAC nas chamadas de cron; `sync-ti-todos` e
  `check-ti-cliente` fora do ar; `update-parceiro` restrito a admin; `ia-triagem-andamentos`
  para de confiar no `usuario_id` do corpo.
- Staging: signup desligado, grants de `anon` iguais aos de produção, confirmação de que a
  chave do Vault difere, e a function órfã `intake-trello` — fora do repositório desde 19/09,
  ainda publicada e ativa lá — apagada.
- Decisão sobre visibilidade do repositório e o CPF em `scripts/conector-mni.mjs` — sem
  reescrever histórico.

**Portão de saída:** cada ataque reproduzido no ambiente local com conta descartável passa a
falhar e vira spec E2E de regressão; suíte completa verde; lints 0028/0029 do Supabase
Advisor zerados ou justificados um a um.
**Rollback:** grants e policies voltam por migration; edge function volta pelo deploy anterior.

> Já saiu daqui na revisão de 19/09: tokens do MCP (PR #297), alinhamento `staging`×`main`
> (PR #365), timeout de três funções de IA (PR #318) e a `intake-trello`, que saiu do
> repositório.

### Fase 1 — Fundações

*Sem mudança funcional.*

- **Baseline**: `pg_dump --schema-only` de produção versionado, com diff zero contra a cópia
  local. O ambiente local de 15/09 já dá o banco reproduzível — falta a fonte versionada dele.
- **Harness**: pgTAP + supabase-test-helpers e testes de catálogo rodando **no ambiente
  local**, que já traz extensões, policies, grants e default privileges idênticos aos do
  staging — basta `create extension pgtap`.
- **CI obrigatório** nos PRs para `staging` — hoje só existem os workflows do board e do
  espelho: `tsc`, eslint, `bun test` (criando o script `test:unit`, que ainda não existe para
  os 4 arquivos de teste unitário), pgTAP no banco local e lint de migration (tem
  `lock_timeout`; não tem `disable row level security`, `grant … to anon`, URL, e-mail ou UUID
  literal).
- **`msc-sql.mjs`**: `lock_timeout` e `statement_timeout`; recusar produção se o staging não
  tiver a mesma migration com o mesmo sha256.
- **Registro em dia**: `migration_ia_plugin.sql` consta em produção e falta no staging
  (`--registrar`).
- **Rede de segurança**: reconstituir o runbook de backup e restore (a branch
  `docs/backup-restore` foi apagada sem merge); PITR ligado (exige compute Small); backup
  externo cifrado do Storage, que o ambiente local não copia; ensaio de restore em projeto
  novo; staging pago (#290).
- **Diff de visibilidade**: script que grava, por conta de papel e por tabela, as chaves
  visíveis. É a linha de base de todas as fases.
- **Menos superfície** (#285): `mensagens` (ainda referenciada em `excluir-parceiro`),
  ~~`intake_trello_runs`~~ (removida do staging em 21/09), buckets mortos, webhooks sem destino, o client
  service-role morto em `src/integrations/supabase/` e o react-query montado sem uso.
- D23 registrada em DECISOES; alertas para falha de cron, espelho e edge function.

**Portão de saída:** CI bloqueia merge; baseline recria a cópia local sem diferença; restore
ensaiado e cronometrado; PITR ativo; diff de visibilidade gerado para admin, interno e
parceiro; registros de migration iguais entre local, staging e produção.

### Fase 2 — Modelo de acesso

*Aditiva, em paralelo ao modelo atual.*

- Tabelas de §4.1; escritório 1 criado; `membros` preenchido de `usuarios` (`tipo` +
  `eh_admin` → papel; `ativo`/`desligado_em` → status; `eh_parceiro`/`percentual_parceiro` →
  vínculo).
- `private.meus_escritorios()` e `private.escritorios_com()` com testes próprios — as duas
  camadas dependem delas.
- Sincronização temporária entre `usuarios` e `membros` enquanto o código antigo existir.
- Policies sombra: comparar o que as regras novas permitiriam com o que as atuais permitem,
  sem anexá-las às tabelas.
- `escritorio_config` recebe o que hoje está chumbado: responsável padrão, triagem DJE,
  destinatários do digest.
- Sequenciar duas issues que disputam este código: **#356** ("ver como parceiro" em todo o
  sistema) deve nascer já sobre permissões, não sobre `sessionStorage`, e **#339** (templates
  por escritório) é requisito de tenancy disfarçado.

**Portão de saída:** 31 usuários = 31 vínculos; comparação sombra sem diferença; diff de
visibilidade idêntico ao da Fase 1; nada muda na interface.

### Fase 3 — `escritorio_id`

*Expand → enforce.*

- Uma migration por passo: `add column escritorio_id uuid default '<escritório 1>'`. Default
  constante é só metadado — não reescreve a tabela e **não dispara os 49 triggers de
  negócio**. Um `UPDATE` de backfill acionaria webhooks, notificações e tarefas automáticas.
- Trigger `BEFORE INSERT` herda do pai; depois `drop default`,
  `check (escritorio_id is not null) not valid` → `validate` → `set not null`. Confirmar no
  local que as linhas antigas mantêm o valor após o `drop default`.
- `unique (escritorio_id, id)` nos pais; FKs compostas `not valid` → `validate`; as 10
  unicidades de negócio trocadas criando a nova antes de remover a antiga; índices começando
  por `escritorio_id`.
- Linhas sem caminho para um escritório — publicações órfãs, notificações sem destinatário,
  `ia_acoes` sem caso — ficam no escritório 1, o único que existe.
- `lock_timeout` curto com retry em todo DDL: banco pequeno não elimina a fila de lock atrás
  de um cron com transação aberta.
- Ensaiar a sequência inteira no ambiente local quantas vezes precisar (`bun run local:copiar`
  recria a cópia em ~2,5 min, com `ops.migrations_aplicadas` junto).

**Portão de saída:** 0 linhas com `escritorio_id` nulo; 0 filhos divergentes do pai; FKs
`VALID`; EXPLAIN das 10 consultas mais frequentes sem regressão; diff de visibilidade idêntico.

### Fase 4 — Isolamento

- Policy restritiva nas 38 tabelas, numa migration única; policy de legado no Storage; filtros
  no Realtime.
- `is_interno`, `is_admin`, `parceiro_ativo` e `caso_do_parceiro` reimplementados sobre
  `membros`; as 15 checagens inline de `tipo = 'interno'` trocadas pelos helpers;
  `TO authenticated` nas 64 policies `TO public`.
- **Escritório canário** no staging: usuários sintéticos de cada papel e dados fictícios.
- Matriz cruzada (pgTAP, E2E e chamadas às edge functions) com as contas do canário, no local
  e no staging. Os arquivos do Storage não são copiados para o local, então o teste de
  isolamento de bucket roda no staging.

**Portão de saída:** zero linhas do escritório 1 visíveis ao canário e vice-versa, em tabelas,
Storage, Realtime e RPCs; diff de visibilidade do escritório 1 idêntico; teste de revogação
(com o JWT ainda válido, desativar o vínculo → 0 linhas).

> O canário **não vai para produção** nesta fase: enquanto cron e edge functions forem
> globais, rotinas como `notify-novo-comentario` e `digest-diario` mandariam às contas do
> canário e-mails com nomes de clientes reais. Ele entra em produção no fim da Fase 6.

### Fase 5 — RBAC

- Permissivas reescritas como permissão × escopo, um domínio por vez: pessoas → casos e
  clientes → documentos e Storage → tarefas e agenda → comunicação → comercial e integrações.
- ~70 funções reescritas a partir do `pg_get_functiondef` de produção, com a definição
  anterior guardada e hash staging × produção antes e depois; as que não são RPC do front vão
  para `private`.
- Rotinas de cron iterando escritórios; responsáveis automáticos lidos de `escritorio_config`;
  `executor_email` dos templates vira id de membro ou papel funcional.
- `desligar_*` sobre o vínculo; tokens MCP presos ao vínculo e revogados com ele — o PR #297
  já fez isso para o MCP e serve de molde.
- Fechar os dois furos de ciclo de vida do mesmo tipo: `update-parceiro` (interno comum troca
  o e-mail de login de um parceiro) e o `digest-diario`, que ainda envia para interno
  desligado (#291).
- Front: `EscritorioProvider`, `pode()`, guards, sidebar declarativa, codemod das checagens;
  segurança que hoje é só de tela passa para o banco.
- Tela Equipe vira gestão de papéis; assistente e financeiro liberados.

**Portão de saída:** diff de visibilidade idêntico para admin, interno e parceiro, exceto as
mudanças deliberadas de §4.3, listadas e aprovadas; nenhuma `SECURITY DEFINER` em schema
exposto sem checagem nem executável por `anon`; E2E via API para admin × interno, parceiro A ×
parceiro B, `visivel_parceiro` e `analises_tecnicas`.

### Fase 6 — Produto

- Edge functions com escritório real: filtros no service role, segredos em
  `escritorio_integracoes`, marca por escritório nos e-mails e no `send-email-hook`, dedup por
  escritório, limite de IA.
- Configurações do escritório: marca, dados legais, OABs monitoradas, caixa Gmail do INSS,
  Drive, chave de IA, responsáveis, termos versionados.
- Onboarding: `criar_escritorio` (staff) cria escritório, config, papéis e convite do dono,
  com templates, etiquetas e tipos de benefício de um conjunto padrão — sem e-mails da equipe
  atual.
- Convites multi-vínculo; seletor de escritório; console da plataforma; suporte com prazo;
  auditoria.
- Export por escritório (linhas + prefixo do Storage) e eliminação; uso e quota por escritório
  (degrau 2 do D22).
- Espelho de staging: só o escritório 1, com base legal registrada, mais sintéticos; restore e
  anonimização atômicos; pós-condição de consistência de `escritorio_id`; seed com 2
  escritórios × papéis + segundo parceiro.
- Canário criado em produção e matriz cruzada rodando contra ele.

**Portão de saída:** um escritório sintético completa o ciclo no staging — cliente, caso,
documento, publicação, tarefa, e-mail — sem nenhum nome, marca, e-mail ou responsável do
escritório 1; export seguido de eliminação deixa 0 linhas e 0 objetos; matriz cruzada verde
também em produção.

### Fase 7 — Contração

- Remover `usuarios.tipo`, `eh_admin`, `eh_parceiro`, `ativo`, `percentual_parceiro`, a
  sincronização temporária, helpers e policies antigos e a policy de legado do Storage (após
  mover os objetos) — só depois de dois ciclos de release sem nenhuma leitura deles.
- Limpar o que sobrou: react-query sem uso, `src/integrations/supabase/` morto e a quebra de
  `casos.$id.tsx`, ainda com 8.590 linhas (#284).
- Portão de compliance de §9 cumprido.
- Piloto com um escritório parceiro: contrato e DPA assinados, carga inicial assistida,
  acompanhamento diário por duas semanas.

**Portão de saída:** checklist de compliance completo; runbook de incidente ensaiado; MFA
ativo para admins e staff; decisão explícita da Naira para abrir ao segundo cliente.
**Rollback:** a contração é o único passo irreversível. Anotar o timestamp do PITR antes e
executar só quando nada mais lê o legado.

---

## 6. Protocolo de release em produção

Vale para cada fase que chega à `main`. É o fluxo do CLAUDE.md — que desde 15/09 começa no
ambiente local — com os passos que uma mudança de isolamento exige a mais.

| Passo | O quê | Por quê |
|---|---|---|
| 1 · Local | `bun run local:copiar`, migrations com `msc-sql --local`, pgTAP, `e2e:local` e diff de visibilidade. Repetir do zero quantas vezes precisar | Ensaio barato sobre esquema e dados reais anonimizados |
| 2 · Ensaio com dados de produção | Só nas fases 3 a 6: restaurar backup num projeto descartável, aplicar a fase, medir duração e locks | O staging é menor e anonimizado; aqui aparece o tempo real de `VALIDATE` e de índice |
| 3 · Staging | `msc-sql --staging`, edge functions com `--project-ref`, merge na `staging`, E2E completa, validação por papel | Regra da casa |
| 4 · Janela | Fora da faixa dos crons (02:00–08:10 BRT); timestamp do PITR anotado; backup lógico extra antes de fases de policy | Evita a fila de lock atrás de uma rotina e define o ponto de volta |
| 5 · Ordem | Migrations → edge functions → merge `staging → main` | O front nunca depende de objeto que ainda não existe em produção |
| 6 · Conferir o que o front novo usa | Antes do merge de release: todo enum, coluna, função e tabela citados no diff existem em produção | Foi o caso do PR #367 e dos 8 tipos de documento que só existiam no staging |
| 7 · Verificação | Script versionado: nulos e divergências de `escritorio_id`, hashes de policies e funções staging × produção, grants a `anon`, `cron.job_run_details`, `net._http_response`, logs, smoke por papel | "Deploy verde ≠ funcionando" |
| 8 · Observação | 48 h acompanhando erros 42501 (RLS), 401/403 por função, tarefas automáticas criadas e e-mails enviados | Um bloqueio indevido aparece como lista vazia, não como erro |
| 9 · Critério de volta | Definido antes do deploy: o que dispara o rollback, quem decide e qual comando roda | Decidir sob pressão é onde o rollback falha |

---

## 7. Estratégia de testes

Hoje não existe nenhum teste de RLS e o E2E (23 specs, 59 testes) tem um único parceiro
sintético — o isolamento horizontal nunca foi testado. O ambiente local de 15/09 é onde essa
prova passa a rodar.

| Camada | O que prova | Onde roda |
|---|---|---|
| Catálogo (pgTAP) | Toda tabela classificada; restritiva, FK composta e índice presentes; RLS ligada; nenhuma policy `TO public`; nenhuma `SECURITY DEFINER` executável por `anon` — hoje são 21 em produção e 43 no staging | CI, no banco local, em todo PR |
| Matriz cruzada (pgTAP gerado) | Tabela × operação × papel × escritório (1 e canário), incluindo cada RPC do front chamada com id de outro escritório | CI e staging |
| Diff de visibilidade | O que cada conta vê é idêntico antes e depois da fase | Local, staging e ensaio |
| Revogação | Com o JWT ainda válido, desativar o vínculo → 0 linhas; token MCP revogado junto | CI |
| E2E com 2 escritórios | Ataques via supabase-js (ler por id, signed URL alheia, Realtime), troca de escritório sem sobra de cache, parceiro A × parceiro B | Staging; canário em produção |
| Edge functions | Sem credencial → 401; JWT do canário com id do escritório 1 → 403/404; cron sem HMAC → 401 | Staging; canário em produção |
| Desempenho | EXPLAIN ANALYZE das consultas mais frequentes com a restritiva; `index_advisor` | Ensaio |

```sql
-- esboço: prova de isolamento e teste de catálogo
begin;
select plan(3);

select tests.authenticate_as('advogado_canario');
select is_empty(
  $$ select id from public.casos where escritorio_id = '<escritório 1>' $$,
  'canário não lê casos do escritório 1');
select throws_ok(
  $$ insert into public.andamentos (caso_id, titulo) values ('<caso do escritório 1>', 'x') $$,
  '42501', null, 'canário não grava em caso alheio');

select tests.clear_authentication();
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and has_function_privilege('anon', p.oid, 'execute') $$,
  'nenhuma SECURITY DEFINER executável por anon');

select * from finish();
rollback;
```

Specs que mudam papel usam usuário descartável — a suíte cortada de 14/09 deixou
`e2e+interno` como admin. Quem escreve a migration não é quem escreve o teste de diff da
mesma fase.

---

## 8. Riscos e mitigação

| Risco | Chance | Impacto | Mitigação |
|---|---|---|---|
| Função `SECURITY DEFINER` esquecida lê todos os escritórios | Alta | Crítico | Schema `private`, teste de catálogo, matriz cruzada chamando cada RPC com id alheio |
| Edge function com service role sem filtro | Alta | Crítico | Client com RLS por padrão, lint no CI, testes com JWT do canário; FKs compostas impedem a escrita cruzada |
| Backfill dispara triggers de negócio | Média | Alto | Default constante em vez de `UPDATE`; ensaio de corte |
| Fila de lock trava produção durante DDL | Média | Alto | `lock_timeout` curto com retry; janela fora dos crons |
| Escritório 1 perde acesso a algo sem ninguém notar | Média | Alto | Diff de visibilidade idêntico como portão de toda fase |
| Função reescrita a partir de migration velha apaga evolução | Média | Alto | Sempre `pg_get_functiondef` de produção + hash antes e depois |
| Espelho copia dados de outro controlador para o staging | Média | Alto | Espelho só do escritório 1 via policy do `espelho_leitura`; os demais só sintéticos |
| Canário recebe e-mail com dado real antes das rotinas filtrarem | Média | Alto | Canário em produção só no fim da Fase 6 |
| Front mergeado depende de objeto que só existe no staging | Alta | Alto | Conferência de catálogo antes do merge de release (passo 6 de §6). Aconteceu em 19/09 com 8 tipos de documento |
| Objetos do Storage perdidos na mudança de path | Baixa | Crítico | Backup externo antes; `move` em lote com verificação; policy de legado durante a transição |
| Branch longa diverge de `staging` | Alta | Médio | PRs pequenos por fase e por domínio, atrás de flag |
| Estimativa estoura e o trabalho de produto para | Alta | Médio | Fases 0 e 1 entregam valor sozinhas; recalibrar ao fim da Fase 1 |
| Sessões derrubadas no corte (#243) | Média | Médio | Auto-reload pós-deploy resolvido antes da Fase 4 |

---

## 9. LGPD e OAB: portão antes do primeiro cliente

> Levantamento técnico dos textos normativos, **não parecer jurídico**. Precisa de revisão
> por especialista em proteção de dados (#257).

**O que muda de papel.** Hoje o escritório é controlador e também opera a plataforma. No
SaaS, cada escritório é **controlador** dos dados dos seus clientes e a empresa da plataforma
é **operadora** (LGPD art. 5º VI–VII, art. 39); Supabase, Cloudflare, Resend, Google e
provedores de IA viram suboperadores. O operador responde solidariamente se descumprir a lei
ou as instruções (art. 42 §1º I). Dado de saúde é sensível (art. 5º II). A Res. CD/ANPD
15/2024 lista como risco relevante incidente com dado sensível ou **protegido por sigilo
profissional**, com 3 dias úteis para o controlador comunicar e registro por 5 anos.

**OAB.** O Estatuto protege os instrumentos de trabalho e a correspondência eletrônica do
advogado (art. 7º II) e, na busca e apreensão, veda analisar documentos de outros clientes
(§§ 6º-C e 6º-D). O Código de Ética trata o sigilo como de ordem pública (arts. 35–38). A
pesquisa não encontrou norma da OAB que proíba infraestrutura compartilhada — o que não prova
que não exista. A leitura técnica: isolamento lógico é defensável se o sistema conseguir
entregar só os dados de um escritório e o acesso da plataforma for mínimo e auditado. Vale
consulta à OAB-SP.

**Checklist**

- [ ] Contrato SaaS ↔ escritório com DPA: instruções, suboperadores com aviso de mudança,
      incidente em prazo compatível com os 3 dias úteis, auditoria, devolução e eliminação ao
      fim (art. 16), confidencialidade da equipe, proibição de uso secundário.
- [ ] Cláusulas-padrão da ANPD (Res. 19/2024) e mapa de fluxos internacionais — os DPAs do
      Supabase e da Cloudflare não mencionam LGPD; incluir runner do GitHub e o host do
      n8n/Evolution, hoje fora do Anexo I. Confirmar a região do projeto de produção.
- [ ] Runbook de incidente com o critério do art. 5º da Res. 15/2024, capaz de responder
      "quais escritórios e titulares" pela `auditoria`, e contato do encarregado de cada
      escritório cadastrado no sistema.
- [ ] Enquadramento como agente de pequeno porte revisado: dado sensível somado a um critério
      geral provavelmente exclui o regime simplificado.
- [ ] Termos separados — plataforma ↔ usuário e escritório ↔ parceiro — versionados por
      escritório; corrigir as promessas atuais de "somente link mágico" e "hospedagem no
      Brasil".
- [ ] MFA para admins e staff (#261), retenção e descarte (#258), direitos do titular por
      escritório (#263), DPA dos provedores de IA com não-treinamento (#256; Recomendação
      CFOAB 001/2024).

---

## 10. Decisões que precisam da Naira

| Decisão | Recomendação |
|---|---|
| Começar a Fase 0 antes da D23? | Sim, imediatamente — as correções valem para qualquer modelo |
| Repositório público | Tornar privado antes de publicar o desenho de isolamento; tratar o CPF sem reescrever histórico |
| D23 — pool ou silo | Pool com portabilidade; silo só pelos quatro critérios de §3 |
| PITR e staging pago | Ligar os dois antes da Fase 3 |
| Integrações que saem | Aposentar Tramitação, Trello, WhatsApp/Evolution e webhooks antes da Fase 3 (#285); ficam Gmail INSS, Drive, DJEN, DataJud e IA, por escritório |
| Parceiro em vários escritórios | Um login, N vínculos |
| Mudanças deliberadas de acesso | Aprovar antes da Fase 5 (excluir cliente/parceiro só admin; contato do cliente e download no banco) |
| Domínio do produto e site institucional | Domínio próprio do produto; `marasandraconnect.com` segue como escritório 1 (cruza com #244) |
| #356 e #339 antes ou depois do modelo de acesso | Fazer as duas já sobre permissões, na Fase 2 |
| Espelho de staging | Só o escritório 1, com base registrada, mais dados sintéticos |

---

## 11. Fontes

Auditoria somente-leitura em 14/09/2026 do catálogo de produção e staging, das 32 edge
functions, do frontend, dos scripts, workflows e testes; revalidada em 19/09/2026 contra os 75
commits novos da `staging` e contra os catálogos de produção, staging e da cópia local.

- Supabase: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) ·
  [performance de RLS](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) ·
  [Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) ·
  [Sessions](https://supabase.com/docs/guides/auth/sessions) ·
  [Advisors](https://supabase.com/docs/guides/database/database-advisors) ·
  [Storage](https://supabase.com/docs/guides/storage/security/access-control) ·
  [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) ·
  [Edge Functions auth](https://supabase.com/docs/guides/functions/auth) ·
  [Backups e PITR](https://supabase.com/docs/guides/platform/backups) ·
  [pgTAP](https://supabase.com/docs/guides/local-development/testing/overview) ·
  [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum)
- PostgreSQL 17: [CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html) ·
  [Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) ·
  [ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html) ·
  [lock_timeout e retries (postgres.ai)](https://postgres.ai/blog/20210923-zero-downtime-postgres-schema-migrations-lock-timeout-and-retries)
- OWASP: [Multi-Tenant Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) ·
  [ASVS 5.0 V8](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md) ·
  [API1 BOLA](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization)
- [AWS — SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html) ·
  [Notion — Sharding Postgres](https://www.notion.com/blog/sharding-postgres-at-notion) ·
  [Stripe — Online migrations](https://stripe.com/blog/online-migrations) ·
  [Basejump](https://github.com/usebasejump/basejump) e
  [supabase-test-helpers](https://github.com/usebasejump/supabase-test-helpers)
- [LGPD compilada](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm) ·
  [Res. CD/ANPD 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024) ·
  [comunicação de incidente](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis) ·
  [Estatuto da Advocacia](https://www.planalto.gov.br/ccivil_03/leis/l8906.htm) ·
  [Recomendação CFOAB 001/2024](https://s.oab.org.br/arquivos/2024/11/7160d4fe-9449-4aed-80bc-a2d7ac1f5d2f.pdf)
- [Cloudflare — Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

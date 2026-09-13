-- =============================================================================
-- Migration: fallback da triagem do DJE não cai mais em conta sintética
-- (achado de revisão, 2026-09-09).
--
-- Sintoma latente em public._dje_triagem_responsavel(): o 2º degrau é
--   (select id from public.usuarios where ativo and eh_admin order by nome limit 1)
-- e '[' ordena antes de qualquer letra, então no staging o fallback resolve
-- pra '[E2E] Admin' — conta sintética virando dona de triagem de publicação
-- do DJE é pior do que não ter fallback.
--
--   staging, antes: hoje = Naira Romero | fallback = [E2E] Admin
--   produção, antes: hoje = Naira Romero | fallback = Mara Sandra
--
-- Hoje o estrago não aparece porque o 1º degrau resolve: a chave
-- app_config 'dje_triagem_responsavel_id' aponta pra Naira. O fallback só
-- entra em cena se a chave sumir ou apontar pra alguém inativo — e aí, calado,
-- manda publicação do DJE pra uma conta de teste.
--
-- A produção hoje escolheria a Mara (não há admin sintético lá), mas a
-- correção vale nos dois: '[E2E] Interno' está VIVO em produção
-- (ativo = true, eh_admin = false) e nada impede que uma conta sintética de
-- admin apareça lá.
--
-- Correção: filtrar o fallback por interno e por e-mail não-sintético, no
-- mesmo espírito de public.responsavel_tarefa_caso
-- (migration_responsavel_automatico_tarefas.sql), que já exige tipo='interno'.
-- Aqui o filtro de tipo sozinho NÃO resolveria — '[E2E] Admin' é
-- tipo='interno'; quem faz o trabalho é o `email not like 'e2e+%'`, o mesmo
-- predicado que scripts/anonimizar-staging.sql usa pra reconhecer conta
-- sintética. O filtro de tipo fica como defesa barata contra um eventual
-- admin com acesso de parceiro.
--
-- O `lower()` no e-mail é de lavra própria: o anonimizador compara
-- `email like 'e2e+%'` cru, mas LIKE no Postgres é case-sensitive e
-- public.responsavel_padrao_analise() já compara com lower(u.email). Custa
-- nada e fecha 'E2E+...'. Hoje os 29 usuários ativos da produção estão todos
-- em minúsculas e usuarios.email é NOT NULL — não há armadilha de
-- `NULL not like`.
--
-- Risco residual assumido: estreitar o filtro faz o fallback poder devolver
-- NULL se TODO admin ativo for sintético/parceiro, e tarefas.responsavel_id é
-- nullable — a tarefa de triagem nasceria órfã. Não vale um 3º degrau aqui:
-- (a) não acontece hoje em nenhum dos dois bancos (Mara e Naira são admins
-- internas reais), (b) o alvo natural seria
-- public.responsavel_padrao_analise(), que NÃO existe em produção (só no
-- staging, via migration_responsavel_automatico_tarefas) — referenciá-la
-- faria esta migration explodir em prod, e (c) órfã sem responsável é
-- barulhenta e visível, enquanto conta de teste como responsável é justamente
-- o modo silencioso que esta correção existe pra matar. Vale lembrar que a
-- rede trg_tarefas_set_responsavel, que pegaria o nulo, hoje só está no
-- staging.
--
-- Só o 2º degrau muda. O 1º (app_config) fica intacto de propósito: se
-- alguém apontar a chave explicitamente pra uma conta, é escolha humana e
-- não cabe a esta migration desfazer.
--
-- Corpo copiado do pg_get_functiondef da PRODUÇÃO (hash
-- aab496a7a99865a1a473184bf8437235, idêntico em staging e produção antes
-- desta migration), conforme a regra do CLAUDE.md.
--
-- Idempotente: CREATE OR REPLACE puro, sem DDL de tabela e sem backfill.
-- =============================================================================

create or replace function public._dje_triagem_responsavel()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'dje_triagem_responsavel_id'
        and u.ativo),
    (select id from public.usuarios
      where ativo and eh_admin
        and tipo = 'interno'
        and lower(email) not like 'e2e+%'
      order by nome limit 1)
  );
$$;

comment on function public._dje_triagem_responsavel() is
  'Responsável pela triagem de publicação órfã do DJE: app_config dje_triagem_responsavel_id -> 1º admin interno ativo por nome, ignorando contas sintéticas (e2e+%).';

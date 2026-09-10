-- =============================================================================
-- Migration: o padrão do escritório vira configuração, não código
-- (achados 6 e 13 da revisão de 2026-09-10).
--
-- Pergunta que a Naira fez em 09/09: "e tem como trocar a Mara?". A resposta
-- honesta na época era feia: o degrau 5 da escada identifica a pessoa por
-- E-MAIL LITERAL dentro de public.responsavel_padrao_analise(), então trocar
-- exigia migration, staging e produção. Foi exatamente essa rigidez que
-- obrigou a inventar um degrau 4 separado (a chave app_config) só pra ter um
-- botão de troca — dois degraus fazendo o mesmo trabalho.
--
-- Aqui o padrão passa a ser: configuração -> Mara -> admin. Com isso:
--
--  * os degraus 4 e 5 da escada FUNDEM num só. responsavel_tarefa_caso cai de
--    6 degraus pra 4, e o degrau 6 some junto (a última rede já está dentro
--    do padrão). Menos superfície, mesma ordem de decisão — nada muda no
--    comportamento observável.
--
--  * a chave passa a valer para TODO mundo que pede "o padrão do escritório",
--    não só pra quem passa pela escada. Em particular, a importação por
--    planilha (importar-clientes-excel-dialog) chamava
--    responsavel_padrao_analise() via RPC e mandava o valor cru: com o
--    override apontando pra outra pessoa, uma planilha de 200 linhas sem
--    parceiro ia toda pra Mara assim mesmo. Agora não mais. (No mesmo lote o
--    front deixa de chamar a RPC e passa a deixar o banco decidir — um lugar
--    a menos sabendo quem é o padrão.)
--
-- Trocar o padrão volta a ser uma linha, sem migration e sem deploy:
--   insert into public.app_config (chave, valor)
--   select 'tarefa_analise_responsavel_id', id::text from public.usuarios
--    where email = '<e-mail>'
--   on conflict (chave) do update set valor = excluded.valor;
-- E apagar a chave devolve o padrão pra Mara.
--
-- A ordem de decisão é IDÊNTICA à de antes (config -> Mara -> admin), só que
-- num lugar só em vez de espalhada em três degraus da escada.
--
-- DEPENDE de migration_responsavel_escada_unica.sql (PR #232), que cria
-- public.admin_ativo_padrao(). O guard abaixo falha cedo se faltar.
--
-- Corpos partem do pg_get_functiondef do STAGING.
-- Idempotente.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.admin_ativo_padrao()') is null then
    raise exception 'Rode antes migration_responsavel_escada_unica.sql: public.admin_ativo_padrao nao existe neste banco.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 1) O padrão do escritório, agora configurável.
-- ---------------------------------------------------------------------------
create or replace function public.responsavel_padrao_analise()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1) escolha do escritório: um UPDATE nesta chave troca o padrão na hora
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'tarefa_analise_responsavel_id'
        and u.ativo is true),
    -- 2) padrão histórico (Naira, 2026-09-09): a Mara. Fica como referência
    --    quando a chave não existe — que é o estado de hoje nos dois bancos.
    (select u.id
       from public.usuarios u
      where u.tipo = 'interno'
        and u.ativo is true
        and lower(u.email) = 'marasandra.adv@gmail.com'
      limit 1),
    -- 3) última rede: a Mara saiu e ninguém pôs a chave
    public.admin_ativo_padrao()
  );
$$;

comment on function public.responsavel_padrao_analise() is
  'Padrão do escritório para tarefa sem dono: app_config tarefa_analise_responsavel_id -> Mara (e-mail) -> admin_ativo_padrao(). Trocar o padrão = UPDATE na chave, sem migration.';

revoke all on function public.responsavel_padrao_analise() from public;
revoke all on function public.responsavel_padrao_analise() from anon;
grant execute on function public.responsavel_padrao_analise() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) A escada encolhe: 6 degraus viram 4, mesma ordem de decisão.
-- ---------------------------------------------------------------------------
create or replace function public.responsavel_tarefa_caso(
  p_caso_id   uuid,
  p_preferido uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1) palpite de quem chamou (quem pediu o documento, quem criou o evento)
    (select u.id from public.usuarios u
      where u.id = p_preferido and u.ativo is true and u.tipo = 'interno'),
    -- 2) dono explícito do caso
    (select u.id
       from public.casos c
       join public.usuarios u on u.id = c.responsavel_id
      where c.id = p_caso_id and u.ativo is true),
    -- 3) dono de fato: quem carrega mais tarefa aberta nesse caso; empate
    --    (inclusive todo mundo com zero aberta) decide pela mais recente.
    (select t.responsavel_id
       from public.tarefas t
       join public.usuarios u on u.id = t.responsavel_id
      where t.caso_id = p_caso_id
        and u.ativo is true
        and u.tipo = 'interno'
      group by t.responsavel_id
      order by count(*) filter (where t.status in ('a_fazer', 'fazendo')) desc,
               max(t.created_at) desc
      limit 1),
    -- 4) padrão do escritório — que por dentro já é
    --    configuração -> Mara -> admin, e nunca devolve NULL.
    public.responsavel_padrao_analise()
  );
$$;

comment on function public.responsavel_tarefa_caso(uuid, uuid) is
  'Resolve o responsável de uma tarefa nova: preferido -> dono do caso -> dono de fato -> responsavel_padrao_analise() (config -> Mara -> admin). Nunca devolve NULL.';

revoke all on function public.responsavel_tarefa_caso(uuid, uuid) from public;
revoke all on function public.responsavel_tarefa_caso(uuid, uuid) from anon;
grant execute on function public.responsavel_tarefa_caso(uuid, uuid) to authenticated, service_role;

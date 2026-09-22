-- ============================================================================
-- RBAC 06 · QG com busca e paginação (2026-09-22)
--
-- `qg_escritorios` devolvia TODOS os escritórios com oito contagens correladas
-- por linha; `qg_membros` devolvia todos os vínculos. Com dezenas de
-- escritórios isso vira milhares de contagens por abertura de tela. Agora:
--   - qg_escritorios(p_id, p_busca, p_status, p_limite, p_offset) — página de
--     até 10 (máx. 200), com `total` (count over) para o "10 de N"; as
--     contagens só rodam para a página devolvida (CTE `pagina` antes delas);
--   - qg_membros(p_escritorio_id, p_busca, p_status, p_limite, p_offset) —
--     idem; p_status 'ativos' = ativo + convidado (padrão da tela);
--   - qg_escritorios_nomes() — id/nome/slug/status de todos, leve, para
--     mapear nome em listas (operação);
--   - qg_alertas() — o card "Pede atenção" da lista, calculado no banco para
--     TODOS os escritórios (antes era derivado da lista inteira no front);
--   - processos_ultimo_andamento() — SECURITY INVOKER (RLS vale): último
--     andamento por processo, para a tela /processos parar de puxar até
--     10.000 andamentos (que o PostgREST cortava em 1.000 sem avisar).
--   - private.sem_acento(text) — busca sem acento sem depender da extensão
--     unaccent (não instalada): translate() cobre o português.
--
-- Assinaturas mudaram: as versões antigas são removidas antes (senão o
-- PostgREST vê duas `qg_membros` e recusa a chamada como ambígua).
-- Idempotente: re-rodar só recria as funções.
-- ============================================================================

create or replace function private.sem_acento(p text) returns text
language sql immutable strict set search_path = '' as $$
  select translate(lower(p),
    'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn')
$$;

-- ---------------------------------------------------------------------------
-- qg_escritorios: página + total
-- ---------------------------------------------------------------------------
drop function if exists public.qg_escritorios();

create or replace function public.qg_escritorios(
  p_id uuid default null, p_busca text default null, p_status text default null,
  p_limite int default 10, p_offset int default 0)
returns table (id uuid, slug text, nome text, cnpj text, status text, plano text, padrao_sistema boolean,
               criado_em timestamptz, suspenso_em timestamptz, suspenso_motivo text, encerrado_em timestamptz,
               membros_ativos int, admins int, admins_sem_mfa int, casos int, documentos int,
               tokens_mcp int, ultimo_acesso timestamptz, suporte_aberto int, total int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_busca text := nullif(private.sem_acento(btrim(coalesce(p_busca, ''))), '');
  v_limite int := least(greatest(coalesce(p_limite, 10), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.exigir_staff('ver');
  return query
  with pagina as (
    select e.*, count(*) over ()::int as total
      from public.escritorios e
     where (p_id is null or e.id = p_id)
       and (p_status is null or p_status = '' or e.status = p_status)
       and (v_busca is null
            or private.sem_acento(e.nome) like '%' || v_busca || '%'
            or e.slug like '%' || v_busca || '%'
            or coalesce(e.cnpj, '') like '%' || v_busca || '%')
     order by e.padrao_sistema desc, e.nome, e.id
     limit v_limite offset v_offset
  )
  select e.id, e.slug, e.nome, e.cnpj, e.status, e.plano, e.padrao_sistema,
         e.created_at, e.suspenso_em, e.suspenso_motivo, e.encerrado_em,
         (select count(*)::int from public.membros m where m.escritorio_id = e.id and m.status = 'ativo'),
         (select count(*)::int from public.membros m join public.papeis p on p.id = m.papel_id and p.chave = 'admin'
           where m.escritorio_id = e.id and m.status = 'ativo'),
         (select count(*)::int from public.membros m join public.papeis p on p.id = m.papel_id and p.chave = 'admin'
           where m.escritorio_id = e.id and m.status = 'ativo'
             and not exists (select 1 from auth.mfa_factors f where f.user_id = m.usuario_id and f.status = 'verified')),
         (select count(*)::int from public.casos c where c.escritorio_id = e.id),
         (select count(*)::int from public.documentos d where d.escritorio_id = e.id),
         (select count(*)::int from public.ia_tokens t where t.escritorio_id = e.id and t.revogado_em is null
             and (t.expira_em is null or t.expira_em > now())),
         (select max(a.last_sign_in_at) from public.membros m join auth.users a on a.id = m.usuario_id
           where m.escritorio_id = e.id),
         (select count(*)::int from public.acessos_suporte s where s.escritorio_id = e.id
             and (s.status = 'pendente' or (s.status = 'aprovado' and now() < s.fim))),
         e.total
    from pagina e
   order by e.padrao_sistema desc, e.nome, e.id;
end;
$$;

-- Só nome: para mapear id -> nome em listas (operação, auditoria).
create or replace function public.qg_escritorios_nomes()
returns table (id uuid, nome text, slug text, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  select e.id, e.nome, e.slug, e.status from public.escritorios e order by e.padrao_sistema desc, e.nome;
end;
$$;

-- O card "Pede atenção": todos os escritórios, só quem tem algo a apontar.
create or replace function public.qg_alertas()
returns table (escritorio_id uuid, nome text, alerta text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_staff('ver');
  return query
  with adm as (
    select m.escritorio_id,
           count(*)::int as admins,
           count(*) filter (where not exists (select 1 from auth.mfa_factors f
                                               where f.user_id = m.usuario_id and f.status = 'verified'))::int as sem_mfa
      from public.membros m join public.papeis p on p.id = m.papel_id and p.chave = 'admin'
     where m.status = 'ativo'
     group by m.escritorio_id),
  sup as (
    select s.escritorio_id, count(*)::int as abertos
      from public.acessos_suporte s
     where s.status = 'pendente' or (s.status = 'aprovado' and now() < s.fim)
     group by s.escritorio_id)
  select e.id, e.nome, x.alerta
    from public.escritorios e
    left join adm on adm.escritorio_id = e.id
    left join sup on sup.escritorio_id = e.id
    cross join lateral (values
      (case when e.status = 'ativo' and coalesce(adm.admins, 0) = 0 then 'sem administrador ativo' end),
      (case when e.status = 'ativo' and coalesce(adm.sem_mfa, 0) > 0
            then adm.sem_mfa || ' admin(s) sem verificação em duas etapas' end),
      (case when e.status = 'provisionando' then 'criado, mas o primeiro admin ainda não entrou' end),
      (case when coalesce(sup.abertos, 0) > 0 then sup.abertos || ' acesso(s) de suporte em aberto' end)
    ) as x(alerta)
   where x.alerta is not null
   order by e.padrao_sistema desc, e.nome, x.alerta;
end;
$$;

-- ---------------------------------------------------------------------------
-- qg_membros: página + total, busca por nome/e-mail, filtro de status
-- ---------------------------------------------------------------------------
drop function if exists public.qg_membros(uuid);

create or replace function public.qg_membros(
  p_escritorio_id uuid, p_busca text default null, p_status text default 'ativos',
  p_limite int default 10, p_offset int default 0)
returns table (usuario_id uuid, nome text, email text, papel text, papel_nome text, tipo_acesso text,
               status text, mfa boolean, ultimo_acesso timestamptz, desde timestamptz, total int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_busca text := nullif(private.sem_acento(btrim(coalesce(p_busca, ''))), '');
  v_limite int := least(greatest(coalesce(p_limite, 10), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.exigir_staff('ver');
  return query
  with pagina as (
    select m.usuario_id, m.status, m.created_at, p.chave, p.nome as papel_nome, p.tipo_acesso, p.ordem,
           u.nome as usuario_nome, u.email,
           count(*) over ()::int as total
      from public.membros m
      join public.usuarios u on u.id = m.usuario_id
      join public.papeis p on p.id = m.papel_id
     where m.escritorio_id = p_escritorio_id
       and (p_status is null or p_status = '' or p_status = 'todos'
            or (p_status = 'ativos' and m.status in ('ativo', 'convidado'))
            or m.status = p_status)
       and (v_busca is null
            or private.sem_acento(coalesce(u.nome, '')) like '%' || v_busca || '%'
            or lower(coalesce(u.email, '')) like '%' || v_busca || '%')
     order by p.ordem, u.nome, m.usuario_id
     limit v_limite offset v_offset
  )
  select x.usuario_id, x.usuario_nome, x.email, x.chave, x.papel_nome, x.tipo_acesso, x.status,
         exists (select 1 from auth.mfa_factors f where f.user_id = x.usuario_id and f.status = 'verified'),
         a.last_sign_in_at, x.created_at, x.total
    from pagina x
    left join auth.users a on a.id = x.usuario_id
   order by x.ordem, x.usuario_nome, x.usuario_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- /processos: último andamento por processo, sob a RLS de quem chama
-- ---------------------------------------------------------------------------
create or replace function public.processos_ultimo_andamento()
returns table (processo_admin_id uuid, processo_judicial_id uuid, titulo text, origem text, data timestamptz)
language sql stable security invoker set search_path = '' as $$
  select distinct on (coalesce(a.processo_admin_id, a.processo_judicial_id))
         a.processo_admin_id, a.processo_judicial_id, a.titulo, a.origem::text,
         coalesce(a.data_evento, a.created_at)
    from public.andamentos a
   where a.processo_admin_id is not null or a.processo_judicial_id is not null
   order by coalesce(a.processo_admin_id, a.processo_judicial_id),
            coalesce(a.data_evento, a.created_at) desc, a.id
$$;
revoke execute on function public.processos_ultimo_andamento() from public, anon;
grant execute on function public.processos_ultimo_andamento() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants das qg_* (mesma regra da migration 05)
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'qg\_%'
  loop
    execute format('revoke execute on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
  end loop;
end $$;

notify pgrst, 'reload schema';

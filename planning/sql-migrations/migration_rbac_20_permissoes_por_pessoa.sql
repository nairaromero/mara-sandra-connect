-- migration_rbac_20_permissoes_por_pessoa.sql
--
-- O admin ajusta permissões de UMA pessoa, por cima do papel dela
-- (planning/PERMISSOES_POR_PESSOA.md, aprovado em 25/09/2026).
--
-- O que se guarda é a DIFERENÇA, não uma cópia da matriz: `membro_permissoes`
-- tem uma linha por ajuste, `concedida = true` soma e `false` tira. Assim o
-- papel continua vivo (melhorar "advogado" amanhã alcança quem foi ajustado) e
-- desfazer um ajuste é apagar a linha.
--
-- O efetivo passa a ser calculado num lugar só — `private.permissoes_efetivas`
-- — e `private.tem_permissao` lê dali. Como TODA decisão de acesso (policies,
-- RPCs, edge functions) passa por `tem_permissao`, ninguém mais precisa ser
-- tocado.
--
-- Decisões da Naira (25/09):
--   1. a tela mora em /equipe (não há aba nova em Configurações);
--   2. só admin ajusta (`equipe:gerenciar`);
--   3. sensíveis: equipe:gerenciar, escritorio:configurar, auditoria:ler,
--      integracoes:gerenciar, clientes:excluir, parceiros:excluir,
--      ia:mcp_conceder;
--   4. ninguém concede o que não tem;
--   5. TUDO auditável.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Permissões sensíveis (a tela avisa antes de conceder)
-- ---------------------------------------------------------------------------
alter table public.permissoes add column if not exists sensivel boolean not null default false;

update public.permissoes set sensivel = true
 where chave in ('equipe:gerenciar', 'escritorio:configurar', 'auditoria:ler',
                 'integracoes:gerenciar', 'clientes:excluir', 'parceiros:excluir',
                 'ia:mcp_conceder')
   and not sensivel;

-- ---------------------------------------------------------------------------
-- 2. A tabela dos ajustes
-- ---------------------------------------------------------------------------
create table if not exists public.membro_permissoes (
  id            uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete cascade,
  membro_id     uuid not null references public.membros (id) on delete cascade,
  permissao     text not null references public.permissoes (chave) on delete cascade,
  -- escopo do ajuste; null = o mesmo do papel (ou `todos`, quando o papel não dá)
  escopo        text check (escopo in ('todos', 'atribuidos', 'indicados', 'proprios')),
  -- true  = concedida além do papel
  -- false = tirada do que o papel dá
  concedida     boolean not null,
  definida_por  uuid references public.usuarios (id) on delete set null,
  definida_em   timestamptz not null default now(),
  unique (membro_id, permissao)
);

create index if not exists membro_permissoes_membro_idx on public.membro_permissoes (membro_id);
create index if not exists membro_permissoes_escritorio_idx on public.membro_permissoes (escritorio_id);

alter table public.membro_permissoes enable row level security;

-- Isolamento por escritório, como toda tabela de domínio.
drop policy if exists isolamento_escritorio on public.membro_permissoes;
create policy isolamento_escritorio on public.membro_permissoes
  as restrictive for all to authenticated
  using (escritorio_id = (select private.escritorio_ativo()))
  with check (escritorio_id = (select private.escritorio_ativo()));

-- Quem lê: quem gerencia a equipe (a tela do /equipe). A própria pessoa não
-- precisa ler esta tabela: o que ela pode chega por `minhas_permissoes()`.
drop policy if exists membro_permissoes_ler on public.membro_permissoes;
create policy membro_permissoes_ler on public.membro_permissoes
  for select to authenticated
  using ((select private.tem_permissao('equipe:gerenciar')));

-- Escrita SÓ pela RPC (security definer, com as travas). Nem o admin escreve
-- direto: assim não existe caminho sem auditoria.
revoke all on public.membro_permissoes from anon, authenticated;
grant select (id, escritorio_id, membro_id, permissao, escopo, concedida, definida_por, definida_em)
  on public.membro_permissoes to authenticated;
grant all on public.membro_permissoes to service_role;

-- ---------------------------------------------------------------------------
-- 3. O efetivo, num lugar só
-- ---------------------------------------------------------------------------
create or replace function private.permissoes_efetivas(p_membro_id uuid)
returns table (permissao text, escopo text, origem text)
language sql stable security definer set search_path = '' as $$
  with do_papel as (
    select pp.permissao, pp.escopo
      from public.membros m
      join public.papel_permissoes pp on pp.papel_id = m.papel_id
     where m.id = p_membro_id
  ),
  ajustes as (
    select mp.permissao, mp.escopo, mp.concedida
      from public.membro_permissoes mp
     where mp.membro_id = p_membro_id
  )
  -- o que o papel dá e o ajuste não tirou (escopo do ajuste vence, se houver)
  select p.permissao,
         coalesce(a.escopo, p.escopo) as escopo,
         case when a.permissao is null then 'papel' else 'ajuste' end as origem
    from do_papel p
    left join ajustes a on a.permissao = p.permissao
   where a.permissao is null or a.concedida
  union all
  -- o que só o ajuste dá
  select a.permissao, coalesce(a.escopo, 'todos'), 'ajuste'
    from ajustes a
   where a.concedida
     and not exists (select 1 from do_papel p where p.permissao = a.permissao)
$$;

-- ---------------------------------------------------------------------------
-- 4. `tem_permissao` passa a ler o efetivo (ponto único de decisão)
-- ---------------------------------------------------------------------------
create or replace function private.tem_permissao(p_perm text, p_escopo text default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from private.meu_vinculo() v
      join private.permissoes_efetivas(v.membro_id) e on e.permissao = p_perm
     where p_escopo is null or e.escopo = p_escopo
  )
$$;

-- ---------------------------------------------------------------------------
-- 5. `minhas_permissoes` ganha a origem (a tela marca o que foi ajustado)
-- ---------------------------------------------------------------------------
drop function if exists public.minhas_permissoes();
create or replace function public.minhas_permissoes()
returns table (permissao text, escopo text, origem text)
language sql stable security definer set search_path = '' as $$
  select e.permissao, e.escopo, e.origem
    from private.meu_vinculo() v
    join private.permissoes_efetivas(v.membro_id) e on true
$$;

revoke execute on function public.minhas_permissoes() from public, anon;
grant execute on function public.minhas_permissoes() to authenticated, service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6. A lista que a tela mostra (uma linha por permissão do sistema)
-- ---------------------------------------------------------------------------
create or replace function public.permissoes_do_membro(p_usuario_id uuid)
returns table (permissao text, grupo text, descricao text, sensivel boolean,
               do_papel boolean, tem boolean, escopo text, ajustada boolean,
               definida_por_nome text, definida_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esc    uuid := private.escritorio_ativo();
  v_membro uuid;
begin
  if not private.tem_permissao('equipe:gerenciar') then
    raise exception 'Sem permissão: apenas quem gerencia a equipe vê os ajustes' using errcode = '42501';
  end if;
  select m.id into v_membro from public.membros m
   where m.escritorio_id = v_esc and m.usuario_id = p_usuario_id;
  if v_membro is null then
    raise exception 'Pessoa sem vínculo neste escritório' using errcode = '42501';
  end if;

  return query
  select p.chave,
         p.grupo,
         p.descricao,
         p.sensivel,
         (pp.permissao is not null)          as do_papel,
         (e.permissao is not null)           as tem,
         coalesce(e.escopo, pp.escopo)       as escopo,
         (mp.permissao is not null)          as ajustada,
         u.nome                              as definida_por_nome,
         mp.definida_em
    from public.permissoes p
    left join public.membros m on m.id = v_membro
    left join public.papel_permissoes pp on pp.papel_id = m.papel_id and pp.permissao = p.chave
    left join private.permissoes_efetivas(v_membro) e on e.permissao = p.chave
    left join public.membro_permissoes mp on mp.membro_id = v_membro and mp.permissao = p.chave
    left join public.usuarios u on u.id = mp.definida_por
   order by p.grupo, p.chave;
end;
$$;

revoke execute on function public.permissoes_do_membro(uuid) from public, anon;
grant execute on function public.permissoes_do_membro(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. O ajuste em si — com as travas e a auditoria
-- ---------------------------------------------------------------------------
-- p_estado: 'conceder' | 'remover' | 'papel' (volta ao que o papel dá)
create or replace function public.definir_permissao_do_membro(p_usuario_id uuid, p_permissao text,
                                                              p_estado text, p_escopo text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_esc      uuid := private.escritorio_ativo();
  v_eu       uuid := auth.uid();
  v_m        public.membros%rowtype;
  v_papel    public.papeis%rowtype;
  v_do_papel boolean;
  v_antes    boolean;
  v_depois   boolean;
begin
  -- (1) quem ajusta: só quem gerencia a equipe (admin)
  if not private.tem_permissao('equipe:gerenciar') then
    raise exception 'Sem permissão: apenas quem gerencia a equipe ajusta permissões' using errcode = '42501';
  end if;

  -- (2) ninguém se ajusta (mesma régua de definir_papel: evita escalar sozinho
  --     e evita o admin fechar a própria porta)
  if p_usuario_id = v_eu then
    raise exception 'Você não pode ajustar as próprias permissões';
  end if;

  if p_estado not in ('conceder', 'remover', 'papel') then
    raise exception 'estado inválido: use conceder, remover ou papel';
  end if;
  if p_escopo is not null and p_escopo not in ('todos', 'atribuidos', 'indicados', 'proprios') then
    raise exception 'escopo inválido';
  end if;
  if not exists (select 1 from public.permissoes where chave = p_permissao) then
    raise exception 'permissão % não existe', p_permissao;
  end if;

  select * into v_m from public.membros
   where escritorio_id = v_esc and usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'Pessoa sem vínculo neste escritório' using errcode = '42501';
  end if;
  select * into v_papel from public.papeis where id = v_m.papel_id;

  -- (3) ninguém concede o que não tem (decisão 4 da Naira)
  if p_estado = 'conceder' and not private.tem_permissao(p_permissao) then
    raise exception 'Você não pode conceder uma permissão que você mesma não tem (%)', p_permissao
      using errcode = '42501';
  end if;

  -- (4) coerência com o tipo de acesso: parceiro só recebe o que o papel
  --     parceiro do sistema prevê
  if p_estado = 'conceder' and v_papel.tipo_acesso = 'parceiro'
     and not exists (
       select 1 from public.papel_permissoes pp
         join public.papeis pa on pa.id = pp.papel_id
        where pa.escritorio_id is null and pa.chave = 'parceiro' and pp.permissao = p_permissao)
  then
    raise exception 'Essa permissão não se aplica a quem é parceiro (%)', p_permissao;
  end if;

  v_do_papel := exists (select 1 from public.papel_permissoes
                         where papel_id = v_m.papel_id and permissao = p_permissao);
  v_antes := exists (select 1 from private.permissoes_efetivas(v_m.id) e where e.permissao = p_permissao);

  -- (5) aplica
  if p_estado = 'papel' then
    delete from public.membro_permissoes where membro_id = v_m.id and permissao = p_permissao;
  else
    insert into public.membro_permissoes (escritorio_id, membro_id, permissao, escopo, concedida, definida_por)
    values (v_esc, v_m.id, p_permissao, p_escopo, p_estado = 'conceder', v_eu)
    on conflict (membro_id, permissao) do update
      set concedida = excluded.concedida,
          escopo = excluded.escopo,
          definida_por = excluded.definida_por,
          definida_em = now();
  end if;

  -- (6) o escritório não pode ficar sem ninguém para gerenciar a equipe
  if p_permissao = 'equipe:gerenciar' and p_estado <> 'conceder' then
    if not exists (
      select 1 from public.membros m2
        join private.permissoes_efetivas(m2.id) e2 on e2.permissao = 'equipe:gerenciar'
       where m2.escritorio_id = v_esc and m2.status = 'ativo')
    then
      raise exception 'O escritório ficaria sem ninguém para gerenciar a equipe';
    end if;
  end if;

  v_depois := exists (select 1 from private.permissoes_efetivas(v_m.id) e where e.permissao = p_permissao);

  -- (7) auditoria: quem mexeu, em quem, o que era e o que ficou
  perform private.auditar(v_esc, 'membro', 'equipe.permissao_ajustada', 'membros', v_m.id::text,
    jsonb_build_object('usuario_id', p_usuario_id, 'permissao', p_permissao, 'estado', p_estado,
                       'escopo', p_escopo, 'papel', v_papel.chave, 'vinha_do_papel', v_do_papel,
                       'antes', v_antes, 'depois', v_depois));
end;
$$;

revoke execute on function public.definir_permissao_do_membro(uuid, text, text, text) from public, anon;
grant execute on function public.definir_permissao_do_membro(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Voltar TUDO ao papel (também auditado)
-- ---------------------------------------------------------------------------
create or replace function public.resetar_permissoes_do_membro(p_usuario_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_esc    uuid := private.escritorio_ativo();
  v_m      public.membros%rowtype;
  v_quant  integer;
begin
  if not private.tem_permissao('equipe:gerenciar') then
    raise exception 'Sem permissão: apenas quem gerencia a equipe ajusta permissões' using errcode = '42501';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'Você não pode ajustar as próprias permissões';
  end if;
  select * into v_m from public.membros
   where escritorio_id = v_esc and usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'Pessoa sem vínculo neste escritório' using errcode = '42501';
  end if;

  delete from public.membro_permissoes where membro_id = v_m.id;
  get diagnostics v_quant = row_count;

  if not exists (
    select 1 from public.membros m2
      join private.permissoes_efetivas(m2.id) e2 on e2.permissao = 'equipe:gerenciar'
     where m2.escritorio_id = v_esc and m2.status = 'ativo')
  then
    raise exception 'O escritório ficaria sem ninguém para gerenciar a equipe';
  end if;

  perform private.auditar(v_esc, 'membro', 'equipe.permissoes_resetadas', 'membros', v_m.id::text,
    jsonb_build_object('usuario_id', p_usuario_id, 'ajustes_removidos', v_quant));
  return v_quant;
end;
$$;

revoke execute on function public.resetar_permissoes_do_membro(uuid) from public, anon;
grant execute on function public.resetar_permissoes_do_membro(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

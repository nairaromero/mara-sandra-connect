-- =============================================================================
-- migration_parceiro_desligar.sql  (2026-08-23)
--
-- Soft delete de PARCEIRO, no molde do desligar_interno (issue #202):
--   1. desligar_parceiro(usuario)  — ativo=false + desligado_em/por; ban no auth
--      (bloqueia login) + derruba sessoes/refresh tokens. NAO apaga nada: casos,
--      comentarios, documentos e repasses ficam no nome da pessoa.
--   2. reativar_parceiro(usuario)  — desfaz.
--   3. caso_do_parceiro(caso)      — passa a exigir ativo=true e desligado_em is
--      null. Ate aqui a flag `ativo` nao bloqueava nada pra parceiro: o RLS so
--      olhava parceiro_id = auth.uid(), entao um parceiro "inativo" que ainda
--      tivesse access token valido continuava vendo os casos dele por ate 1h.
--
-- Quem pode: qualquer interno ativo (is_interno()) — e quem gerencia /parceiros
-- e convida parceiro. Reversivel, entao nao exige admin. Idempotente.
--
-- Por que soft delete e nao a edge excluir-parceiro: ver issue #202 — o cascade
-- manual dela falha em FKs NO ACTION e deixa o parceiro meio apagado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. parceiro_ativo(): quem chama e um parceiro em atividade
-- ---------------------------------------------------------------------------
create or replace function public.parceiro_ativo()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.usuarios
     where id = auth.uid()
       and tipo = 'parceiro'
       and ativo = true
       and desligado_em is null
  );
$$;

-- As policies abaixo checam `parceiro_id = auth.uid()` direto, sem passar
-- por caso_do_parceiro(): casos (insert/select/update), clientes
-- (select/update), clientes_etiquetas (select), comentarios (insert/select)
-- e repasses (select). Sem isto, um parceiro desligado com access token
-- ainda valido (≤1h) continuaria listando os casos dele. Reescreve cada
-- expressao trocando `parceiro_id = auth.uid()` por
-- `(parceiro_id = auth.uid() and public.parceiro_ativo())`. Idempotente:
-- pula policy que ja contem parceiro_ativo().
do $$
declare
  p record;
  v_qual text;
  v_check text;
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%parceiro_id = auth.uid()%'
       and (coalesce(qual, '') || coalesce(with_check, '')) not ilike '%parceiro_ativo()%'
  loop
    -- Preserva o alias quando houver (c.parceiro_id, casos.parceiro_id).
    v_qual  := regexp_replace(p.qual,       '(\w+\.)?parceiro_id = auth\.uid\(\)', '(\1parceiro_id = auth.uid() AND public.parceiro_ativo())', 'g');
    v_check := regexp_replace(p.with_check, '(\w+\.)?parceiro_id = auth\.uid\(\)', '(\1parceiro_id = auth.uid() AND public.parceiro_ativo())', 'g');
    if p.qual is not null and p.with_check is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', p.policyname, p.schemaname, p.tablename, v_qual, v_check);
    elsif p.qual is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, v_qual);
    else
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, v_check);
    end if;
    raise notice 'policy % em % atualizada', p.policyname, p.tablename;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. caso_do_parceiro: parceiro desligado nao e mais "dono" de caso nenhum
-- ---------------------------------------------------------------------------
create or replace function public.caso_do_parceiro(p_caso_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
      from public.casos c
      join public.usuarios u on u.id = c.parceiro_id
     where c.id = p_caso_id
       and c.parceiro_id = auth.uid()
       and u.ativo = true
       and u.desligado_em is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. desligar_parceiro
-- ---------------------------------------------------------------------------
create or replace function public.desligar_parceiro(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_alvo  public.usuarios%rowtype;
  v_casos int;
begin
  if not public.is_interno() then
    raise exception 'Sem permissão: apenas a equipe interna desliga parceiros';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'Você não pode desligar a si mesma(o)';
  end if;

  select * into v_alvo from public.usuarios where id = p_usuario_id for update;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;
  if v_alvo.tipo <> 'parceiro' then
    raise exception 'Esta função só desliga parceiros (interno sai por /equipe)';
  end if;

  select count(*) into v_casos from public.casos where parceiro_id = p_usuario_id;

  update public.usuarios
     set ativo = false,
         desligado_em = coalesce(desligado_em, now()),
         desligado_por = coalesce(desligado_por, auth.uid())
   where id = p_usuario_id;

  -- Bloqueia login e derruba sessões. O access token atual ainda vale até
  -- expirar (≤1h), mas caso_do_parceiro() já falha (ativo=false), então a
  -- pessoa não enxerga mais caso nenhum mesmo com o token na mão.
  update auth.users
     set banned_until = now() + interval '100 years'
   where id = p_usuario_id;
  delete from auth.refresh_tokens where user_id = p_usuario_id::text;
  delete from auth.sessions where user_id = p_usuario_id;

  return jsonb_build_object(
    'nome', v_alvo.nome,
    'casos_preservados', v_casos
  );
end;
$$;

revoke all on function public.desligar_parceiro(uuid) from public, anon;
grant execute on function public.desligar_parceiro(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. reativar_parceiro
-- ---------------------------------------------------------------------------
create or replace function public.reativar_parceiro(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_alvo public.usuarios%rowtype;
begin
  if not public.is_interno() then
    raise exception 'Sem permissão: apenas a equipe interna reativa parceiros';
  end if;
  select * into v_alvo from public.usuarios where id = p_usuario_id;
  if not found or v_alvo.tipo <> 'parceiro' then
    raise exception 'Parceiro não encontrado';
  end if;

  update public.usuarios
     set ativo = true,
         desligado_em = null,
         desligado_por = null
   where id = p_usuario_id;

  update auth.users set banned_until = null where id = p_usuario_id;
end;
$$;

revoke all on function public.reativar_parceiro(uuid) from public, anon;
grant execute on function public.reativar_parceiro(uuid) to authenticated;

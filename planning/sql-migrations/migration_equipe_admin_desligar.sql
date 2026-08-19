-- =============================================================================
-- migration_equipe_admin_desligar.sql  (2026-08-19)
--
-- Gestão da equipe pela UI (/equipe), só pra ADMIN (Naira/Mara):
--   1. definir_admin(usuario, valor)          — promover/remover admin
--   2. desligar_interno(usuario, novo_resp)   — tira a pessoa da equipe:
--        • tarefas ABERTAS (a_fazer/fazendo) passam pro novo responsável
--          (obrigatório se houver alguma); as concluídas ficam no nome dela
--        • eventos de agenda FUTUROS também passam
--        • usuarios: ativo=false, eh_admin=false, desligado_em/por
--        • auth: banned_until (bloqueia login) + derruba sessões/refresh tokens
--      NÃO apaga a conta: o nome continua no histórico (tarefas concluídas,
--      comentários, andamentos, "Concluída por …").
--   3. reativar_interno(usuario)              — desfaz o desligamento
--
-- RPCs SECURITY DEFINER com gate is_admin() — chamadas direto do front com o
-- JWT da pessoa logada (sem edge function). Idempotente.
-- =============================================================================

alter table public.usuarios
  add column if not exists desligado_em  timestamptz,
  add column if not exists desligado_por uuid references public.usuarios(id) on delete set null;

comment on column public.usuarios.desligado_em is
  'Interno desligado da equipe pela UI (conta bloqueada, histórico preservado). NULL = ativo/nunca desligado.';

-- ---------------------------------------------------------------------------
-- 1. definir_admin
-- ---------------------------------------------------------------------------
create or replace function public.definir_admin(p_usuario_id uuid, p_valor boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alvo public.usuarios%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão: apenas administradores alteram o papel de admin';
  end if;
  if p_usuario_id = auth.uid() and p_valor is distinct from true then
    raise exception 'Você não pode remover o próprio papel de admin';
  end if;

  select * into v_alvo from public.usuarios where id = p_usuario_id;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;
  if v_alvo.tipo <> 'interno' then
    raise exception 'Só usuários internos podem ser admin';
  end if;
  if p_valor and (not v_alvo.ativo or v_alvo.desligado_em is not null) then
    raise exception 'Reative a pessoa antes de torná-la admin';
  end if;

  update public.usuarios
     set eh_admin = coalesce(p_valor, false)
   where id = p_usuario_id;
end;
$$;

revoke all on function public.definir_admin(uuid, boolean) from public, anon;
grant execute on function public.definir_admin(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. desligar_interno
-- ---------------------------------------------------------------------------
create or replace function public.desligar_interno(
  p_usuario_id uuid,
  p_novo_responsavel_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_alvo   public.usuarios%rowtype;
  v_novo   public.usuarios%rowtype;
  v_abertas int;
  v_tarefas_movidas int := 0;
  v_eventos_movidos int := 0;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão: apenas administradores desligam pessoas da equipe';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'Você não pode desligar a si mesma(o)';
  end if;

  select * into v_alvo from public.usuarios where id = p_usuario_id for update;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;
  if v_alvo.tipo <> 'interno' then
    raise exception 'Esta função só desliga usuários internos (parceiro sai por /parceiros)';
  end if;

  select count(*) into v_abertas
    from public.tarefas
   where responsavel_id = p_usuario_id
     and status in ('a_fazer', 'fazendo');

  if p_novo_responsavel_id is not null then
    if p_novo_responsavel_id = p_usuario_id then
      raise exception 'O novo responsável não pode ser a própria pessoa desligada';
    end if;
    select * into v_novo from public.usuarios where id = p_novo_responsavel_id;
    if not found or v_novo.tipo <> 'interno' or not v_novo.ativo or v_novo.desligado_em is not null then
      raise exception 'Novo responsável inválido: precisa ser alguém ativo da equipe';
    end if;
  elsif v_abertas > 0 then
    raise exception 'Há % tarefa(s) aberta(s) com essa pessoa: escolha quem assume', v_abertas;
  end if;

  -- Tarefas abertas → novo responsável (concluídas/canceladas ficam como estão).
  if p_novo_responsavel_id is not null then
    update public.tarefas
       set responsavel_id = p_novo_responsavel_id
     where responsavel_id = p_usuario_id
       and status in ('a_fazer', 'fazendo');
    get diagnostics v_tarefas_movidas = row_count;

    -- Agenda: só o que ainda vai acontecer.
    update public.agenda_eventos
       set responsavel_id = p_novo_responsavel_id
     where responsavel_id = p_usuario_id
       and end_at >= now();
    get diagnostics v_eventos_movidos = row_count;
  end if;

  update public.usuarios
     set ativo = false,
         eh_admin = false,
         desligado_em = now(),
         desligado_por = auth.uid()
   where id = p_usuario_id;

  -- Bloqueia login e derruba sessões. O access token atual ainda vale até
  -- expirar (≤1h), mas is_interno()/is_admin() já falham (ativo=false).
  update auth.users
     set banned_until = now() + interval '100 years'
   where id = p_usuario_id;
  delete from auth.refresh_tokens where user_id = p_usuario_id::text;
  delete from auth.sessions where user_id = p_usuario_id;

  return jsonb_build_object(
    'tarefas_movidas', v_tarefas_movidas,
    'eventos_movidos', v_eventos_movidos,
    'nome', v_alvo.nome
  );
end;
$$;

revoke all on function public.desligar_interno(uuid, uuid) from public, anon;
grant execute on function public.desligar_interno(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. reativar_interno
-- ---------------------------------------------------------------------------
create or replace function public.reativar_interno(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_alvo public.usuarios%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão: apenas administradores reativam pessoas da equipe';
  end if;
  select * into v_alvo from public.usuarios where id = p_usuario_id;
  if not found or v_alvo.tipo <> 'interno' then
    raise exception 'Usuário interno não encontrado';
  end if;

  update public.usuarios
     set ativo = true,
         desligado_em = null,
         desligado_por = null
   where id = p_usuario_id;

  update auth.users set banned_until = null where id = p_usuario_id;
end;
$$;

revoke all on function public.reativar_interno(uuid) from public, anon;
grant execute on function public.reativar_interno(uuid) to authenticated;

-- =============================================================================
-- Migration: segurança dos tokens do MCP (ia_tokens)  —  2026-09-11
--
-- Auditoria do MCP achou dois buracos (ver conversa de 2026-09-11):
--   1) Qualquer interno podia ALTERAR qualquer token pela API (policy de UPDATE
--      com `or is_interno()`): trocar o dono (agir no MCP "como" outra pessoa)
--      ou desfazer uma revogação. Ninguém escreve em ia_tokens com o JWT do
--      usuário: ia-config e ia-mcp usam service role (conferido em src/ e
--      supabase/functions/). Então a escrita fica só pelo backend.
--   2) desligar_interno não revogava os tokens do MCP — e o token não passa
--      pelo login, então quem era desligado seguia usando o MCP.
--
-- Idempotente: pode rodar de novo sem desfazer nada.
-- Rodar primeiro no staging:  node scripts/msc-sql.mjs --staging --file <este arquivo>
-- =============================================================================

-- 1) ia_tokens: escrita só pelo backend (service role ignora RLS e grants abaixo).
--    SELECT continua como está (ninguém lê direto hoje; o card usa ia-config).
drop policy if exists "ia_tokens_insert" on public.ia_tokens;
drop policy if exists "ia_tokens_update" on public.ia_tokens;
drop policy if exists "ia_tokens_delete" on public.ia_tokens;
revoke insert, update, delete on public.ia_tokens from authenticated, anon;

-- 2) desligar_interno passa a revogar os tokens do MCP.
--    Base: pg_get_functiondef de PRODUÇÃO em 2026-09-11 (md5 b76896a09638134755d139d86fbbbc8b,
--    idêntico no staging). Única mudança: o bloco "Tokens do MCP" antes do return.
CREATE OR REPLACE FUNCTION public.desligar_interno(p_usuario_id uuid, p_novo_responsavel_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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

  -- Tokens do MCP (Claude/ChatGPT externos) não passam pelo login: revoga todos.
  -- Reativar a pessoa NÃO devolve os tokens; ela gera novos se precisar.
  update public.ia_tokens
     set revogado_em = now()
   where usuario_id = p_usuario_id
     and revogado_em is null;

  return jsonb_build_object(
    'tarefas_movidas', v_tarefas_movidas,
    'eventos_movidos', v_eventos_movidos,
    'nome', v_alvo.nome
  );
end;
$function$;

-- 3) Quem JÁ está desligado/inativo: revoga tokens que ainda valham.
--    (Em 2026-09-11 não havia nenhum em produção; fica pela garantia.)
update public.ia_tokens t
   set revogado_em = now()
  from public.usuarios u
 where u.id = t.usuario_id
   and t.revogado_em is null
   and (u.ativo = false or u.desligado_em is not null);

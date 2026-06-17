-- =============================================================================
-- Migration: WhatsApp — onboarding por código (vínculo LID → parceiro)
--
-- PROBLEMA: na ENTRADA o WhatsApp entrega só um LID anônimo (não o telefone) e
-- NÃO é possível ENVIAR a um @lid. Logo, o vínculo LID→parceiro tem de começar
-- pela SAÍDA (que funciona — Fase 1): mandamos um CÓDIGO para o telefone
-- cadastrado do parceiro; ele responde o código na conversa; ao receber a
-- resposta (LID + código), casamos o código → parceiro e gravamos o vínculo.
--
-- FLUXO (gatilho = interno/admin pelo painel; decidido 2026-06-02):
--   1. interno chama whatsapp_gerar_codigo_ativacao(parceiro_id)
--      -> gera código (4 dígitos, 15 min, uso único) e ENFILEIRA a mensagem
--         com o código pro telefone do parceiro (outbox da Fase 1 entrega).
--   2. parceiro responde o código no WhatsApp.
--   3. a Edge (whatsapp-inbound), no ramo "parceiro desconhecido", chama
--      whatsapp_consumir_codigo(codigo, lid) -> cria whatsapp_lid_map e confirma.
--
-- Depende de: migration_whatsapp_outbox.sql (Fase 1) e
--             migration_whatsapp_inbound.sql (Fase 2: whatsapp_lid_map,
--             whatsapp_enqueue_text). Idempotente.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Códigos de ativação pendentes.
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_ativacao_codigos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null,
  parceiro_id  uuid not null references public.usuarios(id) on delete cascade,
  telefone     text not null,                 -- destino (telefone cadastrado)
  expira_em    timestamptz not null,
  usado_em     timestamptz,                   -- null = ainda válido
  criado_em    timestamptz not null default now()
);

-- Garante código único ENTRE os ainda válidos (não usados). Códigos já usados
-- podem repetir o valor no futuro sem conflito.
create unique index if not exists uq_whatsapp_ativacao_codigo_ativo
  on public.whatsapp_ativacao_codigos (codigo)
  where usado_em is null;

create index if not exists idx_whatsapp_ativacao_parceiro
  on public.whatsapp_ativacao_codigos (parceiro_id, criado_em desc);

alter table public.whatsapp_ativacao_codigos enable row level security;
-- BYPASSRLS do service_role ignora policies mas NÃO concede privilégio de
-- tabela (lição da Fase 2). As RPCs são SECURITY DEFINER (acessam como dono),
-- mas concedemos por consistência/segurança caso haja I/O direto futuro.
grant select, insert, update, delete on public.whatsapp_ativacao_codigos to service_role;

-- ----------------------------------------------------------------------------
-- 2. Gera um código de ativação e ENFILEIRA a mensagem pro telefone do parceiro.
--    Autorização: quando chamado pelo app (auth.uid() != null) exige usuário
--    INTERNO; chamadas service-role diretas (Edge/CLI/teste) passam. Invalida
--    códigos pendentes anteriores do mesmo parceiro. Retorna o código gerado.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_gerar_codigo_ativacao(
  p_parceiro_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel       text;
  v_nome      text;
  v_codigo    text;
  v_tentativas int := 0;
begin
  -- AUTORIZAÇÃO: pelo app, só interno pode ativar parceiro.
  if auth.uid() is not null then
    if not exists (
      select 1 from public.usuarios
       where id = auth.uid() and tipo = 'interno' and coalesce(ativo, true)
    ) then
      raise exception 'nao autorizado: apenas usuario interno pode ativar';
    end if;
  end if;

  select telefone, nome into v_tel, v_nome
    from public.usuarios
   where id = p_parceiro_id and tipo = 'parceiro' and coalesce(ativo, true);

  if v_tel is null then
    raise exception 'parceiro % invalido, inativo ou sem telefone', p_parceiro_id;
  end if;

  -- invalida códigos pendentes anteriores deste parceiro
  update public.whatsapp_ativacao_codigos
     set usado_em = now()
   where parceiro_id = p_parceiro_id and usado_em is null;

  -- gera código de 4 dígitos único entre os ativos (com retry anti-colisão)
  loop
    v_codigo := lpad((floor(random() * 10000))::int::text, 4, '0');
    begin
      insert into public.whatsapp_ativacao_codigos
        (codigo, parceiro_id, telefone, expira_em)
      values
        (v_codigo, p_parceiro_id, v_tel, now() + interval '15 minutes');
      exit;  -- inserido com sucesso
    exception when unique_violation then
      v_tentativas := v_tentativas + 1;
      if v_tentativas > 25 then
        raise exception 'nao foi possivel gerar codigo unico';
      end if;
    end;
  end loop;

  -- enfileira a mensagem com o código (Fase 1 entrega pro telefone do parceiro)
  perform public.whatsapp_enqueue_text(
    v_tel,
    'ativacao',
    '🔐 *Ativação do WhatsApp*' || E'\n\n' ||
    'Olá, Dr(a). ' || coalesce(nullif(split_part(coalesce(v_nome, ''), ' ', 1), ''), 'parceiro(a)') || '! ' ||
    'Para ativar o atendimento por aqui, responda esta conversa com o código:' ||
    E'\n\n*' || v_codigo || '*' || E'\n\n' ||
    '_O código expira em 15 minutos._',
    p_parceiro_id,
    null
  );

  return v_codigo;
end;
$$;

revoke all on function public.whatsapp_gerar_codigo_ativacao(uuid)
  from public, anon;
grant execute on function public.whatsapp_gerar_codigo_ativacao(uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Consome um código (na ENTRADA): valida e cria o vínculo LID → parceiro.
--    Chamada pela Edge (service_role). Retorna o parceiro vinculado, ou nada
--    se o código for inválido/expirado/já usado.
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_consumir_codigo(
  p_codigo text,
  p_lid    text
) returns table (parceiro_id uuid, nome text, telefone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lid  text := regexp_replace(coalesce(p_lid, ''), '\D', '', 'g');
  v_rec  record;
begin
  if v_lid = '' or btrim(coalesce(p_codigo, '')) = '' then
    return;
  end if;

  select c.id, c.parceiro_id, c.telefone, u.nome as unome, u.telefone as utel
    into v_rec
    from public.whatsapp_ativacao_codigos c
    join public.usuarios u on u.id = c.parceiro_id
   where c.codigo = btrim(p_codigo)
     and c.usado_em is null
     and c.expira_em > now()
   order by c.criado_em desc
   limit 1;

  if not found then
    return;  -- nenhum código válido
  end if;

  -- cria/atualiza o vínculo LID -> parceiro
  insert into public.whatsapp_lid_map (lid, parceiro_id, telefone, origem)
  values (v_lid, v_rec.parceiro_id, coalesce(v_rec.telefone, v_rec.utel), 'codigo')
  on conflict (lid) do update
    set parceiro_id = excluded.parceiro_id,
        telefone    = excluded.telefone,
        origem      = 'codigo';

  -- marca o código como usado
  update public.whatsapp_ativacao_codigos set usado_em = now() where id = v_rec.id;

  return query
    select v_rec.parceiro_id, v_rec.unome, coalesce(v_rec.telefone, v_rec.utel);
end;
$$;

revoke all on function public.whatsapp_consumir_codigo(text, text)
  from public, anon, authenticated;
grant execute on function public.whatsapp_consumir_codigo(text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Limpeza (opcional): apaga códigos vencidos/usados antigos (housekeeping).
-- ----------------------------------------------------------------------------
create or replace function public.whatsapp_ativacao_purge(p_dias int default 7)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  with del as (
    delete from public.whatsapp_ativacao_codigos
     where criado_em < now() - make_interval(days => p_dias)
    returning 1
  )
  select count(*) into v_n from del;
  return v_n;
end;
$$;

revoke all on function public.whatsapp_ativacao_purge(int) from public, anon, authenticated;
grant execute on function public.whatsapp_ativacao_purge(int) to service_role;

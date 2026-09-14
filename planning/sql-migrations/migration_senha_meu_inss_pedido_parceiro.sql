-- =============================================================================
-- Migration: equipe pede ao PARCEIRO a troca da senha do Meu INSS do cliente
-- (card #305, decisões da Naira em 2026-09-14).
--
-- Fluxo:
--   1. Interno pede no card "Dados do cliente" → pedir_troca_senha_meu_inss
--      cria uma solicitação (tipo 'senha_meu_inss', origem 'externa') com prazo
--      e motivo opcional. Um pedido aberto por CLIENTE (a senha é do cliente,
--      não do caso): pedir de novo devolve o que já está aberto.
--   2. Como toda solicitação externa: e-mail ao parceiro (notify-solicitacao-doc),
--      card no kanban dele e lembretes de prazo (enviar_lembretes_solicitacao).
--   3. Parceiro informa a nova senha → cumprir_troca_senha_meu_inss →
--      set_senha_meu_inss (criptografa + auditoria, como já era).
--   4. set_senha_meu_inss, quando quem grava é PARCEIRO, cumpre sozinha os
--      pedidos abertos daquele cliente — vale também pelo botão "Alterar senha"
--      que o parceiro já tinha. Cada pedido cumprido gera:
--        - tarefa "Senha do Meu INSS alterada" pra quem pediu (escada do
--          responsável se quem pediu não está mais ativo);
--        - andamento SÓ INTERNO registrando quem pediu, quem trocou e quando.
--      A senha nunca vai pra tarefa, andamento, e-mail ou webhook.
--
-- Funções reescritas a partir do pg_get_functiondef da PRODUÇÃO (2026-09-14,
-- hash igual ao do staging):
--   - set_senha_meu_inss: única mudança é a chamada ao cumprimento no fim;
--   - _solicitacao_cumprida_parceiro_cria_tarefa: única mudança é pular o
--     pedido de senha (ele não tem documento a analisar).
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Tipo novo de solicitação. Só é USADO dentro de corpos de função (texto
--    comparado em tempo de execução), então roda na mesma transação.
-- ---------------------------------------------------------------------------
alter type public.tipo_documento add value if not exists 'senha_meu_inss';

-- ---------------------------------------------------------------------------
-- 1. Cumpre os pedidos abertos de troca de senha de um cliente.
--    Chamada só por funções SECURITY DEFINER (set_senha_meu_inss).
-- ---------------------------------------------------------------------------
create or replace function public._cumprir_pedidos_senha_meu_inss(
  p_cliente_id uuid,
  p_autor uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r           record;
  v_autor     text;
  v_autor_tipo text;
  v_cliente   text;
  v_quando    text;
  v_n         int := 0;
begin
  select coalesce(nullif(btrim(u.nome), ''), u.email, 'usuário'), u.tipo
    into v_autor, v_autor_tipo
    from public.usuarios u
   where u.id = p_autor;
  select cl.nome into v_cliente from public.clientes cl where cl.id = p_cliente_id;
  v_quando := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');

  for r in
    select s.id, s.caso_id, s.solicitado_por, s.data_solicitacao,
           coalesce(nullif(btrim(sol.nome), ''), sol.email) as solicitante
      from public.solicitacoes_documento s
      join public.casos c on c.id = s.caso_id
      left join public.usuarios sol on sol.id = s.solicitado_por
     where c.cliente_id = p_cliente_id
       and s.tipo::text = 'senha_meu_inss'
       and s.status = 'pendente'
     order by s.data_solicitacao
       for update of s
  loop
    update public.solicitacoes_documento
       set status = 'atendido',
           data_atendimento = now()
     where id = r.id;

    insert into public.tarefas
      (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
       due_at, origem, metadata)
    values
      (r.caso_id,
       public.responsavel_tarefa_caso(r.caso_id, r.solicitado_por),
       'interna', 'a_fazer', 2,
       'Senha do Meu INSS alterada - ' || coalesce(v_cliente, 'cliente'),
       'A senha do Meu INSS foi alterada por ' || v_autor
         || case when v_autor_tipo = 'parceiro' then ' (parceiro)' else '' end
         || ' em ' || v_quando
         || ', atendendo ao pedido de ' || coalesce(r.solicitante, 'alguém da equipe')
         || ' de ' || to_char(r.data_solicitacao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
         || '. A nova senha já está no card Dados do cliente.',
       now(), 'manual',
       jsonb_build_object(
         'origem_solicitacao_documento_id', r.id,
         'senha_meu_inss_alterada', true))
    ;

    insert into public.andamentos
      (caso_id, origem, titulo, descricao, data_evento, criado_por,
       visivel_parceiro, metadata)
    values
      (r.caso_id, 'interno',
       'Senha do Meu INSS alterada',
       'Alterada por ' || v_autor
         || case when v_autor_tipo = 'parceiro' then ' (parceiro)' else '' end
         || ' em ' || v_quando
         || ', a pedido de ' || coalesce(r.solicitante, 'alguém da equipe')
         || ' (pedido de ' || to_char(r.data_solicitacao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
         || '). A senha não fica registrada aqui.',
       now(), p_autor, false,
       jsonb_build_object(
         'origem_solicitacao_documento_id', r.id,
         'senha_meu_inss_alterada', true));

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

revoke all on function public._cumprir_pedidos_senha_meu_inss(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. set_senha_meu_inss — base: produção (2026-09-14). Mudança: no fim, se
--    quem gravou é parceiro, cumpre os pedidos abertos do cliente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_senha_meu_inss(p_cliente_id uuid, p_senha text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_key text;
  v_tipo text;
  v_pode boolean;
begin
  select tipo into v_tipo from public.usuarios where id = auth.uid();

  if v_tipo = 'interno' then
    v_pode := true;
  elsif v_tipo = 'parceiro' then
    -- Parceiro precisa ser o parceiro_id de pelo menos um caso do cliente.
    -- Isso impede um parceiro escrever senha de cliente de outro parceiro.
    select exists (
      select 1 from public.casos c
      where c.cliente_id = p_cliente_id
        and c.parceiro_id = auth.uid()
    ) into v_pode;
  else
    v_pode := false;
  end if;

  if not coalesce(v_pode, false) then
    raise exception 'Sem permissao para definir senha MEU INSS deste cliente';
  end if;

  if p_senha is null or length(trim(p_senha)) = 0 then
    update public.clientes set senha_meu_inss = null where id = p_cliente_id;
    insert into public.acessos_senha_inss (cliente_id, usuario_id, acao)
      values (p_cliente_id, auth.uid(), 'escrita_remocao');
    return;
  end if;

  v_key := public._inss_get_key();
  update public.clientes
     set senha_meu_inss = pgp_sym_encrypt(p_senha, v_key)
   where id = p_cliente_id;

  insert into public.acessos_senha_inss (cliente_id, usuario_id, acao)
    values (p_cliente_id, auth.uid(), 'escrita');

  -- Pedido de troca aberto pela equipe (card #305): o parceiro trocar a
  -- senha — pelo pedido ou pelo botão "Alterar" — já é o cumprimento.
  if v_tipo = 'parceiro' then
    perform public._cumprir_pedidos_senha_meu_inss(p_cliente_id, auth.uid());
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Equipe pede a troca. Um pedido aberto por cliente.
-- ---------------------------------------------------------------------------
create or replace function public.pedir_troca_senha_meu_inss(
  p_caso_id uuid,
  p_prazo_at timestamptz,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cliente  uuid;
  v_parceiro uuid;
  v_id       uuid;
begin
  if not public.is_interno() then
    raise exception 'Só a equipe pode pedir a troca da senha do Meu INSS.';
  end if;

  select c.cliente_id, c.parceiro_id into v_cliente, v_parceiro
    from public.casos c
   where c.id = p_caso_id;
  if not found then
    raise exception 'Caso não encontrado.';
  end if;
  if v_parceiro is null then
    raise exception 'Este caso não tem parceiro para receber o pedido.';
  end if;

  -- Serializa pedidos do mesmo cliente (dois cliques / duas pessoas).
  perform 1 from public.clientes where id = v_cliente for update;

  select s.id into v_id
    from public.solicitacoes_documento s
    join public.casos c on c.id = s.caso_id
   where c.cliente_id = v_cliente
     and s.tipo::text = 'senha_meu_inss'
     and s.status = 'pendente'
   order by s.data_solicitacao
   limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'ja_existia', true);
  end if;

  insert into public.solicitacoes_documento
    (caso_id, tipo, tipos, descricao, status, origem, solicitado_por, prazo_at)
  values
    (p_caso_id, 'senha_meu_inss'::text::public.tipo_documento,
     '[{"tipo": "senha_meu_inss", "label": "Troca da senha do Meu INSS"}]'::jsonb,
     nullif(btrim(p_motivo), ''), 'pendente', 'externa', auth.uid(), p_prazo_at)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'ja_existia', false);
end;
$function$;

revoke all on function public.pedir_troca_senha_meu_inss(uuid, timestamptz, text) from public, anon;
grant execute on function public.pedir_troca_senha_meu_inss(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Parceiro cumpre o pedido informando a nova senha.
-- ---------------------------------------------------------------------------
create or replace function public.cumprir_troca_senha_meu_inss(
  p_solicitacao_id uuid,
  p_senha text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caso     uuid;
  v_cliente  uuid;
  v_parceiro uuid;
  v_status   text;
  v_tipo     text;
begin
  select s.caso_id, c.cliente_id, c.parceiro_id, s.status::text, s.tipo::text
    into v_caso, v_cliente, v_parceiro, v_status, v_tipo
    from public.solicitacoes_documento s
    join public.casos c on c.id = s.caso_id
   where s.id = p_solicitacao_id
     for update of s;
  if not found or v_tipo <> 'senha_meu_inss' then
    raise exception 'Pedido de troca de senha não encontrado.';
  end if;
  if v_parceiro is distinct from auth.uid() then
    raise exception 'Só o parceiro do caso pode informar a nova senha.';
  end if;
  if v_status <> 'pendente' then
    raise exception 'Este pedido já foi resolvido.';
  end if;
  if p_senha is null or length(btrim(p_senha)) = 0 then
    raise exception 'Informe a nova senha.';
  end if;

  -- Grava criptografada + auditoria e cumpre os pedidos abertos do cliente.
  perform public.set_senha_meu_inss(v_cliente, p_senha);

  select s.status::text into v_status
    from public.solicitacoes_documento s where s.id = p_solicitacao_id;
  if v_status <> 'atendido' then
    raise exception 'A senha foi gravada, mas o pedido não foi concluído.';
  end if;
  return jsonb_build_object('status', v_status);
end;
$function$;

revoke all on function public.cumprir_troca_senha_meu_inss(uuid, text) from public, anon;
grant execute on function public.cumprir_troca_senha_meu_inss(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. _solicitacao_cumprida_parceiro_cria_tarefa — base: produção (2026-09-14).
--    Mudança: pedido de senha não abre "Analisar documento recebido" (não há
--    documento; a tarefa certa nasce em _cumprir_pedidos_senha_meu_inss).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._solicitacao_cumprida_parceiro_cria_tarefa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_eh_parceiro boolean;
  v_parceiro_nome text;
  v_tipo_label text;
  v_cliente text;
begin
  -- Só transição para 'atendido'.
  if NEW.status is distinct from 'atendido' or OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  -- Solicitações de template de exigência ficam com o trigger antigo.
  if NEW.origem is not null and NEW.origem like 'template:%' then
    return NEW;
  end if;

  -- Pedido de troca de senha do Meu INSS (card #305): não tem documento a
  -- analisar — a tarefa "Senha do Meu INSS alterada" nasce no cumprimento.
  if NEW.tipo::text = 'senha_meu_inss' then
    return NEW;
  end if;

  -- Só quando quem atualizou é parceiro.
  select (u.tipo = 'parceiro'), u.nome
    into v_eh_parceiro, v_parceiro_nome
    from public.usuarios u
   where u.id = auth.uid();

  if not coalesce(v_eh_parceiro, false) then
    return NEW;
  end if;

  -- Evita duplicar se a mesma solicitação for re-cumprida com análise aberta.
  if exists (
    select 1 from public.tarefas t
     where t.status = 'a_fazer'
       and t.metadata->>'origem_solicitacao_documento_id' = NEW.id::text
       and (t.metadata->>'analise_solicitacao')::boolean is true
  ) then
    return NEW;
  end if;

  -- Pedido de vários documentos: lista os labels; senão, o tipo único.
  if NEW.tipos is not null and jsonb_typeof(NEW.tipos) = 'array'
     and jsonb_array_length(NEW.tipos) > 0 then
    select string_agg(coalesce(x->>'label', x->>'tipo'), ', ')
      into v_tipo_label
      from jsonb_array_elements(NEW.tipos) x;
  else
    v_tipo_label := initcap(replace(coalesce(NEW.tipo::text, 'documento'), '_', ' '));
  end if;

  select cl.nome into v_cliente
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  insert into public.tarefas (
    caso_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    NEW.caso_id, 'interna', 2, 'a_fazer',
    'Analisar documento recebido - ' || coalesce(v_cliente, 'cliente'),
    format(
      'O parceiro %s cumpriu a solicitação de "%s". Conferir o documento enviado e validar.',
      coalesce(v_parceiro_nome, '(sem nome)'), v_tipo_label
    ),
    now(),
    'manual',
    jsonb_build_object(
      'origem_solicitacao_documento_id', NEW.id,
      'documento_id', NEW.documento_id,
      'analise_solicitacao', true
    )
  );

  return NEW;
end;
$function$;

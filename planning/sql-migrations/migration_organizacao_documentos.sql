-- =============================================================================
-- Migration: organização de documentos antes da análise do caso (card #434)
--
-- Decisão da Naira (2026-09-29): todo caso de parceiro cai hoje direto na Mara,
-- e cai com os documentos bagunçados — a análise começa pela arrumação, que não
-- é trabalho de análise. A corrente passa a ser:
--
--   caso do parceiro -> Organizar documentos (Mariane) -> Analisar o caso (Mara)
--
-- Também tira do código a escolha de quem faz cada etapa: hoje, sem nada
-- configurado, a escada cai num último recurso que procura o e-mail da Mara
-- escrito dentro de `private.responsavel_padrao_de`. Aqui isso vira
-- configuração por escritório (`escritorio_config.responsaveis`), com
-- substituto — e a função velha continua intacta, como rede final.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Quem faz cada etapa, por escritório
--
--   responsaveis = {
--     "organiza_documentos": "<uuid>",             quem arruma a pasta
--     "organiza_documentos_substituto": "<uuid>",  quando a primeira está fora
--     "analise": "<uuid>"                          quem analisa o caso
--   }
--
-- A pessoa configurada só vale se ainda for interna ATIVA naquele escritório —
-- gente desligada não pode continuar recebendo tarefa por causa de uma
-- configuração velha.
-- ---------------------------------------------------------------------------
create or replace function public.responsavel_etapa(p_caso_id uuid, p_chave text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with e as (select private.escritorio_do_caso(p_caso_id) as id)
  select coalesce(
    -- 1) a escolha do escritório para esta etapa
    (select u.id
       from public.escritorio_config c
       join public.usuarios u on u.id::text = c.responsaveis ->> p_chave, e
      where c.escritorio_id = e.id
        and private.eh_interno_ativo_em(u.id, e.id)),
    -- 2) o substituto da etapa (ex.: organiza_documentos_substituto)
    (select u.id
       from public.escritorio_config c
       join public.usuarios u on u.id::text = c.responsaveis ->> (p_chave || '_substituto'), e
      where c.escritorio_id = e.id
        and private.eh_interno_ativo_em(u.id, e.id)),
    -- 3) a escada de sempre — nunca devolve nulo nem gente de outro escritório
    public.responsavel_tarefa_caso(p_caso_id)
  );
$$;

-- Criar função dá EXECUTE ao PUBLIC por padrão, e o Supabase ainda concede a
-- anon/service_role. A regra da casa (cobrada por rbac-conferir-exigencias) é
-- que anon só alcança helper de policy — esta não é. Revoga antes de conceder.
revoke all on function public.responsavel_etapa(uuid, text) from public;
revoke all on function public.responsavel_etapa(uuid, text) from anon;
grant execute on function public.responsavel_etapa(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Caso do parceiro abre ORGANIZAÇÃO, não análise
--
-- Reescrita a partir do `pg_get_functiondef` de PRODUÇÃO (2026-09-29); o que
-- muda está marcado com "-- #434".
-- ---------------------------------------------------------------------------
create or replace function public._caso_novo_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_parceiro_nome text;
  v_cliente_nome text;
begin
  if NEW.parceiro_id is null then
    return NEW;
  end if;

  select coalesce(u.nome, u.email, 'parceiro')
    into v_parceiro_nome
    from public.usuarios u
   where u.id = NEW.parceiro_id;

  select c.nome
    into v_cliente_nome
    from public.clientes c
   where c.id = NEW.cliente_id;

  insert into public.tarefas (
    caso_id, responsavel_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    NEW.id,
    -- #434: quem arruma a pasta, pela configuração do escritório. Sem
    -- configuração, cai na escada de antes — ninguém fica sem tarefa.
    public.responsavel_etapa(NEW.id, 'organiza_documentos'),
    'interna', 2, 'a_fazer',
    format(
      'Organizar documentos - %s',                                    -- #434
      coalesce(v_cliente_nome, 'cliente')
    ),
    format(
      'Caso %s indicado pelo parceiro %s. Conferir o que chegou, identificar cada arquivo e '
      || 'pedir o que faltar antes de mandar para análise.',          -- #434
      coalesce(v_cliente_nome, '(sem nome)'),
      coalesce(v_parceiro_nome, '(sem nome)')
    ),
    NEW.created_at + interval '1 day',
    'manual',
    jsonb_build_object(
      'origem_caso_id', NEW.id,
      'origem_parceiro_id', NEW.parceiro_id,
      -- #434: a etapa muda; o widget de organização aparece por esta marca, e
      -- a análise nasce depois, quando esta for concluída.
      'etapa', 'organizacao_documentos',
      'organizacao_documentos', true
    )
  );

  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Concluir a organização entrega a análise na mão de quem analisa
--
-- Documento faltando NÃO segura o caso (decisão da Naira): a análise nasce
-- sabendo o que falta e que já foi pedido.
-- ---------------------------------------------------------------------------
create or replace function public.concluir_organizacao_documentos(
  p_tarefa_id uuid,
  p_faltantes text[] default '{}',
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tarefa    public.tarefas%rowtype;
  v_cliente   text;
  v_parceiro  text;
  v_analista  uuid;
  v_nova      uuid;
  v_faltantes text;
begin
  if not public.is_interno() then
    raise exception 'só a equipe interna organiza documentos' using errcode = 'insufficient_privilege';
  end if;

  select * into v_tarefa from public.tarefas where id = p_tarefa_id;
  if v_tarefa.id is null then
    raise exception 'tarefa não encontrada' using errcode = 'no_data_found';
  end if;
  if v_tarefa.status = 'feito' then
    -- Clique duplo não abre duas análises.
    return jsonb_build_object('ja_concluida', true);
  end if;

  select cl.nome, coalesce(p.nome, p.email)
    into v_cliente, v_parceiro
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
    left join public.usuarios p on p.id = c.parceiro_id
   where c.id = v_tarefa.caso_id;

  v_analista := public.responsavel_etapa(v_tarefa.caso_id, 'analise');
  v_faltantes := nullif(array_to_string(p_faltantes, ', '), '');

  update public.tarefas
     set status = 'feito',
         completed_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'organizacao_concluida_em', now(),
           'documentos_faltantes', to_jsonb(p_faltantes)
         )
   where id = p_tarefa_id;

  insert into public.tarefas (
    caso_id, responsavel_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    v_tarefa.caso_id, v_analista, 'interna', 2, 'a_fazer',
    format('Cliente novo - %s - Analisar', coalesce(v_cliente, 'cliente')),
    format('Caso %s%s. Documentos conferidos e organizados.',
           coalesce(v_cliente, '(sem nome)'),
           coalesce(' indicado pelo parceiro ' || v_parceiro, ''))
      || coalesce(chr(10) || 'Falta: ' || v_faltantes || ' (já solicitado ao parceiro).', '')
      || coalesce(chr(10) || 'Observação de quem organizou: ' || nullif(trim(p_observacao), ''), ''),
    now() + interval '1 day',
    'manual',
    jsonb_build_object(
      'origem_caso_id', v_tarefa.caso_id,
      'origem_parceiro_id', (select parceiro_id from public.casos where id = v_tarefa.caso_id),
      -- É esta marca que faz o widget dos três desfechos aparecer.
      'etapa', 'analise_inicial_parceiro',
      'organizou_tarefa_id', p_tarefa_id,
      'documentos_faltantes', to_jsonb(p_faltantes)
    )
  )
  returning id into v_nova;

  -- Rastro no caso: quem arrumou, quando, e o que faltou.
  insert into public.andamentos (
    caso_id, origem, titulo, descricao, data_evento, criado_por, visivel_parceiro, metadata
  )
  values (
    v_tarefa.caso_id, 'interno',
    'Documentos organizados',
    'Pasta conferida e organizada.'
      || coalesce(chr(10) || 'Faltando: ' || v_faltantes || ' (solicitado ao parceiro).', '')
      || coalesce(chr(10) || nullif(trim(p_observacao), ''), ''),
    now(), auth.uid(), false,
    jsonb_build_object('etapa', 'organizacao_documentos', 'tarefa_id', p_tarefa_id)
  );

  return jsonb_build_object('tarefa_analise_id', v_nova, 'analista_id', v_analista);
end;
$$;

revoke all on function public.concluir_organizacao_documentos(uuid, text[], text) from public;
revoke all on function public.concluir_organizacao_documentos(uuid, text[], text) from anon;
grant execute on function public.concluir_organizacao_documentos(uuid, text[], text) to authenticated;

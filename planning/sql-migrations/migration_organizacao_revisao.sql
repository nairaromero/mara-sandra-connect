-- =============================================================================
-- Migration: ajustes da revisão do lote de organização de documentos (#434)
--
-- Revisão de 21/10 dos PRs #465/#473/#474. Este arquivo conserta, no banco:
--
--   1. `concluir_organizacao_documentos` aceitava tarefa de QUALQUER escritório
--      e de quem não mexe em tarefa: faltavam `exigir_no_escritorio`, a
--      permissão, a marca da tarefa e a trava da linha (clique duplo abria
--      duas análises).
--   2. Três funções `SECURITY DEFINER` liberadas para `authenticated` sem
--      filtro de escritório: qualquer conta logada (até parceiro) listava nome
--      de arquivo e casos de todos os escritórios. Agora só o sistema chama.
--   3. A fila travava: arquivo que falhava (resposta ilegível, sumiu do
--      storage) nunca era marcado e voltava a cada 10 minutos, para sempre.
--      Agora cada falha conta, e na 3ª o arquivo sai da fila com o motivo.
--      "O que ainda falta ler" fica numa regra só (`private.ia_documento_pendente`).
--   4. O link da pasta: o navegador gravava o veredito da checagem (o parceiro
--      podia gravar "compartilhado" direto pela API); "link trocado zera a
--      checagem" só existia na tela; `criado_por` vinha do navegador; trocar
--      ou tirar o link não deixava rastro; e cada "conferir" carimbava a
--      pessoa como autora de uma edição.
--   5. O checklist do caso sai do código (pedido de 05/10: "nada fixo no
--      código"): lista base por escritório + lista por tipo de benefício,
--      editadas em Configurações › Tipos de benefício.
--   6. Quem organiza e quem analisa: a configuração já existia
--      (`escritorio_config.responsaveis`), faltava como gravar pela tela.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Concluir a organização: escritório, permissão, marca e trava da linha
--
-- Corpo a partir da migration_organizacao_documentos (a função não existe em
-- produção ainda); o que muda está marcado com "-- revisão".
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

  -- revisão: tarefa de outro escritório é "não encontrada", como na RLS.
  perform private.exigir_no_escritorio('public.tarefas', p_tarefa_id);

  -- revisão: `for update` — dois cliques ao mesmo tempo esperam um pelo outro,
  -- e o segundo vê a tarefa já concluída.
  select * into v_tarefa from public.tarefas where id = p_tarefa_id for update;
  if v_tarefa.id is null then
    raise exception 'tarefa não encontrada' using errcode = 'no_data_found';
  end if;

  -- revisão: a mesma regra da policy de tarefas — escopo `todos`, ou
  -- `atribuidos` na tarefa de quem conclui.
  if not (private.tem_permissao('tarefas:gerenciar', 'todos')
          or (private.tem_permissao('tarefas:gerenciar', 'atribuidos')
              and v_tarefa.responsavel_id = auth.uid())) then
    raise exception 'sem permissão para concluir esta tarefa' using errcode = '42501';
  end if;

  -- revisão: só a tarefa de organização abre análise. Sem isto, qualquer
  -- tarefa do caso virava "feito" e nascia uma análise por cima.
  if (v_tarefa.metadata->>'organizacao_documentos')::boolean is not true then
    raise exception 'esta tarefa não é de organização de documentos' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 2) Quem decide a etapa é o banco, não a tela
--
-- `responsavel_etapa` é chamada por dentro (gatilho do caso novo e a conclusão
-- acima, as duas SECURITY DEFINER). Liberada para `authenticated`, devolvia o
-- uuid do responsável de caso de outro escritório. Fica para o sistema.
-- ---------------------------------------------------------------------------
revoke all on function public.responsavel_etapa(uuid, text) from public, anon, authenticated;
grant execute on function public.responsavel_etapa(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) A fila da leitura: falha conta, e o que falta ler é UMA regra
-- ---------------------------------------------------------------------------
alter table public.documentos
  add column if not exists ia_tentativas smallint not null default 0,
  add column if not exists ia_falha text;

comment on column public.documentos.ia_tentativas is
  'Leituras da IA que falharam neste arquivo (#434). Na 3ª ele sai da fila com ia_falha.';
comment on column public.documentos.ia_falha is
  'Por que a IA desistiu deste arquivo (#434). Preenchido = sai da fila; a conferência mostra para a pessoa.';

-- O que ainda falta a IA ler — a fila do cron e a lista da function perguntam
-- aqui. (A tela usa a mesma régua de formato, via supabase/functions/_shared/
-- arquivo-ia.ts; a régua e2e/unit/fonte-unica-documentos.test.ts confere que
-- `ia_le_arquivo` e o arquivo dizem o mesmo.)
create or replace function private.ia_documento_pendente(p_nome text, p_lido timestamptz, p_falha text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lido is null and p_falha is null and private.ia_le_arquivo(p_nome);
$$;

revoke all on function private.ia_documento_pendente(text, timestamptz, text) from public, anon;
grant execute on function private.ia_documento_pendente(text, timestamptz, text) to authenticated, service_role;

-- A lista do caso, para a function. Antes não tinha chamador (a function
-- buscava `ia_lido_em is null` sem o filtro de formato e cortava em 15 ANTES
-- de filtrar: caso com 15 .docx antigos nunca chegava aos PDFs).
drop function if exists public.documentos_leitura_pendente(uuid);
create or replace function public.documentos_leitura_pendente(p_caso_id uuid, p_limite int default 15)
returns table(id uuid, nome_arquivo text, storage_path text, tamanho_bytes integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.nome_arquivo, d.storage_path, d.tamanho_bytes
    from public.documentos d
   where d.caso_id = p_caso_id
     and private.ia_documento_pendente(d.nome_arquivo, d.ia_lido_em, d.ia_falha)
   order by d.created_at, d.id
   limit greatest(p_limite, 0);
$$;

revoke all on function public.documentos_leitura_pendente(uuid, int) from public, anon, authenticated;
grant execute on function public.documentos_leitura_pendente(uuid, int) to service_role;

create or replace function public.casos_com_leitura_pendente(
  p_quieto_minutos int default 2,
  p_limite int default 20
)
returns table(caso_id uuid, pendentes bigint, ultimo_upload timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.caso_id,
         count(*) filter (
           where private.ia_documento_pendente(d.nome_arquivo, d.ia_lido_em, d.ia_falha)
         ) as pendentes,
         max(d.created_at) as ultimo_upload
    from public.documentos d
   where exists (
     select 1 from public.tarefas t
      where t.caso_id = d.caso_id
        and t.status = 'a_fazer'
        and (t.metadata->>'organizacao_documentos')::boolean is true
   )
   group by d.caso_id
  having count(*) filter (
           where private.ia_documento_pendente(d.nome_arquivo, d.ia_lido_em, d.ia_falha)
         ) > 0
     -- a poeira baixou: nada novo chegou nos últimos minutos
     and max(d.created_at) < now() - make_interval(mins => p_quieto_minutos)
   order by max(d.created_at)
   limit p_limite;
$$;

-- revisão: só o sistema. Liberada para `authenticated`, listava ids e
-- contagens de casos de todos os escritórios para qualquer conta logada.
revoke all on function public.casos_com_leitura_pendente(int, int) from public, anon, authenticated;
grant execute on function public.casos_com_leitura_pendente(int, int) to service_role;

-- Uma falha de leitura. `p_definitiva`: não adianta tentar de novo (arquivo
-- grande demais). As outras contam, e na 3ª o arquivo sai da fila — o número
-- fica AQUI, não na function.
create or replace function public.registrar_falha_leitura_ia(
  p_documento_id uuid,
  p_motivo text,
  p_definitiva boolean default false
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.documentos
     set ia_tentativas = ia_tentativas + 1,
         ia_falha = case
           when p_definitiva or ia_tentativas + 1 >= 3 then left(p_motivo, 300)
         end
   where id = p_documento_id
     and ia_lido_em is null;
$$;

revoke all on function public.registrar_falha_leitura_ia(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.registrar_falha_leitura_ia(uuid, text, boolean) to service_role;

-- O job do cron (só produção tem pg_cron) já assina como
-- 'cron:identificar-documentos'; a function é que conferia outro nome e
-- recusava tudo. O conserto está na function — o job fica como está.

-- ---------------------------------------------------------------------------
-- 4) O link da pasta: o banco guarda a regra
-- ---------------------------------------------------------------------------

-- Quem pode gravar o veredito da checagem: a function `checar-link-pasta`
-- (service role) ou o próprio banco. Pessoa pela API, não.
create or replace function private.pode_gravar_checagem_link()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') not in ('authenticated', 'anon');
$$;

revoke all on function private.pode_gravar_checagem_link() from public, anon;
grant execute on function private.pode_gravar_checagem_link() to authenticated, service_role;

create or replace function public._pasta_externa_antes()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    -- Autor é quem está logado, não o que o navegador mandou: um interno
    -- gravando `criado_por` = parceiro daria a ele editar/apagar o link.
    if auth.uid() is not null then
      NEW.criado_por := auth.uid();
    end if;
    if not private.pode_gravar_checagem_link() then
      NEW.checado_em := null;
      NEW.checado_status := null;
      NEW.checado_detalhe := null;
    end if;
    return NEW;
  end if;

  -- UPDATE
  if NEW.url is distinct from OLD.url then
    -- Link trocado: o que a checagem viu era do endereço anterior.
    NEW.checado_em := null;
    NEW.checado_status := null;
    NEW.checado_detalhe := null;
  elsif not private.pode_gravar_checagem_link() then
    NEW.checado_em := OLD.checado_em;
    NEW.checado_status := OLD.checado_status;
    NEW.checado_detalhe := OLD.checado_detalhe;
  end if;

  -- Autoria da EDIÇÃO só quando o link ou o nome mudam — a checagem não é
  -- edição de ninguém.
  if NEW.url is distinct from OLD.url or NEW.rotulo is distinct from OLD.rotulo then
    NEW.atualizado_em  := now();
    NEW.atualizado_por := auth.uid();
  else
    NEW.atualizado_em  := OLD.atualizado_em;
    NEW.atualizado_por := OLD.atualizado_por;
  end if;
  NEW.criado_por := OLD.criado_por;
  return NEW;
end;
$$;

revoke all on function public._pasta_externa_antes() from public, anon;

-- Rastro no caso: colar, trocar e tirar o link. O parceiro NÃO escreve em
-- `andamentos`, por isso é o gatilho que escreve.
create or replace function public._pasta_externa_rastro()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_quem   text;
  v_linha  public.caso_pastas_externas%rowtype;
  v_titulo text;
  v_texto  text;
begin
  if tg_op = 'UPDATE' and NEW.url is not distinct from OLD.url then
    return NEW;
  end if;
  if tg_op = 'DELETE' then
    v_linha := OLD;
  else
    v_linha := NEW;
  end if;

  -- Caso sendo apagado (cascade): não há onde deixar rastro.
  if not exists (select 1 from public.casos c where c.id = v_linha.caso_id) then
    return v_linha;
  end if;

  select coalesce(u.nome, u.email) into v_quem
    from public.usuarios u where u.id = auth.uid();

  if tg_op = 'INSERT' then
    v_titulo := 'Pasta de documentos por link';
    v_texto  := coalesce(nullif(trim(NEW.rotulo), '') || ': ', '') || NEW.url;
  elsif tg_op = 'UPDATE' then
    v_titulo := 'Link da pasta trocado';
    v_texto  := 'De ' || OLD.url || chr(10) || 'para ' || NEW.url;
  else
    v_titulo := 'Link da pasta retirado';
    v_texto  := coalesce(nullif(trim(OLD.rotulo), '') || ': ', '') || OLD.url;
  end if;

  insert into public.andamentos (
    caso_id, origem, titulo, descricao, data_evento, criado_por, visivel_parceiro, metadata
  )
  values (
    v_linha.caso_id, 'sistema', v_titulo,
    v_texto || coalesce(chr(10) || 'Por ' || v_quem || '.', ''),
    now(), auth.uid(), true,
    jsonb_build_object('pasta_externa_id', v_linha.id, 'url', v_linha.url, 'operacao', lower(tg_op))
  );

  return v_linha;
exception
  when others then
    -- O rastro não pode derrubar o link: sem ele a pasta continua perdida.
    raise warning 'gatilho % falhou: %', tg_name, sqlerrm;
    return v_linha;
end;
$$;

revoke all on function public._pasta_externa_rastro() from public;
revoke all on function public._pasta_externa_rastro() from anon;

drop trigger if exists trg_pasta_externa_atualizada on public.caso_pastas_externas;
drop trigger if exists trg_pasta_externa_antes on public.caso_pastas_externas;
create trigger trg_pasta_externa_antes
  before insert or update on public.caso_pastas_externas
  for each row execute function public._pasta_externa_antes();

drop trigger if exists trg_pasta_externa_rastro on public.caso_pastas_externas;
create trigger trg_pasta_externa_rastro
  after insert or update of url or delete on public.caso_pastas_externas
  for each row execute function public._pasta_externa_rastro();

-- ---------------------------------------------------------------------------
-- 5) Checklist do caso: configuração do escritório e do benefício
--
-- Formato: lista de itens; cada item é a FAMÍLIA de tipos que o satisfaz
-- (CNIS completo ou resumido resolvem o mesmo item). O primeiro dá o nome.
--   [["procuracao"], ["cnis", "cnis_resumido"], …]
-- ---------------------------------------------------------------------------
create or replace function private.checklist_valido(p jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_tipo jsonb;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 40 then return false; end if;
  for v_item in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(v_item) <> 'array' or jsonb_array_length(v_item) not between 1 and 6 then
      return false;
    end if;
    for v_tipo in select * from jsonb_array_elements(v_item) loop
      if jsonb_typeof(v_tipo) <> 'string'
         or not ((v_tipo #>> '{}') = any (enum_range(null::public.tipo_documento)::text[]))
         or (v_tipo #>> '{}') = 'outro' then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- A CHECK roda com o papel de quem grava (a tela grava `tipos_beneficio`
-- direto): sem EXECUTE, a gravação estoura "permission denied for function".
revoke all on function private.checklist_valido(jsonb) from public, anon;
grant execute on function private.checklist_valido(jsonb) to authenticated, service_role;

-- Lista base, por escritório. Nasce com a proposta levada à Naira em 29/09
-- (o que era o CHECKLIST_BASE fixo no código) — daqui em diante é do escritório.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'escritorio_config'
       and column_name = 'checklist_documentos'
  ) then
    alter table public.escritorio_config
      add column checklist_documentos jsonb not null
      default '[["procuracao"],["contrato_honorarios"],["rg_cpf"],["comprovante_residencia"],["cnis","cnis_resumido"]]'::jsonb;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.escritorio_config'::regclass
       and conname = 'escritorio_config_checklist_valido'
  ) then
    alter table public.escritorio_config
      add constraint escritorio_config_checklist_valido
      check (private.checklist_valido(checklist_documentos));
  end if;
end $$;

comment on column public.escritorio_config.checklist_documentos is
  'O que todo caso precisa ter (#434): lista de itens, cada item = tipos de documento que o satisfazem.';

-- Lista por benefício. Nasce com o rascunho por família que estava no
-- comentário do checklist (incapacidade, especial, rural, pensão) — o
-- conteúdo de verdade fecha com quem confere, pela tela. Só na criação da
-- coluna: rodar de novo não desfaz o que o escritório editou.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tipos_beneficio'
       and column_name = 'documentos_exigidos'
  ) then
    alter table public.tipos_beneficio
      add column documentos_exigidos jsonb not null default '[]'::jsonb;

    update public.tipos_beneficio
       set documentos_exigidos = '[["laudo_medico"],["atestado_medico"],["laudo_inss"]]'::jsonb
     where nome ilike '%incapacidade%' or nome ilike 'aux_lio%doen_a%';
    update public.tipos_beneficio
       set documentos_exigidos = '[["ppp"],["ltcat"],["pgr_ppra"]]'::jsonb
     where nome ilike 'aposentadoria especial%';
    update public.tipos_beneficio
       set documentos_exigidos = '[["declaracao_atividade_rural"]]'::jsonb
     where nome ilike '%rural%';
    update public.tipos_beneficio
       set documentos_exigidos = '[["certidao_obito"],["certidao_casamento"]]'::jsonb
     where nome ilike 'pens_o por morte%';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tipos_beneficio'::regclass
       and conname = 'tipos_beneficio_documentos_validos'
  ) then
    alter table public.tipos_beneficio
      add constraint tipos_beneficio_documentos_validos
      check (private.checklist_valido(documentos_exigidos));
  end if;
end $$;

comment on column public.tipos_beneficio.documentos_exigidos is
  'O que o caso deste benefício precisa ter além da lista base do escritório (#434).';

-- O checklist de UM caso: a lista base do escritório + a do benefício do
-- caso, sem item repetido. INVOKER: a RLS de quem pergunta decide o que ela vê
-- (caso de outro escritório devolve vazio, não a lista dele).
create or replace function public.checklist_documentos_do_caso(p_caso_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with caso as (
    select c.escritorio_id, c.tipo_beneficio from public.casos c where c.id = p_caso_id
  ),
  itens as (
    select i.item, 1 as origem, i.ord
      from caso
      join public.escritorio_config ec on ec.escritorio_id = caso.escritorio_id
      cross join lateral jsonb_array_elements(ec.checklist_documentos) with ordinality as i(item, ord)
    union all
    select i.item, 2, i.ord
      from caso
      join public.tipos_beneficio tb
        on tb.escritorio_id = caso.escritorio_id and tb.nome = caso.tipo_beneficio
      cross join lateral jsonb_array_elements(tb.documentos_exigidos) with ordinality as i(item, ord)
  ),
  unicos as (
    select distinct on (item) item, origem, ord from itens order by item, origem, ord
  )
  select coalesce(jsonb_agg(item order by origem, ord), '[]'::jsonb) from unicos;
$$;

revoke all on function public.checklist_documentos_do_caso(uuid) from public, anon;
grant execute on function public.checklist_documentos_do_caso(uuid) to authenticated, service_role;

-- Gravar a lista base: mesma permissão de quem mexe nos tipos de benefício
-- (a mesma aba), auditado como a marca.
create or replace function public.escritorio_definir_checklist(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esc   uuid := private.escritorio_ativo();
  v_antes jsonb;
begin
  if v_esc is null or not private.tem_permissao('templates:gerenciar', null) then
    raise exception 'só quem gerencia os modelos do escritório altera o checklist' using errcode = '42501';
  end if;
  if p_itens is null or not private.checklist_valido(p_itens) then
    raise exception 'checklist inválido: cada item precisa de ao menos um tipo de documento conhecido'
      using errcode = '22023';
  end if;

  insert into public.escritorio_config (escritorio_id) values (v_esc) on conflict (escritorio_id) do nothing;
  select c.checklist_documentos into v_antes from public.escritorio_config c where c.escritorio_id = v_esc;

  update public.escritorio_config
     set checklist_documentos = p_itens, updated_at = now()
   where escritorio_id = v_esc;

  perform private.auditar(v_esc, 'membro', 'escritorio.checklist', 'escritorio_config', v_esc::text,
                          jsonb_build_object('antes', v_antes, 'depois', p_itens));
  return p_itens;
end;
$$;

revoke all on function public.escritorio_definir_checklist(jsonb) from public, anon;
grant execute on function public.escritorio_definir_checklist(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Quem faz cada etapa, pela tela
--
-- `escritorio_config.responsaveis` já decidia (responsavel_etapa e
-- responsavel_padrao_de); só não havia como gravar sem SQL. A chave `analise`
-- vale também para tarefa sem dono (responsavel_padrao_de).
-- ---------------------------------------------------------------------------
create or replace function public.escritorio_definir_responsaveis(
  p_organiza uuid,
  p_organiza_substituto uuid,
  p_analise uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esc    uuid := private.escritorio_ativo();
  v_antes  jsonb;
  v_depois jsonb;
  v_par    record;
begin
  if v_esc is null or not private.tem_permissao('escritorio:configurar', null) then
    raise exception 'só quem configura o escritório escolhe quem faz cada etapa' using errcode = '42501';
  end if;

  -- Só gente interna ATIVA deste escritório: a mesma régua que
  -- `responsavel_etapa` aplica na hora de usar.
  for v_par in
    select * from (values (p_organiza), (p_organiza_substituto), (p_analise)) as t(id)
  loop
    if v_par.id is not null and not private.eh_interno_ativo_em(v_par.id, v_esc) then
      raise exception 'a pessoa escolhida não faz parte da equipe interna ativa deste escritório'
        using errcode = '22023';
    end if;
  end loop;

  insert into public.escritorio_config (escritorio_id) values (v_esc) on conflict (escritorio_id) do nothing;
  select coalesce(c.responsaveis, '{}'::jsonb) into v_antes
    from public.escritorio_config c where c.escritorio_id = v_esc;

  -- Nulo tira a escolha: a etapa volta para a escada de sempre.
  v_depois := jsonb_strip_nulls(
    (v_antes - 'organiza_documentos' - 'organiza_documentos_substituto' - 'analise')
    || jsonb_build_object(
         'organiza_documentos', p_organiza,
         'organiza_documentos_substituto', p_organiza_substituto,
         'analise', p_analise));

  update public.escritorio_config
     set responsaveis = v_depois, updated_at = now()
   where escritorio_id = v_esc;

  perform private.auditar(v_esc, 'membro', 'escritorio.responsaveis', 'escritorio_config', v_esc::text,
                          jsonb_build_object('antes', v_antes, 'depois', v_depois));
  return v_depois;
end;
$$;

revoke all on function public.escritorio_definir_responsaveis(uuid, uuid, uuid) from public, anon;
grant execute on function public.escritorio_definir_responsaveis(uuid, uuid, uuid) to authenticated, service_role;

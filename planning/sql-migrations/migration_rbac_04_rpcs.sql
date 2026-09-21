-- migration_rbac_04_rpcs.sql
--
-- RBAC multi-tenant, passo 4 de 5: o CÓDIGO PRIVILEGIADO
-- (planning/MULTI_TENANT_RBAC.md §4.2 "código privilegiado" e §4.4).
--
-- `postgres` tem BYPASSRLS: toda função SECURITY DEFINER ignora as policies do
-- passo 3. O plano chama isso de "o maior risco". O que fecha a porta:
--
--   1. só 29 funções de `public` são executáveis por `authenticated`
--      (migration_revoke_execute_anon). As que recebem o id de um recurso
--      ganham um GUARD: o recurso tem que ser do escritório ativo de quem chama.
--      Reescritas A PARTIR DO QUE ESTÁ NO BANCO (`pg_get_functiondef`), trocando
--      só o trecho necessário — mesmo caminho da migration_chamadas_sistema_
--      assinadas, e evita a armadilha do dedc529;
--   2. as que devolvem LISTAS (sql) ganham o filtro de escritório;
--   3. as que decidem acesso por `usuarios.tipo` passam a perguntar ao vínculo
--      (de quebra: `excluir_cliente` e as três da senha do MEU INSS ignoravam
--      `ativo`, e `aplicar_template` não conferia NADA — criava tarefa em
--      qualquer caso_id);
--   4. a gestão de equipe (definir_admin, desligar_*, reativar_*) passa a operar
--      no VÍNCULO do escritório ativo; nasce `definir_papel`;
--   5. o "responsável padrão" deixa de escolher gente de outro escritório.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Guard de recurso
-- ---------------------------------------------------------------------------
-- Sem pessoa (cron, gatilho, edge com service role): passa — quem chama é o
-- sistema e a integridade fica por conta das FKs compostas. Registro que não
-- existe: passa — a função dona da regra dá a mensagem dela. Registro de outro
-- escritório: "não encontrado", para não confirmar que existe.
create or replace function private.exigir_no_escritorio(p_tabela regclass, p_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esc uuid;
begin
  if auth.uid() is null or p_id is null then
    return;
  end if;
  execute format('select escritorio_id from %s where id = $1', p_tabela) into v_esc using p_id;
  if v_esc is null then
    return;
  end if;
  if v_esc is distinct from private.escritorio_ativo() then
    raise exception 'registro não encontrado' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function private.eh_interno_ativo_em(p_usuario uuid, p_escritorio uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros m
      join public.papeis p on p.id = m.papel_id
     where m.usuario_id = p_usuario and m.escritorio_id = p_escritorio
       and m.status = 'ativo' and p.tipo_acesso = 'interno')
$$;

revoke all on function private.exigir_no_escritorio(regclass, uuid), private.eh_interno_ativo_em(uuid, uuid) from public, anon;
grant execute on function private.exigir_no_escritorio(regclass, uuid), private.eh_interno_ativo_em(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Remendos nas RPCs do front, a partir da definição do banco
-- ---------------------------------------------------------------------------
do $$
declare
  r     record;
  v_def text;
  v_new text;
  c_tipo constant text := 'select tipo into v_tipo from public.usuarios where id = auth.uid();';
begin
  for r in
    select * from (values
      -- (função, trecho a achar, o que entra no lugar, marca de "já aplicado")
      -- guards em plpgsql: entram logo depois do primeiro `begin`
      ('aplicar_template', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.casos'', p_caso_id);\n' ||
         E'  if auth.uid() is not null and not (public.is_interno() or public.caso_do_parceiro(p_caso_id)) then\n' ||
         E'    raise exception ''Sem permissão para aplicar template neste caso'' using errcode = ''42501'';\n  end if;\n',
         'exigir_no_escritorio'),
      ('aplicar_template', 'where nome = p_template and ativo = true;',
         E'where nome = p_template and ativo = true\n     and escritorio_id = (select c.escritorio_id from public.casos c where c.id = p_caso_id);',
         'c.escritorio_id from public.casos'),
      ('cumprir_troca_senha_meu_inss', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.solicitacoes_documento'', p_solicitacao_id);\n', 'exigir_no_escritorio'),
      ('log_acesso_documento', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.documentos'', p_documento_id);\n', 'exigir_no_escritorio'),
      ('pedir_troca_senha_meu_inss', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.casos'', p_caso_id);\n', 'exigir_no_escritorio'),
      ('set_webhook_secret', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.webhook_destinos'', p_destino_id);\n', 'exigir_no_escritorio'),
      ('vincular_publicacao_dje', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.publicacoes_dje'', p_pub_id);\n' ||
         E'  perform private.exigir_no_escritorio(''public.casos'', p_caso_id);\n', 'exigir_no_escritorio'),
      ('excluir_cliente', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.clientes'', p_cliente_id);\n', 'exigir_no_escritorio'),
      ('get_senha_meu_inss', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.clientes'', p_cliente_id);\n', 'exigir_no_escritorio'),
      ('set_senha_meu_inss', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.clientes'', p_cliente_id);\n', 'exigir_no_escritorio'),
      ('tem_senha_meu_inss', E'\nbegin\n',
         E'\nbegin\n  perform private.exigir_no_escritorio(''public.clientes'', p_cliente_id);\n', 'exigir_no_escritorio'),

      -- quem decidia por usuarios.tipo passa a perguntar ao vínculo
      ('excluir_cliente',    c_tipo, 'v_tipo := private.meu_tipo();', 'private.meu_tipo()'),
      ('get_senha_meu_inss', c_tipo, 'v_tipo := private.meu_tipo();', 'private.meu_tipo()'),
      ('set_senha_meu_inss', c_tipo, 'v_tipo := private.meu_tipo();', 'private.meu_tipo()'),
      ('tem_senha_meu_inss', c_tipo, 'v_tipo := private.meu_tipo();', 'private.meu_tipo()'),
      ('excluir_cliente', E'if v_tipo is null or v_tipo <> ''interno'' then',
         E'if v_tipo is null or v_tipo <> ''interno'' or not private.tem_permissao(''clientes:excluir'') then',
         'clientes:excluir'),

      -- listas (sql): filtro de escritório
      ('agenda_do_parceiro', E'    on c.id = e.caso_id\n',
         E'    on c.id = e.caso_id\n   and c.escritorio_id = (select private.escritorio_ativo())\n', 'c.id = e.caso_id\n   and c.escritorio_id'),
      ('agenda_do_parceiro', E'    on c.id = t.caso_id\n',
         E'    on c.id = t.caso_id\n   and c.escritorio_id = (select private.escritorio_ativo())\n', 'c.id = t.caso_id\n   and c.escritorio_id'),
      ('casos_sem_proximo_passo', E'  where public.is_interno()\n',
         E'  where public.is_interno()\n    and c.escritorio_id = (select private.escritorio_ativo())\n', 'private.escritorio_ativo()'),
      ('pericias_do_caso', E'    where c.id = p_caso_id\n',
         E'    where c.id = p_caso_id\n      and c.escritorio_id = (select private.escritorio_ativo())\n', 'private.escritorio_ativo()'),
      ('uso_storage_parceiro', E'   where o.bucket_id = ''documentos''\n',
         E'   where o.bucket_id = ''documentos''\n     and c.escritorio_id = (select private.escritorio_ativo())\n', 'private.escritorio_ativo()')
    ) as m(funcao, achar, trocar, marca)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = r.funcao;

    if v_def is null then
      raise warning '%: função não existe neste banco — pulada', r.funcao;
    elsif position(r.trocar in v_def) > 0 then
      null; -- já aplicado (o trecho novo contém o antigo: conferir ANTES de procurar o antigo)
    elsif position(r.achar in v_def) = 0 then
      raise exception '%: não achei o trecho esperado (%). A função mudou — revisar o remendo antes de seguir.',
        r.funcao, left(replace(r.achar, E'\n', '⏎'), 60);
    else
      -- só a PRIMEIRA ocorrência (o `begin` do bloco principal)
      v_new := overlay(v_def placing r.trocar from position(r.achar in v_def) for length(r.achar));
      execute v_new;
    end if;
  end loop;
end $$;

-- whatsapp_gerar_codigo_ativacao: checagem inline de tipo + alvo no escritório
do $$
declare
  v_def text;
  c_achar constant text :=
    E'    if not exists (\n      select 1 from public.usuarios\n       where id = auth.uid() and tipo = ''interno'' and coalesce(ativo, true)\n    ) then';
  c_trocar constant text :=
    E'    if not public.is_interno() or not private.usuario_no_escritorio_ativo(p_parceiro_id) then';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'whatsapp_gerar_codigo_ativacao';
  if v_def is null then
    raise warning 'whatsapp_gerar_codigo_ativacao não existe — pulada';
  elsif position('usuario_no_escritorio_ativo' in v_def) > 0 then
    null;
  elsif position(c_achar in v_def) = 0 then
    raise exception 'whatsapp_gerar_codigo_ativacao: trecho de autorização mudou — revisar o remendo';
  else
    execute replace(v_def, c_achar, c_trocar);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Responsável padrão: sempre gente do escritório do caso
-- ---------------------------------------------------------------------------
create or replace function private.escritorio_do_caso(p_caso_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.escritorio_id from public.casos c where c.id = p_caso_id),
    private.escritorio_ativo(),
    private.escritorio_padrao())
$$;

create or replace function private.admin_ativo_de(p_escritorio uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  -- Contas sintéticas por último: '[' ordena antes de qualquer letra (#229).
  select u.id
    from public.membros m
    join public.papeis p on p.id = m.papel_id and p.chave = 'admin'
    join public.usuarios u on u.id = m.usuario_id
   where m.escritorio_id = p_escritorio and m.status = 'ativo'
   order by (lower(u.email) like 'e2e+%'), u.nome
   limit 1
$$;

create or replace function private.responsavel_padrao_de(p_escritorio uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    -- 1) escolha do escritório (Configurações)
    (select u.id
       from public.escritorio_config c
       join public.usuarios u on u.id::text = c.responsaveis ->> 'analise'
      where c.escritorio_id = p_escritorio
        and private.eh_interno_ativo_em(u.id, p_escritorio)),
    -- 2) legado do escritório padrão: a chave do app_config e, sem ela, a Mara
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'tarefa_analise_responsavel_id'
        and p_escritorio = private.escritorio_padrao()
        and private.eh_interno_ativo_em(u.id, p_escritorio)),
    (select u.id
       from public.usuarios u
      where lower(u.email) = 'marasandra.adv@gmail.com'
        and p_escritorio = private.escritorio_padrao()
        and private.eh_interno_ativo_em(u.id, p_escritorio)
      limit 1),
    -- 3) última rede: um admin ativo DESTE escritório
    private.admin_ativo_de(p_escritorio))
$$;

revoke all on function private.escritorio_do_caso(uuid), private.admin_ativo_de(uuid), private.responsavel_padrao_de(uuid) from public, anon;
grant execute on function private.escritorio_do_caso(uuid), private.admin_ativo_de(uuid), private.responsavel_padrao_de(uuid) to authenticated, service_role;

create or replace function public.admin_ativo_padrao() returns uuid
language sql stable security definer set search_path = '' as $$
  select private.admin_ativo_de(coalesce(private.escritorio_ativo(), private.escritorio_padrao()))
$$;

create or replace function public.responsavel_padrao_analise() returns uuid
language sql stable security definer set search_path = '' as $$
  select private.responsavel_padrao_de(coalesce(private.escritorio_ativo(), private.escritorio_padrao()))
$$;

create or replace function public.responsavel_tarefa_caso(p_caso_id uuid, p_preferido uuid default null) returns uuid
language sql stable security definer set search_path = '' as $$
  with e as (select private.escritorio_do_caso(p_caso_id) as id)
  select coalesce(
    -- 1) palpite de quem chamou (quem pediu o documento, quem criou o evento)
    (select p_preferido from e where private.eh_interno_ativo_em(p_preferido, e.id)),
    -- 2) dono explícito do caso
    (select c.responsavel_id
       from public.casos c, e
      where c.id = p_caso_id and private.eh_interno_ativo_em(c.responsavel_id, e.id)),
    -- 3) dono de fato: quem carrega mais tarefa aberta nesse caso; empate decide
    --    pela mais recente
    (select t.responsavel_id
       from public.tarefas t, e
      where t.caso_id = p_caso_id
        and private.eh_interno_ativo_em(t.responsavel_id, e.id)
      group by t.responsavel_id
      order by count(*) filter (where t.status in ('a_fazer', 'fazendo')) desc,
               max(t.created_at) desc
      limit 1),
    -- 4) padrão do escritório do caso — nunca devolve gente de outro escritório
    (select private.responsavel_padrao_de(e.id) from e))
$$;

-- O DJE ainda é integração do escritório padrão (v1).
create or replace function public._dje_triagem_responsavel() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'dje_triagem_responsavel_id'
        and private.eh_interno_ativo_em(u.id, private.escritorio_padrao())),
    private.admin_ativo_de(private.escritorio_padrao()))
$$;

-- ---------------------------------------------------------------------------
-- 4. Equipe: tudo no vínculo do escritório ativo
-- ---------------------------------------------------------------------------
-- Último admin ativo não sai nem é rebaixado — por qualquer caminho.
create or replace function private.tg_membros_ultimo_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_era_admin boolean;
  v_segue     boolean;
begin
  select p.chave = 'admin' into v_era_admin from public.papeis p where p.id = old.papel_id;
  if not (v_era_admin and old.status = 'ativo') then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    select p.chave = 'admin' into v_segue from public.papeis p where p.id = new.papel_id;
    v_segue := v_segue and new.status = 'ativo';
  else
    v_segue := false;
  end if;

  if not v_segue and not exists (
    select 1 from public.membros m
      join public.papeis p on p.id = m.papel_id and p.chave = 'admin'
     where m.escritorio_id = old.escritorio_id and m.status = 'ativo' and m.id <> old.id
  ) then
    raise exception 'o escritório precisa de pelo menos um administrador ativo' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_membros_ultimo_admin on public.membros;
create trigger trg_membros_ultimo_admin
  before update or delete on public.membros
  for each row execute function private.tg_membros_ultimo_admin();

create or replace function public.definir_papel(p_usuario_id uuid, p_papel text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_esc   uuid := private.escritorio_ativo();
  v_m     public.membros%rowtype;
  v_atual public.papeis%rowtype;
  v_novo  public.papeis%rowtype;
begin
  if not private.tem_permissao('equipe:gerenciar') then
    raise exception 'Sem permissão: apenas quem gerencia a equipe altera papéis' using errcode = '42501';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'Você não pode alterar o próprio papel';
  end if;

  select * into v_m from public.membros
   where escritorio_id = v_esc and usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'Pessoa não encontrada neste escritório';
  end if;

  select * into v_atual from public.papeis where id = v_m.papel_id;
  select * into v_novo from public.papeis
   where chave = p_papel and (escritorio_id is null or escritorio_id = v_esc)
   order by escritorio_id nulls last limit 1;
  if not found then
    raise exception 'Papel % não existe', p_papel;
  end if;
  if v_novo.tipo_acesso <> v_atual.tipo_acesso then
    raise exception 'Não dá para trocar entre equipe interna e parceiro por aqui';
  end if;
  if v_novo.chave = 'admin' and v_m.status <> 'ativo' then
    raise exception 'Reative a pessoa antes de torná-la admin';
  end if;

  update public.membros set papel_id = v_novo.id, updated_at = now() where id = v_m.id;
end;
$$;

create or replace function public.definir_admin(p_usuario_id uuid, p_valor boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Mantida para o código antigo: admin ⇄ advogado.
  if p_usuario_id = auth.uid() and p_valor is distinct from true then
    raise exception 'Você não pode remover o próprio papel de admin';
  end if;
  if not exists (select 1 from public.membros m join public.papeis p on p.id = m.papel_id
                  where m.escritorio_id = private.escritorio_ativo()
                    and m.usuario_id = p_usuario_id and p.tipo_acesso = 'interno') then
    raise exception 'Só usuários internos deste escritório podem ser admin';
  end if;
  perform public.definir_papel(p_usuario_id, case when coalesce(p_valor, false) then 'admin' else 'advogado' end);
end;
$$;

-- Sessão e login só caem quando a pessoa não tem mais NENHUM vínculo ativo.
create or replace function private.bloquear_login_se_sem_vinculo(p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.membros where usuario_id = p_usuario and status = 'ativo') then
    return;
  end if;
  update auth.users set banned_until = now() + interval '100 years' where id = p_usuario;
  delete from auth.refresh_tokens where user_id = p_usuario::text;
  delete from auth.sessions where user_id = p_usuario;
end;
$$;
revoke all on function private.bloquear_login_se_sem_vinculo(uuid) from public, anon, authenticated;

create or replace function public.desligar_interno(p_usuario_id uuid, p_novo_responsavel_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_esc   uuid := private.escritorio_ativo();
  v_m     public.membros%rowtype;
  v_nome  text;
  v_abertas int;
  v_tarefas_movidas int := 0;
  v_eventos_movidos int := 0;
begin
  if not private.tem_permissao('equipe:gerenciar') then
    raise exception 'Sem permissão: apenas administradores desligam pessoas da equipe';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'Você não pode desligar a si mesma(o)';
  end if;

  select m.* into v_m
    from public.membros m join public.papeis p on p.id = m.papel_id
   where m.escritorio_id = v_esc and m.usuario_id = p_usuario_id and p.tipo_acesso = 'interno'
     for update of m;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;
  select nome into v_nome from public.usuarios where id = p_usuario_id;

  select count(*) into v_abertas
    from public.tarefas
   where escritorio_id = v_esc and responsavel_id = p_usuario_id
     and status in ('a_fazer', 'fazendo');

  if p_novo_responsavel_id is not null then
    if p_novo_responsavel_id = p_usuario_id then
      raise exception 'O novo responsável não pode ser a própria pessoa desligada';
    end if;
    if not private.eh_interno_ativo_em(p_novo_responsavel_id, v_esc) then
      raise exception 'Novo responsável inválido: precisa ser alguém ativo da equipe';
    end if;
  elsif v_abertas > 0 then
    raise exception 'Há % tarefa(s) aberta(s) com essa pessoa: escolha quem assume', v_abertas;
  end if;

  if p_novo_responsavel_id is not null then
    update public.tarefas
       set responsavel_id = p_novo_responsavel_id
     where escritorio_id = v_esc and responsavel_id = p_usuario_id
       and status in ('a_fazer', 'fazendo');
    get diagnostics v_tarefas_movidas = row_count;

    update public.agenda_eventos
       set responsavel_id = p_novo_responsavel_id
     where escritorio_id = v_esc and responsavel_id = p_usuario_id
       and end_at >= now();
    get diagnostics v_eventos_movidos = row_count;
  end if;

  -- Sai do escritório e perde o papel de admin (reativar não devolve).
  update public.membros
     set status = 'desativado',
         desativado_em = now(),
         desativado_por = auth.uid(),
         papel_id = case when (select chave from public.papeis where id = papel_id) = 'admin'
                         then (select id from public.papeis where escritorio_id is null and chave = 'advogado')
                         else papel_id end,
         updated_at = now()
   where id = v_m.id;

  perform private.bloquear_login_se_sem_vinculo(p_usuario_id);

  -- Tokens do MCP não passam pelo login: revoga os deste escritório.
  update public.ia_tokens
     set revogado_em = now()
   where usuario_id = p_usuario_id and escritorio_id = v_esc and revogado_em is null;

  return jsonb_build_object(
    'tarefas_movidas', v_tarefas_movidas,
    'eventos_movidos', v_eventos_movidos,
    'nome', v_nome);
end;
$$;

create or replace function public.reativar_interno(p_usuario_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
begin
  if not private.tem_permissao('equipe:gerenciar') then
    raise exception 'Sem permissão: apenas administradores reativam pessoas da equipe';
  end if;
  update public.membros m
     set status = 'ativo', desativado_em = null, desativado_por = null, updated_at = now()
    from public.papeis p
   where p.id = m.papel_id and p.tipo_acesso = 'interno'
     and m.escritorio_id = v_esc and m.usuario_id = p_usuario_id;
  if not found then
    raise exception 'Usuário interno não encontrado';
  end if;
  update auth.users set banned_until = null where id = p_usuario_id;
end;
$$;

create or replace function public.desligar_parceiro(p_usuario_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_esc   uuid := private.escritorio_ativo();
  v_nome  text;
  v_casos int;
begin
  if not private.tem_permissao('parceiros:gerenciar') then
    raise exception 'Sem permissão: apenas a equipe interna desliga parceiros';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'Você não pode desligar a si mesma(o)';
  end if;

  update public.membros m
     set status = 'desativado',
         desativado_em = coalesce(m.desativado_em, now()),
         desativado_por = coalesce(m.desativado_por, auth.uid()),
         updated_at = now()
    from public.papeis p
   where p.id = m.papel_id and p.tipo_acesso = 'parceiro'
     and m.escritorio_id = v_esc and m.usuario_id = p_usuario_id;
  if not found then
    raise exception 'Esta função só desliga parceiros (interno sai por /equipe)';
  end if;

  select nome into v_nome from public.usuarios where id = p_usuario_id;
  select count(*) into v_casos from public.casos
   where escritorio_id = v_esc and parceiro_id = p_usuario_id;

  perform private.bloquear_login_se_sem_vinculo(p_usuario_id);

  return jsonb_build_object('nome', v_nome, 'casos_preservados', v_casos);
end;
$$;

create or replace function public.reativar_parceiro(p_usuario_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
begin
  if not private.tem_permissao('parceiros:gerenciar') then
    raise exception 'Sem permissão: apenas a equipe interna reativa parceiros';
  end if;
  update public.membros m
     set status = 'ativo', desativado_em = null, desativado_por = null, updated_at = now()
    from public.papeis p
   where p.id = m.papel_id and p.tipo_acesso = 'parceiro'
     and m.escritorio_id = v_esc and m.usuario_id = p_usuario_id;
  if not found then
    raise exception 'Parceiro não encontrado';
  end if;
  update auth.users set banned_until = null where id = p_usuario_id;
end;
$$;

-- Vínculo novo para quem JÁ tem conta (convite para e-mail cadastrado cria
-- vínculo em vez de erro). Quem cria a conta nova é a edge convidar-usuario.
create or replace function public.vincular_pessoa(p_email text, p_papel text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_esc   uuid := private.escritorio_ativo();
  v_uid   uuid;
  v_papel public.papeis%rowtype;
  v_id    uuid;
begin
  select * into v_papel from public.papeis
   where chave = p_papel and (escritorio_id is null or escritorio_id = v_esc)
   order by escritorio_id nulls last limit 1;
  if not found then
    raise exception 'Papel % não existe', p_papel;
  end if;
  if not private.tem_permissao(case when v_papel.tipo_acesso = 'interno'
                                    then 'equipe:gerenciar' else 'parceiros:gerenciar' end) then
    raise exception 'Sem permissão para vincular esta pessoa' using errcode = '42501';
  end if;

  select id into v_uid from public.usuarios where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'Não existe conta com este e-mail' using errcode = 'P0002';
  end if;

  insert into public.membros (escritorio_id, usuario_id, papel_id, status, convidado_por, recebe_repasse)
  values (v_esc, v_uid, v_papel.id, 'ativo', auth.uid(), v_papel.tipo_acesso = 'parceiro')
  on conflict (escritorio_id, usuario_id) do update
     set status = 'ativo', desativado_em = null, desativado_por = null,
         papel_id = excluded.papel_id, updated_at = now()
  returning id into v_id;

  update auth.users set banned_until = null where id = v_uid;
  return v_id;
end;
$$;

revoke execute on function public.definir_papel(uuid, text), public.vincular_pessoa(text, text) from public, anon;
grant execute on function public.definir_papel(uuid, text), public.vincular_pessoa(text, text) to authenticated, service_role;
-- (as demais já tinham o grant certo; `create or replace` preserva a ACL.)

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and pg_get_functiondef(p.oid) like '%private.exigir_no_escritorio%') as rpcs_com_guard,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.prosrc ~ 'from public\.usuarios\s+where id = auth\.uid\(\)') as ainda_decidem_por_usuarios_tipo,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'EXECUTE')) as executaveis_por_anon,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')) as executaveis_por_authenticated;

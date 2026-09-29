-- migration_rbac_03_isolamento.sql
--
-- RBAC multi-tenant, passo 3 de 5: ISOLAMENTO e papéis no banco
-- (planning/MULTI_TENANT_RBAC.md §4.2, Fases 4 e 5).
--
--   1. `is_interno()`, `is_admin()`, `parceiro_ativo()`, `caso_do_parceiro()` e
--      `parceiro_alcanca_cliente()` passam a ler o VÍNCULO no escritório ativo —
--      nenhuma decisão de acesso lê mais `usuarios.tipo/eh_admin/ativo`;
--   2. uma policy RESTRICTIVE por tabela de domínio: `escritorio_id` tem que ser
--      o escritório ativo de quem consulta. O Postgres combina restritivas com
--      AND, então uma permissiva descuidada (até `USING (true)`) não atravessa
--      escritório. As 143 permissivas — e toda a nuance de negócio delas —
--      ficam como estão;
--   3. as permissivas são reescritas só na FORMA, a partir do que está no banco:
--        - helper nu → `(select helper())` (initPlan: uma vez por consulta, não
--          por linha — agora o helper custa mais);
--        - `exists (select 1 from usuarios where tipo = 'interno')` inline →
--          `(select is_interno())`. Dez policies testavam `tipo` SEM `ativo`:
--          pessoa desligada ainda passava (o mesmo furo de ac2f486 que tinha
--          sobrado em agenda, comentários, tarefas e templates);
--        - `TO public` → `TO authenticated` (menos as feitas para `anon`);
--   4. policies RESTRICTIVE por PERMISSÃO onde a matriz de §4.3 distingue os
--      papéis novos (assistente, financeiro). Admin, advogado e parceiro têm
--      todas as permissões que já exerciam: para eles nada muda;
--   5. `usuarios`: a pessoa vê a si mesma e quem é do escritório ativo;
--   6. Storage: o objeto tem que ser de um caso (ou pessoa) do escritório ativo.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Helpers de papel sobre o vínculo
-- ---------------------------------------------------------------------------
create or replace function public.is_interno() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select v.tipo_acesso = 'interno' from private.meu_vinculo() v), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select v.papel = 'admin' from private.meu_vinculo() v), false)
$$;

create or replace function public.parceiro_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select v.tipo_acesso = 'parceiro' from private.meu_vinculo() v), false)
$$;

-- `escritorio_ativo()` só devolve escritório em que a pessoa é membro ATIVO:
-- caso do escritório ativo + parceiro_id = eu já cobre "parceiro desligado".
create or replace function public.caso_do_parceiro(p_caso_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.casos c
     where c.id = p_caso_id
       and c.parceiro_id = (select auth.uid())
       and c.escritorio_id = (select private.escritorio_ativo())
  )
$$;

create or replace function public.parceiro_alcanca_cliente(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes c
     where c.id = p_cliente_id
       and c.escritorio_id = (select private.escritorio_ativo())
       and (c.created_by = (select auth.uid())
            or exists (select 1 from public.casos k
                        where k.cliente_id = c.id and k.parceiro_id = (select auth.uid())))
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Isolamento: uma restritiva por tabela de domínio
-- ---------------------------------------------------------------------------
do $$
declare
  t regclass;
begin
  for t in select private.tabelas_de_dominio() loop
    execute format('alter table %s enable row level security', t);
    execute format('drop policy if exists isolamento_escritorio on %s', t);
    execute format(
      'create policy isolamento_escritorio on %s as restrictive for all to authenticated
         using      (escritorio_id = (select private.escritorio_ativo()))
         with check (escritorio_id = (select private.escritorio_ativo()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Permissivas: só a forma
-- ---------------------------------------------------------------------------
do $$
declare
  r        record;
  v_using  text;
  v_check  text;
  v_sql    text;
  -- `exists (select 1 from usuarios [u] where id = auth.uid() and tipo = 'interno' [and ativo])`
  c_inline constant text :=
    'EXISTS \( SELECT 1\s+FROM usuarios( u)?\s+WHERE \(\((u|usuarios)\.id = auth\.uid\(\)\) AND \((u|usuarios)\.tipo = ''interno''::tipo_usuario\)( AND \((u|usuarios)\.ativo = true\))?\)\)';
  n_forma  int := 0;
  n_roles  int := 0;
begin
  for r in
    select schemaname, tablename, policyname, roles, qual, with_check
      from pg_policies
     where schemaname in ('public', 'storage')
       and policyname <> 'isolamento_escritorio'
       and policyname not like 'perm\_%'
  loop
    v_using := r.qual;
    v_check := r.with_check;

    -- helper nu → initPlan (primeiro: o passo seguinte já escreve embrulhado)
    v_using := regexp_replace(v_using, '(?<!SELECT )\m(is_interno|is_admin|parceiro_ativo)\(\)', '( SELECT \1())', 'g');
    v_check := regexp_replace(v_check, '(?<!SELECT )\m(is_interno|is_admin|parceiro_ativo)\(\)', '( SELECT \1())', 'g');
    -- checagem inline de tipo → helper
    v_using := regexp_replace(v_using, c_inline, '( SELECT is_interno())', 'g');
    v_check := regexp_replace(v_check, c_inline, '( SELECT is_interno())', 'g');

    if v_using is distinct from r.qual or v_check is distinct from r.with_check then
      v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if v_using is not null then v_sql := v_sql || format(' using (%s)', v_using); end if;
      if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
      execute v_sql;
      n_forma := n_forma + 1;
    end if;

    if r.roles = '{public}'::name[] and r.policyname not ilike '%anon%' then
      execute format('alter policy %I on %I.%I to authenticated', r.policyname, r.schemaname, r.tablename);
      n_roles := n_roles + 1;
    end if;
  end loop;
  raise notice 'policies reescritas na forma: %; TO public → authenticated: %', n_forma, n_roles;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Restritivas por permissão (onde a matriz distingue os papéis novos)
-- ---------------------------------------------------------------------------
-- comandos: s=SELECT i=INSERT u=UPDATE d=DELETE. `atribuido` = coluna que
-- decide o escopo "atribuidos". `livre` = condição que dispensa a permissão.
do $$
declare
  r record;
  c text;
  v_cmd text;
  v_cond text;
  v_nome text;
begin
  for r in
    select * from (values
      ('casos',                 'iud', 'casos:editar',            null,             null),
      ('clientes',              'iud', 'casos:editar',            null,             null),
      ('clientes_etiquetas',    'iud', 'casos:editar',            null,             null),
      ('processos_admin',       'iud', 'casos:editar',            null,             null),
      ('processos_judiciais',   'iud', 'casos:editar',            null,             null),
      ('processos_admin',       's',   'processos:ler',           null,             null),
      ('processos_judiciais',   's',   'processos:ler',           null,             null),
      ('publicacoes_dje',       's',   'publicacoes:ler',         null,             null),
      ('andamentos',            'iud', 'casos:editar',            null,             null),
      ('andamentos',            's',   'andamentos:ler_internos', null,             'visivel_parceiro is true'),
      ('analises_tecnicas',     's',   'analises:ler',            null,             'resumo_parceiro is not null'),
      ('documentos',            'iu',  'documentos:enviar',       null,             null),
      ('documentos',            'd',   'documentos:excluir',      null,             null),
      ('tarefas',               'iud', 'tarefas:gerenciar',       'responsavel_id', null),
      ('agenda_eventos',        'iud', 'agenda:gerenciar',        'responsavel_id', null),
      ('leads',                 'siud','comercial:gerenciar',     null,             null),
      ('lead_comentarios',      'siud','comercial:gerenciar',     null,             null),
      ('repasses',              's',   'repasses:ler',            null,             null),
      ('etiquetas',             'iud', 'etiquetas:gerenciar',     null,             null),
      ('tarefa_templates',      'iud', 'templates:gerenciar',     null,             null),
      ('tipos_beneficio',       'iud', 'templates:gerenciar',     null,             null),
      ('ia_acoes',              'siud','ia:usar',                 null,             null),
      ('ia_integracoes',        'siud','ia:usar',                 null,             null)
    ) as m(tabela, comandos, permissao, atribuido, livre)
  loop
    -- analises_tecnicas: a condição "livre" só vale se a coluna existir
    if r.livre is not null and r.tabela = 'analises_tecnicas'
       and not exists (select 1 from pg_attribute
                        where attrelid = 'public.analises_tecnicas'::regclass
                          and attname = 'resumo_parceiro' and not attisdropped) then
      r.livre := null;
    end if;

    v_cond := format('(select private.tem_permissao(%L, null))', r.permissao);
    if r.atribuido is not null then
      v_cond := format(
        '((select private.tem_permissao(%1$L, %2$L)) or ((select private.tem_permissao(%1$L, %3$L)) and %4$I = (select auth.uid())))',
        r.permissao, 'todos', 'atribuidos', r.atribuido);
    end if;
    if r.livre is not null then
      v_cond := format('((%s) or %s)', r.livre, v_cond);
    end if;

    foreach c in array regexp_split_to_array(r.comandos, '') loop
      v_cmd := case c when 's' then 'select' when 'i' then 'insert' when 'u' then 'update' else 'delete' end;
      v_nome := 'perm_' || replace(r.permissao, ':', '_') || '_' || v_cmd;
      execute format('drop policy if exists %I on public.%I', v_nome, r.tabela);
      execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
        v_nome, r.tabela, v_cmd,
        case v_cmd
          when 'insert' then format('with check (%s)', v_cond)
          when 'update' then format('using (%1$s) with check (%1$s)', v_cond)
          else format('using (%s)', v_cond) end);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. usuarios: a si mesmo e quem é do escritório ativo
-- ---------------------------------------------------------------------------
-- Sem restritiva de INSERT: o vínculo de quem está sendo criado nasce no
-- gatilho AFTER, então "é do meu escritório?" ainda seria falso no WITH CHECK.
drop policy if exists isolamento_escritorio_select on public.usuarios;
create policy isolamento_escritorio_select on public.usuarios
  as restrictive for select to authenticated
  using (id = (select auth.uid()) or private.usuario_no_escritorio_ativo(id));

drop policy if exists isolamento_escritorio_update on public.usuarios;
create policy isolamento_escritorio_update on public.usuarios
  as restrictive for update to authenticated
  using      (id = (select auth.uid()) or private.usuario_no_escritorio_ativo(id))
  with check (id = (select auth.uid()) or private.usuario_no_escritorio_ativo(id));

drop policy if exists isolamento_escritorio_delete on public.usuarios;
create policy isolamento_escritorio_delete on public.usuarios
  as restrictive for delete to authenticated
  using (private.usuario_no_escritorio_ativo(id));

-- O guard de privilégios consulta is_admin(): agora é o admin DO ESCRITÓRIO
-- ATIVO, e o alvo tem que ser do mesmo escritório (a restritiva acima garante).

-- ---------------------------------------------------------------------------
-- 6. Storage
-- ---------------------------------------------------------------------------
create or replace function private.objeto_no_escritorio_ativo(p_bucket text, p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_bucket not in ('documentos', 'cnis-uploads', 'contratos') then
    return true;
  end if;
  begin
    v_id := split_part(p_nome, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  if p_bucket = 'contratos' then
    return v_id = auth.uid() or private.usuario_no_escritorio_ativo(v_id);
  end if;
  return exists (select 1 from public.casos c
                  where c.id = v_id and c.escritorio_id = private.escritorio_ativo());
end;
$$;
revoke all on function private.objeto_no_escritorio_ativo(text, text) from public, anon;
grant execute on function private.objeto_no_escritorio_ativo(text, text) to authenticated, service_role;

drop policy if exists isolamento_escritorio on storage.objects;
create policy isolamento_escritorio on storage.objects
  as restrictive for all to authenticated
  using      (private.objeto_no_escritorio_ativo(bucket_id, name))
  with check (private.objeto_no_escritorio_ativo(bucket_id, name));

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from private.tabelas_de_dominio()) as tabelas_de_dominio,
  (select count(*) from pg_policies where policyname = 'isolamento_escritorio' and schemaname = 'public' and permissive = 'RESTRICTIVE') as restritivas_de_isolamento,
  (select count(*) from pg_policies where policyname like 'perm\_%') as restritivas_de_permissao,
  (select count(*) from pg_policies where schemaname in ('public','storage') and roles = '{public}'::name[]) as ainda_to_public,
  (select count(*) from pg_policies where schemaname in ('public','storage')
      and coalesce(qual,'') || coalesce(with_check,'') ~ 'usuarios\.tipo|u\.tipo') as ainda_com_tipo_inline,
  (select count(*) from pg_policies where schemaname in ('public','storage')
      and coalesce(qual,'') || coalesce(with_check,'') ~ '(?<!SELECT )\m(is_interno|is_admin|parceiro_ativo)\(\)') as helpers_nus;

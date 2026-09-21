-- migration_rls_with_check_e_vinculos.sql
--
-- Fecha duas classes de furo achadas na auditoria de 14/09 e revalidadas em
-- 19/09 no catálogo de produção.
--
-- (a) 9 policies de UPDATE/ALL sem WITH CHECK. Sem WITH CHECK explícito o
--     Postgres reaproveita o USING como check da linha NOVA. Isso já basta
--     para o caso simples, mas deixa o comportamento implícito e frágil: quem
--     mexer no USING amanhã muda, sem perceber, a regra de escrita. As 9
--     passam a declarar o WITH CHECK.
--
-- (b) O furo que realmente vaza dado: o vínculo `casos.cliente_id`.
--     `clientes_select` deixa o parceiro ler o cliente que ele criou OU o
--     cliente de um caso dele. `casos_insert` só valida `parceiro_id`, e
--     `casos_update` não congela nada além de responsavel_id. Então o
--     parceiro criava (ou repontava) um caso para QUALQUER cliente_id e
--     passava a ler aquele cliente — e a senha do MEU INSS dele, porque
--     `get_senha_meu_inss` autoriza o parceiro justamente por
--     `casos.cliente_id`. Exige saber o UUID do cliente.
--
--     A correção segue o estilo dos guards que já existem
--     (tg_casos_parceiro_guard, tg_solicitacao_parceiro_guard): quem não tem
--     contexto de usuário (cron, edge com service_role) ou é interno passa
--     direto; para o parceiro, coluna de vínculo volta ao valor antigo no
--     UPDATE e é validada no INSERT.
--
-- (c) `documentos`: as policies de INSERT aceitam qualquer `storage_path`, e a
--     policy de SELECT do Storage libera o objeto cujo `name` é igual ao
--     `storage_path` de um documento de caso do parceiro. Registrando um
--     documento no próprio caso com o path de um arquivo de OUTRO caso, o
--     parceiro lia aquele arquivo. Agora o path precisa começar pelo caso do
--     próprio documento — que é a convenção que o app já usa
--     (`<caso_id>/<arquivo>`).
--
-- Idempotente. Não altera dado nenhum.

-- ---------------------------------------------------------------------------
-- (a) WITH CHECK explícito
-- ---------------------------------------------------------------------------
alter policy casos_update on public.casos
  using (((parceiro_id = auth.uid()) and parceiro_ativo()) or is_interno())
  with check (((parceiro_id = auth.uid()) and parceiro_ativo()) or is_interno());

alter policy clientes_update on public.clientes
  using (is_interno() or (exists (
    select 1 from public.casos
     where casos.cliente_id = clientes.id
       and casos.parceiro_id = auth.uid() and parceiro_ativo())))
  with check (is_interno() or (exists (
    select 1 from public.casos
     where casos.cliente_id = clientes.id
       and casos.parceiro_id = auth.uid() and parceiro_ativo())));

-- comentário só continua alcançável por quem já alcançava o caso de destino:
-- sem isso o autor movia o próprio comentário para qualquer caso_id.
alter policy comentarios_update on public.comentarios
  using ((autor_id = auth.uid()) or is_interno())
  with check (((autor_id = auth.uid()) and (is_interno() or caso_do_parceiro(caso_id))) or is_interno());

alter policy documentos_update_delete on public.documentos
  using (is_interno())
  with check (is_interno());

alter policy mensagens_update on public.mensagens
  using ((remetente_id = auth.uid()) or is_interno())
  with check ((remetente_id = auth.uid()) or is_interno());

alter policy tarefas_update_interno on public.tarefas
  using (is_interno())
  with check (is_interno());

alter policy agenda_eventos_update_interno on public.agenda_eventos
  using (is_interno() and ((restrito_a is null) or (auth.uid() = any (restrito_a))))
  with check (is_interno() and ((restrito_a is null) or (auth.uid() = any (restrito_a))));

alter policy tipos_beneficio_update on public.tipos_beneficio
  using (is_interno())
  with check (is_interno());

-- usuarios_update_self ganhou WITH CHECK em migration_usuarios_guard_privilegios.sql.

-- Nota: `tarefas_update_interno`, `comentarios_update` e
-- `agenda_eventos_update_interno` traziam a checagem de interno inline
-- (`exists (select 1 from usuarios u where u.id = auth.uid() and u.tipo =
-- 'interno')`), que ignora `ativo`. Passam a usar `is_interno()`, que já
-- exige `ativo = true` — é a mesma correção de ac2f486, que ficou faltando
-- nestas três.

-- ---------------------------------------------------------------------------
-- (b) casos: o parceiro não escolhe cliente que ele não alcança
-- ---------------------------------------------------------------------------
create or replace function public.parceiro_alcanca_cliente(p_cliente_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.clientes c
     where c.id = p_cliente_id
       and (c.created_by = auth.uid()
            or exists (select 1 from public.casos k
                        where k.cliente_id = c.id and k.parceiro_id = auth.uid()))
  );
$$;

comment on function public.parceiro_alcanca_cliente(uuid) is
  'true se o cliente já é alcançável pelo parceiro logado (criado por ele ou de um caso dele). Usada pelo guard de casos.';

revoke execute on function public.parceiro_alcanca_cliente(uuid) from public, anon;
grant execute on function public.parceiro_alcanca_cliente(uuid) to authenticated, service_role;

create or replace function public.tg_casos_parceiro_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sem contexto de usuário (cron, edge com service_role) ou interno: libera.
  if auth.uid() is null or public.is_interno() then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    -- Parceiro só abre caso para cliente que ele já alcança: o que ele criou
    -- ou o de outro caso dele. Sem isso, apontar para um cliente qualquer
    -- dava leitura do cliente e da senha do MEU INSS dele.
    if not public.parceiro_alcanca_cliente(NEW.cliente_id) then
      raise exception 'permissão negada: cliente não pertence a este parceiro'
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  -- UPDATE: colunas de vínculo e de atribuição voltam ao valor antigo.
  NEW.responsavel_id := OLD.responsavel_id;
  NEW.cliente_id     := OLD.cliente_id;
  NEW.parceiro_id    := OLD.parceiro_id;
  return NEW;
end;
$$;

drop trigger if exists trg_casos_parceiro_guard on public.casos;
create trigger trg_casos_parceiro_guard
  before insert or update on public.casos
  for each row
  execute function public.tg_casos_parceiro_guard();

-- ---------------------------------------------------------------------------
-- (c) documentos: o path tem que ser do próprio caso
-- ---------------------------------------------------------------------------
create or replace function public.tg_documentos_path_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_interno() then
    return NEW;
  end if;

  -- Convenção do app: `<caso_id>/<arquivo>` (ver os 9 construtores de path no
  -- front e nas edge functions). Para o parceiro isso deixa de ser convenção
  -- e passa a ser regra: sem ela, registrar um documento no próprio caso com
  -- o path de outro caso abria o arquivo do outro caso pela policy do Storage.
  if NEW.storage_path is null
     or NEW.storage_path not like (NEW.caso_id::text || '/%') then
    raise exception 'permissão negada: caminho do arquivo não pertence ao caso do documento'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_documentos_path_guard on public.documentos;
create trigger trg_documentos_path_guard
  before insert or update on public.documentos
  for each row
  execute function public.tg_documentos_path_guard();

-- Conferência
select
  (select count(*) from pg_policies
    where schemaname = 'public' and cmd in ('UPDATE','ALL') and with_check is null
      and policyname in ('casos_update','clientes_update','comentarios_update','documentos_update_delete',
                         'mensagens_update','tarefas_update_interno','agenda_eventos_update_interno',
                         'tipos_beneficio_update','usuarios_update_self')) as policies_sem_check,
  (select count(*) from pg_trigger where tgname = 'trg_casos_parceiro_guard' and tgenabled = 'O') as guard_casos,
  (select count(*) from pg_trigger where tgname = 'trg_documentos_path_guard' and tgenabled = 'O') as guard_documentos;

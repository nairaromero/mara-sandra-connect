-- migration_rbac_25_auditar_mudanca_de_acesso.sql
--
-- Toda mudança de ACESSO passa a deixar linha na auditoria do escritório.
--
-- Achado em 27/09/2026, ao tornar duas pessoas Assistente no staging: a troca
-- foi aceita e não deixou rastro nenhum. A assimetria era esquisita — conceder
-- UMA permissão a alguém já era auditado com antes e depois
-- (migration_rbac_20), mas trocar o PAPEL, que muda as 26 de uma vez, não. O
-- mesmo valia para desligar e reativar gente, e para excluir cliente.
--
-- Pior que não registrar: `reativar_interno` e `reativar_parceiro` LIMPAM
-- `desativado_em`/`desativado_por`, ou seja, apagavam o único rastro que
-- existia do desligamento. Depois de reativar alguém, não havia como saber que
-- essa pessoa já tinha sido desligada, nem por quem.
--
-- O que passa a ser registrado (`tipo_ator = 'membro'`, então fica DENTRO do
-- escritório: o `qg_auditoria` só lê `plataforma` e `suporte`):
--
--   equipe.papel_alterado    de → para, e quantos ajustes individuais caíram
--   equipe.desligado         nome, quem assumiu, tarefas e eventos movidos
--   equipe.reativado         nome e papel com que voltou
--   parceiro.desligado       nome e quantos casos ficaram preservados
--   parceiro.reativado       nome
--   cliente.excluido         nome e quantos casos foram junto
--
-- `definir_admin` não aparece na lista porque delega para `definir_papel` —
-- auditar uma cobre a outra.
--
-- MÉTODO: remendo cirúrgico a partir do `pg_get_functiondef` do banco-alvo, uma
-- âncora por função (mesma técnica da migration_rbac_22). Nada é reescrito a
-- partir de migration velha, e se a âncora não existir mais a migration PARA
-- com erro em vez de publicar uma função diferente da que está no ar.
--
-- Idempotente: cada bloco pula se a função já chama `private.auditar`.

-- ---------------------------------------------------------------------------
-- 1. Troca de papel (e, por tabela, `definir_admin`)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_ancora text := '  update public.membros set papel_id = v_novo.id, updated_at = now() where id = v_m.id;';
  v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'definir_papel' limit 1;
  if v_def is null then raise warning 'definir_papel não existe neste banco — pulada'; return; end if;
  if position('private.auditar' in v_def) > 0 then return; end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'definir_papel: âncora não encontrada — a função mudou, revisar o remendo';
  end if;
  v_novo := replace(v_def, v_ancora, v_ancora || '
  -- migration_rbac_25: quem trocou o papel de quem, e o que caiu junto.
  perform private.auditar(v_esc, ''membro'', ''equipe.papel_alterado'', ''membros'', v_m.id::text,
    jsonb_build_object(''usuario_id'', p_usuario_id, ''de'', v_atual.chave, ''para'', v_novo.chave,
                       ''ajustes_removidos'', v_ajustes));');
  -- a contagem dos ajustes que caem: o delete já existe, só ganha o `get diagnostics`
  v_novo := replace(v_novo,
    '  delete from public.membro_permissoes where membro_id = v_m.id;',
    '  delete from public.membro_permissoes where membro_id = v_m.id;
  get diagnostics v_ajustes = row_count;');
  v_novo := replace(v_novo,
    '  v_novo  public.papeis%rowtype;',
    '  v_novo  public.papeis%rowtype;
  v_ajustes int := 0;');
  execute v_novo;
  raise notice 'definir_papel: passa a auditar a troca de papel';
end $do$;

-- ---------------------------------------------------------------------------
-- 2. Desligar pessoa da equipe
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_ancora text := '  return jsonb_build_object(
    ''tarefas_movidas'', v_tarefas_movidas,';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'desligar_interno' limit 1;
  if v_def is null then raise warning 'desligar_interno não existe neste banco — pulada'; return; end if;
  if position('private.auditar' in v_def) > 0 then return; end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'desligar_interno: âncora não encontrada — a função mudou, revisar o remendo';
  end if;
  -- ANTES do return: depois dele seria código morto.
  execute replace(v_def, v_ancora, '  -- migration_rbac_25: o desligamento fica na trilha, e continua lá depois
  -- de uma eventual reativação (que limpa `desativado_por` da linha).
  perform private.auditar(v_esc, ''membro'', ''equipe.desligado'', ''membros'', v_m.id::text,
    jsonb_build_object(''usuario_id'', p_usuario_id, ''nome'', v_nome,
                       ''assumiu'', p_novo_responsavel_id,
                       ''tarefas_movidas'', v_tarefas_movidas,
                       ''eventos_movidos'', v_eventos_movidos));

' || v_ancora);
  raise notice 'desligar_interno: passa a auditar';
end $do$;

-- ---------------------------------------------------------------------------
-- 3. Reativar pessoa da equipe
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_ancora text := '  update auth.users set banned_until = null where id = p_usuario_id;';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'reativar_interno' limit 1;
  if v_def is null then raise warning 'reativar_interno não existe neste banco — pulada'; return; end if;
  if position('private.auditar' in v_def) > 0 then return; end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'reativar_interno: âncora não encontrada — a função mudou, revisar o remendo';
  end if;
  execute replace(v_def, v_ancora, v_ancora || '
  -- migration_rbac_25: esta função APAGA `desativado_em`/`desativado_por`; sem
  -- esta linha, reativar alguém apagava o rastro de que houve desligamento.
  perform private.auditar(v_esc, ''membro'', ''equipe.reativado'', ''membros'',
    (select m.id::text from public.membros m where m.escritorio_id = v_esc and m.usuario_id = p_usuario_id),
    jsonb_build_object(''usuario_id'', p_usuario_id,
                       ''nome'', (select u.nome from public.usuarios u where u.id = p_usuario_id),
                       ''papel'', (select p.chave from public.membros m join public.papeis p on p.id = m.papel_id
                                    where m.escritorio_id = v_esc and m.usuario_id = p_usuario_id)));');
  raise notice 'reativar_interno: passa a auditar';
end $do$;

-- ---------------------------------------------------------------------------
-- 4. Desligar parceiro
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_ancora text := '  return jsonb_build_object(''nome'', v_nome, ''casos_preservados'', v_casos);';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'desligar_parceiro' limit 1;
  if v_def is null then raise warning 'desligar_parceiro não existe neste banco — pulada'; return; end if;
  if position('private.auditar' in v_def) > 0 then return; end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'desligar_parceiro: âncora não encontrada — a função mudou, revisar o remendo';
  end if;
  execute replace(v_def, v_ancora, '  -- migration_rbac_25
  perform private.auditar(v_esc, ''membro'', ''parceiro.desligado'', ''membros'',
    (select m.id::text from public.membros m where m.escritorio_id = v_esc and m.usuario_id = p_usuario_id),
    jsonb_build_object(''usuario_id'', p_usuario_id, ''nome'', v_nome, ''casos_preservados'', v_casos));

' || v_ancora);
  raise notice 'desligar_parceiro: passa a auditar';
end $do$;

-- ---------------------------------------------------------------------------
-- 5. Reativar parceiro
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_ancora text := '  update auth.users set banned_until = null where id = p_usuario_id;';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'reativar_parceiro' limit 1;
  if v_def is null then raise warning 'reativar_parceiro não existe neste banco — pulada'; return; end if;
  if position('private.auditar' in v_def) > 0 then return; end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'reativar_parceiro: âncora não encontrada — a função mudou, revisar o remendo';
  end if;
  execute replace(v_def, v_ancora, v_ancora || '
  -- migration_rbac_25 (mesma razão do reativar_interno: esta função limpa o rastro da linha)
  perform private.auditar(v_esc, ''membro'', ''parceiro.reativado'', ''membros'',
    (select m.id::text from public.membros m where m.escritorio_id = v_esc and m.usuario_id = p_usuario_id),
    jsonb_build_object(''usuario_id'', p_usuario_id,
                       ''nome'', (select u.nome from public.usuarios u where u.id = p_usuario_id)));');
  raise notice 'reativar_parceiro: passa a auditar';
end $do$;

-- ---------------------------------------------------------------------------
-- 6. Excluir cliente (o que não tem volta)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_ancora text := '  delete from public.documentos where caso_id = ANY(v_caso_ids);';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'excluir_cliente' limit 1;
  if v_def is null then raise warning 'excluir_cliente não existe neste banco — pulada'; return; end if;
  if position('private.auditar' in v_def) > 0 then return; end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'excluir_cliente: âncora não encontrada — a função mudou, revisar o remendo';
  end if;
  -- ANTES dos deletes: depois deles o nome do cliente já não existe.
  execute replace(v_def, v_ancora, '  -- migration_rbac_25: a exclusão é irreversível e leva os casos junto —
  -- registrada antes dos deletes, quando o nome ainda existe.
  perform private.auditar(private.escritorio_ativo(), ''membro'', ''cliente.excluido'', ''clientes'',
    p_cliente_id::text,
    jsonb_build_object(''nome'', (select c.nome from public.clientes c where c.id = p_cliente_id),
                       ''casos'', coalesce(array_length(v_caso_ids, 1), 0)));

' || v_ancora);
  raise notice 'excluir_cliente: passa a auditar';
end $do$;

notify pgrst, 'reload schema';

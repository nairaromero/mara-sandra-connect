-- ============================================================================
-- RBAC 07 · Lado do escritório no acesso de suporte (2026-09-23)
--
-- O admin do escritório já aprovava/recusava (suporte_responder) e via os
-- pedidos (suporte_pedidos); faltava (a) encerrar por conta própria um acesso
-- em andamento — o dado é dele — e (b) ler a trilha do que a plataforma fez
-- no escritório com o NOME de quem fez: a policy de `auditoria` deixa o admin
-- ler as linhas, mas `ator_id` de staff não resolve pela `usuarios` (staff não
-- tem vínculo, a RLS de usuarios não mostra). Duas RPCs, ambas exigindo admin
-- do escritório ativo.
-- ============================================================================

-- Encerrar um acesso de suporte aprovado (ou recusar de vez um pendente).
create or replace function public.suporte_encerrar(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
begin
  if not public.is_admin() then
    raise exception 'só um administrador do escritório encerra um acesso de suporte' using errcode = '42501';
  end if;
  update public.acessos_suporte
     set status = 'encerrado', fim = least(coalesce(fim, now()), now()),
         respondido_por = coalesce(respondido_por, auth.uid()), respondido_em = coalesce(respondido_em, now())
   where id = p_id and escritorio_id = v_esc and status in ('pendente', 'aprovado');
  if not found then
    raise exception 'acesso não encontrado ou já encerrado';
  end if;
  perform private.auditar(v_esc, 'membro', 'suporte.encerrar', 'acessos_suporte', p_id::text);
end;
$$;

-- Trilha do escritório: tudo que a plataforma, o suporte e os próprios admins
-- fizeram AQUI, com o nome de quem fez. Só metadado (a tabela já é assim).
create or replace function public.auditoria_plataforma(p_limite int default 25, p_offset int default 0)
returns table (id bigint, quando timestamptz, tipo_ator text, ator_nome text, acao text,
               recurso text, recurso_id text, detalhes jsonb, total int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
  v_limite int := least(greatest(coalesce(p_limite, 25), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if v_esc is null or not public.is_admin() then
    raise exception 'só um administrador do escritório lê a auditoria' using errcode = '42501';
  end if;
  return query
  select a.id, a.created_at, a.tipo_ator, u.nome, a.acao, a.recurso, a.recurso_id, a.detalhes,
         count(*) over ()::int
    from public.auditoria a
    left join public.usuarios u on u.id = a.ator_id
   where a.escritorio_id = v_esc
   order by a.created_at desc, a.id desc
   limit v_limite offset v_offset;
end;
$$;

revoke execute on function public.suporte_encerrar(uuid), public.auditoria_plataforma(int, int) from public, anon;
grant execute on function public.suporte_encerrar(uuid), public.auditoria_plataforma(int, int) to authenticated, service_role;

notify pgrst, 'reload schema';

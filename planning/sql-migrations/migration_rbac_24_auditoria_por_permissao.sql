-- migration_rbac_24_auditoria_por_permissao.sql
--
-- A auditoria passa a obedecer a PERMISSÃO `auditoria:ler`, não o papel admin.
--
-- Achado em 27/09/2026 filmando o comunicado do release (mesma classe do #402,
-- e pior pelo modo de falhar). Depois da migration_rbac_20 a permissão
-- `auditoria:ler` virou ajustável por pessoa — é uma das sete sensíveis, com
-- confirmação escrita na tela —, e a rota `/auditoria` abre para quem a tem.
-- Só que o SERVIDOR continuava cobrando `is_admin()` nos dois lados da tela:
--
--   · `auditoria_plataforma()` (a trilha do escritório) recusa com
--     "só um administrador do escritório lê a auditoria" — erro na cara;
--   · a policy `acessos_senha_inss_admin_read` (os acessos à senha do MEU INSS)
--     não recusa: **devolve zero linhas**. A tela mostra "0 eventos", que é
--     indistinguível de "nunca ninguém abriu uma senha". Falha silenciosa e
--     plausível, que é a pior de todas.
--
-- Conferido no staging em 27/09 concedendo `auditoria:ler` ao advogado do
-- Canário: a RPC estourou 42501 e a tabela devolveu 0 linhas.
--
-- Nada muda no padrão: `auditoria:ler` pertence só ao papel admin
-- (papel_permissoes), então quem lê hoje continua lendo. O que passa a
-- funcionar é a concessão individual, que a tela já oferece.
--
-- Idempotente. local → staging → produção.

-- ---------------------------------------------------------------------------
-- 1. A trilha do escritório
-- ---------------------------------------------------------------------------
-- Cópia fiel da definição que está no staging (hash 441591fd…, vinda da
-- migration_rbac_07), com uma linha trocada: `is_admin()` vira a permissão.
create or replace function public.auditoria_plataforma(p_limite int default 25, p_offset int default 0)
returns table (id bigint, quando timestamptz, tipo_ator text, ator_nome text, acao text,
               recurso text, recurso_id text, detalhes jsonb, total int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
  v_limite int := least(greatest(coalesce(p_limite, 25), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  -- migration_rbac_24: a permissão, não o papel. `auditoria:ler` é do admin por
  -- padrão e pode ser concedida a uma pessoa (migration_rbac_20).
  if v_esc is null or not private.tem_permissao('auditoria:ler') then
    raise exception 'sem permissão para ler a auditoria deste escritório' using errcode = '42501';
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

revoke execute on function public.auditoria_plataforma(int, int) from public, anon;
grant  execute on function public.auditoria_plataforma(int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Os acessos à senha do MEU INSS
-- ---------------------------------------------------------------------------
-- A policy permissiva de leitura: mesma troca. O `isolamento_escritorio`
-- (restritiva) continua valendo por cima, então ninguém vê outro escritório.
drop policy if exists acessos_senha_inss_admin_read on public.acessos_senha_inss;
create policy acessos_senha_inss_admin_read on public.acessos_senha_inss
  for select to authenticated
  using (private.tem_permissao('auditoria:ler'));

comment on policy acessos_senha_inss_admin_read on public.acessos_senha_inss is
  'Leitura da trilha de senhas do MEU INSS: quem tem auditoria:ler (admin por padrão, concedível por pessoa desde a migration_rbac_20).';

notify pgrst, 'reload schema';

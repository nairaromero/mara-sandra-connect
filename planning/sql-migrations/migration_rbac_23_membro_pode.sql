-- migration_rbac_23_membro_pode.sql
--
-- Um jeito de o SERVIDOR perguntar "esta pessoa pode X?" sobre OUTRA pessoa.
--
-- Por que precisa existir: `private.tem_permissao` responde sobre quem está
-- logado, e `meu_contexto()` idem. A function `ia-mcp` não tem sessão — ela
-- valida um token e precisa saber se QUEM EMITIU aquele token ainda pode
-- conceder acesso ao MCP. Sem isto, a function comparava o PAPEL do emissor
-- com 'admin' e furava o desenho das permissões por pessoa (migration_rbac_20):
-- conceder `ia:mcp_conceder` a quem não é administrador gerava token que nasce
-- morto — `ia-config` aceitava emitir e `ia-mcp` recusava usar.
--
-- A resposta sai de `private.permissoes_efetivas`, a MESMA fonte de
-- `tem_permissao` e de `meu_contexto` — continua existindo um ponto de decisão
-- só. Esta função não decide nada: só lê pelo lado de fora.
--
-- Quem chama: apenas `service_role` (as edge functions). Pessoa logada
-- continua com `minhas_permissoes()` para si e `permissoes_do_membro(uuid)`
-- para as outras — essa, sim, exigindo `equipe:gerenciar`.
--
-- Idempotente.

create or replace function public.membro_pode(p_membro_id uuid, p_permissao text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.permissoes_efetivas(p_membro_id) e
     where e.permissao = p_permissao
  )
$$;

comment on function public.membro_pode(uuid, text) is
  'Permissão efetiva (papel + ajustes) de um vínculo qualquer. Só para service_role: as edge functions que agem fora de uma sessão.';

revoke execute on function public.membro_pode(uuid, text) from public, anon, authenticated;
grant  execute on function public.membro_pode(uuid, text) to service_role;

notify pgrst, 'reload schema';

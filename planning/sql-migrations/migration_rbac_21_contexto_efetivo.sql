-- migration_rbac_21_contexto_efetivo.sql
--
-- Fecha um buraco aberto pela migration_rbac_20: as EDGE FUNCTIONS não viam os
-- ajustes por pessoa.
--
-- `meu_contexto()` é o que `exigirUsuario` lê (`quem.perfil.permissoes`) nas 32
-- functions. Ele montava a lista direto de `papel_permissoes` — ou seja, do
-- PAPEL. Depois do ajuste por pessoa isso ficou errado nos dois sentidos, e o
-- pior deles é o de segurança:
--
--   · TIRAR `ia:usar` de alguém não impedia essa pessoa de chamar `ia-assistant`,
--     `ia-triagem-andamentos` e as outras — provado no banco local em 25/09:
--     a function deixou a chamada passar da autorização;
--   · CONCEDER `parceiros:excluir` a alguém não fazia a function `excluir-parceiro`
--     aceitar, então a tela oferecia e o servidor recusava (a classe de defeito
--     que a auditoria de 24/09 fechou).
--
-- A correção é uma linha: o contexto passa a ler `private.permissoes_efetivas`,
-- a mesma fonte de `tem_permissao`. Nada mais muda de forma — a function
-- continua devolvendo `text[]` de permissões.
--
-- Idempotente.

create or replace function public.meu_contexto()
returns table (escritorio_id uuid, papel text, tipo_acesso text, permissoes text[])
language sql stable security definer set search_path = '' as $$
  select v.escritorio_id,
         v.papel,
         v.tipo_acesso,
         array(select distinct e.permissao from private.permissoes_efetivas(v.membro_id) e)
    from private.meu_vinculo() v
$$;

notify pgrst, 'reload schema';

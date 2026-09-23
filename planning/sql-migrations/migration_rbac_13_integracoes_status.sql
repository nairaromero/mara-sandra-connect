-- RBAC 13 — Legalmail e Tramitação Inteligente (TI) por escritório: a tela
-- precisa saber quais integrações o escritório ativo tem para só oferecer os
-- botões ("Buscar no Legalmail", "Buscar no TI", "Sync Legal") onde há
-- credencial. `escritorio_integracoes` só é legível por quem gerencia
-- integrações (admin); esta RPC devolve o mínimo (tipo/ativo/configurada) a
-- qualquer membro do escritório ativo, sem segredo nenhum.
--
-- Legado: o escritório padrão do sistema continua usando LEGALMAIL_TOKEN /
-- TI_TOKEN das functions enquanto não cadastrar os seus — por isso, para ele,
-- legalmail e ti aparecem como `configurada = true, legado = true` quando não
-- há linha própria. Os demais escritórios só têm o que cadastraram.
--
-- Idempotente.

create or replace function public.minhas_integracoes()
returns table (tipo text, ativo boolean, configurada boolean, legado boolean)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with esc as (select private.escritorio_ativo() as id),
  proprias as (
    select i.tipo, i.ativo, (i.segredo_definido_em is not null) as configurada, false as legado
      from public.escritorio_integracoes i, esc
     where i.escritorio_id = esc.id
  ),
  legado as (
    select t.tipo, true as ativo, true as configurada, true as legado
      from (values ('legalmail'), ('ti')) as t(tipo), esc
      join public.escritorios e on e.id = esc.id
     where e.padrao_sistema
       and not exists (select 1 from proprias p where p.tipo = t.tipo)
  )
  select * from proprias
  union all
  select * from legado
$$;

revoke execute on function public.minhas_integracoes() from public, anon;
grant execute on function public.minhas_integracoes() to authenticated, service_role;

comment on function public.minhas_integracoes() is
  'Integrações do escritório ativo para a tela decidir o que oferecer (sem segredo). legado=true: escritório padrão usando a variável de ambiente antiga.';

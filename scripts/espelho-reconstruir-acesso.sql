-- Passo 6 do espelho (scripts/espelho-staging.sh): devolve o vínculo de
-- escritório a quem veio de produção.
--
-- `membros`, `plataforma_staff` e `membro_permissoes` não saem de produção
-- (EXCLUIR, #481): o truncate de `usuarios` as leva junto. Antes, este passo
-- REAPLICAVA todas as migrations do RBAC — mas a migration_rbac_01 deixou de
-- ser reaplicável (uma posterior mudou o retorno de minhas_permissoes) e o
-- backfill dela só roda com `membros` VAZIA (o seed das contas de teste já
-- cria 3). Resultado em 27/10: staging sem vínculo para ninguém de produção.
--
-- Aqui: quem ainda não tem vínculo nenhum ganha um no escritório padrão, com o
-- papel derivado de `usuarios` (a mesma regra do backfill original: parceiro,
-- admin ou advogado). Os papéis finos de produção (financeiro, assistente) e
-- os ajustes por pessoa não vêm — o staging valida com as contas de teste.
-- O staff do QG e o Canário vêm depois, pelo scripts/seed-local-rbac.mjs.
-- Idempotente.

insert into public.membros
  (escritorio_id, usuario_id, papel_id, status, recebe_repasse, percentual_parceiro,
   termos_versao, desativado_em, desativado_por, created_at)
select e.id, u.id, p.id,
       case when coalesce(u.ativo, true) and u.desligado_em is null then 'ativo' else 'desativado' end,
       coalesce(u.eh_parceiro, false), u.percentual_parceiro, u.termos_versao,
       case when coalesce(u.ativo, true) and u.desligado_em is null then null
            else coalesce(u.desligado_em, now()) end,
       u.desligado_por, coalesce(u.created_at, now())
  from public.usuarios u
  cross join (select id from public.escritorios where padrao_sistema) e
  join public.papeis p
    on p.escritorio_id is null
   and p.chave = case when u.tipo = 'parceiro' then 'parceiro'
                      when coalesce(u.eh_admin, false) then 'admin'
                      else 'advogado' end
 where not exists (select 1 from public.membros m where m.usuario_id = u.id)
   -- Staff do QG nunca é membro de escritório (lê só metadados). No espelho
   -- real eles ainda não existem neste ponto (o seed os recria depois), mas o
   -- arquivo também roda à mão — e aí viravam advogados do escritório padrão.
   and not exists (select 1 from public.plataforma_staff s where s.usuario_id = u.id);

select 'vínculos depois do espelho: ' || count(*) from public.membros;

-- Catálogo (#486): escritório que o espelho preserva mas não existe em
-- produção (o Canário) perde tipos de benefício e modelos de tarefa no passo 2.
-- O túnel copia do padrão o que estiver vazio — o mesmo do qg_criar_escritorio.
select private.semear_catalogo(e.id) from public.escritorios e where not e.padrao_sistema;
select 'catálogo: ' || string_agg(e.slug || ' ' ||
         (select count(*) from public.tipos_beneficio t where t.escritorio_id = e.id) || ' tipos/' ||
         (select count(*) from public.tarefa_templates t where t.escritorio_id = e.id) || ' modelos', ', ')
  from public.escritorios e;

-- Chave de IA do staging (#486): guardada no passo 1b, devolvida aqui. Quem a
-- gravou pode não existir mais (usuarios veio de produção): atualizado_por cai
-- para nulo, como faria o ON DELETE SET NULL.
insert into public.escritorio_integracoes
select (jsonb_populate_record(null::public.escritorio_integracoes,
          g.linha - 'atualizado_por'
          || jsonb_build_object('atualizado_por',
               case when exists (select 1 from public.usuarios u where u.id::text = g.linha->>'atualizado_por')
                    then g.linha->'atualizado_por' end))).*
  from ops.espelho_guarda_ia g
 where exists (select 1 from public.escritorios e where e.id::text = g.linha->>'escritorio_id')
on conflict (escritorio_id, tipo) do nothing;
select 'chave de IA do staging: ' || count(*) || ' devolvida(s)' from public.escritorio_integracoes where tipo = 'ia';

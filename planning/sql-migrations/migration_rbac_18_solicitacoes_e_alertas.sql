-- migration_rbac_18_solicitacoes_e_alertas.sql
--
-- Classe inversa, passo 4 de 4 (planning/RBAC_CLASSE_INVERSA.md, grupo 1a):
-- as decisões de produto que a Naira aprovou em 24/09.
--
-- 1. SOLICITAÇÕES DE DOCUMENTO. É o pedido que o escritório faz ao cliente ou
--    ao parceiro. A tabela não exigia permissão nenhuma: qualquer pessoa do
--    escritório criava, editava e APAGAVA um pedido para sempre — provado no
--    staging com a conta do financeiro, que só tem `casos:ler` e `repasses:ler`.
--    Passa a exigir `casos:editar`, a mesma permissão de quem toca no caso. O
--    parceiro continua respondendo pedidos: ele tem `casos:editar` (escopo
--    `indicados`) e a permissiva dele já o prende aos casos indicados.
--
-- 2. ALERTAS DE DUPLICIDADE. Registro de CPF repetido, gravado por quem cria
--    caso. Passa a exigir `casos:editar`, que é quem chega nessa tela.
--
-- 3. WEBHOOKS. `webhook_destinos` só era escrito pela tela que hoje mostra
--    "Em breve" (o componente é código morto desde 23/09). A escrita sai do
--    navegador e volta com o módulo, por function.
--
-- Não mexe em dado. Idempotente.

-- ---------------------------------------------------------------------------
-- 1 e 2. Policies restritivas por permissão (mesmo molde da migration_rbac_03)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('solicitacoes_documento', 'casos:editar'),
      ('alertas_duplicidade',    'casos:editar')
    ) as m(tabela, permissao)
  loop
    if to_regclass('public.' || r.tabela) is null then
      raise warning 'tabela public.% não existe — pulada', r.tabela;
      continue;
    end if;
    execute format('drop policy if exists perm_%s_insert on public.%I', replace(r.tabela, '_', ''), r.tabela);
    execute format('drop policy if exists perm_%s_update on public.%I', replace(r.tabela, '_', ''), r.tabela);
    execute format('drop policy if exists perm_%s_delete on public.%I', replace(r.tabela, '_', ''), r.tabela);

    execute format(
      'create policy perm_%s_insert on public.%I as restrictive for insert to authenticated with check ((select private.tem_permissao(%L)))',
      replace(r.tabela, '_', ''), r.tabela, r.permissao);
    execute format(
      'create policy perm_%s_update on public.%I as restrictive for update to authenticated using ((select private.tem_permissao(%L)))',
      replace(r.tabela, '_', ''), r.tabela, r.permissao);
    execute format(
      'create policy perm_%s_delete on public.%I as restrictive for delete to authenticated using ((select private.tem_permissao(%L)))',
      replace(r.tabela, '_', ''), r.tabela, r.permissao);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Webhooks: escrita fora do navegador enquanto o módulo está "Em breve"
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.webhook_destinos') is not null then
    revoke insert, update, delete on public.webhook_destinos from anon, authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';

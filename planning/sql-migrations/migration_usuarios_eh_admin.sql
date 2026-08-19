-- =============================================================================
-- migration_usuarios_eh_admin.sql  (2026-08-19)
--
-- Papel de ADMIN dentro da equipe interna. Hoje só Naira e Mara.
--
-- `usuarios.tipo` continua sendo o modo de acesso (interno x parceiro) e
-- `eh_parceiro` o papel comercial. `eh_admin` é um 3º eixo: quem administra
-- o escritório no sistema — vê Equipe interna, Webhooks, Auditoria e os
-- cards de integração (IA / Claude / Gmail) em Configurações.
--
-- Só vale pra tipo='interno' (parceiro admin não faz sentido; a UI nem olha).
--
-- Também endurece RLS das tabelas que só admin deveria ler/gerir:
--   webhook_destinos / webhook_eventos / webhook_config  → is_admin()
--   acessos_senha_inss (tela Auditoria)                   → is_admin()
-- (antes: qualquer interno.) Triggers e n8n usam service_role, não são afetados.
--
-- Idempotente.
-- =============================================================================

alter table public.usuarios
  add column if not exists eh_admin boolean not null default false;

comment on column public.usuarios.eh_admin is
  'Administra o escritório no sistema (Equipe interna, Webhooks, Auditoria, '
  'integrações). Só faz sentido com tipo=interno. Hoje: Naira e Mara.';

update public.usuarios
   set eh_admin = true
 where lower(email) in (
         'nairaromerovian@gmail.com',
         'marasandra.adv@gmail.com',
         -- aliases do espelho anonimizado de staging
         'nairaromerovian+mara@gmail.com'
       )
   and tipo = 'interno'
   and eh_admin is distinct from true;

-- Mesmo molde de is_interno(): SECURITY DEFINER pra não depender da RLS de
-- usuarios dentro de outra policy.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid()
      and tipo = 'interno'
      and ativo = true
      and eh_admin = true
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Webhooks: só admin gerencia/lê.
-- ---------------------------------------------------------------------------
drop policy if exists webhook_destinos_interno_all on public.webhook_destinos;
drop policy if exists webhook_destinos_admin_all on public.webhook_destinos;
create policy webhook_destinos_admin_all on public.webhook_destinos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists webhook_eventos_interno_select on public.webhook_eventos;
drop policy if exists webhook_eventos_admin_select on public.webhook_eventos;
create policy webhook_eventos_admin_select on public.webhook_eventos
  for select to authenticated
  using (public.is_admin());

drop policy if exists webhook_config_interno_all on public.webhook_config;
drop policy if exists webhook_config_admin_all on public.webhook_config;
create policy webhook_config_admin_all on public.webhook_config
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- set_webhook_secret: mesmo gate.
create or replace function public.set_webhook_secret(p_destino_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Sem permissao: apenas administradores gerenciam segredos de webhook';
  end if;

  if p_secret is null or length(trim(p_secret)) = 0 then
    raise exception 'Segredo vazio';
  end if;

  select secret_id into v_secret_id from public.webhook_destinos where id = p_destino_id;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'webhook_destino_' || p_destino_id::text,
      'Segredo HMAC do destino de webhook ' || p_destino_id::text
    );
    update public.webhook_destinos
       set secret_id = v_secret_id, updated_at = now()
     where id = p_destino_id;
  else
    perform vault.update_secret(v_secret_id, p_secret);
    update public.webhook_destinos set updated_at = now() where id = p_destino_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Auditoria (acessos_senha_inss): só admin lê. INSERT continua pela RPC
-- SECURITY DEFINER de registro de acesso (não passa por esta policy).
-- ---------------------------------------------------------------------------
drop policy if exists acessos_select_interno on public.acessos_senha_inss;
drop policy if exists acessos_senha_inss_interno_read on public.acessos_senha_inss;
drop policy if exists acessos_senha_inss_admin_read on public.acessos_senha_inss;
create policy acessos_senha_inss_admin_read on public.acessos_senha_inss
  for select to authenticated
  using (public.is_admin());

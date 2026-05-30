-- ============================================================================
-- RLS + grants para a TELA INTERNA de cadastro de webhook_destinos.
-- Aplicada em 2026-05-30 (projeto llugytkdsfsrciavhrfw).
--
-- O frontend fala direto com o Supabase como role `authenticated`. RLS e a
-- fronteira de seguranca. So usuarios `interno` (is_interno()) gerenciam
-- webhooks; parceiros nunca veem nada disso. O n8n usa service_role, que
-- ignora RLS (BYPASSRLS) e segue funcionando.
-- ============================================================================

-- webhook_destinos: interno faz tudo (listar, criar, editar, excluir).
drop policy if exists webhook_destinos_interno_all on public.webhook_destinos;
create policy webhook_destinos_interno_all on public.webhook_destinos
  for all to authenticated
  using (public.is_interno())
  with check (public.is_interno());

-- webhook_eventos: interno so LE (log de entrega/auditoria). Ninguem escreve
-- via frontend; quem insere sao os triggers (SECURITY DEFINER) e o n8n (service_role).
drop policy if exists webhook_eventos_interno_select on public.webhook_eventos;
create policy webhook_eventos_interno_select on public.webhook_eventos
  for select to authenticated
  using (public.is_interno());

-- webhook_config: interno le/edita o base_url pela tela.
drop policy if exists webhook_config_interno_all on public.webhook_config;
create policy webhook_config_interno_all on public.webhook_config
  for all to authenticated
  using (public.is_interno())
  with check (public.is_interno());

-- ----------------------------------------------------------------------------
-- set_webhook_secret: gate interno + grant a authenticated (igual set_senha_meu_inss).
-- O segredo nunca volta ao frontend; aqui so se ESCREVE no Vault.
-- ----------------------------------------------------------------------------
create or replace function public.set_webhook_secret(p_destino_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  if not public.is_interno() then
    raise exception 'Sem permissao: apenas equipe interna gerencia segredos de webhook';
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

revoke all on function public.set_webhook_secret(uuid, text) from public, anon;
grant execute on function public.set_webhook_secret(uuid, text) to authenticated, service_role;

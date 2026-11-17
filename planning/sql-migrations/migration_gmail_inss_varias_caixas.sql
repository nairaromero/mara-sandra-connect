-- ============================================================================
-- Várias caixas de e-mail do INSS por escritório (pedido da Naira, 17/11/2026)
--
-- Até aqui `usuario_gmail_oauth` tinha UMA linha por PESSOA (pk = usuario_id) e
-- o `inss-email-processor` lia UMA caixa por escritório (a mais recente): quem
-- recebia e-mail do INSS em duas caixas ficava com uma delas ignorada, e uma
-- mesma pessoa não conseguia conectar a segunda.
--
-- Agora a linha é a CAIXA: pk própria (`id`), única por (escritório, e-mail).
-- `usuario_id` continua dizendo quem conectou. Quem gerencia integrações do
-- escritório desconecta qualquer caixa dele (antes, só quem conectou).
-- `gmail_inss_status` devolve todas as caixas do escritório ativo.
-- `inss_email_log` passa a guardar de qual caixa veio o e-mail e o Message-ID
-- do próprio e-mail, que é igual nas duas caixas quando o INSS manda para os
-- dois endereços — é por ele que o mesmo e-mail não vira tarefa em dobro.
--
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) A linha é a caixa
-- ---------------------------------------------------------------------------
alter table public.usuario_gmail_oauth add column if not exists id uuid not null default gen_random_uuid();

update public.usuario_gmail_oauth set email_conectado = lower(email_conectado) where email_conectado <> lower(email_conectado);

-- A mesma caixa conectada por duas pessoas do escritório: fica a conexão mais nova.
delete from public.usuario_gmail_oauth g
 using public.usuario_gmail_oauth mais_nova
 where mais_nova.escritorio_id = g.escritorio_id
   and mais_nova.email_conectado = g.email_conectado
   and (mais_nova.connected_at, mais_nova.id) > (g.connected_at, g.id);

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.usuario_gmail_oauth'::regclass and conname = 'usuario_gmail_oauth_pkey'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (usuario_id)'
  ) then
    alter table public.usuario_gmail_oauth drop constraint usuario_gmail_oauth_pkey;
    alter table public.usuario_gmail_oauth add constraint usuario_gmail_oauth_pkey primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.usuario_gmail_oauth'::regclass and conname = 'usuario_gmail_oauth_caixa_uk'
  ) then
    alter table public.usuario_gmail_oauth add constraint usuario_gmail_oauth_caixa_uk unique (escritorio_id, email_conectado);
  end if;
end $$;

create index if not exists usuario_gmail_oauth_usuario_idx on public.usuario_gmail_oauth (usuario_id);

-- ---------------------------------------------------------------------------
-- 2) Desconectar: quem gerencia integrações do escritório, qualquer caixa dele
--    (a policy restritiva `perm_usuariogmailoauth_delete` já cobra a permissão)
-- ---------------------------------------------------------------------------
drop policy if exists usuario_gmail_oauth_self_delete on public.usuario_gmail_oauth;
drop policy if exists usuario_gmail_oauth_escritorio_delete on public.usuario_gmail_oauth;
create policy usuario_gmail_oauth_escritorio_delete on public.usuario_gmail_oauth
  for delete to authenticated
  using (escritorio_id = (select private.escritorio_ativo()));

-- ---------------------------------------------------------------------------
-- 3) Status: todas as caixas do escritório ativo
--    (muda o tipo de retorno: precisa cair e nascer de novo, com os grants)
-- ---------------------------------------------------------------------------
drop function if exists public.gmail_inss_status();
create function public.gmail_inss_status()
returns table (id uuid, email_conectado text, connected_at timestamptz, last_used_at timestamptz, conectado_por text, e_minha boolean)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_esc uuid := private.escritorio_ativo();
begin
  if v_esc is null or not private.tem_permissao('integracoes:gerenciar', null) then
    raise exception 'só quem gerencia integrações vê a caixa do INSS' using errcode = '42501';
  end if;
  return query
  select g.id, g.email_conectado, g.connected_at, g.last_used_at, u.nome, g.usuario_id = auth.uid()
    from public.usuario_gmail_oauth g
    left join public.usuarios u on u.id = g.usuario_id
   where g.escritorio_id = v_esc
   order by g.connected_at, g.id;
end;
$function$;

revoke execute on function public.gmail_inss_status() from public, anon;
grant execute on function public.gmail_inss_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Auditoria da leitura: de qual caixa veio e o Message-ID do e-mail
-- ---------------------------------------------------------------------------
alter table public.inss_email_log add column if not exists caixa text;
alter table public.inss_email_log add column if not exists rfc_message_id text;
create index if not exists inss_email_log_rfc_idx on public.inss_email_log (escritorio_id, rfc_message_id) where rfc_message_id is not null;

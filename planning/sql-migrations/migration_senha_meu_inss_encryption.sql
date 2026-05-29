-- =============================================================================
-- Migration: criptografia simetrica para senha do MEU INSS via pgcrypto.
--
-- Por que existe:
--   - Hoje a senha do MEU INSS fica em clientes.senha_meu_inss_plain (text).
--   - Isso e debito LGPD critico: qualquer leitura direta de banco expoe
--     a credencial do cliente.
--
-- Como funciona:
--   - Adiciona coluna senha_meu_inss (bytea) na tabela clientes.
--   - Adiciona tabela acessos_senha_inss (audit log).
--   - Funcao set_senha_meu_inss(cliente_id, senha) criptografa e grava.
--   - Funcao get_senha_meu_inss(cliente_id) decripta e registra audit.
--   - Apenas usuarios com tipo='interno' podem chamar set/get.
--
-- PRE-REQUISITO MANUAL (rode ANTES desta migration no SQL Editor):
--   1) Gerar uma chave forte (32+ chars). No terminal local rode:
--        openssl rand -hex 32
--      Copie o resultado.
--
--   2) Configurar a chave no banco (SQL Editor do Supabase):
--        alter database postgres set app.inss_key = '<chave-do-passo-1>';
--        select pg_reload_conf();
--
--   3) Verificar que a chave esta acessivel:
--        show app.inss_key;
--      (deve retornar a chave; se vier vazio, repetir o passo 2)
--
-- Idempotente: pode rodar varias vezes.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Coluna criptografada
-- ---------------------------------------------------------------------------
alter table public.clientes
  add column if not exists senha_meu_inss bytea;

comment on column public.clientes.senha_meu_inss is
  'Senha do MEU INSS criptografada via pgp_sym_encrypt (pgcrypto).
   Ler apenas via funcao public.get_senha_meu_inss().';

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table if not exists public.acessos_senha_inss (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  usuario_id uuid references public.usuarios(id) on delete set null,
  acessado_em timestamptz not null default now()
);

create index if not exists idx_acessos_senha_inss_cliente
  on public.acessos_senha_inss(cliente_id, acessado_em desc);
create index if not exists idx_acessos_senha_inss_usuario
  on public.acessos_senha_inss(usuario_id, acessado_em desc);

-- RLS: apenas internos podem LER o audit log. Insert eh feito pela funcao
-- com security definer.
alter table public.acessos_senha_inss enable row level security;

drop policy if exists "acessos_senha_inss_interno_read"
  on public.acessos_senha_inss;
create policy "acessos_senha_inss_interno_read"
  on public.acessos_senha_inss
  for select
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.tipo = 'interno'
    )
  );

-- ---------------------------------------------------------------------------
-- set_senha_meu_inss(cliente_id, senha)
--   - Criptografa e grava em clientes.senha_meu_inss.
--   - Senha NULL/vazia limpa o campo.
--   - Apenas usuarios internos podem chamar.
-- ---------------------------------------------------------------------------
create or replace function public.set_senha_meu_inss(
  p_cliente_id uuid,
  p_senha text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_tipo text;
begin
  -- Validar que quem chama eh interno
  select tipo into v_tipo from public.usuarios where id = auth.uid();
  if v_tipo is null or v_tipo <> 'interno' then
    raise exception 'Apenas usuarios internos podem definir senha MEU INSS';
  end if;

  v_key := current_setting('app.inss_key', true);
  if v_key is null or length(v_key) < 16 then
    raise exception 'Chave de criptografia nao configurada (app.inss_key)';
  end if;

  if p_senha is null or length(trim(p_senha)) = 0 then
    update public.clientes set senha_meu_inss = null where id = p_cliente_id;
  else
    update public.clientes
       set senha_meu_inss = pgp_sym_encrypt(p_senha, v_key)
     where id = p_cliente_id;
  end if;
end;
$$;

revoke all on function public.set_senha_meu_inss(uuid, text) from public;
grant execute on function public.set_senha_meu_inss(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_senha_meu_inss(cliente_id)
--   - Decripta e retorna a senha em texto.
--   - REGISTRA o acesso em acessos_senha_inss antes de retornar.
--   - Apenas usuarios internos podem chamar.
--   - Retorna NULL se nao houver senha cadastrada.
-- ---------------------------------------------------------------------------
create or replace function public.get_senha_meu_inss(
  p_cliente_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_tipo text;
  v_senha_bytea bytea;
begin
  select tipo into v_tipo from public.usuarios where id = auth.uid();
  if v_tipo is null or v_tipo <> 'interno' then
    raise exception 'Apenas usuarios internos podem ler senha MEU INSS';
  end if;

  v_key := current_setting('app.inss_key', true);
  if v_key is null or length(v_key) < 16 then
    raise exception 'Chave de criptografia nao configurada (app.inss_key)';
  end if;

  select senha_meu_inss into v_senha_bytea
    from public.clientes where id = p_cliente_id;

  if v_senha_bytea is null then
    return null;
  end if;

  -- Audita o acesso antes de retornar
  insert into public.acessos_senha_inss (cliente_id, usuario_id)
    values (p_cliente_id, auth.uid());

  return pgp_sym_decrypt(v_senha_bytea, v_key);
end;
$$;

revoke all on function public.get_senha_meu_inss(uuid) from public;
grant execute on function public.get_senha_meu_inss(uuid) to authenticated;

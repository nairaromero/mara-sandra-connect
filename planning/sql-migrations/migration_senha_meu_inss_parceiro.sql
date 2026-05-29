-- =============================================================================
-- Migration: estende set_senha_meu_inss para aceitar parceiro write-only.
--
-- Mudancas:
--   1) set_senha_meu_inss agora aceita:
--      - usuarios.tipo = 'interno' (qualquer cliente)
--      - usuarios.tipo = 'parceiro' (so se for parceiro_id de algum caso
--        do cliente). Garante ownership.
--      Audit log: registra acao = 'escrita' ou 'escrita_remocao'.
--
--   2) get_senha_meu_inss permanece interno-only.
--      Audit log: registra acao = 'leitura'.
--
--   3) Nova tem_senha_meu_inss(cliente_id) -> boolean.
--      Permite UI saber se cliente ja tem senha cadastrada SEM revelar a
--      senha em si. Mesmo controle de acesso de set_senha (interno OU
--      parceiro dono do caso).
--
-- Pre-requisito: migration_senha_meu_inss_encryption.sql ja aplicada.
--
-- Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- set_senha_meu_inss(cliente_id, senha) - agora aceita parceiro dono do caso
-- ---------------------------------------------------------------------------
create or replace function public.set_senha_meu_inss(
  p_cliente_id uuid,
  p_senha text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_tipo text;
  v_pode boolean;
begin
  select tipo into v_tipo from public.usuarios where id = auth.uid();

  if v_tipo = 'interno' then
    v_pode := true;
  elsif v_tipo = 'parceiro' then
    -- Parceiro precisa ser o parceiro_id de pelo menos um caso do cliente.
    -- Isso impede um parceiro escrever senha de cliente de outro parceiro.
    select exists (
      select 1 from public.casos c
      where c.cliente_id = p_cliente_id
        and c.parceiro_id = auth.uid()
    ) into v_pode;
  else
    v_pode := false;
  end if;

  if not coalesce(v_pode, false) then
    raise exception 'Sem permissao para definir senha MEU INSS deste cliente';
  end if;

  if p_senha is null or length(trim(p_senha)) = 0 then
    update public.clientes set senha_meu_inss = null where id = p_cliente_id;
    insert into public.acessos_senha_inss (cliente_id, usuario_id, acao)
      values (p_cliente_id, auth.uid(), 'escrita_remocao');
    return;
  end if;

  v_key := public._inss_get_key();

  update public.clientes
     set senha_meu_inss = pgp_sym_encrypt(p_senha, v_key)
   where id = p_cliente_id;

  insert into public.acessos_senha_inss (cliente_id, usuario_id, acao)
    values (p_cliente_id, auth.uid(), 'escrita');
end;
$$;

revoke all on function public.set_senha_meu_inss(uuid, text) from public;
grant execute on function public.set_senha_meu_inss(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_senha_meu_inss(cliente_id) - INTERNO ONLY (sem mudanca de permissao,
-- apenas explicita 'leitura' no audit log).
-- ---------------------------------------------------------------------------
create or replace function public.get_senha_meu_inss(
  p_cliente_id uuid
) returns text
language plpgsql
security definer
set search_path = public, extensions
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

  select senha_meu_inss into v_senha_bytea
    from public.clientes where id = p_cliente_id;

  if v_senha_bytea is null then
    return null;
  end if;

  v_key := public._inss_get_key();

  insert into public.acessos_senha_inss (cliente_id, usuario_id, acao)
    values (p_cliente_id, auth.uid(), 'leitura');

  return pgp_sym_decrypt(v_senha_bytea, v_key);
end;
$$;

revoke all on function public.get_senha_meu_inss(uuid) from public;
grant execute on function public.get_senha_meu_inss(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- tem_senha_meu_inss(cliente_id) - boolean check
--   - retorna true/false sem revelar a senha
--   - mesmo controle de acesso de set_senha (interno OU parceiro dono)
--   - retorna NULL se nao tem permissao (UI trata como false silenciosamente)
-- ---------------------------------------------------------------------------
create or replace function public.tem_senha_meu_inss(
  p_cliente_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_pode boolean;
  v_tem boolean;
begin
  select tipo into v_tipo from public.usuarios where id = auth.uid();
  if v_tipo = 'interno' then
    v_pode := true;
  elsif v_tipo = 'parceiro' then
    select exists (
      select 1 from public.casos c
      where c.cliente_id = p_cliente_id and c.parceiro_id = auth.uid()
    ) into v_pode;
  else
    v_pode := false;
  end if;

  if not coalesce(v_pode, false) then
    return null;
  end if;

  select senha_meu_inss is not null into v_tem
    from public.clientes where id = p_cliente_id;
  return coalesce(v_tem, false);
end;
$$;

revoke all on function public.tem_senha_meu_inss(uuid) from public;
grant execute on function public.tem_senha_meu_inss(uuid) to authenticated;

-- Parceiro vinculado ao caso pode LER a senha MEU INSS do cliente (olhinho
-- na UI). Antes era write-only pro parceiro. Leitura continua registrada em
-- acessos_senha_inss (audit LGPD), agora com quem leu sendo interno OU o
-- parceiro dono do caso.
--
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_senha_meu_inss(p_cliente_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_key text;
  v_tipo text;
  v_autorizado boolean;
  v_senha_bytea bytea;
begin
  select tipo into v_tipo from public.usuarios where id = auth.uid();

  -- Interno sempre pode; parceiro so se tiver caso vinculado a esse cliente.
  v_autorizado := (v_tipo = 'interno');
  if not v_autorizado and v_tipo = 'parceiro' then
    select exists (
      select 1 from public.casos
       where cliente_id = p_cliente_id
         and parceiro_id = auth.uid()
    ) into v_autorizado;
  end if;

  if not coalesce(v_autorizado, false) then
    raise exception 'Sem permissao para ler a senha MEU INSS deste cliente';
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
$function$;

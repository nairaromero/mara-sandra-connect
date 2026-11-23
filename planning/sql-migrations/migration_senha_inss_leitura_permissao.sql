-- Revisão RBAC (23/11): a LEITURA da senha do Meu INSS passa a cobrar a mesma
-- régua da ESCRITA (senha_inss:ler) para o interno.
--
-- Gap: `set_senha_meu_inss` já exigia `private.tem_permissao('senha_inss:ler')`
-- no ramo interno ("ver e trocar são a mesma régua"), mas `get_senha_meu_inss` e
-- `tem_senha_meu_inss` davam `v_tipo = 'interno'` como autorização bastante — a
-- tela escondia a senha de quem não tem a permissão (ex.: financeiro), mas a RPC
-- direta entregava a credencial do portal do governo a qualquer interno. É o
-- padrão "classe inversa": a tela era o único freio.
--
-- Hoje ninguém é afetado (todo interno ativo tem a permissão por padrão de papel),
-- então é defesa em profundidade — a porta que abriria no dia em que um financeiro
-- fosse ativado ou a permissão fosse revogada de alguém.
--
-- Partido do `pg_get_functiondef` da produção; muda SÓ a linha de autorização do
-- interno nas duas leituras. O ramo do parceiro (túnel
-- `private.parceiro_pode_senha_meu_inss`) fica igual. CREATE OR REPLACE = idempotente.

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
  perform private.exigir_no_escritorio('public.clientes', p_cliente_id);
  v_tipo := private.meu_tipo();

  -- Ver a senha cobra a mesma régua que trocá-la (senha_inss:ler), como no set.
  -- Parceiro só com vínculo ativo, aceite em dia e caso do cliente.
  v_autorizado := (v_tipo = 'interno' and private.tem_permissao('senha_inss:ler'));
  if not v_autorizado and v_tipo = 'parceiro' then
    v_autorizado := private.parceiro_pode_senha_meu_inss(p_cliente_id);
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

CREATE OR REPLACE FUNCTION public.tem_senha_meu_inss(p_cliente_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo text;
  v_pode boolean;
  v_tem boolean;
begin
  perform private.exigir_no_escritorio('public.clientes', p_cliente_id);
  v_tipo := private.meu_tipo();
  if v_tipo = 'interno' then
    -- mesma régua da leitura/escrita da senha (senha_inss:ler)
    v_pode := private.tem_permissao('senha_inss:ler');
  elsif v_tipo = 'parceiro' then
    v_pode := private.parceiro_pode_senha_meu_inss(p_cliente_id);
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
$function$;

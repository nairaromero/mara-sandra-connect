-- ============================================================================
-- Senha do Meu INSS: o parceiro só acessa com vínculo ativo e aceite em dia
-- (revisão de 23/11/2026)
--
-- As três RPCs da senha (get/tem/set) autorizavam o parceiro SÓ por "ser o
-- parceiro_id de um caso do cliente". Não conferiam se o parceiro está ativo
-- nem se aceitou os termos vigentes. A regra "parceiro sem aceite não recebe
-- dado de cliente" só valia na saída (e-mail/WhatsApp) e, na tela, por um
-- redirecionamento no navegador — guarda mole, que não fecha a RPC. Resultado:
-- um parceiro desligado com sessão ainda válida, ou que nunca aceitou os
-- termos, dono do caso, lia (ou gravava) a senha do portal do governo do
-- cliente. O lote "copiar CPF e senha" (#532) transformou isso num clique.
--
-- Fonte única: um túnel `private.parceiro_pode_senha_meu_inss` decide, e as três
-- funções passam a chamá-lo no ramo do parceiro — nenhuma repete a regra.
--
-- Limite conhecido: a VERSÃO exata dos termos vive na constante TS
-- (_shared/termos.ts, `TERMOS_VERSAO`); o servidor nunca a teve
-- (`registrar_aceite_termos` recebe a versão do cliente). Aqui dá para exigir
-- que haja ALGUM aceite (onboarded + versão registrada), não a versão de hoje.
-- Parceiro uma versão atrás dos termos ainda passaria — a paridade exata com a
-- trava de e-mail pede uma fonte SQL da versão vigente (decisão à parte).
--
-- As três funções são reescritas a PARTIR da definição viva de produção
-- (pg_get_functiondef em 23/11), só trocando o ramo do parceiro.
-- Idempotente (create or replace).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Túnel: o parceiro pode mexer na senha do Meu INSS deste cliente?
-- ---------------------------------------------------------------------------
create or replace function private.parceiro_pode_senha_meu_inss(p_cliente_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.casos c
     where c.cliente_id = p_cliente_id and c.parceiro_id = auth.uid()
  )
  and exists (
    select 1 from public.usuarios u
     where u.id = auth.uid()
       and u.ativo is true
       and u.onboarded_em is not null
       and u.termos_versao is not null
  );
$function$;

revoke all on function private.parceiro_pode_senha_meu_inss(uuid) from public, anon;
-- só os definers (postgres) chamam por dentro; authenticated nunca chama direto
grant execute on function private.parceiro_pode_senha_meu_inss(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- get: ler a senha
-- ---------------------------------------------------------------------------
create or replace function public.get_senha_meu_inss(p_cliente_id uuid)
returns text
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_key text;
  v_tipo text;
  v_autorizado boolean;
  v_senha_bytea bytea;
begin
  perform private.exigir_no_escritorio('public.clientes', p_cliente_id);
  v_tipo := private.meu_tipo();

  -- Interno sempre pode; parceiro só com vínculo ativo, aceite em dia e caso do cliente.
  v_autorizado := (v_tipo = 'interno');
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

-- ---------------------------------------------------------------------------
-- tem: existe senha? (só booleano, mesma régua de acesso)
-- ---------------------------------------------------------------------------
create or replace function public.tem_senha_meu_inss(p_cliente_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_tipo text;
  v_pode boolean;
  v_tem boolean;
begin
  perform private.exigir_no_escritorio('public.clientes', p_cliente_id);
  v_tipo := private.meu_tipo();
  if v_tipo = 'interno' then
    v_pode := true;
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

-- ---------------------------------------------------------------------------
-- set: gravar/remover a senha
-- ---------------------------------------------------------------------------
create or replace function public.set_senha_meu_inss(p_cliente_id uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_key text;
  v_tipo text;
  v_pode boolean;
begin
  perform private.exigir_no_escritorio('public.clientes', p_cliente_id);
  v_tipo := private.meu_tipo();

  if v_tipo = 'interno' then
    -- ver a senha e trocar a senha são a mesma régua (senha_inss:ler)
    v_pode := private.tem_permissao('senha_inss:ler');
  elsif v_tipo = 'parceiro' then
    v_pode := private.parceiro_pode_senha_meu_inss(p_cliente_id);
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

  -- Pedido de troca aberto pela equipe (card #305): o parceiro trocar a
  -- senha — pelo pedido ou pelo botão "Alterar" — já é o cumprimento.
  if v_tipo = 'parceiro' then
    perform public._cumprir_pedidos_senha_meu_inss(p_cliente_id, auth.uid());
  end if;
end;
$function$;

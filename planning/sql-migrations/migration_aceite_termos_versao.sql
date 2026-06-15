-- Re-aceite por versão: guarda a versão de termos aceita no próprio usuário,
-- para o gate de onboarding exigir novo aceite quando a versão mudar.

alter table public.usuarios add column if not exists termos_versao text;

-- RPC atualizada: passa a gravar usuarios.termos_versao = p_versao.
create or replace function public.registrar_aceite_termos(
  p_versao          text,
  p_dados           jsonb,
  p_documentos      jsonb,
  p_nome_assinatura text,
  p_user_agent      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ip  text;
  v_id  uuid;
  v_headers json;
begin
  if v_uid is null then
    raise exception 'nao autenticado';
  end if;
  if coalesce(trim(p_nome_assinatura), '') = '' then
    raise exception 'assinatura (nome) obrigatoria';
  end if;

  begin
    v_headers := current_setting('request.headers', true)::json;
    v_ip := split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1);
    if coalesce(v_ip, '') = '' then
      v_ip := v_headers ->> 'cf-connecting-ip';
    end if;
  exception when others then
    v_ip := null;
  end;

  insert into public.aceites_termos
    (usuario_id, versao, documentos, dados_preenchidos, nome_assinatura, ip, user_agent)
  values
    (v_uid, p_versao, p_documentos, p_dados, trim(p_nome_assinatura), nullif(v_ip, ''), p_user_agent)
  returning id into v_id;

  update public.usuarios set
    nome              = coalesce(nullif(p_dados->>'nome', ''), nome),
    documento         = coalesce(nullif(p_dados->>'documento', ''), documento),
    oab               = coalesce(nullif(p_dados->>'oab', ''), oab),
    oab_uf            = coalesce(nullif(p_dados->>'oab_uf', ''), oab_uf),
    endereco          = coalesce(nullif(p_dados->>'endereco', ''), endereco),
    termos_versao     = p_versao,
    aceitou_termos_em = now(),
    onboarded_em      = coalesce(onboarded_em, now()),
    updated_at        = now()
  where id = v_uid;

  return v_id;
end;
$$;

grant execute on function public.registrar_aceite_termos(text, jsonb, jsonb, text, text) to authenticated;

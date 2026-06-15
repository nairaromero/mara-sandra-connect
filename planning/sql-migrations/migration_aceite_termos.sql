-- Aceite eletrônico de termos pelo parceiro no primeiro acesso.
--
-- - Campos cadastrais do parceiro (autodeclarados na assinatura).
-- - Registro imutável do aceite (versão, documentos+hash, dados, IP, UA, data).
-- - RPC que grava o aceite (IP via cabeçalho PostgREST) e atualiza o cadastro.

-- 1) Dados cadastrais do parceiro (preenchidos por ele no aceite).
alter table public.usuarios add column if not exists documento text;
alter table public.usuarios add column if not exists oab_uf   text;
alter table public.usuarios add column if not exists endereco text;

-- 2) Registro de aceite (imutável — só INSERT via RPC).
create table if not exists public.aceites_termos (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid references public.usuarios(id) on delete set null,
  versao            text not null,
  documentos        jsonb not null,        -- [{id,titulo,hash}]
  dados_preenchidos jsonb not null,        -- snapshot dos dados do parceiro
  nome_assinatura   text not null,
  ip                text,
  user_agent        text,
  assinado_em       timestamptz not null default now()
);

create index if not exists idx_aceites_termos_usuario on public.aceites_termos(usuario_id);
create index if not exists idx_aceites_termos_assinado on public.aceites_termos(assinado_em desc);

alter table public.aceites_termos enable row level security;

-- Interno lê todos; parceiro lê os próprios. Ninguém insere direto (só via RPC).
drop policy if exists aceites_termos_select on public.aceites_termos;
create policy aceites_termos_select on public.aceites_termos
  for select to public
  using (public.is_interno() or usuario_id = auth.uid());

grant select on public.aceites_termos to authenticated;

-- 3) RPC: grava o aceite e atualiza o cadastro do próprio usuário.
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

  -- IP do cabeçalho (PostgREST expõe request.headers).
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
    aceitou_termos_em = now(),
    onboarded_em      = coalesce(onboarded_em, now()),
    updated_at        = now()
  where id = v_uid;

  return v_id;
end;
$$;

grant execute on function public.registrar_aceite_termos(text, jsonb, jsonb, text, text) to authenticated;

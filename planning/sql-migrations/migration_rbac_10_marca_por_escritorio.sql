-- ============================================================================
-- RBAC 10 · Marca por escritório (2026-09-23)
--
-- O topo do sistema, os e-mails e as mensagens passam a usar a marca DO
-- ESCRITÓRIO (nome de exibição, logo, cor), não mais a do escritório 1 fixa
-- no código. A marca do PRODUTO (Legal Connect) fica onde ninguém sabe o
-- escritório: login, favicon, QG, rodapé.
--   - escritorio_config.marca = { nome_exibicao, logo_url, cor } (já existia
--     a coluna; aqui o contrato, a RPC que grava e o seed do escritório 1);
--   - bucket público `marcas`: <escritorio_id>/logo.<ext>; só quem configura
--     o escritório grava, e só no caminho do escritório ativo;
--   - meus_vinculos() e meus_acessos_suporte() passam a devolver a marca
--     (assinatura muda: drop + create).
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket público das marcas + policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('marcas', 'marcas', true)
on conflict (id) do update set public = true;

drop policy if exists marcas_ler on storage.objects;
create policy marcas_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'marcas');

drop policy if exists marcas_gravar on storage.objects;
create policy marcas_gravar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marcas'
              and (storage.foldername(name))[1] = (select private.escritorio_ativo())::text
              and (select private.tem_permissao('escritorio:configurar', null)));

drop policy if exists marcas_atualizar on storage.objects;
create policy marcas_atualizar on storage.objects
  for update to authenticated
  using (bucket_id = 'marcas'
         and (storage.foldername(name))[1] = (select private.escritorio_ativo())::text
         and (select private.tem_permissao('escritorio:configurar', null)))
  with check (bucket_id = 'marcas'
              and (storage.foldername(name))[1] = (select private.escritorio_ativo())::text);

drop policy if exists marcas_apagar on storage.objects;
create policy marcas_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'marcas'
         and (storage.foldername(name))[1] = (select private.escritorio_ativo())::text
         and (select private.tem_permissao('escritorio:configurar', null)));

-- ---------------------------------------------------------------------------
-- 2. RPC que grava a marca (merge no jsonb; '' limpa a cor; p_limpar_logo tira o logo)
-- ---------------------------------------------------------------------------
create or replace function public.escritorio_definir_marca(
  p_nome_exibicao text default null, p_logo_url text default null, p_cor text default null,
  p_limpar_logo boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_esc uuid := private.escritorio_ativo();
  v_marca jsonb;
  -- array_append, nao `||`: com literal de texto o Postgres tentaria ler um array
  v_campos text[] := '{}';
begin
  if v_esc is null or not private.tem_permissao('escritorio:configurar', null) then
    raise exception 'só quem configura o escritório altera a marca' using errcode = '42501';
  end if;
  if p_nome_exibicao is not null and length(btrim(p_nome_exibicao)) > 80 then
    raise exception 'nome de exibição: no máximo 80 caracteres';
  end if;
  if p_cor is not null and p_cor <> '' and p_cor !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'cor inválida: use o formato #RRGGBB';
  end if;
  if p_logo_url is not null and (length(p_logo_url) > 500 or p_logo_url !~ '^(https?://|/)') then
    raise exception 'logo: informe uma URL (https://…) ou um caminho do site (/…)';
  end if;

  insert into public.escritorio_config (escritorio_id) values (v_esc) on conflict (escritorio_id) do nothing;
  select coalesce(c.marca, '{}'::jsonb) into v_marca from public.escritorio_config c where c.escritorio_id = v_esc;

  if p_nome_exibicao is not null then
    v_marca := v_marca || jsonb_build_object('nome_exibicao', nullif(btrim(p_nome_exibicao), ''));
    v_campos := array_append(v_campos, 'nome_exibicao');
  end if;
  if p_limpar_logo then
    v_marca := v_marca - 'logo_url';
    v_campos := array_append(v_campos, 'logo_url');
  elsif p_logo_url is not null then
    v_marca := v_marca || jsonb_build_object('logo_url', p_logo_url);
    v_campos := array_append(v_campos, 'logo_url');
  end if;
  if p_cor = '' then
    v_marca := v_marca - 'cor';
    v_campos := array_append(v_campos, 'cor');
  elsif p_cor is not null then
    v_marca := v_marca || jsonb_build_object('cor', lower(p_cor));
    v_campos := array_append(v_campos, 'cor');
  end if;
  v_marca := jsonb_strip_nulls(v_marca);

  update public.escritorio_config set marca = v_marca, updated_at = now() where escritorio_id = v_esc;
  perform private.auditar(v_esc, 'membro', 'escritorio.marca', 'escritorio_config', v_esc::text,
                          jsonb_build_object('campos', to_jsonb(v_campos)));
  return v_marca;
end;
$$;
revoke execute on function public.escritorio_definir_marca(text, text, text, boolean) from public, anon;
grant execute on function public.escritorio_definir_marca(text, text, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Vínculos devolvem a marca
-- ---------------------------------------------------------------------------
drop function if exists public.meus_vinculos();
create or replace function public.meus_vinculos()
returns table (escritorio_id uuid, escritorio_nome text, escritorio_slug text,
               escritorio_status text, membro_status text, papel text, papel_nome text,
               tipo_acesso text, ativo_agora boolean, marca jsonb)
language sql stable security definer set search_path = '' as $$
  select e.id, e.nome, e.slug, e.status, m.status, p.chave, p.nome, p.tipo_acesso,
         e.id = (select private.escritorio_ativo()),
         coalesce(c.marca, '{}'::jsonb)
    from public.membros m
    join public.escritorios e on e.id = m.escritorio_id
    join public.papeis p on p.id = m.papel_id
    left join public.escritorio_config c on c.escritorio_id = e.id
   where m.usuario_id = (select auth.uid())
     and m.status <> 'desativado'
     and e.status <> 'encerrado'
   order by e.nome
$$;
revoke execute on function public.meus_vinculos() from public, anon;
grant execute on function public.meus_vinculos() to authenticated, service_role;

drop function if exists public.meus_acessos_suporte();
create or replace function public.meus_acessos_suporte()
returns table (acesso_id uuid, escritorio_id uuid, escritorio_nome text, fim timestamptz, marca jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.escritorio_id, e.nome, a.fim, coalesce(c.marca, '{}'::jsonb)
    from public.acessos_suporte a
    join public.escritorios e on e.id = a.escritorio_id
    left join public.escritorio_config c on c.escritorio_id = e.id
   where a.staff_id = (select auth.uid())
     and a.status = 'aprovado' and now() >= a.inicio and now() < a.fim
$$;
revoke execute on function public.meus_acessos_suporte() from public, anon;
grant execute on function public.meus_acessos_suporte() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Escritório 1: a marca que sempre esteve fixa no código
-- ---------------------------------------------------------------------------
insert into public.escritorio_config (escritorio_id)
select private.escritorio_padrao() where private.escritorio_padrao() is not null
on conflict (escritorio_id) do nothing;

update public.escritorio_config
   set marca = '{"nome_exibicao": "Mara Sandra Vian Advocacia", "logo_url": "/logo.png"}'::jsonb
 where escritorio_id = private.escritorio_padrao()
   and (marca is null or marca = '{}'::jsonb);

notify pgrst, 'reload schema';

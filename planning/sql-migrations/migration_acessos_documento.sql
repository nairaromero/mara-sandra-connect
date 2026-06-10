-- Audit log de acesso a documentos (LGPD Art. 37 — registro de operações de
-- tratamento). Toda visualização/download de documento passa a ser registrada.
--
-- Não confundir com acessos_senha_inss (já existente) — aquele é só p/ a senha
-- do MEU INSS. Este cobre os documentos do Storage.

create table if not exists public.acessos_documento (
  id          uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos(id) on delete cascade,
  caso_id     uuid,
  usuario_id  uuid,
  acao        text not null,           -- 'visualizacao' | 'download'
  created_at  timestamptz not null default now()
);

create index if not exists idx_acessos_documento_documento
  on public.acessos_documento(documento_id);
create index if not exists idx_acessos_documento_caso
  on public.acessos_documento(caso_id);
create index if not exists idx_acessos_documento_created
  on public.acessos_documento(created_at desc);

alter table public.acessos_documento enable row level security;

-- Só interno lê o log. Ninguém insere direto (só via RPC SECURITY DEFINER).
drop policy if exists acessos_documento_select_interno on public.acessos_documento;
create policy acessos_documento_select_interno on public.acessos_documento
  for select to public using (public.is_interno());

grant select on public.acessos_documento to authenticated;

-- Registra um acesso. SECURITY DEFINER pra furar a RLS de INSERT, mas grava
-- sempre o auth.uid() do chamador (não dá pra forjar usuario_id).
create or replace function public.log_acesso_documento(
  p_documento_id uuid,
  p_acao text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caso_id uuid;
begin
  select caso_id into v_caso_id from public.documentos where id = p_documento_id;
  if v_caso_id is null then
    return; -- documento inexistente: ignora silenciosamente
  end if;
  insert into public.acessos_documento (documento_id, caso_id, usuario_id, acao)
  values (
    p_documento_id,
    v_caso_id,
    auth.uid(),
    coalesce(nullif(p_acao, ''), 'visualizacao')
  );
end;
$$;

grant execute on function public.log_acesso_documento(uuid, text) to authenticated;

-- migration_usuarios_guard_privilegios.sql
--
-- Fecha a auto-promoção: hoje um parceiro logado vira interno/admin com um
-- PATCH na própria linha de public.usuarios.
--
-- Por que passava (conferido no catálogo de produção em 2026-09-19):
--   * `usuarios_update_self` é UPDATE USING ((id = auth.uid()) OR is_interno())
--     e **não tem WITH CHECK** — sem WITH CHECK explícito o Postgres reusa o
--     USING, que continua verdadeiro depois da troca, porque a linha continua
--     sendo a da própria pessoa;
--   * `authenticated` tem UPDATE **de tabela**, ou seja, em todas as 22 colunas,
--     incluindo tipo, eh_admin, eh_parceiro, ativo e percentual_parceiro;
--   * o único gatilho da tabela é o de updated_at.
-- Resultado: `PATCH /usuarios?id=eq.<self> {tipo:'interno', eh_admin:true}`
-- devolvia 200 e a pessoa passava a enxergar todos os clientes, laudos e
-- senhas do MEU INSS. Reproduzido no ambiente local com conta descartável.
--
-- Duas camadas, porque uma sozinha é frágil:
--   1. GRANT por coluna — `authenticated` só escreve as colunas de perfil que
--      as telas realmente editam (Configurações: nome, oab, telefone;
--      Boas-vindas: onboarded_em, aceitou_termos_em). Qualquer outra coluna
--      passa a ser "permission denied for table usuarios".
--   2. Gatilho de guarda — mesmo que um GRANT volte a abrir a tabela no
--      futuro, mudança de coluna de privilégio só passa vinda de papel
--      privilegiado (postgres/service_role, o que cobre as 7 funções
--      SECURITY DEFINER que escrevem em usuarios e as edge functions) ou de
--      quem é admin.
--
-- O gatilho também cobre INSERT: `usuarios_insert_interno` aceita
-- `id = auth.uid()` sem restringir tipo, então a mesma escalada existiria em
-- qualquer ambiente com signup aberto (é o caso do staging hoje).
--
-- Idempotente. Não altera dado nenhum.

-- ---------------------------------------------------------------------------
-- 1. Guarda de privilégio
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER de propósito (é o padrão; está explícito para não se
-- perder numa reescrita futura). Dentro de uma função SECURITY DEFINER,
-- `current_user` é sempre o DONO da função — seria 'postgres' para todo
-- mundo, e a guarda deixaria a promoção passar. Com INVOKER, `current_user`
-- é o papel real da requisição: 'authenticated', 'anon' ou 'service_role'.
-- Conferido no ambiente local: com SECURITY DEFINER o ataque passava mesmo
-- com o gatilho instalado.
create or replace function public.tg_usuarios_guard_privilegios()
returns trigger
language plpgsql
security invoker
set search_path = public, auth, pg_temp
as $$
declare
  v_privilegiado boolean := current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin');
begin
  -- Papel privilegiado (service_role das edge functions, SECURITY DEFINER das
  -- RPCs de equipe, restore do espelho) e admin do escritório passam direto.
  if v_privilegiado or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.tipo = 'interno'
       or coalesce(new.eh_admin, false)
       or coalesce(new.eh_parceiro, false) then
      raise exception 'permissão negada: criar usuário interno, admin ou parceiro comercial exige admin'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id            is distinct from old.id
     or new.email      is distinct from old.email
     or new.tipo       is distinct from old.tipo
     or coalesce(new.eh_admin, false)    is distinct from coalesce(old.eh_admin, false)
     or coalesce(new.eh_parceiro, false) is distinct from coalesce(old.eh_parceiro, false)
     or coalesce(new.ativo, true)        is distinct from coalesce(old.ativo, true)
     or new.percentual_parceiro is distinct from old.percentual_parceiro
     or new.desligado_em  is distinct from old.desligado_em
     or new.desligado_por is distinct from old.desligado_por
     or new.senha_definida_em is distinct from old.senha_definida_em then
    raise exception 'permissão negada: alterar identidade ou privilégio de usuário exige admin'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.tg_usuarios_guard_privilegios() is
  'Congela identidade e privilégio em public.usuarios para quem não é admin nem papel privilegiado. Ver trg_usuarios_guard_privilegios.';

drop trigger if exists trg_usuarios_guard_privilegios on public.usuarios;
create trigger trg_usuarios_guard_privilegios
  before insert or update on public.usuarios
  for each row
  execute function public.tg_usuarios_guard_privilegios();

-- ---------------------------------------------------------------------------
-- 2. GRANT por coluna: authenticated escreve só o perfil
-- ---------------------------------------------------------------------------
-- As telas que escrevem em usuarios com a sessão da pessoa:
--   src/routes/_authenticated/configuracoes.tsx  → nome, oab, telefone
--   src/routes/_authenticated/boas-vindas.tsx    → onboarded_em, aceitou_termos_em
-- Todo o resto (equipe, parceiro, termos, senha) passa por RPC SECURITY
-- DEFINER ou por edge function com service_role, que não dependem deste grant.
revoke update on public.usuarios from authenticated;
grant update (nome, oab, telefone, onboarded_em, aceitou_termos_em)
  on public.usuarios to authenticated;

-- `anon` nunca escreveu nesta tabela; deixa explícito.
revoke insert, update, delete on public.usuarios from anon;

-- ---------------------------------------------------------------------------
-- 3. WITH CHECK explícito nas policies de usuarios
-- ---------------------------------------------------------------------------
-- Não é o que segura a escalada (a linha continua sendo a da própria pessoa),
-- mas tira a dependência do fallback silencioso "WITH CHECK herda o USING" e
-- impede que um UPDATE mova a linha para fora do alcance de quem edita.
alter policy usuarios_update_self on public.usuarios
  using ((id = auth.uid()) or is_interno())
  with check ((id = auth.uid()) or is_interno());

-- Conferência
select
  (select count(*) from pg_trigger where tgname = 'trg_usuarios_guard_privilegios' and tgenabled = 'O') as gatilho_ativo,
  (select string_agg(column_name, ', ' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'usuarios'
      and grantee = 'authenticated' and privilege_type = 'UPDATE') as colunas_editaveis,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'usuarios'
      and grantee = 'authenticated' and privilege_type = 'UPDATE') as update_de_tabela,
  (select with_check is not null from pg_policies
    where schemaname = 'public' and tablename = 'usuarios' and policyname = 'usuarios_update_self') as policy_com_check;

-- =============================================================================
-- Migration: permitir que qualquer usuario autenticado leia as linhas de
-- usuarios INTERNOS (equipe do escritorio).
--
-- Motivo: o parceiro so podia ler a propria linha em `usuarios`
-- (policy usuarios_self_or_interno). Por isso, ao ver um COMENTARIO feito por
-- um interno, o join autor:autor_id(...) voltava NULL -> aparecia "(sem nome)"
-- e badge "?". Internos sao a equipe do escritorio; nome/tipo nao sao
-- sensiveis para o parceiro (que se comunica com a firma).
--
-- RLS combina policies por OR; adicionamos uma policy permissive nova sem
-- dropar as existentes. Parceiros continuam SEM ver outros parceiros.
-- Idempotente.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'usuarios'
      and policyname = 'usuarios_select_internos'
  ) then
    create policy "usuarios_select_internos"
    on public.usuarios
    as permissive
    for select
    to authenticated
    using (tipo = 'interno');
  end if;
end$$;

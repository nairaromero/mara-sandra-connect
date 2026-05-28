-- =============================================================================
-- Migration: Permitir parceiro ler processos (admin e judicial) dos casos dele.
--
-- Causa: a UI da visao do parceiro carrega processos_judiciais/processos_admin
-- pra renderizar os cards "Andamentos Administrativos" e "Andamentos Judiciais".
-- Sem SELECT permitido, esses arrays ficam vazios no estado e os cards/andamentos
-- relacionados nao renderizam pro parceiro, mesmo os andamentos tendo
-- visivel_parceiro=true.
--
-- A funcao caso_do_parceiro(caso_id) ja existe e checa se o caso pertence ao
-- parceiro logado (caso.parceiro_id = auth.uid()).
--
-- Idempotente: pode rodar varias vezes.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'processos_judiciais'
      and policyname = 'processos_judiciais_parceiro_select'
  ) then
    create policy "processos_judiciais_parceiro_select"
    on public.processos_judiciais
    as permissive
    for select
    to authenticated
    using (public.caso_do_parceiro(caso_id));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'processos_admin'
      and policyname = 'processos_admin_parceiro_select'
  ) then
    create policy "processos_admin_parceiro_select"
    on public.processos_admin
    as permissive
    for select
    to authenticated
    using (public.caso_do_parceiro(caso_id));
  end if;
end$$;

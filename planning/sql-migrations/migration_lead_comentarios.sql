-- ============================================================================
-- CRM Comercial — histórico de comentários por lead (substitui o campo único
-- `observacoes` na UI). Aplicada em 2026-07-13 (projeto llugytkdsfsrciavhrfw).
--
-- Todo interno comenta e lê (RLS is_interno). Vira o histórico da negociação
-- que acompanha o lead até o handoff. `autor_id` nullable: notas migradas do
-- campo antigo não têm autor conhecido.
-- ============================================================================

create table if not exists public.lead_comentarios (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  autor_id uuid references public.usuarios(id) on delete set null,
  texto text not null check (char_length(texto) between 1 and 4000),
  criado_em timestamptz not null default now()
);

create index if not exists lead_comentarios_lead_idx
  on public.lead_comentarios (lead_id, criado_em);

alter table public.lead_comentarios enable row level security;

drop policy if exists lead_comentarios_interno_all on public.lead_comentarios;
create policy lead_comentarios_interno_all on public.lead_comentarios
  for all to authenticated
  using (public.is_interno())
  with check (public.is_interno());

-- Tabela criada via Management API não ganha grants default (gotcha conhecido).
revoke all on public.lead_comentarios from anon;
grant all on table public.lead_comentarios to service_role;
grant select, insert, update, delete on public.lead_comentarios to authenticated;

-- Migra observações antigas pro histórico (uma vez; sem autor).
insert into public.lead_comentarios (lead_id, texto, criado_em)
select l.id, l.observacoes, l.atualizado_em
from public.leads l
where l.observacoes is not null and char_length(l.observacoes) > 0
  and not exists (select 1 from public.lead_comentarios c where c.lead_id = l.id);

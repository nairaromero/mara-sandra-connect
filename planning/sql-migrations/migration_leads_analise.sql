-- ============================================================================
-- CRM Comercial — etapa Análise com responsável + retorno automático.
-- Aplicada em 2026-07-13 (projeto llugytkdsfsrciavhrfw).
--
-- Fluxo: ao mover pra "analise" o comercial escolhe a advogada; nasce uma
-- tarefa pra ela (metadata.lead_id). Quando a tarefa é concluída, o trigger
-- marca `analise_concluida_em` no lead e registra no histórico — o comercial
-- vê no kanban e decide a continuidade (kit previdenciário → handoff).
-- ============================================================================

-- Tarefas de lead não têm caso. O front já tipava caso_id como nullable
-- (CriarTarefaInput) e toda a UI é null-safe (t.caso?.cliente?.nome) — o
-- NOT NULL no banco era o desalinhado.
alter table public.tarefas alter column caso_id drop not null;

alter table public.leads
  add column if not exists analise_responsavel_id uuid references public.usuarios(id) on delete set null,
  add column if not exists analise_tarefa_id uuid references public.tarefas(id) on delete set null,
  add column if not exists analise_concluida_em timestamptz,
  add column if not exists kit_enviado_em timestamptz;

comment on column public.leads.analise_responsavel_id is 'Advogada(o) escolhida(o) pra fazer a análise do lead.';
comment on column public.leads.kit_enviado_em is 'Quando o kit previdenciário foi enviado pro cliente assinar (etapa fechamento).';

-- Tarefa de análise concluída → devolve o lead pro comercial.
create or replace function public.tg_lead_analise_concluida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  -- Só transição pra concluída, e só tarefas amarradas a lead.
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  v_lead_id := nullif(new.metadata->>'lead_id', '')::uuid;
  if v_lead_id is null then
    return new;
  end if;

  update public.leads
     set analise_concluida_em = now(), atualizado_em = now()
   where id = v_lead_id
     and analise_tarefa_id = new.id
     and analise_concluida_em is null;

  if found then
    insert into public.lead_comentarios (lead_id, autor_id, texto)
    values (v_lead_id, new.responsavel_id,
            'Análise concluída — devolvido pro comercial decidir a continuidade.');
  end if;

  return new;
exception when others then
  -- Falha do gancho nunca pode derrubar a conclusão da tarefa.
  raise warning 'tg_lead_analise_concluida: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_lead_analise_concluida on public.tarefas;
create trigger trg_lead_analise_concluida
  after update on public.tarefas
  for each row
  execute function public.tg_lead_analise_concluida();

-- =============================================================================
-- Migration: etiqueta do cliente acompanha o agendamento da perícia.
--
-- O ciclo já existia pela metade: a rotina diária troca
-- PERICIA_AGENDADA_INSS → AGUARDANDO_RESULTADO_DE_PERICIA depois que a
-- perícia acontece — mas ninguém APLICAVA a etiqueta no agendamento (era
-- manual/migração TI; a Naira notou o buraco em 2026-08-24).
--
-- Agora, criar evento de perícia:
--   - remove AGUARDANDO_AGENDAMENTO_DE_PERICIA (saiu da fila de espera);
--   - garante PERICIA_AGENDADA_INSS (ou PERICIA_AGENDADA_JUDICIAL quando o
--     evento é judicial — nome novo, par do INSS).
-- E a troca pós-perícia passa a reconhecer também a variante judicial.
--
-- Idempotente.
-- =============================================================================

create or replace function public.tg_etiqueta_pericia_agendada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente uuid;
  v_tags    jsonb;
  v_nome    text;
  v_nova    jsonb;
begin
  if new.tipo is distinct from 'pericia' then return new; end if;
  if new.caso_id is null then return new; end if;

  select c.cliente_id, cl.tags into v_cliente, v_tags
    from public.casos c join public.clientes cl on cl.id = c.cliente_id
   where c.id = new.caso_id;
  if v_cliente is null then return new; end if;
  v_tags := coalesce(v_tags, '[]'::jsonb);

  v_nome := case
    when new.processo_judicial_id is not null then 'PERICIA_AGENDADA_JUDICIAL'
    when new.titulo ~* 'judicial' then 'PERICIA_AGENDADA_JUDICIAL'
    else 'PERICIA_AGENDADA_INSS' end;

  -- Ja tem a etiqueta de agendada? Nada a fazer (so tira a de espera).
  -- Cor/id: clona de qualquer cliente que ja use o nome; senao, so o nome.
  if not exists (
    select 1 from jsonb_array_elements(v_tags) tag where tag->>'name' = v_nome
  ) then
    select to_jsonb(t) into v_nova
      from (
        select tag->>'id' as id, tag->>'name' as name, tag->>'color' as color
          from public.clientes c
          cross join lateral jsonb_array_elements(c.tags) as tag
         where tag->>'name' = v_nome
         limit 1
      ) t;
    if v_nova is null then
      v_nova := jsonb_build_object('name', v_nome);
    end if;
  else
    v_nova := null;
  end if;

  update public.clientes
     set tags = (
       select coalesce(jsonb_agg(tag), '[]'::jsonb)
         from jsonb_array_elements(v_tags) as tag
        where tag->>'name' <> 'AGUARDANDO_AGENDAMENTO_DE_PERICIA'
     ) || case when v_nova is null then '[]'::jsonb
               else jsonb_build_array(v_nova) end
   where id = v_cliente;

  return new;
exception when others then
  raise warning 'tg_etiqueta_pericia_agendada falhou (evento %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$$;

drop trigger if exists trg_etiqueta_pericia_agendada on public.agenda_eventos;
create trigger trg_etiqueta_pericia_agendada
  after insert on public.agenda_eventos
  for each row execute function public.tg_etiqueta_pericia_agendada();

-- Troca pós-perícia reconhece a variante judicial.
create or replace function public.trocar_etiqueta_pos_pericia()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      record;
  v_nova jsonb;
  v_n    int := 0;
begin
  select to_jsonb(t) into v_nova
    from (
      select tag->>'id' as id, tag->>'name' as name, tag->>'color' as color
        from public.clientes c
        cross join lateral jsonb_array_elements(c.tags) as tag
       where tag->>'name' = 'AGUARDANDO_RESULTADO_DE_PERICIA'
       limit 1
    ) t;
  if v_nova is null then
    v_nova := jsonb_build_object('name', 'AGUARDANDO_RESULTADO_DE_PERICIA');
  end if;

  for r in
    select distinct c.id as cliente_id, c.tags
      from public.agenda_eventos e
      join public.casos k    on k.id = e.caso_id
      join public.clientes c on c.id = k.cliente_id
     where e.tipo = 'pericia'
       and e.start_at < now()
       and e.start_at > now() - interval '120 days'
       and exists (
         select 1 from jsonb_array_elements(c.tags) as tag
          where tag->>'name' in
            ('PERICIA_AGENDADA', 'PERICIA_AGENDADA_INSS', 'PERICIA_AGENDADA_JUDICIAL')
       )
  loop
    update public.clientes
       set tags = (
         select coalesce(jsonb_agg(tag), '[]'::jsonb) ||
                case when exists (
                  select 1 from jsonb_array_elements(r.tags) as t2
                   where t2->>'name' = 'AGUARDANDO_RESULTADO_DE_PERICIA'
                ) then '[]'::jsonb else jsonb_build_array(v_nova) end
           from jsonb_array_elements(r.tags) as tag
          where tag->>'name' not in
            ('PERICIA_AGENDADA', 'PERICIA_AGENDADA_INSS', 'PERICIA_AGENDADA_JUDICIAL')
       )
     where id = r.cliente_id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

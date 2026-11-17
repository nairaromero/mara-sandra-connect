-- =============================================================================
-- Migration: etiquetas com UMA fonte de verdade (etiquetas + clientes_etiquetas).
--
-- Bug (visto em produção, 2026-11-09): as rotinas de perícia escreviam no
-- clientes.tags (JSON legado do TI), e o trigger espelhador
-- clientes_sync_tags_para_etiquetas "limpava" os vínculos de origem TI que não
-- estavam no JSON. Como a tela grava só em clientes_etiquetas desde 2026-06-17,
-- o JSON vivia desfalcado — agendar ou concluir perícia apagava as etiquetas
-- postas pela tela (STATUS:ATIVO, benefício, parceria...). 6 clientes afetados
-- foram restaurados à mão em 2026-11-09.
--
-- Daqui em diante:
--   1. private.garantir_etiqueta_cliente(cliente, nome, cor) é o túnel único
--      de "garante a etiqueta e vincula" (escritório herdado do cliente).
--   2. tg_etiqueta_pericia_agendada e trocar_etiqueta_pos_pericia operam
--      direto em clientes_etiquetas, sem tocar no JSON.
--   3. O trigger espelhador morre (nada mais alimenta o JSON; a coluna
--      clientes.tags fica inerte até ser dropada num release futuro).
--
-- Idempotente.
-- =============================================================================

-- 1) Túnel: garante a etiqueta no escritório do cliente e o vínculo.
create or replace function private.garantir_etiqueta_cliente(
  p_cliente uuid,
  p_nome    text,
  p_cor     text default '#e3d0e5'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_escritorio uuid;
  v_etiq       uuid;
begin
  select escritorio_id into v_escritorio
    from public.clientes where id = p_cliente;
  if v_escritorio is null then return; end if;

  select id into v_etiq from public.etiquetas
   where escritorio_id = v_escritorio and nome = p_nome;

  if v_etiq is null then
    insert into public.etiquetas (nome, cor, escritorio_id)
    values (p_nome, p_cor, v_escritorio)
    on conflict (escritorio_id, nome) do nothing
    returning id into v_etiq;
    -- Corrida: outra transação criou entre o select e o insert.
    if v_etiq is null then
      select id into v_etiq from public.etiquetas
       where escritorio_id = v_escritorio and nome = p_nome;
    end if;
  end if;

  if v_etiq is null then return; end if;

  insert into public.clientes_etiquetas (cliente_id, etiqueta_id)
  values (p_cliente, v_etiq)
  on conflict do nothing;
end;
$$;

comment on function private.garantir_etiqueta_cliente(uuid, text, text) is
  'Túnel único para rotina de sistema aplicar etiqueta a cliente: garante a '
  'etiqueta no escritório do cliente e cria o vínculo. Nunca escrever em '
  'clientes.tags (JSON legado, aposentado em 2026-11).';

-- 2) Agendou perícia: sai AGUARDANDO_AGENDAMENTO, entra PERICIA_AGENDADA_*.
create or replace function public.tg_etiqueta_pericia_agendada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente uuid;
  v_nome    text;
begin
  if new.tipo is distinct from 'pericia' then return new; end if;
  if new.caso_id is null then return new; end if;

  select c.cliente_id into v_cliente
    from public.casos c where c.id = new.caso_id;
  if v_cliente is null then return new; end if;

  v_nome := case
    when new.processo_judicial_id is not null then 'PERICIA_AGENDADA_JUDICIAL'
    when new.titulo ~* 'judicial' then 'PERICIA_AGENDADA_JUDICIAL'
    else 'PERICIA_AGENDADA_INSS' end;

  delete from public.clientes_etiquetas ce
   using public.etiquetas et
   where et.id = ce.etiqueta_id
     and ce.cliente_id = v_cliente
     and et.nome = 'AGUARDANDO_AGENDAMENTO_DE_PERICIA';

  perform private.garantir_etiqueta_cliente(v_cliente, v_nome);

  return new;
exception when others then
  raise warning 'tg_etiqueta_pericia_agendada falhou (evento %): % / %',
    new.id, SQLSTATE, SQLERRM;
  return new;
end;
$$;

comment on function public.tg_etiqueta_pericia_agendada() is
  'Ao criar evento de perícia: tira AGUARDANDO_AGENDAMENTO_DE_PERICIA e aplica '
  'PERICIA_AGENDADA_INSS/JUDICIAL — direto em clientes_etiquetas (fonte única).';

-- 3) Perícia realizada (rotina diária): PERICIA_AGENDADA_* → AGUARDANDO_RESULTADO.
--    Só quando a ÚLTIMA perícia do cliente já passou: se há perícia nova
--    marcada (em qualquer caso dele, ainda não concluída), a etiqueta de
--    agendada continua. Antes bastava "alguma perícia passou nos últimos 120
--    dias" — no JSON isso nunca casava (estava desfalcado); lendo
--    clientes_etiquetas, o 1º run em produção trocaria 5 clientes, um deles com
--    perícia marcada (revisão do PR #515, 16/11).
create or replace function public.trocar_etiqueta_pos_pericia()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in
    select distinct cl.id as cliente_id
      from public.agenda_eventos e
      join public.casos k    on k.id = e.caso_id
      join public.clientes cl on cl.id = k.cliente_id
     where e.tipo = 'pericia'
       and e.start_at < now()
       and e.start_at > now() - interval '120 days'
       and exists (
         select 1
           from public.clientes_etiquetas ce
           join public.etiquetas et on et.id = ce.etiqueta_id
          where ce.cliente_id = cl.id
            and et.nome in
              ('PERICIA_AGENDADA', 'PERICIA_AGENDADA_INSS', 'PERICIA_AGENDADA_JUDICIAL')
       )
       and not exists (
         select 1
           from public.agenda_eventos f
           join public.casos k2 on k2.id = f.caso_id
          where k2.cliente_id = cl.id
            and f.tipo = 'pericia'
            and f.start_at >= now()
            and f.concluido_em is null
       )
  loop
    delete from public.clientes_etiquetas ce
     using public.etiquetas et
     where et.id = ce.etiqueta_id
       and ce.cliente_id = r.cliente_id
       and et.nome in
         ('PERICIA_AGENDADA', 'PERICIA_AGENDADA_INSS', 'PERICIA_AGENDADA_JUDICIAL');

    perform private.garantir_etiqueta_cliente(r.cliente_id, 'AGUARDANDO_RESULTADO_DE_PERICIA');
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.trocar_etiqueta_pos_pericia() is
  'Rotina diária: depois da perícia, troca PERICIA_AGENDADA_* por '
  'AGUARDANDO_RESULTADO_DE_PERICIA — direto em clientes_etiquetas (fonte única).';

-- 4) Aposenta o espelhador JSON → tabelas (era quem apagava os vínculos).
drop trigger if exists clientes_sync_tags_para_etiquetas on public.clientes;
drop function if exists public._clientes_sync_tags_para_etiquetas();

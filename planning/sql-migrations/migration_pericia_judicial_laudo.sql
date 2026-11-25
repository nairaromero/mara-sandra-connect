-- Perícia JUDICIAL não tem "deferido": tem LAUDO.
--
-- Caso que a Mara apontou (25/11/2026): na tarefa "Conferir laudo da perícia
-- judicial" os botões eram os da perícia do INSS. "Saiu — deferido" lançou o
-- andamento "Resultado da perícia — DEFERIDO" e a corrente do Concedido
-- (Análise de Deferimento, Baixar PA, Acompanhamento de implementação) num
-- processo judicial que só tinha um laudo juntado. No administrativo a perícia
-- favorável concede; no judicial o laudo favorável só segue para a sentença.
--
-- Esta migration:
--  1. `private.eh_pericia_judicial` — a regra no SQL, um lugar só. Espelha
--     `ehPericiaJudicial` (src/lib/tarefas/pericia.ts); a régua
--     e2e/unit/pericia-judicial.test.ts confere os dois.
--  2. `criar_alertas_escalonamento_pericia` deixa de olhar perícia judicial:
--     ouvidoria no INSS / mora administrativa / ajuizar não existem para laudo
--     que demora. Partiu do pg_get_functiondef da produção (25/11); a única
--     diferença é a linha marcada.
--  3. Template `laudo_pericia_judicial` — a corrente que nasce quando o laudo
--     sai: analisar e manifestar. Vai para quem já recebe a "Análise de
--     Deferimento" do escritório (o executor do 1º item do Concedido).
--
-- Idempotente. O template entra com `on conflict do nothing`: rodar de novo
-- não desfaz o que o escritório tiver editado.

-- ---------------------------------------------------------------------------
-- 1. A regra
-- ---------------------------------------------------------------------------
create or replace function private.eh_pericia_judicial(
  p_metadata jsonb,
  p_processo_judicial_id uuid
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when coalesce(p_metadata->>'pericia_judicial', '') = 'true' then true
    when p_metadata->>'template_aplicado' = 'pericia_judicial'   then true
    when p_metadata->>'template_aplicado' = 'pericia_parceiro'   then false
    else p_processo_judicial_id is not null
  end
$$;

comment on function private.eh_pericia_judicial(jsonb, uuid) is
  'A pericia desta tarefa e judicial? Marca explicita ou template judicial -> sim; template do INSS -> nao; sem template, vale o vinculo com processo judicial. Espelho de ehPericiaJudicial (src/lib/tarefas/pericia.ts).';

-- ---------------------------------------------------------------------------
-- 2. Escalonamento (30/60/90 dias) só para perícia do INSS
-- ---------------------------------------------------------------------------
create or replace function public.criar_alertas_escalonamento_pericia()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r       record;
  et      record;
  v_dias  int;
  v_n     int := 0;
begin
  for r in
    select t.id as tarefa_id, t.caso_id, t.responsavel_id,
           t.processo_admin_id, t.processo_judicial_id,
           (t.metadata->>'pericia_em')::timestamptz as pericia_em,
           cl.nome as cliente
      from public.tarefas t
      join public.casos k     on k.id = t.caso_id
      join public.clientes cl on cl.id = k.cliente_id
     where t.origem in ('template', 'pericia_acompanhamento')
       and coalesce((t.metadata->>'acompanhamento_pericia')::boolean, false)
       and t.status in ('a_fazer', 'fazendo')
       and t.metadata->>'pericia_em' is not null
       -- laudo judicial que demora não vira ouvidoria no INSS
       and not private.eh_pericia_judicial(t.metadata, t.processo_judicial_id)
  loop
    v_dias := extract(day from (now() - r.pericia_em))::int;

    for et in
      select * from (values
        ('ouvidoria',    30, 'Fazer ouvidoria - ',    'Resultado da perícia não saiu em 30 dias. Abrir ouvidoria no INSS.'),
        ('peticionar',   60, 'Peticionar por mora - ','Resultado da perícia não saiu em 60 dias. Peticionar por mora administrativa.'),
        ('ajuizar',      90, 'Ajuizar - ',            'Resultado da perícia não saiu em 90 dias. Avaliar ajuizamento.')
      ) as x(chave, dias, titulo, descricao)
    loop
      continue when v_dias < et.dias;
      insert into public.tarefas
        (caso_id, responsavel_id, tipo, status, prioridade, titulo, descricao,
         due_at, origem, origem_ref, metadata,
         processo_admin_id, processo_judicial_id)
      select
        r.caso_id, r.responsavel_id, 'pos_protocolo', 'a_fazer', 1,
        et.titulo || r.cliente, et.descricao,
        now(), 'pericia_acompanhamento',
        'escalonamento:' || r.tarefa_id::text || ':' || et.chave,
        jsonb_build_object(
          'escalonamento_pericia', et.chave,
          'tarefa_origem', r.tarefa_id,
          'pericia_em', r.pericia_em,
          'dias_sem_resultado', v_dias
        ),
        r.processo_admin_id, r.processo_judicial_id
      where not exists (
        select 1 from public.tarefas x
         where x.origem = 'pericia_acompanhamento'
           and x.origem_ref = 'escalonamento:' || r.tarefa_id::text || ':' || et.chave
      );
      if found then v_n := v_n + 1; end if;
    end loop;
  end loop;

  return v_n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Template: o que se faz quando o laudo sai
-- ---------------------------------------------------------------------------
insert into public.tarefa_templates
  (escritorio_id, nome, rotulo, gatilho, descricao, itens, ativo, oculto_na_ui)
select
  pj.escritorio_id,
  'laudo_pericia_judicial',
  'Laudo da perícia judicial',
  'laudo_pericia_judicial',
  'Laudo da perícia judicial juntado aos autos: analisar e manifestar. O laudo não é a decisão — o processo segue até a sentença.',
  jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object(
      'destino', 'tarefa',
      'tipo', 'interna',
      'titulo', 'Analisar laudo da perícia judicial - {nome_cliente}',
      'descricao',
        'O laudo da perícia judicial foi juntado aos autos. Analisar e definir a manifestação (concordar, impugnar ou pedir esclarecimentos), observando o prazo da intimação. O laudo não é a decisão: o processo segue até a sentença.',
      'prioridade', 1,
      'offset_dias', 1,
      'executor_email', (
        select c.itens->0->>'executor_email'
          from public.tarefa_templates c
         where c.escritorio_id = pj.escritorio_id and c.nome = 'concedido'
      ),
      'meta', jsonb_build_object('analise_laudo_pericia', true)
    ))
  ),
  true,
  -- só nasce pelo botão do laudo; não entra na lista de templates da tela
  true
from public.tarefa_templates pj
where pj.nome = 'pericia_judicial'
on conflict (escritorio_id, nome) do nothing;

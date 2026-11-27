-- A contagem do prazo começa no PRÓXIMO DIA ÚTIL depois do evento.
--
-- Regra do escritório (Naira, 27/11/2026), para prazo judicial e administrativo:
-- a publicação ou o andamento do INSS chega num dia e o prazo começa a contar
-- no dia útil seguinte. Veio na sexta, o dia 1 é a segunda. O sistema trabalha
-- com o fatal menos 1, e prazo que termina em sábado/domingo volta para a sexta.
--
--   Exemplo: andamento na sexta 13/11, 10 dias. Dia 1 = segunda 16/11; fatal
--   (dia 10) = quarta 25/11; prazo no sistema = terça 24/11.
--
-- Como estava: o prazo judicial pela publicação (dias úteis, na tela) já contava
-- assim. O relógio do indeferimento, o fatal padrão da exigência do INSS (30
-- dias) e o teto da Análise de Deferimento (10 dias) contavam dias corridos a
-- partir da própria data — certo de segunda a quinta, mas com evento na sexta ou
-- no sábado a contagem começava no fim de semana e o prazo saía 1–2 dias curto.
--
-- `private.base_da_contagem(evento)` é a véspera do dia 1: base + N = N-ésimo
-- dia do prazo. Espelho de `baseDaContagem` (supabase/functions/_shared/prazos.ts,
-- que a tela importa por @shared/prazos). Régua: e2e/unit/prazos-contagem.test.ts.
--
-- As quatro funções partiram do pg_get_functiondef da PRODUÇÃO em 27/11/2026
-- (md5 iguais em produção, staging e local); a única diferença é a base.
--
-- NÃO recalcula o que já está correndo: relógio guarda as datas na criação, e
-- tarefa aberta guarda o teto no metadata. Só o que nascer daqui em diante.
--
-- Idempotente.

create or replace function private.base_da_contagem(p_evento date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case extract(isodow from p_evento)::int
           when 5 then p_evento + 2   -- sexta: dia 1 = segunda
           when 6 then p_evento + 1   -- sábado: dia 1 = segunda
           else p_evento              -- seg-qui: dia 1 = amanhã; domingo: dia 1 = segunda
         end
$$;

comment on function private.base_da_contagem(date) is
  'Vespera do dia 1 da contagem de um prazo: o dia 1 e o proximo dia util depois do evento. base + N = N-esimo dia. Espelho de baseDaContagem (_shared/prazos.ts).';

-- Mesmas permissões de private.recua_fim_de_semana: `public.relogio_etapas` roda
-- como quem chama (a tela a usa), então quem está logado precisa executar esta.
revoke all on function private.base_da_contagem(date) from public, anon;
grant execute on function private.base_da_contagem(date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.relogio_etapas(p_tipo text, p_origem date)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select jsonb_object_agg(d.etapa, private.recua_fim_de_semana(private.base_da_contagem(p_origem) + d.dias))
    from private.relogio_dias(p_tipo) d
$function$;

CREATE OR REPLACE FUNCTION private.relogio_planejado(p_tipo text, p_origem date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select private.recua_fim_de_semana(private.base_da_contagem(p_origem) + d.dias)
    from private.relogio_dias(p_tipo) d
   order by d.ordem desc limit 1
$function$;

CREATE OR REPLACE FUNCTION private.relogio_limite(p_tipo text, p_origem date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select private.recua_fim_de_semana(
    private.base_da_contagem(p_origem) + case p_tipo when 'judicial' then 40 when 'recurso' then 30 end)
$function$;

CREATE OR REPLACE FUNCTION private.tg_tarefa_relogio_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_meta   jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_etapa  text;
  v_rel    public.relogios_prazo%rowtype;
  v_origem date;
  v_est    boolean := false;
  v_hoje   date := private.dia_brt(now());
  v_teto   date;
begin
  if new.caso_id is null then
    return new;
  end if;

  -- Janelas: vence amanhã, pode ir até o teto.
  if v_meta->>'aguardando_exigencia' = 'true' or v_meta->>'analise_deferimento' = 'true' then
    if v_meta->>'analise_deferimento' = 'true' then
      v_teto := private.recua_fim_de_semana(private.base_da_contagem(v_hoje) + 10);
      new.metadata := v_meta || jsonb_build_object('teto_em', v_teto);
    else
      -- O fatal fica gravado: é dele que a decisão da dilação tira a data.
      v_origem := coalesce(nullif(v_meta->>'prazo_fatal_em', '')::date, private.base_da_contagem(v_hoje) + 30);
      v_teto := private.recua_fim_de_semana(v_origem - 3);
      new.metadata := v_meta || jsonb_build_object('teto_em', v_teto, 'prazo_fatal_em', v_origem);
    end if;
    new.due_at := private.fim_do_dia_brt(least(v_hoje + 1, v_teto));
    return new;
  end if;

  v_etapa := case
    when v_meta->>'analise_indeferimento' = 'true' then 'analise'
    when v_meta->>'recurso_administrativo' = 'true' then 'recurso'
    when v_meta->>'montagem_inicial' = 'true'
         and coalesce(v_meta->>'montagem_requerimento', 'false') <> 'true'
         and coalesce(v_meta->>'etapa', 'montagem') in ('montagem', 'revisao', 'protocolo')
      then coalesce(v_meta->>'etapa', 'montagem')
  end;
  if v_etapa is null then
    return new;
  end if;

  -- O relógio da corrente: o que veio no metadata (a etapa anterior e os
  -- botões da análise passam o dela adiante); senão o aberto do MESMO
  -- processo (administrativo/judicial, ou nenhum = relógio do caso).
  if v_meta ? 'relogio_id' then
    select * into v_rel from public.relogios_prazo
     where id = (v_meta->>'relogio_id')::uuid and caso_id = new.caso_id and status = 'aberto';
  end if;
  if v_rel.id is null then
    select * into v_rel from public.relogios_prazo r
     where r.caso_id = new.caso_id and r.status = 'aberto'
       and r.processo_admin_id is not distinct from new.processo_admin_id
       and r.processo_judicial_id is not distinct from new.processo_judicial_id;
  end if;
  -- Etapa seguinte criada à mão sem processo (montagem aplicada pelo template):
  -- vale o relógio do caso só quando não há dúvida — um único aberto.
  if v_rel.id is null and v_etapa <> 'analise'
     and new.processo_admin_id is null and new.processo_judicial_id is null
     and (select count(*) from public.relogios_prazo r
           where r.caso_id = new.caso_id and r.status = 'aberto') = 1 then
    select * into v_rel from public.relogios_prazo r
     where r.caso_id = new.caso_id and r.status = 'aberto';
  end if;

  if v_etapa = 'analise' then
    v_origem := nullif(v_meta->>'data_indeferimento', '')::date;
    if v_origem is null and new.processo_admin_id is not null then
      select pa.data_decisao into v_origem from public.processos_admin pa
       where pa.id = new.processo_admin_id;
    end if;
    if v_origem is null then
      v_origem := private.dia_brt(now());
      v_est := true;
    end if;
    -- Relógio aberto de OUTRO indeferimento (corrente abandonada, protocolo
    -- nunca marcado) não pode capturar a análise nova com datas vencidas:
    -- encerra o antigo e abre um novo. Mesmo indeferimento (template
    -- reaplicado, e-mail repetido) continua no mesmo relógio. Sem data
    -- informada, só reaproveita se o antigo ainda tiver tarefa aberta.
    if v_rel.id is not null
       and ((not v_est and v_rel.origem_em <> v_origem)
            or (v_est and not exists (
                  select 1 from public.tarefas t
                   where t.status = 'a_fazer' and t.metadata->>'relogio_id' = v_rel.id::text))) then
      update public.relogios_prazo
         set status = 'encerrado', concluido_em = now(), updated_at = now()
       where id = v_rel.id;
      v_rel := null;
    end if;
  end if;

  if v_rel.id is null then
    -- Só a análise do indeferimento abre relógio. Montagem aplicada à mão sem
    -- análise (ou recurso sem relógio) segue a regra antiga.
    if v_etapa <> 'analise' then
      return new;
    end if;
    insert into public.relogios_prazo
      (caso_id, processo_admin_id, processo_judicial_id, tipo, origem_em, origem_estimada, etapas, planejado_em, limite_em, created_by)
    values
      (new.caso_id, new.processo_admin_id, new.processo_judicial_id, 'judicial', v_origem, v_est,
       public.relogio_etapas('judicial', v_origem),
       private.relogio_planejado('judicial', v_origem),
       private.relogio_limite('judicial', v_origem),
       auth.uid())
    returning * into v_rel;

    -- A data vira dado do processo (painel do caso), sem sobrescrever o que
    -- alguém já digitou lá.
    if not v_est and new.processo_admin_id is not null then
      update public.processos_admin
         set data_decisao = coalesce(data_decisao, v_origem),
             decisao      = coalesce(nullif(btrim(decisao), ''), 'Indeferido')
       where id = new.processo_admin_id;
    end if;
  elsif v_etapa = 'recurso' and v_rel.tipo <> 'recurso' then
    -- A análise decidiu recurso ordinário: o relógio passa a contar o fatal da lei.
    update public.relogios_prazo
       set tipo = 'recurso',
           etapas = public.relogio_etapas('recurso', origem_em),
           planejado_em = private.relogio_planejado('recurso', origem_em),
           limite_em = private.relogio_limite('recurso', origem_em),
           updated_at = now()
     where id = v_rel.id
    returning * into v_rel;
  end if;

  if not (v_rel.etapas ? v_etapa) then
    -- Etapa que não existe neste tipo de relógio (ex.: montagem judicial num
    -- caso que foi para recurso): não trava.
    return new;
  end if;

  new.due_at := private.fim_do_dia_brt((v_rel.etapas->>v_etapa)::date);
  new.metadata := v_meta || jsonb_build_object(
    'relogio_id', v_rel.id,
    'relogio_etapa', v_etapa,
    'prazo_fatal', true);
  return new;
end;
$function$;

-- Fixes do code review do lote kanban+radar (2026-09-01) — findings 8 e 9.
--
-- >>> SÓ STAGING até a Naira validar o lote. Na PRODUÇÃO, rodar junto com as
-- >>> outras do lote (planning/DEPLOY_LOTE_KANBAN_RADAR.md), DEPOIS de
-- >>> migration_radar_judicial_gatilhos_publicacao e _tarefas_parceiro_prazo.
--
-- 9) tg_publicacao_acionavel_cria_tarefa: o probe de dedup filtrava só
--    origem_ref — nenhum índice serve (o único é parcial em (origem,
--    origem_ref) where origem <> 'manual'), então cada publicação casada
--    fazia Seq Scan em tarefas DENTRO da transação do sync DJEN/DataJud.
--    Com "origem = 'sync_djen'" no EXISTS o probe vira Index Only Scan
--    (EXPLAIN conferido no staging em 2026-09-01). Corpo partido do
--    pg_get_functiondef REAL do staging (md5 0de2e59571d885c729e64cee997d57b3),
--    mudança APENAS no exists.
--
-- 8) Prazos backfillados com +27 cru caíam em fim de semana; o formulário
--    (prazoParceiroDoFatal) recua pra sexta. Alinha os pendentes existentes
--    à regra (o backfill da _prazo e o inss-email-processor já foram
--    corrigidos na origem). Idempotente: após a 1ª execução não sobra prazo
--    de fim de semana pra corrigir.

-- 9) Redefinição do trigger (só o EXISTS mudou):
CREATE OR REPLACE FUNCTION public.tg_publicacao_acionavel_cria_tarefa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_texto    text;
  v_cliente  text;
  v_gatilho  text;
  v_titulo   text;
  v_uteis    int;
  v_due      timestamptz;
begin
  if NEW.caso_id is null then return NEW; end if;
  -- Só o que chega automaticamente dos tribunais.
  if NEW.origem not in ('djen', 'datajud') then return NEW; end if;
  -- Andamento nascido dos próprios fluxos de aviso: não morder o rabo.
  if NEW.metadata ? 'tipo_aviso' then return NEW; end if;
  if NEW.data_evento is not null and NEW.data_evento < (now() - interval '30 days') then
    return NEW;
  end if;

  v_texto := coalesce(NEW.titulo, '') || ' ' || coalesce(NEW.descricao, '');

  -- Perícia/audiência marcada: o gatilho irmão (tg_rascunho_pericia_andamento)
  -- já cria a tarefa de aviso — aqui não duplica.
  if (v_texto ~* 'per[ií]cia' and v_texto ~* '(marcad|agendad|reagendad|remarcad|designad)')
     or (v_texto ~* 'audi[eê]nci' and v_texto ~* '(marcad|agendad|designad|redesignad|pautad)') then
    return NEW;
  end if;

  -- Um gatilho por publicação; o mais específico vence.
  if v_texto ~* 'proposta de acordo' then
    v_gatilho := 'acordo';
    v_titulo  := 'Manifestar sobre proposta de acordo';
    v_uteis   := 2;
  elsif v_texto ~* 'senten[çc]a' then
    v_gatilho := 'sentenca';
    v_titulo  := 'Analisar sentença - decidir recurso';
    v_uteis   := 2;
  elsif v_texto ~* 'laudo' then
    v_gatilho := 'laudo';
    v_titulo  := 'Analisar laudo pericial';
    v_uteis   := 3;
  elsif v_texto ~* 'rpv|precat[óo]rio|requisi[çc][ãa]o de pequeno valor' then
    v_gatilho := 'rpv';
    v_titulo  := 'Verificar pagamento (RPV/precatório)';
    v_uteis   := 5;
  elsif v_texto ~* 'manifest' then
    v_gatilho := 'manifestacao';
    v_titulo  := 'Manifestar nos autos';
    v_uteis   := 2;
  else
    return NEW;
  end if;

  select cl.nome into v_cliente
    from public.casos c join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  v_due := (public._dia_util_apos((now() at time zone 'America/Sao_Paulo')::date, v_uteis)::timestamp
            + interval '9 hours') at time zone 'America/Sao_Paulo';

  insert into public.tarefas
    (caso_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
  select
    NEW.caso_id, 'prazo', 'a_fazer', 1,
    v_titulo || ' - ' || coalesce(v_cliente, 'cliente'),
    'Publicação detectada (' || v_gatilho || '): "'
      || left(coalesce(NEW.titulo, ''), 120) || '". Leia a publicação no caso, '
      || 'confira o prazo REAL nela e aja. O prazo desta tarefa ('
      || v_uteis || ' dias úteis) é só o lembrete de segurança.',
    v_due,
    'sync_djen',
    'andamento:' || NEW.id::text || ':acionavel',
    NEW.processo_admin_id,
    NEW.processo_judicial_id,
    jsonb_build_object(
      'publicacao_acionavel', v_gatilho,
      'origem_andamento_id', NEW.id
    )
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'sync_djen'  -- casa com o índice parcial uq_tarefas_origem_ref
       and t.origem_ref = 'andamento:' || NEW.id::text || ':acionavel'
  );

  return NEW;
exception when others then
  raise warning 'tg_publicacao_acionavel_cria_tarefa falhou (andamento %): % / %',
    NEW.id, SQLSTATE, SQLERRM;
  return NEW;
end;
$function$
;

-- 8) Recuo de fim de semana nos prazos pendentes backfillados (+27 cru).
update public.solicitacoes_documento s
   set prazo_at = (
     (
       ((s.prazo_at at time zone 'America/Sao_Paulo')::date
        - case extract(dow from (s.prazo_at at time zone 'America/Sao_Paulo')::date)
            when 6 then 1  -- sábado → sexta
            when 0 then 2  -- domingo → sexta
            else 0
          end)
       + time '23:59:59') at time zone 'America/Sao_Paulo'
   )
 where s.origem = 'template:exigencia'
   and s.status = 'pendente'
   and s.prazo_at is not null
   and extract(dow from (s.prazo_at at time zone 'America/Sao_Paulo')::date) in (0, 6);

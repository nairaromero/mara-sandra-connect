-- Tarefas do PARCEIRO (kanban) + prazo estruturado nas solicitações.
--
-- >>> SÓ STAGING até a Naira validar o lote. Rodar na PRODUÇÃO (junto com as
-- >>> outras 4 do lote — ver planning/DEPLOY_LOTE_KANBAN_RADAR.md) ANTES do
-- >>> merge staging→main: o front novo depende de prazo_at e das RPCs daqui.
--
-- Feedback de parceiro (2026-08-31): quer ver as pendências dele em kanban
-- por fase do caso (Em análise / Administrativo / Judiciais), ordenadas por
-- prazo. Hoje NENHUM prazo chega estruturado ao parceiro: o fatal da
-- exigência INSS vive só na tarefa interna, o da judicial vira texto na
-- descrição, e solicitação avulsa não tem prazo nenhum.
--
-- Decisões (Naira, 2026-08-31):
--   * prazo mostrado ao parceiro = FATAL − 3 dias ("enviar até"); o fatal
--     real nunca chega a ele — a folga do escritório fica preservada.
--   * nova tela "Tarefas" pro parceiro (rota /tarefas, versão restrita);
--   * só entra no board o que precisa de ação (nada de acompanhamento);
--   * perícia/audiência = card informativo com data; item "Perícias" do menu
--     vira "Agenda" e passa a mostrar audiências também;
--   * o prazo entra no e-mail de criação e ganha lembretes 7d/3d/0d.
--
-- Idempotente: add column if not exists / create or replace / cron condicional.

-- ---------------------------------------------------------------------------
-- 1. Colunas novas em solicitacoes_documento
-- ---------------------------------------------------------------------------
-- prazo_at = "enviar até" DO PARCEIRO (fatal − 3, quando há fatal; livre na
-- avulsa). Fim do dia de Brasília, pra "até o dia X" incluir o dia X inteiro.
-- lembretes_enviados = marcadores dos lembretes por e-mail já disparados
-- (['7d','3d','0d']), idempotência do job diário.

alter table public.solicitacoes_documento
  add column if not exists prazo_at timestamptz,
  add column if not exists lembretes_enviados jsonb not null default '[]'::jsonb;

comment on column public.solicitacoes_documento.prazo_at is
  'Prazo mostrado ao parceiro ("enviar até", fim do dia BRT). Regra da casa: fatal real − 3 dias; o fatal nunca é exposto ao parceiro.';
comment on column public.solicitacoes_documento.lembretes_enviados is
  'Marcadores dos lembretes por e-mail já enviados: ["7d","3d","0d"]. Consumido por enviar_lembretes_solicitacao().';

-- Backfill SÓ da exigência INSS pendente: o fatal dela é fixo (30 dias
-- corridos da criação), então prazo do parceiro = criação + 27 dias.
-- Exigência judicial NÃO tem backfill: o fatal ficou só em texto/tarefa e
-- qualquer matching seria chute (padrão que já mordeu — "matching amplo
-- demais"); a equipe ajusta pelo botão Editar da solicitação.
-- Recuo de fim de semana (mesma regra do front, prazoParceiroDoFatal):
-- caindo em sáb/dom, volta pra sexta — senão a mesma exigência ganha prazo
-- de domingo por aqui e de sexta pelo formulário (code review 2026-09-01).
update public.solicitacoes_documento s
   set prazo_at = (
     (
       (
         ((s.data_solicitacao at time zone 'America/Sao_Paulo')::date + 27)
         - case extract(dow from ((s.data_solicitacao at time zone 'America/Sao_Paulo')::date + 27))
             when 6 then 1  -- sábado → sexta
             when 0 then 2  -- domingo → sexta
             else 0
           end
       )
       + time '23:59:59') at time zone 'America/Sao_Paulo'
   )
 where s.origem = 'template:exigencia'
   and s.status = 'pendente'
   and s.prazo_at is null;

-- ---------------------------------------------------------------------------
-- 2. agenda_do_parceiro()
-- ---------------------------------------------------------------------------
-- (removida em 2026-09-01, code review) A versão zero-arg que vivia aqui foi
-- superada por agenda_do_parceiro(p_desde timestamptz default null), criada
-- em migration_tarefas_parceiro_correcoes.sql — que DROPA a zero-arg.
-- Recriá-la aqui num re-run pós-correcoes deixava DUAS overloads no banco e
-- a chamada sem argumento do front virava ambiguidade PGRST203 (Agenda do
-- parceiro quebrada). Rodar este arquivo é seguro em qualquer ordem agora.


-- ---------------------------------------------------------------------------
-- 3. Lembretes de solicitação com prazo (7d / 3d / no dia)
-- ---------------------------------------------------------------------------
-- Problema que resolve: com o board ordenado por urgência, pendência com
-- prazo longe fica no fundo e "aparece" só quando pega fogo. O e-mail bate na
-- porta do parceiro três vezes antes do "enviar até" — e como o prazo já é
-- fatal−3, o lembrete "é hoje" ainda deixa 3 dias reais de folga.
--
-- Mesmo desenho do enviar_lembretes_evento(): job diário, dispara a edge
-- function (notify-solicitacao-doc em modo lembrete) via pg_net e marca o
-- envio em lembretes_enviados. Limiar por "dias restantes" (<=) e não por
-- igualdade: cron que falhou num dia manda no seguinte em vez de nunca.

create or replace function public.enviar_lembretes_solicitacao()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_url    text;
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias   int;
  v_marca  text;
  v_n      int := 0;
begin
  select valor into v_url from public.app_config where chave = 'edge_base_url';

  for r in
    select s.id, s.prazo_at, s.lembretes_enviados
      from public.solicitacoes_documento s
      join public.casos c on c.id = s.caso_id
     where s.status = 'pendente'
       and s.prazo_at is not null
       and s.origem <> 'interna'          -- interna é do escritório
       and c.parceiro_id is not null
  loop
    v_dias := (r.prazo_at at time zone 'America/Sao_Paulo')::date - v_hoje;

    -- Um lembrete por faixa; a mais urgente ganha (não manda 7d e 3d juntos).
    v_marca := case
      when v_dias <= 0 then '0d'
      when v_dias <= 3 then '3d'
      when v_dias <= 7 then '7d'
      else null
    end;
    if v_marca is null or r.lembretes_enviados ? v_marca then
      continue;
    end if;

    -- Marca ANTES do disparo (pg_net é assíncrono, não tem como aguardar o
    -- resultado) — mesmo trade-off do lembrete de perícia: prefere perder um
    -- e-mail raro a spammar o parceiro todo dia.
    update public.solicitacoes_documento
       set lembretes_enviados = lembretes_enviados || to_jsonb(v_marca)
     where id = r.id;

    if v_url is not null
       and exists (select 1 from pg_extension where extname = 'pg_net') then
      perform net.http_post(
        url := v_url || '/notify-solicitacao-doc',
        headers := '{"Content-Type": "application/json", "x-region": "sa-east-1"}'::jsonb,
        body := jsonb_build_object('solicitacao_id', r.id, 'lembrete', v_marca),
        timeout_milliseconds := 30000
      );
    elsif v_url is null then
      raise warning 'app_config.edge_base_url ausente — lembrete % da solicitacao % sem e-mail', v_marca, r.id;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.enviar_lembretes_solicitacao() is
  'Lembrete por e-mail de solicitação pendente com prazo_at (7d/3d/no dia do "enviar até"): dispara notify-solicitacao-doc em modo lembrete via pg_net e marca em lembretes_enviados. Job diário; idempotente.';

-- Agenda: todo dia 08:00 de Brasília (11:00 UTC). Condicional porque só
-- produção tem pg_cron; em staging a função existe e é chamada a mão.
do $agenda$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'lembrete-solicitacao-diario') then
      perform cron.unschedule('lembrete-solicitacao-diario');
    end if;
    perform cron.schedule(
      'lembrete-solicitacao-diario',
      '0 11 * * *',
      'select public.enviar_lembretes_solicitacao();'
    );
  else
    raise notice 'pg_cron ausente — job do lembrete de solicitacao NAO agendado neste ambiente.';
  end if;
end
$agenda$;

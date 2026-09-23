-- =============================================================================
-- Migration: frente obrigatória em perícia/audiência (fora da tela também) e
-- dono do pedido sem vazamento pela escada (card #357, 3ª parte)
--
-- Revisão do próprio lote com a Naira (2026-09-19). Dois furos:
--
--   1. "Perícia e audiência sempre têm processo" valia só na tela. Qualquer
--      outro caminho (importação, script, API, ferramenta de IA futura) grava
--      sem frente, e o compromisso cai na coluna errada do parceiro.
--      Aqui o banco preenche sozinho quando a resposta é ÚNICA — audiência com
--      um processo judicial, perícia com uma frente só. Ambíguo continua nulo:
--      inventar frente é pior que deixar pra decisão de gente.
--
--   2. `_tarefas_set_responsavel` lia `solicitacoes_documento.responsavel_id`
--      como preferido. Com o campo agora escolhido na tela também no pedido
--      EXTERNO, a escolha alcançava, calada, qualquer tarefa que carregue
--      `origem_solicitacao_documento_id` no metadata. Passa a valer só o que
--      cada gatilho grava explicitamente na hora de criar a tarefa; a escada
--      volta a usar só `solicitado_por`.
--
-- As funções abaixo saíram do `pg_get_functiondef` do banco (local == PRODUÇÃO,
-- md5 conferido em 2026-09-19); as mudanças estão marcadas com "-- #357".
--
-- Idempotente. Local → staging → produção, com aval.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Perícia/audiência: o banco completa a frente quando ela é única
-- ---------------------------------------------------------------------------
create or replace function public._agenda_evento_frente_unica()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
  v_jud   uuid;
  v_n_admin int;
  v_n_jud   int;
begin
  if NEW.tipo not in ('pericia', 'audiencia') then return NEW; end if;
  if NEW.caso_id is null then return NEW; end if;
  if NEW.processo_admin_id is not null or NEW.processo_judicial_id is not null then
    return NEW;
  end if;

  -- Nada de min(id): não existe agregado min() pra uuid — o erro caía no
  -- handler e a frente ficava nula em silêncio (pego no teste local).
  select count(*) into v_n_admin from public.processos_admin where caso_id = NEW.caso_id;
  select count(*) into v_n_jud   from public.processos_judiciais where caso_id = NEW.caso_id;
  select id into v_admin from public.processos_admin
   where caso_id = NEW.caso_id order by created_at, id limit 1;
  select id into v_jud from public.processos_judiciais
   where caso_id = NEW.caso_id order by created_at, id limit 1;

  if NEW.tipo = 'audiencia' then
    -- Audiência corre no judiciário: com um processo judicial só, é esse.
    if v_n_jud = 1 then NEW.processo_judicial_id := v_jud; end if;
    return NEW;
  end if;

  -- Perícia pode ser do INSS ou da Justiça: só completa quando o caso tem
  -- UMA frente no total.
  if v_n_admin + v_n_jud = 1 then
    if v_n_jud = 1 then NEW.processo_judicial_id := v_jud;
    else NEW.processo_admin_id := v_admin;
    end if;
  end if;

  return NEW;
exception when others then
  raise warning '_agenda_evento_frente_unica falhou (evento %): %', NEW.id, sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists trg_agenda_evento_frente_unica on public.agenda_eventos;
create trigger trg_agenda_evento_frente_unica
  before insert or update of caso_id, tipo, processo_admin_id, processo_judicial_id
  on public.agenda_eventos
  for each row execute function public._agenda_evento_frente_unica();

-- Backfill com a MESMA regra: só o que é determinístico. O que sobrar (caso
-- com duas frentes, ou nenhuma) fica pra decisão de gente.
update public.agenda_eventos e
   set processo_judicial_id = pj.id
  from public.processos_judiciais pj
 where pj.caso_id = e.caso_id
   and e.tipo = 'audiencia'
   and e.processo_admin_id is null
   and e.processo_judicial_id is null
   and (select count(*) from public.processos_judiciais x where x.caso_id = e.caso_id) = 1;

update public.agenda_eventos e
   set processo_judicial_id = pj.id
  from public.processos_judiciais pj
 where pj.caso_id = e.caso_id
   and e.tipo = 'pericia'
   and e.processo_admin_id is null
   and e.processo_judicial_id is null
   and (select count(*) from public.processos_judiciais x where x.caso_id = e.caso_id) = 1
   and (select count(*) from public.processos_admin x where x.caso_id = e.caso_id) = 0;

update public.agenda_eventos e
   set processo_admin_id = pa.id
  from public.processos_admin pa
 where pa.caso_id = e.caso_id
   and e.tipo = 'pericia'
   and e.processo_admin_id is null
   and e.processo_judicial_id is null
   and (select count(*) from public.processos_admin x where x.caso_id = e.caso_id) = 1
   and (select count(*) from public.processos_judiciais x where x.caso_id = e.caso_id) = 0;

-- ---------------------------------------------------------------------------
-- 2) A escada de dono volta a usar só `solicitado_por`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tarefas_set_responsavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_preferido uuid;
  v_solic     uuid;
begin
  if NEW.responsavel_id is not null then
    return NEW;
  end if;

  -- Tarefa que nasceu de uma solicitação de documento: quem pediu confere.
  --
  -- #357: aqui é SÓ `solicitado_por`. O `responsavel_id` do pedido ("quem
  -- providencia" na interna, "quem cuida quando o documento voltar" na
  -- externa) passou a ser escolhido na tela, e cada gatilho grava esse dono
  -- na tarefa que ele cria — explícito, na hora. Se a escada também lesse o
  -- campo, a escolha vazaria em silêncio pra qualquer outra tarefa que
  -- carregue a mesma marca no metadata.
  v_solic := nullif(NEW.metadata->>'origem_solicitacao_documento_id', '')::uuid;
  if v_solic is not null then
    select s.solicitado_por
      into v_preferido
      from public.solicitacoes_documento s
     where s.id = v_solic;
  end if;

  -- Tarefa sem caso é tarefa de escritório: fica com quem criou (se for
  -- interno). Sem isso ela cairia no padrão do escritório, que não tem nada
  -- a ver com o assunto.
  if NEW.caso_id is null then
    v_preferido := coalesce(v_preferido, NEW.created_by);
  end if;

  NEW.responsavel_id := public.responsavel_tarefa_caso(NEW.caso_id, v_preferido);
  return NEW;
exception when others then
  -- Antes o handler devolvia NEW com responsavel_id NULL: qualquer falha na
  -- escada (função renomeada, grant mudado, metadata com uuid inválido)
  -- ressuscitava a tarefa órfã em silêncio. Agora tem chão.
  raise warning '_tarefas_set_responsavel falhou (caso %): % / % — caindo no admin padrão',
    NEW.caso_id, SQLSTATE, SQLERRM;
  begin
    NEW.responsavel_id := public.admin_ativo_padrao();
  exception when others then
    -- Nem o chão respondeu. Uma tarefa sem dono é ruim; um insert que explode
    -- é pior — deixa passar e o warning acima fica no log.
    null;
  end;
  return NEW;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 3) Tarefa de exigência nasce com o dono escolhido no pedido (e com a frente)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._solicitacao_atendida_cria_tarefa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tipo_label text;
  v_template   text;
  v_judicial   boolean;
  v_cliente    text;
begin
  if (OLD.status is distinct from NEW.status) and NEW.status = 'atendido'
     and NEW.origem is not null and NEW.origem like 'template:%' then

    v_tipo_label := coalesce(NEW.tipo::text, 'documento');
    v_template   := split_part(NEW.origem, ':', 2);
    v_judicial   := (v_template = 'exigencia_judicial');

    select cl.nome into v_cliente
      from public.casos c
      join public.clientes cl on cl.id = c.cliente_id
     where c.id = NEW.caso_id;

    -- 1) Andamento visível ao parceiro: avisa que recebemos.
    insert into public.andamentos (
      caso_id, origem, titulo, descricao, data_evento, visivel_parceiro, metadata
    )
    values (
      NEW.caso_id, 'interno',
      case when v_judicial
           then 'Documento entregue pelo Parceiro — iremos juntar aos autos'
           else 'Documento entregue pelo Parceiro — iremos cumprir a exigência' end,
      'Recebemos o documento "' || v_tipo_label || '" entregue pelo parceiro. ' ||
      case when v_judicial
           then 'Iremos peticionar a juntada no processo e informaremos em breve.'
           else 'Iremos cumprir a exigência no INSS e informaremos em breve.' end,
      now(), true,
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem,
        'etapa', 'documento_recebido'
      )
    );

    -- 2) Tarefa pro interno — título com o nome do cliente; INSS leva o
    --    checklist de cumprimento (cumprimento_exigencia=true).
    insert into public.tarefas (
      caso_id, tipo, prioridade, status,
      titulo, descricao, due_at, origem, metadata,
      responsavel_id,                                   -- #357
      processo_admin_id, processo_judicial_id           -- #357
    )
    values (
      NEW.caso_id, 'interna', 1, 'a_fazer',
      case when v_judicial
           then 'Cumprir Exigência Judicial - ' || coalesce(v_cliente, 'cliente')
           else 'Cumprir Exigência INSS - ' || coalesce(v_cliente, 'cliente') end,
      format(
        case when v_judicial
             then 'O parceiro entregou o documento "%s" solicitado. Peticionar a juntada no processo o quanto antes.'
             else 'O parceiro entregou o documento "%s" solicitado. Cumprir a exigência no Meu INSS o quanto antes.' end,
        v_tipo_label
      ),
      now(),
      'manual',
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem,
        'template_aplicado', v_template
      ) || case when v_judicial then '{}'::jsonb
                else jsonb_build_object('cumprimento_exigencia', true) end,
      -- #357: quem foi escolhido no pedido ("quem cuida quando o documento
      -- voltar") assume também o cumprimento da exigência. Null = escada de
      -- sempre (`_tarefas_set_responsavel`).
      NEW.responsavel_id,
      NEW.processo_admin_id, NEW.processo_judicial_id
    );

    -- 3) Fecha a "Aguardando documentos…" do mesmo caso/template.
    update public.tarefas
       set status = 'feito',
           updated_at = now(),
           completed_at = coalesce(completed_at, now())
     where caso_id = NEW.caso_id
       and status = 'a_fazer'
       and metadata->>'template_aplicado' = v_template
       and titulo ilike 'Aguardando documentos%';
  end if;
  return NEW;
end;
$function$;

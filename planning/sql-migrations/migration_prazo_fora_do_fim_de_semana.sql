-- Prazo não cai em sábado nem domingo.
--
-- Pedido da Naira (27/11/2026): "se o prazo finalizar no final de semana, puxar
-- para sexta; se iniciar no final de semana, puxa para segunda".
--
-- Levantamento em produção no dia: 14 tarefas abertas e 2 pedidos de documento
-- com prazo em sábado/domingo. O prazo é calculado em ~25 pontos da tela, mais
-- as rotinas do banco e as edge functions (robô do INSS, publicação, IA,
-- ZapSign) — cada um do seu jeito, alguns já recuando, outros não. Em vez de
-- consertar ponto a ponto, a regra mora AQUI, na gravação: vale para todos os
-- caminhos, os de hoje e os que vierem.
--
-- A regra (`private.prazo_fora_do_fim_de_semana`):
--   1. prazo em dia útil: fica como está;
--   2. prazo em sábado/domingo: recua para a SEXTA, mesmo horário
--      (`private.recua_fim_de_semana`, a conta que o relógio de prazos já usa);
--   3. se essa sexta já passou — o prazo NASCEU no fim de semana, ou na sexta
--      depois do horário —, vai para a SEGUNDA: prazo não nasce vencido;
--   4. prazo travado (fatal, com teto ou relógio) só vai para a segunda se ela
--      couber no teto; senão fica na sexta, mesmo já passada.
--
-- Fica de fora: tarefa do tipo 'pericia' (o "prazo" dela é a data do
-- compromisso, e perícia em sábado existe), tarefa já feita/cancelada e a
-- agenda (`agenda_eventos`), que é compromisso e não prazo.
-- Feriado não entra: o sistema não tem calendário de feriados.
--
-- Espelho na tela: `prazoForaDoFimDeSemana` (src/lib/tarefas/relogio.ts), só
-- para o formulário avisar a pessoa antes de salvar. Régua:
-- e2e/unit/prazo-fora-do-fim-de-semana.test.ts.
--
-- Idempotente.

create or replace function private.prazo_fora_do_fim_de_semana(
  p_prazo timestamptz,
  p_agora timestamptz,
  p_nunca_adia boolean
) returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_local timestamp;
  v_dia   date;
  v_sexta date;
  v_r     timestamptz;
begin
  if p_prazo is null then return null; end if;
  v_local := p_prazo at time zone 'America/Sao_Paulo';
  v_dia   := v_local::date;
  v_sexta := private.recua_fim_de_semana(v_dia);
  if v_sexta = v_dia then return p_prazo; end if;

  v_r := (v_sexta + v_local::time) at time zone 'America/Sao_Paulo';
  if coalesce(p_nunca_adia, false) or v_r >= p_agora then
    return v_r;
  end if;
  -- a sexta já passou: segunda (sexta + 3)
  return ((v_sexta + 3) + v_local::time) at time zone 'America/Sao_Paulo';
end;
$$;

comment on function private.prazo_fora_do_fim_de_semana(timestamptz, timestamptz, boolean) is
  'Prazo em sabado/domingo recua para a sexta (mesmo horario); se a sexta ja passou, vai para a segunda — menos prazo travado, que nunca e adiado. Espelho de prazoForaDoFimDeSemana (src/lib/tarefas/relogio.ts).';

revoke all on function private.prazo_fora_do_fim_de_semana(timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function private.prazo_fora_do_fim_de_semana(timestamptz, timestamptz, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- Tarefas
-- ---------------------------------------------------------------------------
-- O prazo de UMA tarefa, já sabendo se ele é travado. Travado (fatal, com teto
-- de janela ou com relógio) só vai para a segunda se a segunda couber no teto;
-- sem teto conhecido, ou passando dele, fica na sexta mesmo já passada —
-- automação nenhuma empurra prazo fatal para depois do limite.
create or replace function private.tarefa_prazo_fora_do_fim_de_semana(
  p_due timestamptz,
  p_metadata jsonb
) returns timestamptz
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_meta    jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_travado boolean;
  v_novo    timestamptz;
  v_teto    date;
begin
  v_novo := private.prazo_fora_do_fim_de_semana(p_due, now(), false);
  if v_novo is null or v_novo <= p_due then
    return v_novo;  -- ficou igual ou recuou: sempre pode
  end if;

  v_travado := coalesce(v_meta->>'prazo_fatal', '') = 'true'
               or v_meta ? 'teto_em' or v_meta ? 'relogio_id';
  if not v_travado then
    return v_novo;
  end if;

  if v_meta ? 'teto_em' then
    v_teto := nullif(v_meta->>'teto_em', '')::date;
  elsif v_meta ? 'relogio_id' then
    select greatest(r.planejado_em, coalesce(r.liberado_ate, r.planejado_em)) into v_teto
      from public.relogios_prazo r
     where r.id = nullif(v_meta->>'relogio_id', '')::uuid;
  end if;

  if v_teto is not null and private.dia_brt(v_novo) <= v_teto then
    return v_novo;
  end if;
  return private.prazo_fora_do_fim_de_semana(p_due, now(), true);
end;
$$;

revoke all on function private.tarefa_prazo_fora_do_fim_de_semana(timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function private.tarefa_prazo_fora_do_fim_de_semana(timestamptz, jsonb)
  to service_role;

create or replace function public.tg_tarefa_prazo_fora_do_fim_de_semana()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.due_at is null then return new; end if;
  -- Só quando o prazo está sendo definido: editar outro campo de uma tarefa
  -- antiga não mexe na data dela.
  if tg_op = 'UPDATE' and new.due_at is not distinct from old.due_at then return new; end if;
  -- data de compromisso, não prazo
  if new.tipo = 'pericia' then return new; end if;
  if new.status not in ('a_fazer', 'fazendo') then return new; end if;

  new.due_at := private.tarefa_prazo_fora_do_fim_de_semana(new.due_at, new.metadata);
  return new;
end;
$$;

revoke all on function public.tg_tarefa_prazo_fora_do_fim_de_semana() from public, anon, authenticated;

-- "zz_": o ÚLTIMO dos gatilhos BEFORE. Tem que vir depois dos que DEFINEM o
-- prazo na criação (trg_implementacao_due_inicial, trg_tarefa_relogio_insert —
-- "vence amanhã" numa sexta dava sábado) e pode vir depois da trava do relógio:
-- esta função só recua, ou adia dentro do teto.
drop trigger if exists trg_tarefa_prazo_fora_do_fds on public.tarefas;
drop trigger if exists zz_prazo_fora_do_fds on public.tarefas;
create trigger zz_prazo_fora_do_fds
  before insert or update of due_at on public.tarefas
  for each row execute function public.tg_tarefa_prazo_fora_do_fim_de_semana();

-- ---------------------------------------------------------------------------
-- Pedidos de documento (prazo do parceiro)
-- ---------------------------------------------------------------------------
create or replace function public.tg_solicitacao_prazo_fora_do_fim_de_semana()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.prazo_at is null then return new; end if;
  if tg_op = 'UPDATE' and new.prazo_at is not distinct from old.prazo_at then return new; end if;
  if new.status <> 'pendente' then return new; end if;
  new.prazo_at := private.prazo_fora_do_fim_de_semana(new.prazo_at, now(), false);
  return new;
end;
$$;

revoke all on function public.tg_solicitacao_prazo_fora_do_fim_de_semana() from public, anon, authenticated;

drop trigger if exists trg_solicitacao_prazo_fora_do_fds on public.solicitacoes_documento;
drop trigger if exists zz_prazo_fora_do_fds on public.solicitacoes_documento;
create trigger zz_prazo_fora_do_fds
  before insert or update of prazo_at on public.solicitacoes_documento
  for each row execute function public.tg_solicitacao_prazo_fora_do_fim_de_semana();

-- ---------------------------------------------------------------------------
-- O que já está aberto e ainda vai vencer num fim de semana
-- ---------------------------------------------------------------------------
-- Só o que está por vencer: prazo de fim de semana que já passou é atraso de
-- verdade, e mexer na data dele esconderia isso.
update public.tarefas t
   set due_at = private.tarefa_prazo_fora_do_fim_de_semana(t.due_at, t.metadata)
 where t.status in ('a_fazer', 'fazendo')
   and t.tipo <> 'pericia'
   and t.due_at > now()
   and extract(isodow from t.due_at at time zone 'America/Sao_Paulo') in (6, 7);

update public.solicitacoes_documento s
   set prazo_at = private.prazo_fora_do_fim_de_semana(s.prazo_at, now(), false)
 where s.status = 'pendente'
   and s.prazo_at > now()
   and extract(isodow from s.prazo_at at time zone 'America/Sao_Paulo') in (6, 7);

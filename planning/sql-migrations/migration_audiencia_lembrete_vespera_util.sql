-- =============================================================================
-- Migration: lembrete automático de AUDIÊNCIA sai na véspera ÚTIL
-- (análise ponta a ponta da audiência, Naira 2026-09-13).
--
-- ANTES: audiencia_data_lembrete = data da audiência − 1, sem olhar o dia da
-- semana. Audiência de segunda → e-mail ao parceiro no DOMINGO às 08:00 (o job
-- rotina-pericia-diaria roda todo dia, fim de semana inclusive).
--
-- AGORA: véspera útil — caindo em sábado ou domingo, recua pra sexta.
--   seg → sex · ter → seg · qua → ter · qui → qua · sex → qui
--   sáb/dom (raro) → sex
-- O piso "hoje" continua: audiência marcada em cima da hora ainda recebe o
-- lembrete no mesmo dia (mesmo que hoje seja fim de semana — aí é urgência).
-- Feriado não entra (o sistema não tem calendário deles), mesma convenção de
-- _dia_util_apos.
--
-- O texto do lembrete (audiencia_lembrete_texto) não diz "amanhã" — traz a
-- data — então sair na sexta pra audiência de segunda não fica errado.
-- Perícia não muda: já sai na última sexta antes (pericia_data_lembrete).
--
-- Ponto de partida: pg_get_functiondef da PRODUÇÃO em 2026-09-13 (hash igual
-- ao do staging). Única chamadora: enviar_lembretes_evento().
--
-- Idempotente.
-- =============================================================================

create or replace function public.audiencia_data_lembrete(p_quando timestamp with time zone)
 returns date
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select greatest(
    v.vespera - case extract(dow from v.vespera)::int
                  when 6 then 1  -- sábado → sexta
                  when 0 then 2  -- domingo → sexta
                  else 0 end,
    (now() at time zone 'America/Sao_Paulo')::date
  )
  from (select (p_quando at time zone 'America/Sao_Paulo')::date - 1 as vespera) v;
$function$;

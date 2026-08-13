-- Correção pontual: 2 perícias gravadas SEM horário (só a data, caindo em
-- 00:00). Não é o bug de fuso de [migration_fix_pericias_fuso_madri.sql] —
-- ali o horário existia e estava deslocado -5h; aqui ele nunca foi gravado.
--
-- Horários informados pela Naira (13/08/2026):
--   GERALDO PEREIRA GOMES  — 19/11/2026 às 11:20 (perícia judicial)
--   LEANDRO ALVES DA SILVA — 31/08/2026 às 13:20
--
-- Duração: Leandro já tinha 60 min e é preservada. O evento do Geraldo estava
-- com duração ZERO (início = fim), outro efeito de ter nascido só com data;
-- recebe os mesmos 60 min das demais perícias pra render direito na agenda.
--
-- Updates por id, com trava no valor atual (rodar de novo não altera nada).

begin;

-- GERALDO PEREIRA GOMES — 19/11/2026 00:00 -> 11:20 (duração 0 -> 60 min)
update agenda_eventos
   set start_at = '2026-11-19 11:20:00-03',
       end_at   = '2026-11-19 12:20:00-03'
 where id = 'fe07bcc2-8786-438c-a02f-9ad52cb73892'
   and start_at = '2026-11-19 00:00:00-03';

-- LEANDRO ALVES DA SILVA — 31/08/2026 00:00 -> 13:20 (mantém os 60 min)
update agenda_eventos
   set start_at = '2026-08-31 13:20:00-03',
       end_at   = '2026-08-31 13:20:00-03'::timestamptz + (end_at - start_at)
 where id = '99b49f0d-a01d-4492-822e-261c3a5ed070'
   and start_at = '2026-08-31 00:00:00-03';

commit;

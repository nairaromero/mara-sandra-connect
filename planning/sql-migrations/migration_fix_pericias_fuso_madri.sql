-- Correção pontual: perícias gravadas no fuso errado (Madri em vez de Brasília).
--
-- Antes do fix de src/lib/fuso.ts, a tela da agenda lia/gravava no fuso do
-- NAVEGADOR. A Naira agenda da Espanha, então "09:10" digitado em Madri virou
-- 04:10 em Brasília — e foi esse horário convertido que saiu no aviso ao
-- parceiro. Um parceiro reclamou da diferença.
--
-- Cada linha abaixo foi conferida UMA A UMA contra o comprovante do INSS no
-- Google Drive (13/08/2026). O desvio é uniforme: -5h (Madri no horário de
-- verão, +02, contra Brasília, -03). As DATAS estavam corretas; só a hora.
--
-- NÃO é um UPDATE em bloco: são ids específicos, com trava no valor atual
-- (só altera se ainda estiver com o horário errado). Rodar duas vezes não
-- soma 10h. Perícias criadas no Brasil e as materializadas pelo processador
-- do INSS (que gravam -03:00 explícito) NÃO são tocadas.
--
-- Eventos: start_at e end_at deslocam juntos (todos têm 60 min de duração).

begin;

-- 1) ISAEL SEBASTIAO DOS SANTOS — 13/08 03:30 -> 08:30 (comprovante: 08:30)
update agenda_eventos
   set start_at = start_at + interval '5 hours',
       end_at   = end_at   + interval '5 hours'
 where id = '30dfe580-1cf3-4e93-9226-04ebe54660f4'
   and start_at = '2026-08-13 03:30:00-03';

-- 2) EDMILSON BATISTA DE ARAUJO — 14/08 05:10 -> 10:10 (comprovante: 10:10)
update agenda_eventos
   set start_at = start_at + interval '5 hours',
       end_at   = end_at   + interval '5 hours'
 where id = '2092e58c-e72c-4096-9af4-b1cabfd14025'
   and start_at = '2026-08-14 05:10:00-03';

-- 3) DOUGLAS HENRIQUE DE MORAES GOUVEIA — 20/08 04:10 -> 09:10 (comprovante: 09:10)
update agenda_eventos
   set start_at = start_at + interval '5 hours',
       end_at   = end_at   + interval '5 hours'
 where id = '047c52ab-d81a-458b-9e66-604e8a0ba226'
   and start_at = '2026-08-20 04:10:00-03';

-- 4) ALESSANDRA OLIVEIRA DA SILVA — 24/08 04:00 -> 09:00 (comprovante: 09:00)
update agenda_eventos
   set start_at = start_at + interval '5 hours',
       end_at   = end_at   + interval '5 hours'
 where id = 'f3f0d25e-12e2-4ec5-a8db-521263616ab8'
   and start_at = '2026-08-24 04:00:00-03';

-- 5) WILLIAN RODRIGUES DA COSTA — 24/08 04:50 -> 09:50 (comprovante: 09:50)
update agenda_eventos
   set start_at = start_at + interval '5 hours',
       end_at   = end_at   + interval '5 hours'
 where id = '3552c0f8-e990-409a-8bd5-2cc33602847c'
   and start_at = '2026-08-24 04:50:00-03';

-- 6) SEBASTIAO DE LIMA INACIO — 26/08 04:10 -> 09:10 (comprovante: 09:10)
update agenda_eventos
   set start_at = start_at + interval '5 hours',
       end_at   = end_at   + interval '5 hours'
 where id = '728c8b27-7b50-4ef9-8fa2-6dbc3e34d7e6'
   and start_at = '2026-08-26 04:10:00-03';

-- 7) MARTA CELINA TEODORO DA SILVA (tarefa) — 17/08 03:20 -> 08:20 (comprovante: 08:20)
update tarefas
   set due_at = due_at + interval '5 hours'
 where id = 'e0415bad-4099-4fac-9d9f-56b60a9cc200'
   and due_at = '2026-08-17 03:20:00-03';

-- 8) ELIEZER JESIEL PEREIRA (tarefa) — 13/08 00:00 -> 08:00.
-- Caso DIFERENTE: não é deslocamento de fuso, é hora que nunca foi gravada
-- (só a data). O comprovante marca 08:00, então grava o horário explícito.
update tarefas
   set due_at = '2026-08-13 08:00:00-03'
 where id = 'd8fa6d4a-27a0-4252-8179-6c3065850444'
   and due_at = '2026-08-13 00:00:00-03';

commit;

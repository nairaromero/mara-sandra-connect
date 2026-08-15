-- Liga o processador de e-mails do INSS no automático.
--
-- 05:00 UTC = 07:00 na Espanha (horário de verão), que é de onde a Naira
-- opera. Uma vez ao dia: e-mail do INSS não chega em ritmo que justifique
-- mais. Rodando de manhã, a equipe encontra as tarefas prontas ao começar.
--
-- ATENÇÃO ao horário de inverno: quando a Espanha sai do horário de verão
-- (fim de outubro), 05:00 UTC vira 06:00 aí. Pra manter 07:00 o ano todo,
-- trocar a hora do agendamento para 6.
--
-- dias=2 de propósito: se uma execução falhar, a do dia seguinte cobre o
-- buraco. Reprocessar é seguro — a dedup é pelo id da mensagem do Gmail.
--
-- A função só olha `label:inss-agent in:inbox`, então e-mail já arquivado
-- nunca é tocado.
--
-- Idempotente: remove o job antes de recriar.

select cron.unschedule('msc-inss-email')
 where exists (select 1 from cron.job where jobname = 'msc-inss-email');

select cron.schedule(
  'msc-inss-email',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/inss-email-processor',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"dias": 2, "limite": 50}'::jsonb,
    timeout_milliseconds := 145000
  );
  $$
);

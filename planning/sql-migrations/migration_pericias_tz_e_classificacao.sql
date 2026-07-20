-- migration_pericias_tz_e_classificacao.sql
--
-- Dois consertos nas tarefas migradas do TI (2026-07-20):
--
-- 1) FUSO: a migracao gravou os prazos do TI (horario de Brasilia) como se
--    fossem UTC — tudo ficou 3h adiantado, e os compromissos "dia inteiro"
--    (00:00 BRT -> 00:00 UTC) caiam as 21h do DIA ANTERIOR na exibicao local.
--    Correcao: +3h em todo due_at de origem='migracao_ti'. Idempotente via
--    flag metadata.tz_corrigida.
--
-- 2) CLASSIFICACAO: tarefas tipo='pericia' misturam a PERICIA EM SI
--    ("PERICIA AGENDADA - X", "Perícia INSS - X") com tarefas SOBRE pericia
--    ("ACOMPANHAR RESULTADO...", "CONTATAR PARCEIRO...", "Agendamento de
--    perícia" = acao de ligar pra agendar). A agenda deve mostrar so a
--    pericia em si. Grava metadata.pericia_evento = true/false; o frontend
--    filtra por essa flag (com heuristica de fallback pra tarefas futuras
--    criadas sem a flag). Dry-run de 2026-07-20: 41 x 41.

-- 1) Fuso dos prazos migrados
update public.tarefas
   set due_at   = due_at + interval '3 hours',
       metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{tz_corrigida}', 'true'::jsonb)
 where origem = 'migracao_ti'
   and due_at is not null
   and coalesce(metadata->>'tz_corrigida', '') <> 'true';

-- 2) Pericia em si x tarefa sobre pericia
update public.tarefas
   set metadata = jsonb_set(
         coalesce(metadata, '{}'::jsonb),
         '{pericia_evento}',
         case
           when titulo ~* '(acompanh|contatar|resultado|ligar|compareceu|agendamento de)'
             then 'false'::jsonb
           else 'true'::jsonb
         end
       )
 where tipo = 'pericia'
   and (metadata->>'pericia_evento') is null;

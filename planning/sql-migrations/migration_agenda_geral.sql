-- migration_agenda_geral.sql
--
-- A agenda deixa de ser "de perícia" e passa a ser do escritório.
--
-- Duas coisas, uma delas um bug antigo:
--
-- 1) EVENTO NÃO TINHA COMO SER CONCLUÍDO. `agenda_eventos` não tinha status
--    nem data de conclusão — o evento nascia e ficava no calendário pra
--    sempre. Foi o que aconteceu com o "Guichê OAB - JAIR PEREIRA" de 11/08:
--    já tinha acontecido, a equipe deu baixa na TAREFA do cliente, mas o
--    evento é outro registro e continuou lá.
--
--    Pior, isso era inconsistente: a agenda mescla eventos com tarefas de
--    perícia, e as que vêm de tarefa SOMEM quando concluídas ("a tarefa segue
--    sendo a fonte da verdade"). Duas coisas iguais na tela, comportamentos
--    opostos.
--
-- 2) FALTAVA O TIPO "atendimento". O vocabulário já tinha perícia, audiência,
--    reunião, interno e guichê — mas não o atendimento ao cliente, que caía em
--    "reunião" junto com qualquer outra coisa.
--
-- Idempotente.

-- 1) Conclusão do evento -----------------------------------------------------
-- Concluído NÃO some do calendário (decisão da Naira): fica no dia em que
-- aconteceu, esmaecido e riscado, pra o mês passado continuar legível. Sai é
-- das contagens de pendente, e a tela tem um "esconder concluídos".
alter table public.agenda_eventos
  add column if not exists concluido_em  timestamptz,
  add column if not exists concluido_por uuid references public.usuarios(id);

comment on column public.agenda_eventos.concluido_em is
  'Quando o evento foi dado como realizado. NULL = ainda pendente. Nao apaga '
  'nem esconde o evento: o calendario mostra riscado, e o filtro "esconder '
  'concluidos" e quem tira da vista.';

-- O calendário pergunta "o que falta neste mês" — índice parcial serve.
create index if not exists agenda_eventos_pendentes_idx
    on public.agenda_eventos (start_at)
 where concluido_em is null;

-- 2) Tipo novo: atendimento --------------------------------------------------
alter table public.agenda_eventos
  drop constraint if exists agenda_eventos_tipo_check;
alter table public.agenda_eventos
  add constraint agenda_eventos_tipo_check
  check (tipo = any (array[
    'pericia'::text, 'audiencia'::text, 'reuniao'::text,
    'interno'::text, 'guiche'::text, 'atendimento'::text
  ]));

-- 3) Corrige os eventos que nasceram com o tipo errado -----------------------
-- O seletor de tipo existe no formulário desde sempre, mas nada na tela
-- mostrava o tipo — então ninguém reparava, e tudo caiu em "reunião". Sem isto
-- o filtro "Atendimentos" nasceria mentindo.
update public.agenda_eventos
   set tipo = 'guiche'
 where tipo = 'reuniao'
   and titulo ~* 'guich';

update public.agenda_eventos
   set tipo = 'atendimento'
 where tipo = 'reuniao'
   and titulo ~* 'atendimento';

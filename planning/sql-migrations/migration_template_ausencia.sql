-- Template "Ausência" — qualquer pessoa da equipe registra o período em que
-- estará fora (férias, viagem, folga, licença).
--
-- Diferente dos outros templates de agenda, este NÃO tem caso/cliente: a
-- ausência é da pessoa. Daí a flag `sem_caso` no item destino=agenda, que:
--   - faz o seletor de template aparecer mesmo com "Sem caso" (antes ele só
--     surgia depois de escolher um caso, então ausência era inalcançável);
--   - impede o casamento automático por tipo — senão escolher "Interno" em
--     qualquer evento interno viraria "Ausência".
--
-- {nome_usuario} é resolvido no AgendaSheet com o nome de quem está criando,
-- e a pessoa já entra como responsável do evento.
--
-- duracao_min = 600 → 08:00 às 18:00 no dia escolhido. Pra ausência de vários
-- dias é só esticar a data de fim; o calendário agora pinta todos os dias do
-- intervalo (ver chavesDiasBR em src/lib/fuso.ts).
--
-- Idempotente.

insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'ausencia',
  'Ausência (férias, viagem, folga)',
  'ausencia',
  'Marca na agenda o período em que a pessoa estará fora. Aparece em todos os dias do intervalo.',
  '[
    {
      "destino": "agenda",
      "tipo": "interno",
      "titulo": "Ausência - {nome_usuario}",
      "descricao": "Período de ausência.",
      "duracao_min": 600,
      "sem_caso": true
    }
  ]'::jsonb,
  false
)
on conflict (nome) do update set
  rotulo = excluded.rotulo,
  gatilho = excluded.gatilho,
  descricao = excluded.descricao,
  itens = excluded.itens,
  oculto_na_ui = excluded.oculto_na_ui,
  updated_at = now();

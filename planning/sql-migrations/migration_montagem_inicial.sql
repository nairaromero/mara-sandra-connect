-- Montagem de inicial: corrente Bia -> Mara -> Bia, com prazo fatal em cada etapa.
--
-- Depois da analise de indeferimento, a Mara aplica este template quando decide
-- passar a montagem pra Bia. A partir dai a corrente anda sozinha, por botao:
--
--   1. Montagem da inicial   Bia   10 dias  -> botao "Enviar para revisao"
--   2. Revisao da inicial    Mara  10 dias  -> botao "Enviar para protocolo"
--   3. Protocolo da inicial  Bia    5 dias  -> botao "Protocolo realizado"
--        encerra a corrente + andamento VISIVEL ao parceiro
--
-- Dias CORRIDOS (decisao da Naira). O template so cria a etapa 1; as seguintes
-- nascem do clique, porque cada uma comeca a contar quando a anterior termina —
-- criar as tres de uma vez daria prazo errado.
--
-- prazo_fatal=true no metadata: e o que faz a tarefa aparecer na faixa "Prazos
-- fatais" no topo da tela de Tarefas (fatal-1 e vencidas). O sinalizador e
-- generico de proposito — qualquer tarefa marcada assim entra na faixa.
--
-- Idempotente.

insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'montagem_inicial',
  'Montagem de inicial',
  'montagem_inicial',
  'Monta a inicial (Bia), revisa (Mara) e protocola (Bia), com prazo fatal em cada etapa.',
  jsonb_build_array(jsonb_build_object(
    'tipo', 'interna',
    'titulo', 'Montagem da inicial - {nome_cliente}',
    'descricao',
      'Montar a petição inicial. Ao terminar, use o botão "Enviar para revisão" na ' ||
      'própria tarefa — a revisão da Mara nasce automaticamente.' || chr(10) || chr(10) ||
      'Prazo fatal: 10 dias corridos.',
    'prioridade', 1,
    'offset_dias', 10,
    'executor_email', 'advocacia.beatrizsan@outlook.com',
    'interessados_emails', jsonb_build_array('marasandra.adv@gmail.com'),
    'meta', jsonb_build_object(
      'montagem_inicial', true,
      'etapa', 'montagem',
      'prazo_fatal', true
    )
  )),
  false
)
on conflict (nome) do update set
  rotulo = excluded.rotulo,
  gatilho = excluded.gatilho,
  descricao = excluded.descricao,
  itens = excluded.itens,
  oculto_na_ui = excluded.oculto_na_ui,
  updated_at = now();

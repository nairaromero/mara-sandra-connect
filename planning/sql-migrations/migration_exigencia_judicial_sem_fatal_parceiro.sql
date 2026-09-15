-- Exigência Judicial: o prazo fatal não chega mais ao parceiro.
--
-- Regra da casa (Naira, 2026-08-31, migration_tarefas_parceiro_prazo): o
-- parceiro recebe o "enviar até" = fatal − 3 dias (solicitacoes_documento.
-- prazo_at), nunca o fatal real. O template exigencia_judicial é de
-- 2026-08-24, anterior à regra, e ainda escrevia "Prazo fatal: {prazo_fatal}"
-- em dois textos que o parceiro lê:
--   * o andamento (visivel_parceiro = true);
--   * o texto padrão da solicitação de documento — usado quando a IA não
--     responde, e que também vai no e-mail ao parceiro, ao lado do "enviar
--     até". O parceiro via as duas datas.
-- Os dois passam a remeter ao prazo de envio que a solicitação já mostra
-- (card, e-mail e lembretes). As tarefas internas continuam com o fatal.
--
-- Sem placeholder novo de propósito: um front anterior a esta mudança só
-- substitui os placeholders que conhece, então o texto sai certo em qualquer
-- ordem de deploy.
--
-- Conservadora e idempotente: troca só o texto que ainda for EXATAMENTE o
-- antigo (comparado com a produção em 2026-09-15). Texto já novo não muda;
-- texto editado por alguém depois não é sobrescrito, só avisado.
do $$
declare
  v_and_antigo text := E'Recebemos determinação judicial no processo {processo} solicitando documentos. Solicitamos ao parceiro indicador a documentação necessária para a juntada aos autos. Prazo fatal: {prazo_fatal}.\n\nTrecho da publicação:\n{despacho}';
  v_and_novo text := E'Recebemos determinação judicial no processo {processo} solicitando documentos. Solicitamos ao parceiro indicador a documentação necessária para a juntada aos autos, dentro do prazo de envio indicado na solicitação.\n\nTrecho da publicação:\n{despacho}';
  v_sol_antigo text := E'A Justiça solicitou documentos no processo de {nome_cliente}. Prazo fatal: {prazo_fatal} — precisamos receber os documentos alguns dias antes, porque quem faz o protocolo no processo é o escritório.\n\nO que foi pedido:\n{despacho}';
  v_sol_novo text := E'A Justiça solicitou documentos no processo de {nome_cliente}. Envie os documentos ao escritório até a data indicada nesta solicitação: depois de recebê-los, o escritório ainda precisa de tempo para fazer o protocolo no processo.\n\nO que foi pedido:\n{despacho}';
  v_id uuid;
  v_itens jsonb;
  v_novos jsonb;
  v_item jsonb;
  v_desc text;
begin
  select id, itens into v_id, v_itens
    from public.tarefa_templates
   where nome = 'exigencia_judicial';
  if v_id is null then
    raise notice 'template exigencia_judicial não existe neste banco — nada a fazer';
    return;
  end if;

  v_novos := '[]'::jsonb;
  for v_item in select e from jsonb_array_elements(v_itens) with ordinality as x(e, ord) order by ord loop
    v_desc := v_item->>'descricao';
    if v_item->>'destino' = 'andamento' then
      if v_desc = v_and_antigo then
        v_item := jsonb_set(v_item, '{descricao}', to_jsonb(v_and_novo));
      elsif v_desc is distinct from v_and_novo then
        raise warning 'andamento do exigencia_judicial foi editado; texto mantido — conferir se ainda mostra o fatal ao parceiro';
      end if;
    elsif v_item->>'destino' = 'solicitacao_documento' then
      if v_desc = v_sol_antigo then
        v_item := jsonb_set(v_item, '{descricao}', to_jsonb(v_sol_novo));
      elsif v_desc is distinct from v_sol_novo then
        raise warning 'solicitação do exigencia_judicial foi editada; texto mantido — conferir se ainda mostra o fatal ao parceiro';
      end if;
    end if;
    v_novos := v_novos || jsonb_build_array(v_item);
  end loop;

  if v_novos is distinct from v_itens then
    update public.tarefa_templates
       set itens = v_novos, updated_at = now()
     where id = v_id;
    raise notice 'exigencia_judicial: textos do parceiro atualizados';
  else
    raise notice 'exigencia_judicial: nada a mudar';
  end if;
end $$;

select
  item->>'destino' as destino,
  item->>'descricao' like '%{prazo_fatal}%' as mostra_fatal
from public.tarefa_templates t, jsonb_array_elements(t.itens) as item
where t.nome = 'exigencia_judicial'
  and item->>'destino' in ('andamento', 'solicitacao_documento');

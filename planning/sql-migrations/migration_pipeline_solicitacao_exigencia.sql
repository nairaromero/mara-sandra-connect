-- =============================================================================
-- Migration: pipeline "solicitação atendida → tarefa cumprir exigência"
--             + ajustes em em_analise e exigencia templates.
--
-- Quando um template tem item destino=solicitacao_documento, ele insere
-- uma linha em `solicitacoes_documento` com origem='template:<nome>'.
-- Esta migration adiciona um trigger que, quando o parceiro responde
-- (status muda pra 'atendido'), cria automaticamente uma tarefa de
-- "Documento entregue — cumprir exigência" no caso.
--
-- Templates atualizados:
--   em_analise:
--     [0] andamento "Em análise no INSS" (visível ao parceiro)
--           (era 1 tarefa "Acompanhamento" — Naira pediu pra tirar)
--   exigencia:
--     [0] andamento "Documento solicitado ao parceiro — aguardando cumprimento"
--     [1] solicitacao_documento (descricao = documentos da exigência)
--     [2] tarefa "Aguardando documentos do parceiro - {nome_cliente}"
--           (era "Comunicar parceiro + pedir documentos")
--     [3] tarefa "FATAL - CUMPRIMENTO DE EXIGENCIA - {nome_cliente}" (mantém)
--
-- Idempotente.
-- =============================================================================

-- 1) Trigger: solicitação atendida → tarefa automática.
create or replace function public._solicitacao_atendida_cria_tarefa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo_label text;
begin
  -- Dispara apenas na transição pra 'atendido' E quando a solicitação veio
  -- de um template (precisa do prefixo "template:" pra evitar atrapalhar
  -- solicitações manuais).
  if (OLD.status is distinct from NEW.status) and NEW.status = 'atendido'
     and NEW.origem is not null and NEW.origem like 'template:%' then
    v_tipo_label := coalesce(NEW.tipo::text, 'documento');
    insert into public.tarefas (
      caso_id, tipo, prioridade, status,
      titulo, descricao, due_at, origem, metadata
    )
    values (
      NEW.caso_id, 'interna', 1, 'a_fazer',
      'Documento entregue — cumprir exigência no INSS',
      format(
        'O parceiro entregou o documento "%s" solicitado. Cumprir a exigência no Meu INSS o quanto antes.',
        v_tipo_label
      ),
      now(),
      'manual',
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_solicitacao_atendida_cria_tarefa on public.solicitacoes_documento;
create trigger trg_solicitacao_atendida_cria_tarefa
  after update on public.solicitacoes_documento
  for each row execute function public._solicitacao_atendida_cria_tarefa();


-- 2) Template em_analise: só andamento (sem tarefa).
update public.tarefa_templates
   set itens = '[
     {
       "destino": "andamento",
       "tipo": "interno",
       "titulo": "Status alterado para EM ANÁLISE no INSS",
       "descricao": "Requerimento {protocolo} agora está em análise no INSS. Vamos acompanhar a próxima movimentação.",
       "visivel_parceiro": true
     }
   ]'::jsonb,
   updated_at = now()
 where nome = 'em_analise';


-- 3) Template exigencia: andamento + solicitacao + 2 tarefas.
update public.tarefa_templates
   set itens = '[
     {
       "destino": "andamento",
       "tipo": "interno",
       "titulo": "Documento solicitado ao parceiro — aguardando cumprimento",
       "descricao": "Recebemos uma exigência do INSS no requerimento {protocolo}. Solicitamos ao parceiro indicador a documentação necessária para cumprimento.\n\nDespacho:\n{despacho}",
       "visivel_parceiro": true
     },
     {
       "destino": "solicitacao_documento",
       "tipo": "outro",
       "titulo": "Documentos para cumprimento de exigência",
       "descricao": "Documentos solicitados pelo INSS no requerimento {protocolo}.\n\nDespacho:\n{despacho}"
     },
     {
       "titulo": "Aguardando documentos do parceiro - {nome_cliente}",
       "descricao": "Solicitação de documentos enviada ao parceiro. Aguardar resposta para cumprimento da exigência no requerimento {protocolo}.",
       "tipo": "contato_cliente",
       "prioridade": 1,
       "offset_dias": 0,
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"]
     },
     {
       "titulo": "FATAL - CUMPRIMENTO DE EXIGENCIA - {nome_cliente}",
       "descricao": "Prazo de 30 dias para cumprir a exigência. Requerimento {protocolo}.",
       "tipo": "prazo",
       "prioridade": 1,
       "offset_dias": 30,
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"]
     }
   ]'::jsonb,
   updated_at = now()
 where nome = 'exigencia';

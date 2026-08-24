-- =============================================================================
-- Migration: exigência dividida em INSS × Judicial (reunião de agosto/2026).
--
-- 1) Template `exigencia` (administrativa) vira "Exigência INSS" no rótulo e
--    nos títulos dos itens — daqui pra frente; tarefas já abertas não mudam
--    (decisão da Naira em 2026-08-24). O slug `exigencia` NÃO muda: o
--    inss-email-processor aplica o template por esse nome.
--
-- 2) Novo template `exigencia_judicial`, aplicado MANUALMENTE no TarefaSheet:
--    a equipe lê a publicação no Legalmail, cola o trecho no form, informa o
--    PRAZO FATAL (campo novo) e o sistema cria andamento visível ao parceiro,
--    solicitação de documento (texto reescrito em linguagem simples pela IA
--    via edge mensagem-parceiro-exigencia; fallback = descrição abaixo),
--    tarefa de acompanhamento e tarefa FATAL no dia útil anterior ao fatal
--    (due_relative_to='prazo_fatal' + offset_dias=-1, resolvido no front).
--
-- 3) Trigger "solicitação atendida → tarefa" passa a variar o texto:
--    INSS = cumprir no Meu INSS; judicial = peticionar a juntada nos autos.
--
-- Idempotente.
-- =============================================================================

-- 1) Renomeia rótulo e títulos do template administrativo.
update public.tarefa_templates
   set rotulo = 'Exigência INSS',
       itens = '[
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
       "titulo": "Documentos para cumprimento de exigência do INSS",
       "descricao": "Documentos solicitados pelo INSS no requerimento {protocolo}.\n\nDespacho:\n{despacho}"
     },
     {
       "titulo": "Aguardando documentos do parceiro (exigência INSS) - {nome_cliente}",
       "descricao": "Solicitação de documentos enviada ao parceiro. Aguardar resposta para cumprimento da exigência no requerimento {protocolo}.",
       "tipo": "contato_cliente",
       "prioridade": 1,
       "offset_dias": 0,
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"]
     },
     {
       "titulo": "FATAL - CUMPRIMENTO DE EXIGENCIA INSS - {nome_cliente}",
       "descricao": "Prazo de 30 dias para cumprir a exigência. Requerimento {protocolo}.",
       "tipo": "prazo",
       "prioridade": 1,
       "offset_dias": 30,
       "meta": {"prazo_fatal": true},
       "executor_email": "nairaromerovian@gmail.com",
       "interessados_emails": ["marasandra.adv@gmail.com"]
     }
   ]'::jsonb,
       updated_at = now()
 where nome = 'exigencia';


-- 2) Novo template: Exigência Judicial (aplicação manual; sem executor fixo —
--    quem aplica escolhe, com "herdar do form" como default na UI).
insert into public.tarefa_templates (nome, rotulo, gatilho, descricao, itens, oculto_na_ui)
values (
  'exigencia_judicial',
  'Exigência Judicial',
  'exigencia_judicial',
  'Justiça exigiu documentos — comunicar parceiro (IA reescreve em linguagem simples) e marcar o fatal informado na publicação.',
  '[
    {
      "destino": "andamento",
      "tipo": "interno",
      "titulo": "Exigência judicial — documentos solicitados ao parceiro",
      "descricao": "Recebemos determinação judicial no processo {processo} solicitando documentos. Solicitamos ao parceiro indicador a documentação necessária para a juntada aos autos. Prazo fatal: {prazo_fatal}.\n\nTrecho da publicação:\n{despacho}",
      "visivel_parceiro": true
    },
    {
      "destino": "solicitacao_documento",
      "tipo": "outro",
      "titulo": "Documentos para cumprimento de exigência judicial",
      "descricao": "A Justiça solicitou documentos no processo de {nome_cliente}. Prazo fatal: {prazo_fatal} — precisamos receber os documentos alguns dias antes, porque quem faz o protocolo no processo é o escritório.\n\nO que foi pedido:\n{despacho}",
      "meta": {"mensagem_ia": "exigencia_judicial"}
    },
    {
      "titulo": "Aguardando documentos do parceiro (exigência judicial) - {nome_cliente}",
      "descricao": "Solicitação de documentos enviada ao parceiro. Aguardar resposta para juntada no processo {processo}. Prazo fatal: {prazo_fatal}.",
      "tipo": "contato_cliente",
      "prioridade": 1,
      "offset_dias": 0
    },
    {
      "titulo": "FATAL - CUMPRIMENTO DE EXIGENCIA JUDICIAL - {nome_cliente}",
      "descricao": "Prazo judicial para juntar os documentos no processo {processo}. Prazo fatal: {prazo_fatal}. A tarefa vence no dia útil anterior ao fatal.",
      "tipo": "prazo",
      "prioridade": 1,
      "due_relative_to": "prazo_fatal",
      "offset_dias": -1,
      "meta": {"prazo_fatal": true}
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


-- 3) Trigger "solicitação atendida → tarefa": texto varia INSS × judicial.
create or replace function public._solicitacao_atendida_cria_tarefa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo_label text;
  v_titulo text;
  v_descricao text;
begin
  -- Dispara apenas na transição pra 'atendido' E quando a solicitação veio
  -- de um template (prefixo "template:" evita atrapalhar solicitações manuais).
  if (OLD.status is distinct from NEW.status) and NEW.status = 'atendido'
     and NEW.origem is not null and NEW.origem like 'template:%' then
    v_tipo_label := coalesce(NEW.tipo::text, 'documento');
    -- Exigência do INSS se cumpre no Meu INSS; a judicial, peticionando a
    -- juntada nos autos. A tarefa criada precisa mandar pro lugar certo.
    if NEW.origem = 'template:exigencia_judicial' then
      v_titulo := 'Documento entregue — juntar aos autos (exigência judicial)';
      v_descricao := format(
        'O parceiro entregou o documento "%s" solicitado. Peticionar a juntada no processo o quanto antes.',
        v_tipo_label
      );
    else
      v_titulo := 'Documento entregue — cumprir exigência no INSS';
      v_descricao := format(
        'O parceiro entregou o documento "%s" solicitado. Cumprir a exigência no Meu INSS o quanto antes.',
        v_tipo_label
      );
    end if;
    insert into public.tarefas (
      caso_id, tipo, prioridade, status,
      titulo, descricao, due_at, origem, metadata
    )
    values (
      NEW.caso_id, 'interna', 1, 'a_fazer',
      v_titulo, v_descricao, now(), 'manual',
      jsonb_build_object(
        'origem_solicitacao_documento_id', NEW.id,
        'origem_template', NEW.origem
      )
    );
  end if;
  return NEW;
end;
$$;

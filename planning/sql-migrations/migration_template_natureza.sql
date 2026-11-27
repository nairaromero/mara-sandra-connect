-- Template só cabe no processo da natureza dele.
--
-- Pedido da Naira (27/11/2026): no formulário, com um requerimento (processo
-- administrativo) escolhido não dá para aplicar template judicial, e
-- vice-versa. Foi assim que perícia judicial nasceu com o template do INSS em
-- agosto — e os botões de "deferido" apareceram num processo judicial.
--
-- `tarefa_templates.natureza` é a fonte: 'admin', 'judicial' ou nulo (cabe em
-- qualquer processo). A tela só lê esta coluna — não decide pelo nome.
--
-- O que entra classificado aqui é o que o USO confirma (tarefas dos últimos
-- 120 dias em produção, por processo ligado):
--   pericia_judicial   0 adm / 83 jud        -> judicial
--   exigencia         56 adm /  0 jud        -> admin
--   indeferido       114 adm /  0 jud        -> admin
--   pericia_parceiro  71 adm / 19 jud (erro) -> admin
-- e os de nome inequívoco (Exigência/Audiência Judicial, Em Análise,
-- Montagem/Protocolo de Requerimento).
--
-- Ficam LIVRES de propósito, à espera de decisão do escritório:
--   montagem_inicial (181 adm / 5 jud) e protocolo_inicial (48 adm / 0 jud) —
--     "inicial" é judicial no nome, mas nasce presa ao requerimento indeferido;
--   concedido (53 adm / 9 jud) e requerimento_aberto (29 adm / 3 jud);
--   guiche_oab, ausencia e os de revisão.
--
-- Idempotente. A classificação só preenche onde está NULO: rodar de novo não
-- desfaz o que o escritório tiver mudado.

alter table public.tarefa_templates
  add column if not exists natureza text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarefa_templates_natureza_chk') then
    alter table public.tarefa_templates
      add constraint tarefa_templates_natureza_chk
      check (natureza is null or natureza in ('admin', 'judicial'));
  end if;
end $$;

comment on column public.tarefa_templates.natureza is
  'Em que processo o template cabe: admin (requerimento), judicial (acao) ou nulo (qualquer um). A tela esconde o template que nao cabe no processo escolhido.';

update public.tarefa_templates
   set natureza = 'judicial'
 where natureza is null
   and nome in ('pericia_judicial', 'exigencia_judicial', 'audiencia_judicial', 'laudo_pericia_judicial');

update public.tarefa_templates
   set natureza = 'admin'
 where natureza is null
   and nome in ('pericia_parceiro', 'exigencia', 'indeferido', 'em_analise',
                'montagem_requerimento_adm', 'protocolo_requerimento');

-- Escritório novo recebe o catálogo com a natureza. Partiu do
-- pg_get_functiondef da PRODUÇÃO em 27/11/2026 (md5 60dff850…, igual em staging
-- e local); a diferença é só a coluna `natureza` no insert dos templates.
CREATE OR REPLACE FUNCTION private.semear_catalogo(p_destino uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_base uuid := private.escritorio_padrao();
begin
  if p_destino is null or v_base is null or p_destino = v_base then
    return;
  end if;

  -- Conjunto padrão, sem nada do escritório de origem: tipos de benefício e
  -- templates (sem responsável fixo nem e-mail de executor).
  if not exists (select 1 from public.tipos_beneficio where escritorio_id = p_destino) then
    insert into public.tipos_beneficio (escritorio_id, nome, ativo, ordem)
    select p_destino, t.nome, t.ativo, t.ordem from public.tipos_beneficio t where t.escritorio_id = v_base;
  end if;

  if not exists (select 1 from public.tarefa_templates where escritorio_id = p_destino) then
    insert into public.tarefa_templates (escritorio_id, nome, gatilho, descricao, itens, ativo, oculto_na_ui, rotulo, natureza)
    select p_destino, t.nome, t.gatilho, t.descricao,
           (select jsonb_agg(i - 'responsavel_id' - 'executor_email' - 'executor_id') from jsonb_array_elements(t.itens) i),
           t.ativo, t.oculto_na_ui, t.rotulo, t.natureza
      from public.tarefa_templates t where t.escritorio_id = v_base;
  end if;
end;
$function$;

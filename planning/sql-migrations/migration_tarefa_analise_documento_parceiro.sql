-- Tarefa de análise quando PARCEIRO junta documento avulso a um caso.
--
-- Problema: parceiro sobe documento na aba Documentos (ou pelo WhatsApp) e a
-- equipe só fica sabendo se ele avisar por fora. O único rastro era a
-- notificação no sino, que some. Caso real: Isabella juntou termo aditivo e
-- ninguém abriu tarefa pra analisar.
--
-- O que já existia e NÃO muda:
--   - trg_solicitacao_cumprida_parceiro_cria_tarefa: parceiro cumpre
--     solicitação avulsa → "Analisar documento recebido — {tipo}".
--   - trg_solicitacao_atendida_cria_tarefa: solicitação de template de
--     exigência atendida → "cumprir exigência no INSS".
--   - caso_novo_parceiro_cria_tarefa: caso criado por parceiro →
--     "Cliente novo - Parceiro X - Analisar".
--
-- Este arquivo cobre o resto: qualquer INSERT em documentos cujo uploaded_by
-- é usuário tipo='parceiro' → tarefa "Analisar documentos juntados pelo
-- parceiro - {cliente}", sem responsável (qualquer interno pega).
--
-- Regras:
--   1. Gate por uploaded_by, não auth.uid(): o RPC do WhatsApp roda como
--      service_role (auth.uid() nulo) e grava uploaded_by = parceiro.
--   2. Agrupa: enquanto houver tarefa dessas ABERTA (a_fazer) pro mesmo caso e
--      mesmo parceiro, o documento novo entra nela (descrição é reconstruída
--      a partir de metadata.documento_ids). 8 arquivos numa leva = 1 tarefa.
--      Se a tarefa já foi feita/cancelada/está "fazendo", nasce outra.
--   3. Não duplica com "Cliente novo": se a tarefa de análise inicial do
--      parceiro foi criada há menos de 10 min (= docs subidos na criação do
--      caso), pula — a análise inicial já cobre os documentos.
--   4. Não duplica com solicitação: o fluxo "responder solicitação" insere o
--      documento ANTES de gravar documento_id na solicitação, então o doc
--      entra na tarefa agrupada e só depois a solicitação dispara a tarefa
--      específica dela. Um segundo trigger (em solicitacoes_documento) tira
--      o doc da tarefa agrupada quando documento_id é preenchido; se ela
--      ficar vazia, é apagada.
--
-- Interno subindo documento não gera tarefa (ele já viu o documento).
-- Idempotente: create or replace + drop trigger if exists.

-- ---------------------------------------------------------------------------
-- 0) Rótulo do tipo de documento (espelho de src/lib/documentos/tipos.ts)
-- ---------------------------------------------------------------------------
-- Tipo novo no front sem entrada aqui não quebra nada: cai no fallback
-- initcap("rg_cpf" → "Rg Cpf").
create or replace function public.documento_tipo_label(p_tipo text)
returns text
language sql
immutable
as $$
  select coalesce(
    case p_tipo
      when 'cnis'                            then 'CNIS'
      when 'rg_cpf'                          then 'RG / CPF'
      when 'comprovante_residencia'          then 'Comprovante de residência'
      when 'ctps'                            then 'CTPS'
      when 'holerite'                        then 'Holerite / contracheque'
      when 'ppp'                             then 'PPP'
      when 'laudo_medico'                    then 'Laudo médico'
      when 'ltcat'                           then 'LTCAT'
      when 'atestado_medico'                 then 'Atestado médico'
      when 'cat'                             then 'CAT'
      when 'carne_gps'                       then 'Carnê de contribuição (GPS)'
      when 'ctc'                             then 'CTC'
      when 'carta_concessao_inss'            then 'Carta de concessão/indeferimento INSS'
      when 'hiscre'                          then 'HISCRE'
      when 'certidao_casamento'              then 'Certidão de casamento'
      when 'certidao_obito'                  then 'Certidão de óbito'
      when 'certidao_nascimento'             then 'Certidão de nascimento'
      when 'declaracao_uniao_estavel'        then 'Declaração de união estável'
      when 'declaracao_atividade_rural'      then 'Declaração de atividade rural'
      when 'procuracao'                      then 'Procuração'
      when 'substabelecimento'               then 'Substabelecimento'
      when 'contrato_honorarios'             then 'Contrato de honorários'
      when 'declaracao_hipossuficiencia'     then 'Declaração de hipossuficiência'
      when 'declaracao_ausencia_duplicidade' then 'Declaração de ausência de duplicidade de ação'
      when 'outro'                           then 'Outro'
    end,
    initcap(replace(coalesce(p_tipo, 'documento'), '_', ' '))
  );
$$;

-- ---------------------------------------------------------------------------
-- 1) Descrição da tarefa agrupada, reconstruída a partir dos ids
-- ---------------------------------------------------------------------------
create or replace function public._analise_docs_parceiro_descricao(
  p_parceiro_nome text,
  p_ids uuid[]
)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with docs as (
    select d.nome_arquivo,
           case
             when d.tipo = 'outro' and coalesce(btrim(d.tipo_personalizado), '') <> ''
               then d.tipo_personalizado
             else public.documento_tipo_label(d.tipo::text)
           end as tipo_label,
           to_char(d.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as quando,
           d.created_at
      from public.documentos d
     where d.id = any(p_ids)
  ),
  linhas as (
    select string_agg(
             format('- %s (%s) — %s', nome_arquivo, tipo_label, quando),
             chr(10) order by created_at
           ) as txt,
           count(*) as n
      from docs
  )
  select format(
           'O parceiro %s juntou %s documento(s) ao caso. Conferir e validar:%s%s',
           coalesce(p_parceiro_nome, '(sem nome)'),
           n,
           chr(10),
           coalesce(txt, '(nenhum)')
         )
    from linhas;
$$;

-- ---------------------------------------------------------------------------
-- 2) Trigger em documentos: parceiro juntou → cria/atualiza tarefa
-- ---------------------------------------------------------------------------
create or replace function public._documento_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tipo          text;
  v_parceiro_nome text;
  v_cliente_nome  text;
  v_tarefa_id     uuid;
  v_ids           uuid[];
begin
  if NEW.uploaded_by is null or NEW.caso_id is null then
    return NEW;
  end if;

  select u.tipo, coalesce(u.nome, u.email, 'parceiro')
    into v_tipo, v_parceiro_nome
    from public.usuarios u
   where u.id = NEW.uploaded_by;

  if v_tipo is distinct from 'parceiro' then
    return NEW;
  end if;

  -- Docs subidos junto com a criação do caso já são cobertos pela tarefa
  -- "Cliente novo - Parceiro X - Analisar" (janela de 10 minutos).
  if exists (
    select 1
      from public.tarefas t
     where t.caso_id = NEW.caso_id
       and t.status in ('a_fazer', 'fazendo')
       and t.metadata->>'etapa' = 'analise_inicial_parceiro'
       and t.created_at > NEW.created_at - interval '10 minutes'
  ) then
    return NEW;
  end if;

  -- Tarefa agrupada aberta pro mesmo caso + mesmo parceiro?
  select t.id,
         coalesce(
           array(select x::uuid from jsonb_array_elements_text(t.metadata->'documento_ids') x),
           '{}'::uuid[]
         )
    into v_tarefa_id, v_ids
    from public.tarefas t
   where t.caso_id = NEW.caso_id
     and t.status = 'a_fazer'
     and (t.metadata->>'analise_documento_parceiro')::boolean is true
     and t.metadata->>'origem_parceiro_id' = NEW.uploaded_by::text
   order by t.created_at desc
   limit 1
   for update;

  if v_tarefa_id is not null then
    if not (NEW.id = any(v_ids)) then
      v_ids := v_ids || NEW.id;
    end if;
    update public.tarefas
       set metadata  = metadata || jsonb_build_object('documento_ids', to_jsonb(v_ids)),
           descricao = public._analise_docs_parceiro_descricao(v_parceiro_nome, v_ids)
     where id = v_tarefa_id;
    return NEW;
  end if;

  select cl.nome
    into v_cliente_nome
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  v_ids := array[NEW.id];

  insert into public.tarefas (
    caso_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    NEW.caso_id, 'interna', 2, 'a_fazer',
    format('Analisar documentos juntados pelo parceiro - %s',
           coalesce(v_cliente_nome, '(sem nome)')),
    public._analise_docs_parceiro_descricao(v_parceiro_nome, v_ids),
    NEW.created_at + interval '1 day',
    'manual',
    jsonb_build_object(
      'analise_documento_parceiro', true,
      'origem_parceiro_id', NEW.uploaded_by,
      'documento_ids', to_jsonb(v_ids)
    )
  );

  return NEW;
exception
  when others then
    -- Nunca derrubar o upload do parceiro por causa da tarefa.
    raise warning 'trigger % falhou: %', tg_name, sqlerrm;
    return NEW;
end;
$$;

drop trigger if exists trg_documento_parceiro_cria_tarefa on public.documentos;

create trigger trg_documento_parceiro_cria_tarefa
  after insert on public.documentos
  for each row
  execute function public._documento_parceiro_cria_tarefa();

-- ---------------------------------------------------------------------------
-- 3) Trigger em solicitacoes_documento: doc virou resposta de solicitação →
--    sai da tarefa agrupada (a solicitação tem tarefa própria)
-- ---------------------------------------------------------------------------
create or replace function public._solicitacao_documento_retira_da_analise_agrupada()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r      record;
  v_ids  uuid[];
  v_nome text;
begin
  if NEW.documento_id is null or OLD.documento_id is not distinct from NEW.documento_id then
    return NEW;
  end if;

  for r in
    select t.id, t.metadata
      from public.tarefas t
     where t.status = 'a_fazer'
       and (t.metadata->>'analise_documento_parceiro')::boolean is true
       and t.metadata->'documento_ids' ? NEW.documento_id::text
       for update
  loop
    v_ids := array(
      select x::uuid
        from jsonb_array_elements_text(r.metadata->'documento_ids') x
       where x <> NEW.documento_id::text
    );

    if coalesce(array_length(v_ids, 1), 0) = 0 then
      -- Só tinha esse documento: a tarefa da solicitação substitui esta.
      delete from public.tarefas where id = r.id;
      continue;
    end if;

    select coalesce(u.nome, u.email, 'parceiro')
      into v_nome
      from public.usuarios u
     where u.id = (r.metadata->>'origem_parceiro_id')::uuid;

    update public.tarefas
       set metadata  = metadata || jsonb_build_object('documento_ids', to_jsonb(v_ids)),
           descricao = public._analise_docs_parceiro_descricao(v_nome, v_ids)
     where id = r.id;
  end loop;

  return NEW;
exception
  when others then
    raise warning 'trigger % falhou: %', tg_name, sqlerrm;
    return NEW;
end;
$$;

drop trigger if exists trg_solicitacao_documento_retira_da_analise_agrupada
  on public.solicitacoes_documento;

create trigger trg_solicitacao_documento_retira_da_analise_agrupada
  after update on public.solicitacoes_documento
  for each row
  execute function public._solicitacao_documento_retira_da_analise_agrupada();

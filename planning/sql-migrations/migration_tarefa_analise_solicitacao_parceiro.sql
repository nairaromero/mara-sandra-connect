-- Tarefa de análise quando PARCEIRO cumpre solicitação de documento avulsa.
--
-- Contexto: o trigger trg_solicitacao_atendida_cria_tarefa já cuida das
-- solicitações nascidas de template de exigência (origem LIKE 'template:%'):
-- cria andamento + tarefa "cumprir exigência no INSS". Esse fluxo NÃO muda.
--
-- Este trigger cobre o resto: solicitação comum (sem template) marcada como
-- 'atendido' por um usuário PARCEIRO → cria tarefa pro interno analisar o
-- documento recebido. Interno cumprindo a própria solicitação não gera tarefa
-- (ele já viu o documento).
--
-- Idempotente: create or replace + drop trigger if exists.

create or replace function public._solicitacao_cumprida_parceiro_cria_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_eh_parceiro boolean;
  v_parceiro_nome text;
  v_tipo_label text;
begin
  -- Só transição para 'atendido'.
  if NEW.status is distinct from 'atendido' or OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  -- Solicitações de template de exigência ficam com o trigger antigo.
  if NEW.origem is not null and NEW.origem like 'template:%' then
    return NEW;
  end if;

  -- Só quando quem atualizou é parceiro.
  select (u.tipo = 'parceiro'), u.nome
    into v_eh_parceiro, v_parceiro_nome
    from public.usuarios u
   where u.id = auth.uid();
  if not coalesce(v_eh_parceiro, false) then
    return NEW;
  end if;

  -- Evita duplicar se a mesma solicitação for re-cumprida com análise aberta.
  if exists (
    select 1 from public.tarefas t
     where t.status = 'a_fazer'
       and t.metadata->>'origem_solicitacao_documento_id' = NEW.id::text
       and (t.metadata->>'analise_solicitacao')::boolean is true
  ) then
    return NEW;
  end if;

  v_tipo_label := initcap(replace(coalesce(NEW.tipo::text, 'documento'), '_', ' '));

  insert into public.tarefas (
    caso_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    NEW.caso_id, 'interna', 2, 'a_fazer',
    format('Analisar documento recebido — %s', v_tipo_label),
    format(
      'O parceiro %s cumpriu a solicitação de "%s". Conferir o documento enviado e validar.',
      coalesce(v_parceiro_nome, '(sem nome)'), v_tipo_label
    ),
    now(),
    'manual',
    jsonb_build_object(
      'origem_solicitacao_documento_id', NEW.id,
      'documento_id', NEW.documento_id,
      'analise_solicitacao', true
    )
  );

  return NEW;
end;
$$;

drop trigger if exists trg_solicitacao_cumprida_parceiro_cria_tarefa
  on public.solicitacoes_documento;

create trigger trg_solicitacao_cumprida_parceiro_cria_tarefa
  after update on public.solicitacoes_documento
  for each row
  execute function public._solicitacao_cumprida_parceiro_cria_tarefa();

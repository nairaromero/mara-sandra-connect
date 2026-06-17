-- migration_tarefa_cliente_novo_parceiro.sql
--
-- Cria trigger AFTER INSERT em public.casos: quando um caso tem
-- parceiro_id != null (= parceiro foi quem cadastrou), gera uma tarefa
-- "Cliente novo - Parceiro {nome} - Analisar" pra equipe interna.
--
-- due_at = created_at + 1 dia. Sem responsável (qualquer interno pega).
-- prioridade=2, tipo='interna', status='a_fazer'.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public._caso_novo_parceiro_cria_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
declare
  v_parceiro_nome text;
  v_cliente_nome text;
begin
  if NEW.parceiro_id is null then
    return NEW;
  end if;

  select coalesce(u.nome, u.email, 'parceiro')
    into v_parceiro_nome
    from public.usuarios u
   where u.id = NEW.parceiro_id;

  select c.nome
    into v_cliente_nome
    from public.clientes c
   where c.id = NEW.cliente_id;

  insert into public.tarefas (
    caso_id, tipo, prioridade, status,
    titulo, descricao, due_at, origem, metadata
  )
  values (
    NEW.id, 'interna', 2, 'a_fazer',
    format(
      'Cliente novo - Parceiro %s - Analisar',
      coalesce(v_parceiro_nome, 'parceiro')
    ),
    format(
      'Caso %s indicado pelo parceiro %s. Revisar dados, documentos e definir próximos passos.',
      coalesce(v_cliente_nome, '(sem nome)'),
      coalesce(v_parceiro_nome, '(sem nome)')
    ),
    NEW.created_at + interval '1 day',
    'manual',
    jsonb_build_object(
      'origem_caso_id', NEW.id,
      'origem_parceiro_id', NEW.parceiro_id,
      'etapa', 'analise_inicial_parceiro'
    )
  );

  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS caso_novo_parceiro_cria_tarefa ON public.casos;
CREATE TRIGGER caso_novo_parceiro_cria_tarefa
AFTER INSERT ON public.casos
FOR EACH ROW
EXECUTE FUNCTION public._caso_novo_parceiro_cria_tarefa();

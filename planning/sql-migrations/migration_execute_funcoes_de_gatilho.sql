-- ============================================================================
-- Devolve o EXECUTE que o gatilho do "Concedido" precisa, e cria o túnel que
-- responde "quem o navegador executa sem saber" (2026-09-29)
--
-- SINTOMA: aplicar o template "Concedido" pela tela (Nova tarefa → Template)
-- falhava com `permission denied for function implementacao_cadencia`, no
-- staging e em produção. O front grava as tarefas do template uma a uma, então
-- as que vinham antes da 4ª ("Acompanhamento de implementação") ficavam
-- gravadas — cada tentativa deixava uma cópia parcial do template no caso.
--
-- CAUSA: a `migration_revoke_execute_anon` (staging 19/09, produção 21/09 14:05) fechou todas as funções do
-- `public` e tirou as de gatilho da lista com o argumento "o Postgres confere o
-- privilégio no CREATE TRIGGER, não a cada disparo". Isso vale para a função
-- DO gatilho — não para as que ela chama por dentro. `tg_implementacao_due_inicial`
-- é SECURITY INVOKER: roda como quem gravou a tarefa (`authenticated`) e chama
-- `implementacao_cadencia` e `somar_dias_uteis`, que ficaram só com
-- `postgres`/`service_role`. Pelo e-mail do INSS não quebrava: lá o insert vem
-- de service role ou do `aplicar_template` (SECURITY DEFINER).
--
-- CONSERTO: as duas são conta pura (immutable, não leem nem gravam tabela) —
-- devolver o EXECUTE a `authenticated` não abre porta nenhuma.
--
-- TÚNEL: `private.funcoes_fechadas_no_caminho()` é a fonte única da pergunta
-- "que função o navegador executa sem chamar pelo nome, e está fechada para
-- ele?". Deriva do catálogo, não de lista à mão:
--   · pontos de partida: gatilho SECURITY INVOKER (roda como quem escreveu na
--     tabela) e policy que vale para `authenticated` (roda como quem consulta);
--   · segue as chamadas para `public.`/`private.` e desce recursivamente pelas
--     que também são INVOKER (as DEFINER rodam como o dono — o que elas chamam
--     por dentro não precisa do EXECUTE do navegador; elas mesmas precisam);
--   · devolve a que está sem EXECUTE para `authenticated`.
-- Quem a usa: esta migration (trava no fim), a `migration_revoke_execute_anon`
-- (trava no fim, para o próximo "fecha tudo" não repetir isto) e o
-- `scripts/rbac-conferir-exigencias.mjs` (e, por ele, a spec `rbac-exigencias`).
--
-- A leitura do corpo é textual (regex `nome(`): pega chamada qualificada e não
-- qualificada, ignora `outro_schema.nome(`. Pode acusar demais (nome de função
-- citado em comentário), nunca de menos para chamada escrita no corpo — SQL
-- dinâmico (`execute format(...)`) fica de fora e é o limite conhecido.
--
-- Idempotente.
-- ============================================================================

-- 1) o conserto
grant execute on function public.implementacao_cadencia(boolean)  to authenticated;
grant execute on function public.somar_dias_uteis(date, integer)  to authenticated;

-- 2) o túnel
create or replace function private.funcoes_fechadas_no_caminho()
returns table (origem text, funcao text)
 language sql
 stable
 set search_path to 'pg_catalog'
as $function$
  with recursive
  fn as (
    select p.oid, n.nspname::text as esquema, p.proname::text as nome,
           p.prosecdef as definer, p.prosrc as corpo
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f'
  ),
  raiz as (
    select format('gatilho %s em %s', t.tgname, t.tgrelid::regclass) as origem, f.corpo
      from pg_trigger t join fn f on f.oid = t.tgfoid
     where not t.tgisinternal and not f.definer
    union all
    select format('policy "%s" em %s', pol.polname, pol.polrelid::regclass),
           concat_ws(' ', pg_get_expr(pol.polqual, pol.polrelid),
                          pg_get_expr(pol.polwithcheck, pol.polrelid))
      from pg_policy pol
     where pol.polroles && array[0::oid, 'authenticated'::regrole::oid]
  ),
  chama (origem, oid, invoker, nivel) as (
    select r.origem, f.oid, not f.definer, 1
      from raiz r
     cross join lateral regexp_matches(r.corpo,
           '(?:\m(public|private)\.|(?<![.a-z0-9_"]))([a-z_][a-z0-9_]*)\s*\(', 'gi') m
      join fn f on f.nome = lower(m[2]) and f.esquema = coalesce(lower(m[1]), 'public')
    union
    select c.origem, f.oid, not f.definer, c.nivel + 1
      from chama c join fn pai on pai.oid = c.oid
     cross join lateral regexp_matches(pai.corpo,
           '(?:\m(public|private)\.|(?<![.a-z0-9_"]))([a-z_][a-z0-9_]*)\s*\(', 'gi') m
      join fn f on f.nome = lower(m[2]) and f.esquema = coalesce(lower(m[1]), 'public')
     where c.invoker and c.nivel < 6
  )
  select distinct c.origem,
         f.esquema || '.' || f.nome || '(' || pg_get_function_identity_arguments(f.oid) || ')'
    from chama c join fn f on f.oid = c.oid
   where not has_function_privilege('authenticated', c.oid, 'EXECUTE')
   order by 1, 2
$function$;

revoke execute on function private.funcoes_fechadas_no_caminho() from public, anon, authenticated;
grant  execute on function private.funcoes_fechadas_no_caminho() to service_role;

comment on function private.funcoes_fechadas_no_caminho() is
  'Túnel: função que gatilho INVOKER ou policy de authenticated chama (direto ou por outra INVOKER) '
  'e está sem EXECUTE para authenticated. Vazio = nada vai estourar "permission denied for function" '
  'no meio de uma escrita da tela. Conferida por scripts/rbac-conferir-exigencias.mjs.';

-- 3) trava: não sai daqui com o caminho quebrado
do $$
declare
  v text;
begin
  select string_agg(origem || ' → ' || funcao, E'\n  ') into v
    from private.funcoes_fechadas_no_caminho();
  if v is not null then
    raise exception E'EXECUTE faltando no caminho do navegador:\n  %', v;
  end if;
end $$;

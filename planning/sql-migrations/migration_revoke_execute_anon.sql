-- migration_revoke_execute_anon.sql
--
-- Fecha as funções do schema public: hoje 56 funções SECURITY DEFINER são
-- executáveis por `anon` em produção (43 RPCs no staging), entre elas
-- `webhook_cliente_ref(p_caso_id)`, que devolve nome e CPF do cliente de
-- qualquer caso sem nenhuma checagem, e as rotinas de cron, que disparam
-- e-mail (`rotina_diaria_pericia`, `enviar_lembretes_*`, `rematch_publicacoes_dje`).
--
-- A causa é o padrão do Postgres: função nova nasce com EXECUTE para PUBLIC,
-- e as migrations antigas só faziam `revoke ... from public` caso a caso. Foi
-- assim que `responsavel_tarefa_caso` ficou chamável por anon (b643ee6).
--
-- Desenho: fecha tudo e devolve o mínimo, por papel.
--   * anon e authenticated: só os 4 helpers que aparecem DENTRO de policy,
--     default, constraint ou índice — sem EXECUTE neles, a consulta do
--     próprio dono da linha falharia com "permission denied for function"
--     em vez de devolver a linha. Levantados do catálogo, não de memória:
--     caso_do_parceiro, is_admin, is_interno, parceiro_ativo.
--   * authenticated: mais as 25 RPCs que o front realmente chama
--     (`grep -rhoE '\.rpc\("[a-z_0-9]+"' src`), com a assinatura exata de
--     produção.
--   * service_role: tudo. É o papel das edge functions e do n8n, já tem
--     BYPASSRLS e DML completo — fechar função para ele não protege nada e
--     quebraria pipeline (ia_integracao_efetiva, responsavel_tarefa_caso,
--     whatsapp_*, webhook_claim_batch/mark_result).
--   * funções de gatilho não precisam de EXECUTE em runtime: o Postgres
--     confere o privilégio no CREATE TRIGGER, não a cada disparo. Por isso
--     saem da lista sem risco. MAS o que o gatilho INVOKER chama por dentro
--     precisa (item 3b) — `private.funcoes_fechadas_no_caminho()` acusa, e a
--     trava no fim deste arquivo não deixa sair sem.
--
-- `alter default privileges` no fim faz a próxima função nascer fechada, que
-- é o que impede a dívida de voltar.
--
-- Escopo conferido antes de rodar: as 124 funções de `public` são todas do
-- app (dono `postgres`). O pg_net está registrado em `public`, mas as funções
-- dele (`net.http_post` e cia.) vivem no schema `net`, e o pgcrypto em
-- `extensions` — nenhum dos dois é tocado por este revoke, então cron e
-- triggers que chamam edge function continuam funcionando.
--
-- Idempotente, com UMA armadilha: a lista de GRANT abaixo é a verdade do
-- momento. **RPC nova chamada pelo front precisa do grant aqui**, senão a
-- próxima vez que esta migration rodar derruba o acesso dela. Com o
-- `alter default privileges`, função nova já nasce fechada de qualquer jeito,
-- então o grant explícito passa a ser parte de criar RPC — não uma lembrança.

-- 1. fecha tudo para os papéis do navegador
revoke execute on all functions in schema public from public, anon, authenticated;

-- 2. backend confiável mantém tudo
grant execute on all functions in schema public to service_role;

-- 3. helpers usados dentro de policy/constraint/índice
grant execute on function public.is_interno()               to anon, authenticated;
grant execute on function public.is_admin()                 to anon, authenticated;
grant execute on function public.parceiro_ativo()           to anon, authenticated;
grant execute on function public.caso_do_parceiro(p_caso_id uuid) to anon, authenticated;

-- 3b. o que gatilho SECURITY INVOKER chama por dentro. O gatilho em si não
--     precisa de EXECUTE (cabeçalho), mas as funções que ele chama, sim: ele
--     roda como quem gravou na tabela. Esquecer isto quebrou o template
--     "Concedido" pela tela de 21/09 a 29/09 em produção (migration_execute_funcoes_de_gatilho).
--     Quem acusa o que faltar aqui: a trava no fim deste arquivo.
grant execute on function public.implementacao_cadencia(boolean) to authenticated;
grant execute on function public.somar_dias_uteis(date, integer) to authenticated;

-- 4. RPCs que o front chama com a sessão da pessoa
grant execute on function public.agenda_do_parceiro(p_desde timestamp with time zone, p_parceiro_id uuid) to authenticated;
grant execute on function public.aplicar_template(p_caso_id uuid, p_template text, p_origem text, p_origem_ref text, p_responsavel uuid) to authenticated;
grant execute on function public.audiencia_draft_texto(p_cliente text, p_quando timestamp with time zone, p_local text) to authenticated;
grant execute on function public.casos_sem_proximo_passo() to authenticated;
grant execute on function public.cumprir_troca_senha_meu_inss(p_solicitacao_id uuid, p_senha text) to authenticated;
grant execute on function public.definir_admin(p_usuario_id uuid, p_valor boolean) to authenticated;
grant execute on function public.desligar_interno(p_usuario_id uuid, p_novo_responsavel_id uuid) to authenticated;
grant execute on function public.desligar_parceiro(p_usuario_id uuid) to authenticated;
grant execute on function public.excluir_cliente(p_cliente_id uuid) to authenticated;
grant execute on function public.excluir_tarefa_com_motivo(p_id uuid, p_motivo text) to authenticated;
grant execute on function public.get_senha_meu_inss(p_cliente_id uuid) to authenticated;
grant execute on function public.log_acesso_documento(p_documento_id uuid, p_acao text) to authenticated;
grant execute on function public.pedir_troca_senha_meu_inss(p_caso_id uuid, p_prazo_at timestamp with time zone, p_motivo text) to authenticated;
grant execute on function public.pericia_draft_texto(p_natureza text, p_cliente text, p_servico text, p_protocolo text, p_quando timestamp with time zone, p_local text, p_endereco text) to authenticated;
grant execute on function public.pericias_do_caso(p_caso_id uuid) to authenticated;
grant execute on function public.precisa_definir_senha() to authenticated;
grant execute on function public.reativar_interno(p_usuario_id uuid) to authenticated;
grant execute on function public.reativar_parceiro(p_usuario_id uuid) to authenticated;
grant execute on function public.registrar_aceite_termos(p_versao text, p_dados jsonb, p_documentos jsonb, p_nome_assinatura text, p_user_agent text) to authenticated;
grant execute on function public.set_senha_meu_inss(p_cliente_id uuid, p_senha text) to authenticated;
grant execute on function public.set_webhook_secret(p_destino_id uuid, p_secret text) to authenticated;
grant execute on function public.tem_senha_meu_inss(p_cliente_id uuid) to authenticated;
grant execute on function public.uso_storage_parceiro() to authenticated;
grant execute on function public.vincular_publicacao_dje(p_pub_id uuid, p_caso_id uuid) to authenticated;
grant execute on function public.whatsapp_gerar_codigo_ativacao(p_parceiro_id uuid) to authenticated;

-- 5. o padrão para as próximas funções
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to service_role;

-- 6. trava: o "fecha tudo" não pode fechar o que a tela executa sem saber
--    (gatilho INVOKER e policy). O túnel nasce na migration_execute_funcoes_de_gatilho;
--    antes dela, a trava só avisa que não conferiu.
do $$
declare
  v text;
begin
  if to_regprocedure('private.funcoes_fechadas_no_caminho()') is null then
    raise notice 'private.funcoes_fechadas_no_caminho() ausente — caminho do navegador NÃO conferido';
    return;
  end if;
  execute $q$select string_agg(origem || ' → ' || funcao, E'\n  ')
               from private.funcoes_fechadas_no_caminho()$q$ into v;
  if v is not null then
    raise exception E'EXECUTE faltando no caminho do navegador:\n  %', v;
  end if;
end $$;

-- Conferência: quantas funções cada papel ainda alcança
select
  count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) as exec_anon,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as exec_authenticated,
  count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE')) as exec_service_role,
  count(*) filter (where p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) as secdef_anon,
  count(*) as total
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind in ('f','p');

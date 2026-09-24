-- migration_rbac_17_rpc_com_permissao.sql
--
-- Classe inversa, passo 3 de 4 (planning/RBAC_CLASSE_INVERSA.md, grupo 2):
-- três funções `SECURITY DEFINER` chamáveis pelo navegador escreviam em tabela
-- de domínio conferindo só "é interno" e "o caso é do escritório". Por serem
-- definer, elas passam POR CIMA das policies — ou seja, davam um caminho para
-- fazer pela RPC o que a tabela recusa direto.
--
--   aplicar_template      cria o pacote de tarefas   -> somar tarefas:gerenciar
--   vincular_publicacao_dje  liga publicação e gera andamento -> somar casos:editar
--   set_senha_meu_inss    grava a senha do MEU INSS  -> somar senha_inss:ler
--
-- O remendo parte da definição QUE ESTÁ NO BANCO (`pg_get_functiondef`), como
-- manda o CLAUDE.md: nada de recriar a função a partir de uma migration velha.
-- Se o trecho esperado não estiver lá, a migration PARA e avisa — é sinal de
-- que a função mudou e o remendo precisa ser revisto.
--
-- Idempotente: rodar de novo não duplica a checagem.

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      -- (função, trecho a achar, trecho novo, marca de "já aplicado")
      ('aplicar_template',
       'if auth.uid() is not null and not (public.is_interno() or public.caso_do_parceiro(p_caso_id)) then',
       'if auth.uid() is not null and not ((public.is_interno() and private.tem_permissao(''tarefas:gerenciar'')) or public.caso_do_parceiro(p_caso_id)) then',
       'tem_permissao(''tarefas:gerenciar'')'),

      ('vincular_publicacao_dje',
       'if not public.is_interno() then',
       'if not (public.is_interno() and private.tem_permissao(''casos:editar'')) then',
       'tem_permissao(''casos:editar'')'),

      ('set_senha_meu_inss',
       'if v_tipo = ''interno'' then
    v_pode := true;',
       'if v_tipo = ''interno'' then
    -- ver a senha e trocar a senha são a mesma régua (senha_inss:ler)
    v_pode := private.tem_permissao(''senha_inss:ler'');',
       'tem_permissao(''senha_inss:ler'')')
    ) as m(funcao, achar, trocar, marca)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = r.funcao
     limit 1;

    if v_def is null then
      raise warning '%: função não existe neste banco — pulada', r.funcao;
    elsif position(r.marca in v_def) > 0 then
      null; -- já aplicado
    elsif position(r.achar in v_def) = 0 then
      raise exception '%: não achei o trecho esperado. A função mudou — revisar o remendo antes de seguir.', r.funcao;
    else
      v_new := overlay(v_def placing r.trocar from position(r.achar in v_def) for length(r.achar));
      execute v_new;
      raise notice '%: checagem de permissão somada', r.funcao;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

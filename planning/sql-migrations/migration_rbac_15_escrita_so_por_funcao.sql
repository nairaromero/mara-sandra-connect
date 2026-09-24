-- migration_rbac_15_escrita_so_por_funcao.sql
--
-- Classe inversa, passo 1 de 4 (planning/RBAC_CLASSE_INVERSA.md, grupo 1b):
-- tirar do NAVEGADOR a escrita em tabelas que só o sistema escreve.
--
-- Quatorze tabelas de domínio não têm policy de permissão e ainda assim davam
-- insert/update/delete a `authenticated`. Nenhuma tela do produto escreve nelas
-- (conferido arquivo a arquivo em 24/09): quem escreve é edge function com
-- chave de serviço, ou função `SECURITY DEFINER` do próprio banco — e nenhuma
-- delas depende do grant de `authenticated`, porque roda como dona.
--
-- Entre elas está a trilha de auditoria (`acessos_documento`,
-- `acessos_senha_inss`), o histórico de exclusões (`tarefas_excluidas`) e a
-- fila de mensagens (`whatsapp_outbox`). Eram graváveis por qualquer sessão de
-- navegador do escritório.
--
-- Também tira o `execute` de dois gatilhos que estavam abertos a `anon` e
-- `authenticated` por resto de configuração antiga. Gatilho retorna `trigger`:
-- não há chamada útil de fora, mas não há motivo para a permissão existir.
--
-- Impacto no produto: nenhum. Idempotente.

do $$
declare
  t text;
  alvos text[] := array[
    'acessos_documento', 'acessos_senha_inss', 'comentario_email_throttle',
    'contratos_parceria', 'inss_email_log', 'mensagens', 'oabs_monitoradas',
    'tarefas_excluidas', 'webhook_eventos', 'whatsapp_ativacao_codigos',
    'whatsapp_lid_map', 'whatsapp_mensagens', 'whatsapp_outbox', 'whatsapp_sessoes'
  ];
begin
  foreach t in array alvos loop
    if to_regclass('public.' || t) is null then
      raise warning 'tabela public.% não existe neste banco — pulada', t;
      continue;
    end if;
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    -- leitura continua como está: quem lê é decidido pelas policies de select.
  end loop;
end $$;

-- Gatilhos: ninguém chama de fora.
do $$
declare
  f text;
begin
  foreach f in array array['_caso_fase_pelo_processo', '_reabre_caso_finalizado'] loop
    if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f) then
      execute format('revoke execute on function public.%I() from anon, authenticated', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- migration_realtime_sinos.sql
--
-- Habilita Supabase Realtime (postgres_changes) nas tabelas que alimentam os
-- sinos de notificacao, para que as notificacoes apareçam na hora, sem refresh.
--
--   - Sino interno  -> tabela `notificacoes`
--   - Sino parceiro -> andamentos, comentarios, solicitacoes_documento,
--                      documentos, processos_admin, processos_judiciais
--
-- O frontend usa o evento apenas como gatilho de re-busca (que respeita RLS),
-- entao nenhum dado sensivel e exposto pelo payload do Realtime. A RLS de
-- SELECT de cada tabela continua filtrando o que cada usuario consegue ver.
--
-- Idempotente: so adiciona a tabela a publication se ainda nao estiver la.

do $$
declare
  t text;
begin
  foreach t in array array[
    'notificacoes',
    'andamentos',
    'comentarios',
    'solicitacoes_documento',
    'documentos',
    'processos_admin',
    'processos_judiciais'
  ]
  loop
    if exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = t
      )
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = t
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'realtime: added public.%', t;
    end if;
  end loop;
end $$;

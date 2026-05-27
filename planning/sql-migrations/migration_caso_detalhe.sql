-- =============================================================================
-- Migration auxiliar para a tela /casos/{id}
-- Adiciona colunas que a tela assume existir. Idempotente: pode rodar varias vezes.
-- Rodar no Supabase Studio: SQL Editor > New query > colar e Run.
-- =============================================================================

-- 1) Coluna de visibilidade ao parceiro em andamentos
alter table public.andamentos
  add column if not exists visivel_parceiro boolean not null default false;

-- 2) Coluna de visibilidade ao parceiro em documentos
alter table public.documentos
  add column if not exists visivel_parceiro boolean not null default false;

-- 3) Coluna de resumo (filtrado) para o parceiro em analises_tecnicas
alter table public.analises_tecnicas
  add column if not exists resumo_parceiro text;

-- 4) Indices uteis (idempotentes)
create index if not exists idx_andamentos_caso_created
  on public.andamentos (caso_id, created_at desc);

create index if not exists idx_documentos_caso_created
  on public.documentos (caso_id, created_at desc);

create index if not exists idx_mensagens_caso_created
  on public.mensagens (caso_id, created_at asc);

create index if not exists idx_repasses_caso
  on public.repasses (caso_id);

create index if not exists idx_solicitacoes_caso_status
  on public.solicitacoes_documento (caso_id, status);

create index if not exists idx_analises_caso_versao
  on public.analises_tecnicas (caso_id, versao desc);

-- =============================================================================
-- ATENCAO sobre RLS:
-- A tela faz select direto nas tabelas. As policies precisam permitir:
--   - interno: SELECT/INSERT/UPDATE em todas as tabelas relacionadas ao caso
--   - parceiro: SELECT nos casos onde caso.parceiro_id = auth.uid()
--               e filtrado por visivel_parceiro = true em andamentos/documentos
--
-- Se as policies atuais ja cobrem isso, nada a fazer aqui.
-- Caso contrario, exemplo de policy para andamentos (ajustar nomes):
--
-- create policy "andamentos_select_parceiro"
--   on public.andamentos for select
--   using (
--     caso_do_parceiro(caso_id) and visivel_parceiro = true
--   );
--
-- create policy "andamentos_select_interno"
--   on public.andamentos for select
--   using (is_interno());
-- =============================================================================

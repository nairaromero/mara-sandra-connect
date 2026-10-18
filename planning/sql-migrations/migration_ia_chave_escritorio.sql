-- ============================================================================
-- IA · chave por escritório e registro de uso (2026-10-01, #451 parte 2)
--
-- Antes: a chave de IA era de uma PESSOA (ia_integracoes, uma por usuário),
-- e o escritório "tinha IA" quando alguém marcava a própria como
-- compartilhada. Se essa pessoa saísse, a IA do escritório ia junto; e quem
-- paga e para onde vai o dado ficava preso a uma conta pessoal.
--
-- Agora:
--   1. escritorio_integracoes aceita tipo 'ia' (provider e modelo em config;
--      a chave cifrada nas mesmas colunas de Legalmail/TI, gravada só pela
--      function integracoes-escritorio, que audita). Quem decide qual chave
--      vale é _shared/ia-integracao.ts (carregarIntegracao): a do escritório.
--      A chave pessoal deixa de valer.
--   2. a chave compartilhada que existir vira a do escritório (cópia do
--      segredo já cifrado: as duas tabelas usam a mesma IA_MASTER_KEY).
--   3. ia_uso: uma linha por chamada ao provider, gravada pelo adaptador
--      (_shared/ia-providers.ts) — escritório, função, provider, modelo,
--      tokens de entrada/saída/raciocínio, motivo da parada, duração. Sem
--      conteúdo. Leitura de quem gerencia integrações no escritório ativo.
--
-- ia_integracoes e a RPC ia_integracao_efetiva ficam (histórico e tokens do
-- MCP não dependem delas); nenhuma function lê mais a RPC.
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipo 'ia' em escritorio_integracoes
-- ---------------------------------------------------------------------------
alter table public.escritorio_integracoes
  drop constraint if exists escritorio_integracoes_tipo_check;
alter table public.escritorio_integracoes
  add constraint escritorio_integracoes_tipo_check
  check (tipo in ('whatsapp', 'legalmail', 'ti', 'djen', 'ia'));

-- ---------------------------------------------------------------------------
-- 2. A chave compartilhada vira a chave do escritório
-- ---------------------------------------------------------------------------
-- `on conflict do nothing`: rodar de novo não sobrescreve a chave que o
-- escritório já cadastrou pela tela depois da migração.
insert into public.escritorio_integracoes
  (escritorio_id, tipo, ativo, config, segredo_cipher, segredo_iv,
   segredo_definido_em, atualizado_por, updated_at)
select i.escritorio_id,
       'ia',
       i.ativo,
       jsonb_build_object('provider', i.provider, 'modelo', i.modelo,
                          'hint', i.api_key_hint, 'origem', 'chave_compartilhada'),
       i.api_key_cipher,
       i.api_key_iv,
       coalesce(i.atualizado_em, now()),
       i.usuario_id,
       now()
  from public.ia_integracoes i
 where i.compartilhada
   and i.escritorio_id is not null
   and i.api_key_cipher is not null
   and i.api_key_iv is not null
on conflict (escritorio_id, tipo) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Registro de uso da IA
-- ---------------------------------------------------------------------------
create table if not exists public.ia_uso (
  id               bigint generated always as identity primary key,
  escritorio_id    uuid not null references public.escritorios (id) on delete cascade,
  usuario_id       uuid references public.usuarios (id) on delete set null,
  -- edge function que chamou (sugerir-proxima-tarefa, ia-analise...)
  funcao           text not null,
  provider         text not null,
  modelo           text not null,
  -- de quem era a chave cobrada
  origem_chave     text not null,
  tokens_entrada   integer not null default 0,
  tokens_saida     integer not null default 0,
  -- parte da saída gasta no raciocínio, quando o provider informa
  tokens_raciocinio integer,
  parada           text,
  cortada          boolean not null default false,
  -- só a classe da falha (http_400, timeout, cortada...), nunca texto do provider
  erro             text,
  duracao_ms       integer not null,
  criado_em        timestamptz not null default now()
);
alter table public.ia_uso drop constraint if exists ia_uso_origem_chave_check;
alter table public.ia_uso add constraint ia_uso_origem_chave_check
  check (origem_chave in ('escritorio', 'teste'));

create index if not exists ia_uso_esc_idx on public.ia_uso (escritorio_id, criado_em desc);

comment on table public.ia_uso is
  'Uma linha por chamada de IA (migration_ia_chave_escritorio). Escrita só pelo adaptador (service role); sem conteúdo. Leitura de quem gerencia integrações.';

drop trigger if exists aa_herdar_escritorio on public.ia_uso;
create trigger aa_herdar_escritorio before insert or update of escritorio_id on public.ia_uso
  for each row execute function private.tg_herdar_escritorio('usuario_id=usuarios');

alter table public.ia_uso enable row level security;

drop policy if exists isolamento_escritorio on public.ia_uso;
create policy isolamento_escritorio on public.ia_uso as restrictive
  for all to authenticated
  using (escritorio_id = (select private.escritorio_ativo()))
  with check (escritorio_id = (select private.escritorio_ativo()));

drop policy if exists espelho_leitura_select on public.ia_uso;
create policy espelho_leitura_select on public.ia_uso
  for select to espelho_leitura using (true);

drop policy if exists ia_uso_select_gestor on public.ia_uso;
create policy ia_uso_select_gestor on public.ia_uso
  for select to authenticated
  using ((select private.tem_permissao('integracoes:gerenciar', null)));

-- escrita: só service role (nenhuma policy permissiva de insert/update/delete)
revoke insert, update, delete on public.ia_uso from authenticated, anon;
grant select on public.ia_uso to authenticated;

notify pgrst, 'reload schema';

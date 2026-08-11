-- migration_notificacao_por_pessoa.sql
--
-- Faz o sino ser de cada pessoa, e não do escritório.
--
-- Dois defeitos, que só ficaram evidentes depois que o e-mail passou a
-- respeitar o destinatário da conversa (migration_comentario_destinatario):
--
-- 1) A notificação não tinha dono. Comentário de parceiro acendia o sino de
--    todo mundo, mesmo depois que o e-mail já ia só pra uma pessoa.
--
-- 2) Dispensar era DESTRUTIVO E GLOBAL. O sino não marcava como lida — ele
--    fazia `delete from notificacoes`. Uma pessoa clicava e a notificação
--    sumia do sino de todas as outras, sem volta. (A coluna `lida` existe mas
--    estava praticamente sem uso: 9 linhas, nenhuma marcada.)
--
-- Depois desta migration:
--   destinatario_id preenchido -> acende só o sino daquela pessoa
--   destinatario_id NULL       -> escritório inteiro, como sempre foi
--   dispensar                  -> grava linha em notificacao_dispensada,
--                                 e não apaga mais nada
--
-- A coluna `lida` fica onde está, de propósito: `sync-ti-todos` usa ela pra
-- trocar o agregado de "clientes do TI pra cadastrar" (`delete where tipo=
-- 'cliente_ti' and lida=false`). Mexer nela quebraria aquilo sem necessidade.
--
-- Idempotente.

-- 1) Dono da notificação ------------------------------------------------------
alter table public.notificacoes
  add column if not exists destinatario_id uuid references public.usuarios(id);

comment on column public.notificacoes.destinatario_id is
  'Pra quem e o sino. NULL = todos os internos (comportamento historico). '
  'Comentario de parceiro herda o destinatario da conversa, pra o sino contar '
  'a mesma historia que o e-mail.';

create index if not exists notificacoes_destinatario_idx
    on public.notificacoes (destinatario_id)
 where destinatario_id is not null;

-- 2) Dispensa por pessoa ------------------------------------------------------
-- Mesmo desenho de `conversa_leitura`, que ja resolve isso pras conversas:
-- estado de leitura numa tabela lateral, com chave (usuario, item).
create table if not exists public.notificacao_dispensada (
  usuario_id      uuid not null references public.usuarios(id) on delete cascade,
  notificacao_id  uuid not null references public.notificacoes(id) on delete cascade,
  dispensada_em   timestamptz not null default now(),
  primary key (usuario_id, notificacao_id)
);

comment on table public.notificacao_dispensada is
  'Quem ja dispensou qual notificacao. Substitui o delete global que o sino '
  'fazia: agora sumir do sino de uma pessoa nao apaga o registro nem tira do '
  'sino das outras.';

alter table public.notificacao_dispensada enable row level security;

-- Cada um cuida das proprias dispensas.
drop policy if exists notificacao_dispensada_self on public.notificacao_dispensada;
create policy notificacao_dispensada_self on public.notificacao_dispensada
  for all
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- GRANTs explicitos: tabela criada pela Management API NAO recebe os defaults
-- do Supabase, e o sintoma e "permission denied" silencioso na edge function.
-- Ja mordeu antes, na tabela `notificacoes`.
grant all on table public.notificacao_dispensada to service_role;
grant select, insert, update, delete on table public.notificacao_dispensada to authenticated;

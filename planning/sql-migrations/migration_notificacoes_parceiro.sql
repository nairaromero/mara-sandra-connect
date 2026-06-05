-- =============================================================================
-- Migration: notificacoes do PARCEIRO -> EQUIPE (interno)
--
-- Permite que acoes do parceiro (comentario, documento enviado, caso novo)
-- gerem notificacao no sino do interno. Para isso:
--   1) amplia os tipos aceitos em notificacoes.tipo;
--   2) deixa o parceiro INSERIR notificacao para os casos dele (RLS).
--
-- O SELECT continua restrito a interno (parceiro nao le o sino do interno).
-- Idempotente.
-- =============================================================================

alter table public.notificacoes
  drop constraint if exists notificacoes_tipo_check;

alter table public.notificacoes
  add constraint notificacoes_tipo_check
  check (
    tipo in (
      'andamento', 'cliente_ti', 'tags', 'processo',
      'comentario', 'documento', 'caso', 'solicitacao'
    )
  );

-- Parceiro pode inserir notificacao apenas para casos dele.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notificacoes'
      and policyname = 'notificacoes_parceiro_insert'
  ) then
    create policy "notificacoes_parceiro_insert"
    on public.notificacoes
    as permissive
    for insert
    to authenticated
    with check (caso_id is not null and public.caso_do_parceiro(caso_id));
  end if;
end$$;

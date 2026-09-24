-- migration_rbac_16_notificacao_e_comentario.sql
--
-- Classe inversa, passo 2 de 4 (planning/RBAC_CLASSE_INVERSA.md): dois casos
-- que não são política, são bug.
--
-- 1. NOTIFICAÇÕES. `notificacoes.destinatario_id` nulo significa "todos os
--    internos": a linha é COMPARTILHADA. O sino já tinha sido corrigido uma vez
--    — "dispensar" virou `notificacao_dispensada`, por pessoa, justamente
--    porque o delete sumia com o aviso da equipe inteira. O "Limpar todas"
--    ficou para trás e continuava apagando as linhas.
--    Aqui o banco passa a aceitar delete só da notificação ENDEREÇADA a quem
--    pede. Linha compartilhada não se apaga pelo navegador: dispensa-se.
--    (O front, no mesmo lote, passa a dispensar em vez de apagar.)
--
-- 2. COMENTÁRIOS. `comentarios_delete` aceitava "o autor OU qualquer interno",
--    então um interno apagava o comentário de outro sem deixar rastro. Passa a
--    ser "o autor, ou admin" — a mesma régua de quem responde pelo escritório.
--
-- Não mexe em dado nenhum, só em quem pode. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Notificações: apagar só a que é sua
-- ---------------------------------------------------------------------------
-- A permissiva de interno cobria ALL (select/insert/update/delete). Continua
-- cobrindo tudo, menos delete, que ganha regra própria.
drop policy if exists notificacoes_interno_all on public.notificacoes;
create policy notificacoes_interno_all on public.notificacoes
  for all to authenticated
  using ((select public.is_interno()))
  with check ((select public.is_interno()));

drop policy if exists notificacoes_delete_propria on public.notificacoes;
create policy notificacoes_delete_propria on public.notificacoes
  as restrictive
  for delete to authenticated
  using (destinatario_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Comentários: apagar é do autor (ou do admin)
-- ---------------------------------------------------------------------------
drop policy if exists comentarios_delete on public.comentarios;
create policy comentarios_delete on public.comentarios
  for delete to authenticated
  using (autor_id = (select auth.uid()) or (select public.is_admin()));

notify pgrst, 'reload schema';

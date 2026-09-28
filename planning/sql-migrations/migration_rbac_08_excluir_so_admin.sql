-- ============================================================================
-- RBAC 08 · Excluir cliente e excluir parceiro passam a ser só do admin
-- (2026-09-23, aprovado pelo Yuri em 22/09)
--
-- A migration 01 manteve as duas permissões no papel Advogado de propósito
-- ("no escritório 1 ninguém ganha nem perde acesso até aprovação"). Aprovado:
-- exclusão é irreversível (excluir_cliente apaga em cascata, sem lixeira) e
-- rara — advogado que precisar pede ao administrador. O banco já recusa por
-- policy/RPC quem não tem a permissão; a tela esconde o botão por pode().
-- Idempotente: re-rodar não faz nada.
-- ============================================================================

delete from public.papel_permissoes pp
 using public.papeis p
 where p.id = pp.papel_id
   and p.escritorio_id is null
   and p.chave = 'advogado'
   and pp.permissao in ('clientes:excluir', 'parceiros:excluir');

-- Papel de escritório copiado do sistema (se algum dia existir) segue a
-- mesma regra — aqui só os de sistema existem, mas a regra é do produto.
delete from public.papel_permissoes pp
 using public.papeis p
 where p.id = pp.papel_id
   and p.chave = 'advogado'
   and pp.permissao in ('clientes:excluir', 'parceiros:excluir');

notify pgrst, 'reload schema';

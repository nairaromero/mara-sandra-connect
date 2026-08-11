-- migration_merge_beatriz_conta_unica.sql
--
-- Funde as duas contas da Beatriz numa so.
--
-- Situacao antes:
--   0d471a8c-909d-416a-a869-8d007097d1b1  Beatriz Santiago  tipo=interno
--     advocacia.beatrizsan@outlook.com — a conta que ela usa de verdade.
--   6a9e0dd1-2748-4797-9d97-b5fad496e565  Beatriz           tipo=parceiro
--     nairaromerovian+beatrizsp@gmail.com — e-mail de teste, nunca logou.
--
-- A conta parceira so tem 9 casos pendurados nela: zero repasses, comentarios,
-- tarefas, documentos, OABs monitoradas, WhatsApp ou webhooks. Por isso a fusao
-- e barata — checado antes de escrever isto.
--
-- Depois: uma conta so (a interna, com o e-mail real), marcada eh_parceiro=true.
-- Ela entra como equipe, continua aparecendo no seletor de parceiro do caso e
-- recebe os 30% dos casos que indicou.
--
-- PRE-REQUISITO: migration_eh_parceiro_flag.sql aplicada, e o frontend que
-- filtra por eh_parceiro ja em producao. Rodar isto antes do frontend subir faz
-- a Beatriz sumir do seletor de parceiro ate o deploy — os casos existentes
-- continuam certos, mas nao daria pra indicar caso novo pra ela nesse intervalo.
--
-- NAO e idempotente (deleta uma conta). Rodar uma vez so.

begin;

-- 1) A conta que fica vira tambem parceira comercial.
--    percentual_parceiro ja e 30 nas duas; oab_uf so existe na conta parceira.
update public.usuarios
   set eh_parceiro        = true,
       percentual_parceiro = 30,
       oab_uf              = coalesce(oab_uf, 'SP')
 where id = '0d471a8c-909d-416a-a869-8d007097d1b1';

-- 2) Os 9 casos indicados por ela passam a apontar pra conta que fica.
--    E o que preserva o repasse.
update public.casos
   set parceiro_id = '0d471a8c-909d-416a-a869-8d007097d1b1'
 where parceiro_id = '6a9e0dd1-2748-4797-9d97-b5fad496e565';

-- 3) Confere que nada sobrou apontando pra conta antiga antes de apaga-la.
--    Se sobrou, aborta a transacao inteira em vez de deixar orfao.
do $$
declare
  v_restantes int;
begin
  select count(*) into v_restantes
    from public.casos
   where parceiro_id = '6a9e0dd1-2748-4797-9d97-b5fad496e565';
  if v_restantes > 0 then
    raise exception 'ainda ha % caso(s) na conta antiga — abortando', v_restantes;
  end if;
end $$;

-- 4) Remove a conta duplicada. public.usuarios cai junto por
--    usuarios_id_fkey ON DELETE CASCADE.
delete from auth.users
 where id = '6a9e0dd1-2748-4797-9d97-b5fad496e565';

commit;

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
-- A conta de teste so tem 9 casos pendurados nela: zero repasses, comentarios,
-- tarefas, documentos, aceites, OABs monitoradas, WhatsApp ou webhooks —
-- conferido antes de escrever isto. O unico papel dela era ser a etiqueta que
-- diz "esses 9 casos sao indicacao da Beatriz".
--
-- Depois: uma conta so (a real), marcada eh_parceiro=true. Ela entra como
-- equipe, continua no seletor de parceiro do caso e recebe os 30% dos casos que
-- indicou.
--
-- A conta de teste e DESATIVADA, nao apagada (decisao da Naira em 2026-08-11).
-- Ela some da tela de parceiros e dos seletores, mas a linha continua no banco e
-- da pra reverter. O custo de nao apagar: o e-mail
-- nairaromerovian+beatrizsp@gmail.com fica ocupado pra sempre no Supabase Auth,
-- entao nao serve mais pra testar outro parceiro.
--
-- PRE-REQUISITO: migration_eh_parceiro_flag.sql aplicada e o frontend que filtra
-- por eh_parceiro em producao. Ambos cumpridos em 2026-08-11.
--
-- Idempotente: rodar de novo nao muda nada.

begin;

-- 1) A conta que fica vira tambem parceira comercial.
--    percentual_parceiro ja e 30 nas duas; oab_uf so existe na conta de teste.
update public.usuarios
   set eh_parceiro         = true,
       percentual_parceiro = 30,
       oab_uf              = coalesce(oab_uf, 'SP')
 where id = '0d471a8c-909d-416a-a869-8d007097d1b1';

-- 2) Os 9 casos indicados por ela passam a apontar pra conta que fica.
--    E o que preserva o repasse.
update public.casos
   set parceiro_id = '0d471a8c-909d-416a-a869-8d007097d1b1'
 where parceiro_id = '6a9e0dd1-2748-4797-9d97-b5fad496e565';

-- 3) Trava: se sobrou qualquer caso na conta de teste, aborta tudo em vez de
--    desativar uma conta que ainda esta em uso.
do $$
declare
  v_restantes int;
begin
  select count(*) into v_restantes
    from public.casos
   where parceiro_id = '6a9e0dd1-2748-4797-9d97-b5fad496e565';
  if v_restantes > 0 then
    raise exception 'ainda ha % caso(s) na conta de teste — abortando', v_restantes;
  end if;
end $$;

-- 4) Desativa a conta de teste. eh_parceiro=false tira ela da tela de parceiros
--    e dos seletores; ativo=false impede login. O nome deixa claro por que essa
--    linha existe, pra ninguem no futuro achar que e uma parceira de verdade.
update public.usuarios
   set ativo       = false,
       eh_parceiro = false,
       nome        = 'Beatriz (conta de teste desativada — ver conta de equipe)'
 where id = '6a9e0dd1-2748-4797-9d97-b5fad496e565';

commit;

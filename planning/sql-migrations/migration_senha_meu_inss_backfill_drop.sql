-- =============================================================================
-- Migration: backfill das senhas existentes + drop da coluna plain.
--
-- Pre-requisitos:
--   1) migration_senha_meu_inss_encryption.sql ja aplicada
--   2) app.inss_key configurada (vide instrucoes naquele arquivo)
--
-- O QUE FAZ:
--   1) Para cada cliente com senha_meu_inss_plain nao-nulo, criptografa
--      e grava em senha_meu_inss (a coluna nova bytea).
--   2) Verifica visualmente que todas as senhas foram migradas.
--   3) Dropa a coluna senha_meu_inss_plain (RUN SEPARADAMENTE apos
--      validacao - linha comentada por padrao).
--
-- ATENCAO: o passo 3 (drop) e irreversivel. Faca um backup antes.
--
-- Idempotente nos passos 1 e 2. O passo 3 so funciona uma vez.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Passo 1: backfill
-- ---------------------------------------------------------------------------
-- Roda como postgres role (no SQL Editor), entao tem acesso direto a chave.
update public.clientes
   set senha_meu_inss = pgp_sym_encrypt(
     senha_meu_inss_plain,
     current_setting('app.inss_key')
   )
 where senha_meu_inss_plain is not null
   and (senha_meu_inss is null);

-- ---------------------------------------------------------------------------
-- Passo 2: verificar contagem
-- ---------------------------------------------------------------------------
-- Rode estas queries manualmente e confirme:
--
-- select count(*) as total_com_senha_plain
--   from public.clientes where senha_meu_inss_plain is not null;
--
-- select count(*) as total_com_senha_cripto
--   from public.clientes where senha_meu_inss is not null;
--
-- Os dois numeros tem que bater. Se baterem, prosseguir pro passo 3.
--
-- Sanity check: pegar um cliente especifico e ver se decripta certo:
-- select id, nome, pgp_sym_decrypt(senha_meu_inss, current_setting('app.inss_key'))
--   from public.clientes
--  where senha_meu_inss is not null
--  limit 1;

-- ---------------------------------------------------------------------------
-- Passo 3: drop da coluna plain.
-- ---------------------------------------------------------------------------
-- DESCOMENTE A LINHA ABAIXO MANUALMENTE somente apos confirmar o passo 2:
--
-- alter table public.clientes drop column senha_meu_inss_plain;

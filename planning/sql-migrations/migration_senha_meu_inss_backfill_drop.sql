-- =============================================================================
-- Migration: backfill das senhas existentes + drop da coluna plain.
--
-- Pre-requisitos:
--   1) migration_senha_meu_inss_encryption.sql ja aplicada.
--   2) Segredo 'inss_encryption_key' criado no Supabase Vault.
--
-- O QUE FAZ:
--   1) Para cada cliente com senha_meu_inss_plain nao-nulo, criptografa
--      e grava em senha_meu_inss (a coluna nova bytea).
--   2) Queries de verificacao manual (comentadas no arquivo).
--   3) Drop da coluna senha_meu_inss_plain (linha comentada por seguranca -
--      voce descomenta manualmente apos validar).
--
-- ATENCAO: o passo 3 (drop) e irreversivel. Faca backup antes.
--
-- Idempotente nos passos 1 e 2.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Passo 1: backfill
-- ---------------------------------------------------------------------------
-- Usa o helper _inss_get_key() que le do Vault. Como o helper e
-- security definer, ele tem acesso ao segredo sem precisar de superuser.
update public.clientes
   set senha_meu_inss = pgp_sym_encrypt(
     senha_meu_inss_plain,
     public._inss_get_key()
   )
 where senha_meu_inss_plain is not null
   and senha_meu_inss is null;

-- ---------------------------------------------------------------------------
-- Passo 2: verificar contagem (rode estas queries manualmente)
-- ---------------------------------------------------------------------------
-- select count(*) as total_com_senha_plain
--   from public.clientes where senha_meu_inss_plain is not null;
--
-- select count(*) as total_com_senha_cripto
--   from public.clientes where senha_meu_inss is not null;
--
-- Os dois numeros tem que bater.
--
-- Sanity check: pegar um cliente especifico e ver se decripta certo:
-- select id, nome,
--        pgp_sym_decrypt(senha_meu_inss, public._inss_get_key()) as senha_decifrada
--   from public.clientes
--  where senha_meu_inss is not null
--  limit 1;

-- ---------------------------------------------------------------------------
-- Passo 3: drop da coluna plain.
-- ---------------------------------------------------------------------------
-- DESCOMENTE A LINHA ABAIXO MANUALMENTE somente apos confirmar o passo 2:
--
-- alter table public.clientes drop column senha_meu_inss_plain;

-- Migration: adiciona 'djen' ao enum origem_andamento
--
-- A coluna andamentos.origem é um ENUM (origem_andamento), NÃO texto livre.
-- A integração DJE (Comunica API/DJEN) grava andamentos com origem='djen', então
-- o valor precisa existir no enum — senão todo INSERT falha com:
--   "invalid input value for enum origem_andamento: \"djen\""
--
-- Descoberto no dry-run da function sync-djen-publicacoes (2026-06-05).
--
-- Obs.: ALTER TYPE ... ADD VALUE deve rodar FORA de um bloco que já use o valor
-- novo. Mantemos esta migration isolada (só adiciona o valor); a criação da
-- tabela oabs_monitoradas e qualquer uso de 'djen' ficam em migrations separadas.

ALTER TYPE public.origem_andamento ADD VALUE IF NOT EXISTS 'djen';

-- =============================================================================
-- Migration: tipo de beneficio no processo administrativo
--
-- Cada requerimento administrativo (INSS) pode ser de um beneficio especifico.
-- Coluna textual, valores vindos da lista fixa TIPOS_BENEFICIO do app.
--
-- Idempotente. Rodar no SQL Editor do Supabase Studio ou via CLI.
-- =============================================================================

alter table public.processos_admin
  add column if not exists tipo_beneficio text;

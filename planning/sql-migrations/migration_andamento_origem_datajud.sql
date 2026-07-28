-- Migration: adiciona 'datajud' ao enum origem_andamento
--
-- Fase 2 do planning/PROCESSOS_GLOBAL.md: a edge function
-- sync-datajud-movimentacoes grava as movimentações processuais vindas da API
-- pública DataJud/CNJ como andamentos com origem='datajud'.
--
-- Mesmo padrão da migration_andamento_origem_djen.sql: ALTER TYPE ... ADD VALUE
-- isolado numa migration própria (não pode rodar no mesmo bloco que já usa o
-- valor novo).

ALTER TYPE public.origem_andamento ADD VALUE IF NOT EXISTS 'datajud';

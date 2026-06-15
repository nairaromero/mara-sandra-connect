-- =============================================================================
-- Migration: andamentos.origem += 'inss_email'
--
-- A edge function `inss-email-processor` cria andamentos a partir de e-mails
-- do INSS. Esse canal não existia no enum `origem_andamento` (só tinha
-- interno/tramitacao/legalmail/sistema/djen). Adiciona o valor.
--
-- Idempotente: IF NOT EXISTS via ADD VALUE não existe nativamente, então
-- usamos pg_enum check antes do alter.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'origem_andamento'
      and e.enumlabel = 'inss_email'
  ) then
    alter type public.origem_andamento add value 'inss_email';
  end if;
end$$;

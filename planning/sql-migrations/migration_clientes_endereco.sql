-- Migration: adiciona endereco (opcional) ao cliente.
-- Campo texto livre, nullable. Exposto MASCARADO para a IA (ver ia-redact.ts:
-- maskEndereco). Na UI/app aparece completo.
alter table public.clientes add column if not exists endereco text;

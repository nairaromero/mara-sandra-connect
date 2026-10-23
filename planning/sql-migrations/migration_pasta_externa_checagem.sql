-- =============================================================================
-- Migration: o link da pasta guarda o que a última checagem viu (card #434)
--
-- Pedido da Naira (2026-10-20): quando o parceiro compartilha a pasta, ninguém
-- sabe se ele realmente liberou o acesso. A descoberta vinha dias depois, com
-- alguém da equipe levando um pedido de login na cara.
--
-- A function `checar-link-pasta` tenta abrir o link sem credencial nenhuma e
-- diz o que viu. O resultado fica guardado aqui para a tela mostrar sem
-- precisar conferir de novo a cada vez que alguém abre o caso.
--
--   aberto     abriu sem pedir login
--   fechado    pediu login, ou o provedor recusou
--   indefinido não deu para dizer (fora do ar, provedor desconhecido)
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

alter table public.caso_pastas_externas
  add column if not exists checado_em timestamptz,
  add column if not exists checado_status text,
  add column if not exists checado_detalhe text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.caso_pastas_externas'::regclass
       and conname = 'caso_pastas_externas_checado_status'
  ) then
    alter table public.caso_pastas_externas
      add constraint caso_pastas_externas_checado_status
      check (checado_status is null or checado_status in ('aberto', 'fechado', 'indefinido'));
  end if;
end $$;

comment on column public.caso_pastas_externas.checado_status is
  'Última checagem do link pela function checar-link-pasta: aberto | fechado | indefinido.';

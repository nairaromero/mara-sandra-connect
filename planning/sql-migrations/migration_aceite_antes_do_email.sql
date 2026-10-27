-- =============================================================================
-- Migration: parceiro sem aceite dos termos recebe aviso sem dado de cliente,
-- no máximo um por dia (card #249).
--
-- As três functions que mandam e-mail com o nome do cliente (andamento,
-- comentário, pedido de documento) passam a conferir o aceite
-- (`aceiteValido`, supabase/functions/_shared/termos.ts). Sem aceite, vai um
-- aviso genérico (_shared/aviso-sem-aceite.ts). O "um por dia" mora aqui, no
-- calendário de Brasília, por escritório e parceiro.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- 1) O último aviso mandado a cada parceiro, por escritório (molde rbac_02)
create table if not exists public.avisos_aceite_pendente (
  escritorio_id   uuid not null references public.escritorios (id),
  usuario_id      uuid not null references public.usuarios (id) on delete cascade,
  ultimo_aviso_em timestamptz not null default now(),
  total           int not null default 1,
  primary key (escritorio_id, usuario_id)
);

comment on table public.avisos_aceite_pendente is
  'Último aviso "assine os termos" mandado a um parceiro sem aceite, por escritório (#249). Só o sistema grava.';

drop trigger if exists aa_herdar_escritorio on public.avisos_aceite_pendente;
create trigger aa_herdar_escritorio
  before insert or update of escritorio_id on public.avisos_aceite_pendente
  for each row execute function private.tg_herdar_escritorio('usuario_id=usuarios');

alter table public.avisos_aceite_pendente enable row level security;

drop policy if exists isolamento_escritorio on public.avisos_aceite_pendente;
create policy isolamento_escritorio on public.avisos_aceite_pendente
  as restrictive for all to authenticated
  using (escritorio_id = (select private.escritorio_ativo()))
  with check (escritorio_id = (select private.escritorio_ativo()));

-- Ninguém da tela lê nem grava: só as functions, pelo sistema.
revoke all on public.avisos_aceite_pendente from anon, authenticated;

-- 2) Reservar a vaga do dia. TRUE = pode mandar agora (e a vaga fica tomada).
-- Atômico: dois eventos no mesmo instante não mandam dois avisos.
create or replace function public.reservar_aviso_aceite(p_escritorio uuid, p_usuario uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.avisos_aceite_pendente as a (escritorio_id, usuario_id, ultimo_aviso_em, total)
  values (p_escritorio, p_usuario, now(), 1)
  on conflict (escritorio_id, usuario_id) do update
     set ultimo_aviso_em = now(), total = a.total + 1
   where private.dia_brt(a.ultimo_aviso_em) < private.dia_brt(now());
  return found;
end;
$$;

-- 3) Devolver a vaga quando o envio falhou (senão o aviso que não saiu
-- contaria como mandado até amanhã).
create or replace function public.liberar_aviso_aceite(p_escritorio uuid, p_usuario uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.avisos_aceite_pendente
   where escritorio_id = p_escritorio and usuario_id = p_usuario
     and private.dia_brt(ultimo_aviso_em) = private.dia_brt(now());
$$;

revoke all on function public.reservar_aviso_aceite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.liberar_aviso_aceite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reservar_aviso_aceite(uuid, uuid) to service_role;
grant execute on function public.liberar_aviso_aceite(uuid, uuid) to service_role;

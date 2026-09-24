-- migration_rbac_19_ticket_de_suporte.sql
--
-- O número do pedido de acesso de suporte passa a ser GERADO pelo servidor.
--
-- Antes, quem pedia digitava o "ticket" à mão, num campo livre e opcional. Dois
-- problemas, os dois vistos no staging em 24/09: o mesmo número em três pedidos
-- diferentes (ninguém lembra o que já usou) e nada que impeça repetir. Um
-- número que não identifica não serve para o que existe: achar o pedido na
-- auditoria e na conversa com o escritório.
--
-- Agora:
--   * `private.novo_ticket_suporte()` devolve SUP-<ano>-<sequência>, com a
--     sequência no banco — duas pessoas pedindo ao mesmo tempo recebem números
--     diferentes, porque quem numera é o Postgres, não a tela;
--   * a coluna ganha default, NOT NULL e UNIQUE: nem a RPC nem um insert direto
--     conseguem repetir ou deixar em branco;
--   * `qg_suporte_solicitar` perde o parâmetro `p_ticket` (a assinatura antiga é
--     removida para não sobrar overload que o PostgREST escolha por engano).
--
-- Os pedidos que já existem são RENUMERADOS no formato novo. Hoje são poucos e
-- todos de teste (local 1, staging 3, produção 0 — o RBAC ainda não foi para a
-- produção); renumerar é o que torna o UNIQUE possível sem inventar exceção.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. O gerador
-- ---------------------------------------------------------------------------
create sequence if not exists private.suporte_ticket_seq as bigint start 1;

create or replace function private.novo_ticket_suporte() returns text
language sql volatile security definer set search_path = '' as $$
  select 'SUP-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-'
         || lpad(nextval('private.suporte_ticket_seq')::text, 4, '0')
$$;

revoke execute on function private.novo_ticket_suporte() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A coluna: default, sem nulo e sem repetido
-- ---------------------------------------------------------------------------
-- Renumera o que já existe (inclusive o que foi digitado repetido).
update public.acessos_suporte
   set ticket = private.novo_ticket_suporte()
 where ticket is null
    or ticket !~ '^SUP-[0-9]{4}-[0-9]{4,}$';

alter table public.acessos_suporte
  alter column ticket set default private.novo_ticket_suporte();

alter table public.acessos_suporte
  alter column ticket set not null;

create unique index if not exists acessos_suporte_ticket_key
  on public.acessos_suporte (ticket);

-- ---------------------------------------------------------------------------
-- 3. A RPC não recebe mais o número
-- ---------------------------------------------------------------------------
drop function if exists public.qg_suporte_solicitar(uuid, text, text, int, boolean);

create or replace function public.qg_suporte_solicitar(p_escritorio_id uuid, p_motivo text,
                                                        p_horas int default 4,
                                                        p_break_glass boolean default false)
returns table (id uuid, ticket text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := private.exigir_staff('suporte_solicitar');
  v_id     uuid;
  v_ticket text;
begin
  if p_break_glass then
    perform private.exigir_staff('break_glass');
  end if;
  insert into public.acessos_suporte (escritorio_id, staff_id, motivo, horas, break_glass,
                                      status, respondido_em, inicio, fim)
  values (p_escritorio_id, v_uid, btrim(p_motivo), coalesce(p_horas, 4), p_break_glass,
          case when p_break_glass then 'aprovado' else 'pendente' end,
          case when p_break_glass then now() end,
          case when p_break_glass then now() end,
          case when p_break_glass then now() + make_interval(hours => coalesce(p_horas, 4)) end)
  returning acessos_suporte.id, acessos_suporte.ticket into v_id, v_ticket;

  perform private.auditar(p_escritorio_id, case when p_break_glass then 'suporte' else 'plataforma' end,
                          case when p_break_glass then 'suporte.break_glass' else 'suporte.solicitar' end,
                          'acessos_suporte', v_id::text,
                          jsonb_build_object('motivo', btrim(p_motivo), 'ticket', v_ticket, 'horas', p_horas));
  return query select v_id, v_ticket;
end;
$$;

revoke execute on function public.qg_suporte_solicitar(uuid, text, int, boolean) from public, anon;
grant execute on function public.qg_suporte_solicitar(uuid, text, int, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';

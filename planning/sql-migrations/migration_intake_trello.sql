-- ============================================================================
-- Intake de clientes do André via Trello (planning/INTEGRACAO_TRELLO.md).
--
-- 1) Valores novos no enum tipo_documento (categorias que o robô n8n tinha
--    e o sistema não).
-- 2) Tabela de controle intake_trello_runs (idempotência por card).
-- 3) set_senha_meu_inss_sistema: variante da RPC de senha pra edge function
--    com service role (auth.uid() é null lá; a original negaria sempre).
-- 4) Job pg_cron a cada 2 dias chamando a edge function intake-trello
--    (só produção tem pg_cron; staging chama a função à mão).
--
-- Idempotente: pode rodar mais de uma vez.
-- Apply: node scripts/msc-sql.mjs --staging --file planning/sql-migrations/migration_intake_trello.sql
--        (validar, depois sem --staging)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Enum tipo_documento: categorias novas
-- ----------------------------------------------------------------------------
alter type public.tipo_documento add value if not exists 'cnis_resumido';
alter type public.tipo_documento add value if not exists 'laudo_inss';
alter type public.tipo_documento add value if not exists 'pgr_ppra';
alter type public.tipo_documento add value if not exists 'termo_representacao';
alter type public.tipo_documento add value if not exists 'autodeclaracao_veracidade';
alter type public.tipo_documento add value if not exists 'termo_renuncia_teto';
alter type public.tipo_documento add value if not exists 'termo_responsabilidade';
alter type public.tipo_documento add value if not exists 'cnpj_empregadora';

-- ----------------------------------------------------------------------------
-- 2) Tabela de controle: 1 linha por card do Trello já visto
-- ----------------------------------------------------------------------------
create table if not exists public.intake_trello_runs (
  card_id text primary key,
  card_nome text not null,
  card_url text,
  -- concluido = cliente+caso+docs criados; pendente = precisa de humano
  -- (sem CPF, cliente duplicado, sem pasta...); erro = falha inesperada,
  -- a próxima rodada tenta de novo.
  status text not null check (status in ('concluido', 'pendente', 'erro')),
  motivo text,
  cliente_id uuid references public.clientes(id) on delete set null,
  caso_id uuid references public.casos(id) on delete set null,
  docs_importados integer not null default 0,
  docs_classificados_ia integer not null default 0,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.intake_trello_runs is
  'Cards do Trello processados pelo intake (edge function intake-trello). '
  'PK = card_id garante que card não é processado duas vezes; status erro é retentado.';

-- Tabela criada via migration recebe grants default, mas explicitamos por
-- causa do histórico de "permission denied" pro service_role
-- (ver migration_grants_tabelas_sem_service_role.sql).
grant all on table public.intake_trello_runs to service_role;

alter table public.intake_trello_runs enable row level security;

-- Interno lê (tela/depuração); escrita é só da edge function (service_role
-- bypassa RLS — nenhuma policy de insert/update de propósito).
drop policy if exists intake_trello_runs_interno_select on public.intake_trello_runs;
create policy intake_trello_runs_interno_select
  on public.intake_trello_runs for select
  using (public.is_interno());

-- ----------------------------------------------------------------------------
-- 3) Senha do Meu INSS a partir do sistema (service role)
--
-- Mesma criptografia da set_senha_meu_inss (pgp_sym_encrypt + chave do Vault
-- via _inss_get_key). Diferenças: autor vem por parâmetro (auditoria) e o
-- execute é só do service_role — usuário comum continua na RPC original.
-- ----------------------------------------------------------------------------
create or replace function public.set_senha_meu_inss_sistema(
  p_cliente_id uuid,
  p_senha text,
  p_autor uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if p_autor is null then
    raise exception 'p_autor obrigatorio (usuario em nome de quem a senha e gravada)';
  end if;

  if p_senha is null or length(trim(p_senha)) = 0 then
    return; -- intake nunca apaga senha existente
  end if;

  v_key := public._inss_get_key();

  update public.clientes
     set senha_meu_inss = pgp_sym_encrypt(p_senha, v_key)
   where id = p_cliente_id;

  insert into public.acessos_senha_inss (cliente_id, usuario_id, acao)
    values (p_cliente_id, p_autor, 'escrita');
end;
$$;

revoke all on function public.set_senha_meu_inss_sistema(uuid, text, uuid) from public;
revoke all on function public.set_senha_meu_inss_sistema(uuid, text, uuid) from anon;
revoke all on function public.set_senha_meu_inss_sistema(uuid, text, uuid) from authenticated;
grant execute on function public.set_senha_meu_inss_sistema(uuid, text, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4) Cron: a cada 2 dias, 09:00 UTC (06:00 Brasília)
-- ----------------------------------------------------------------------------
do $agenda$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'msc-intake-trello') then
      perform cron.unschedule('msc-intake-trello');
    end if;
    perform cron.schedule(
      'msc-intake-trello',
      '0 9 */2 * *',
      $cmd$
      select net.http_post(
        url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/intake-trello',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 145000
      );
      $cmd$
    );
  else
    raise notice 'pg_cron ausente — job do intake-trello NAO agendado neste ambiente.';
  end if;
end
$agenda$;

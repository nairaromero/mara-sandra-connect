-- ============================================================================
-- Resumo periódico para parceiros (pedido da Naira e da Mara, 23/11/2026)
--
-- Alguns parceiros querem, além do aviso na hora, um e-mail por semana com o
-- que aconteceu nos casos deles: andamentos, requerimentos protocolados no INSS
-- e processos judiciais ajuizados. Não é padrão para todos — é por escritório
-- e por parceiro:
--
--   resumo_parceiros_config       uma linha por escritório: ligado, dia, hora,
--                                 se parceiro novo recebe e quais blocos vão.
--   resumo_parceiros_preferencia  a exceção de um parceiro: 'sempre' | 'nunca'
--                                 (sem linha = segue o padrão do escritório).
--   resumo_parceiros_envios       um resumo por parceiro e dia: trava contra
--                                 envio repetido e "último envio" na tela.
--
-- O que cada valor quer dizer (blocos, modos, quem recebe, quando é a hora)
-- mora em UM lugar: supabase/functions/_shared/resumo-parceiros.ts. O banco
-- repete só os checks abaixo; a régua e2e/unit/resumo-parceiros.test.ts
-- confere que dizem o mesmo.
--
-- Quem escreve e lê: SÓ a edge function `resumo-parceiros` (service role), que
-- exige `parceiros:gerenciar` da pessoa ou a assinatura do cron. Nenhum grant
-- para `authenticated`: a tela fala com a function (src/lib/rbac/exigencias.ts,
-- FUNCTION).
--
-- Espelho (scripts/espelho-staging.sh): config é do AMBIENTE (PRESERVAR — o
-- staging liga/desliga para testar sem herdar a escolha de produção);
-- preferência e envios apontam para usuários (EXCLUIR).
--
-- Cron: `msc-resumo-parceiros` de hora em hora; a function só manda para o
-- escritório cujo dia e hora chegaram. Só em PRODUÇÃO (pg_cron).
-- Idempotente.
-- ============================================================================

create table if not exists public.resumo_parceiros_config (
  escritorio_id uuid primary key references public.escritorios (id) on delete cascade,
  ativo boolean not null default false,
  -- 0 = domingo … 6 = sábado (o `getUTCDay` do JS, no horário de Brasília)
  dia_semana smallint not null default 5 check (dia_semana between 0 and 6),
  hora smallint not null default 20 check (hora between 0 and 23),
  padrao_parceiros boolean not null default false,
  secoes text[] not null default array['andamentos', 'requerimentos', 'judiciais'],
  -- sem FK para usuarios de propósito: a tabela é PRESERVAR no espelho e o
  -- truncate de usuarios a levaria junto
  atualizado_por uuid,
  atualizado_em timestamptz not null default now(),
  constraint resumo_parceiros_config_secoes_check
    check (secoes <@ array['andamentos', 'requerimentos', 'judiciais']::text[])
);

create table if not exists public.resumo_parceiros_preferencia (
  escritorio_id uuid not null references public.escritorios (id) on delete cascade,
  parceiro_id uuid not null references public.usuarios (id) on delete cascade,
  modo text not null check (modo in ('sempre', 'nunca')),
  atualizado_por uuid,
  atualizado_em timestamptz not null default now(),
  primary key (escritorio_id, parceiro_id)
);

create table if not exists public.resumo_parceiros_envios (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios (id) on delete cascade,
  parceiro_id uuid not null references public.usuarios (id) on delete cascade,
  -- dia (Brasília) do envio: um resumo por parceiro por dia
  referencia date not null,
  periodo_inicio timestamptz not null,
  periodo_fim timestamptz not null,
  status text not null default 'enviando' check (status in ('enviando', 'enviado', 'falhou', 'sem_novidade')),
  itens integer not null default 0,
  detalhe text,
  criado_em timestamptz not null default now(),
  unique (escritorio_id, parceiro_id, referencia)
);
create index if not exists resumo_parceiros_envios_parceiro_idx
  on public.resumo_parceiros_envios (escritorio_id, parceiro_id, criado_em desc);

-- ---------------------------------------------------------------------------
-- Escritório: herança e isolamento (molde da migration_rbac_02)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['resumo_parceiros_config', 'resumo_parceiros_preferencia', 'resumo_parceiros_envios'] loop
    execute format('drop trigger if exists aa_herdar_escritorio on public.%I', t);
    execute format(
      'create trigger aa_herdar_escritorio before insert or update of escritorio_id on public.%I
         for each row execute function private.tg_herdar_escritorio()', t);
    execute format('drop trigger if exists ab_suporte_nao_escreve on public.%I', t);
    execute format(
      'create trigger ab_suporte_nao_escreve before insert or update or delete on public.%I
         for each statement execute function private.tg_suporte_nao_escreve()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists isolamento_escritorio on public.%I', t);
    execute format(
      'create policy isolamento_escritorio on public.%I as restrictive for all to authenticated
         using (escritorio_id = (select private.escritorio_ativo()))
         with check (escritorio_id = (select private.escritorio_ativo()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cron (só em produção)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron ausente neste banco (staging/local): job msc-resumo-parceiros não agendado';
    return;
  end if;
  if to_regprocedure('ops.headers_sistema(text)') is null then
    raise notice 'ops.headers_sistema ausente neste banco: job msc-resumo-parceiros não agendado';
    return;
  end if;
  perform cron.schedule(
    'msc-resumo-parceiros',
    '7 * * * *',
    $job$ select net.http_post(
       url := 'https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/resumo-parceiros',
       headers := ops.headers_sistema('cron:resumo-parceiros'),
       body := '{"acao": "rodar"}'::jsonb,
       timeout_milliseconds := 120000
     ) $job$
  );
  raise notice 'job msc-resumo-parceiros agendado (de hora em hora, minuto 7)';
end $$;

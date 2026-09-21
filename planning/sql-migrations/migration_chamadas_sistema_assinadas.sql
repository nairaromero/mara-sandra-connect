-- migration_chamadas_sistema_assinadas.sql
--
-- O cron e dois gatilhos chamam edge function **sem nenhuma credencial**:
--
--   cron msc-datajud-sync-1/2/3 → sync-datajud-movimentacoes
--   cron msc-digest-diario      → digest-diario
--   cron msc-inss-email         → inss-email-processor
--   enviar_lembretes_evento()      → notify-novo-comentario
--   enviar_lembretes_solicitacao() → notify-solicitacao-doc
--
-- Como as functions são deployadas com `--no-verify-jwt` e a chave publicável
-- está no bundle do site, "sem credencial" significa: qualquer pessoa na
-- internet chama. A partir deste lote elas exigem assinatura de sistema
-- (`_shared/auth.ts`, `exigirSistema`).
--
-- Desenho: `ops.headers_sistema('<job>')` monta
--   x-msc-assinatura: <epoch>.<hmac_sha256(<job>.<epoch>, segredo)>
-- e a function confere com o mesmo segredo, numa janela de 5 minutos. O
-- segredo nasce aqui, aleatório, e vive no Vault — nunca literal em migration,
-- nunca no git.
--
-- PASSO MANUAL, uma vez por projeto, DEPOIS de aplicar esta migration:
--   node scripts/msc-sql.mjs [--local|--staging] \
--     "select decrypted_secret from vault.decrypted_secrets where name='msc_system_secret'"
--   e cadastrar o valor como MSC_SYSTEM_SECRET nos segredos das edge functions
--   do MESMO projeto (Dashboard → Edge Functions → Secrets, ou
--   `bunx supabase secrets set MSC_SYSTEM_SECRET=... --project-ref <ref>`).
--   No ambiente local: `supabase/functions/.env` (gitignored) e reiniciar a pilha.
-- Sem esse passo a function responde 503 e o cron falha — de propósito: melhor
-- barulho do que porta aberta.
--
-- As duas rotinas e os jobs são reescritos **a partir do que está no banco**
-- (`pg_get_functiondef` e `cron.job.command`), trocando só o literal de
-- headers. É o mesmo caminho do migration_parceiro_desligar.sql, e evita a
-- armadilha do dedc529: copiar corpo de função para dentro de migration
-- apagaria a evolução que veio depois.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Segredo compartilhado (Vault)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'msc_system_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'msc_system_secret',
      'Assinatura das chamadas de sistema (cron e gatilhos) para as edge functions. ' ||
      'O mesmo valor precisa estar em MSC_SYSTEM_SECRET nos segredos das functions deste projeto.'
    );
    raise notice 'segredo msc_system_secret criado — cadastre o valor em MSC_SYSTEM_SECRET nas edge functions';
  else
    raise notice 'segredo msc_system_secret já existia — nada a fazer';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Quem assina
-- ---------------------------------------------------------------------------
create or replace function ops.headers_sistema(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = ops, extensions, vault, pg_temp
as $$
declare
  v_chave text;
  v_ts    text;
begin
  select decrypted_secret into v_chave
    from vault.decrypted_secrets
   where name = 'msc_system_secret';

  if v_chave is null then
    raise exception 'segredo msc_system_secret ausente no Vault deste banco';
  end if;

  v_ts := floor(extract(epoch from now()))::bigint::text;

  return jsonb_build_object(
    'Content-Type', 'application/json',
    'x-region', 'sa-east-1',
    'x-msc-assinatura',
      v_ts || '.' || encode(extensions.hmac(p_job || '.' || v_ts, v_chave, 'sha256'), 'hex')
  );
end;
$$;

comment on function ops.headers_sistema(text) is
  'Headers de uma chamada de sistema para edge function: assina <job>.<epoch> com o segredo do Vault. Fica em ops (fora do PostgREST) de propósito.';

-- Ninguém além do dono: quem chama são funções SECURITY DEFINER e o cron.
revoke all on function ops.headers_sistema(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. As duas rotinas passam a assinar
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
  v_novo text;
  v_antigo constant text :=
    '''{"Content-Type": "application/json", "x-region": "sa-east-1"}''::jsonb';
begin
  for r in
    select p.oid, p.proname,
           case p.proname
             when 'enviar_lembretes_evento'      then 'pgnet:notify-novo-comentario'
             when 'enviar_lembretes_solicitacao' then 'pgnet:notify-solicitacao-doc'
           end as job
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('enviar_lembretes_evento', 'enviar_lembretes_solicitacao')
  loop
    v_def := pg_get_functiondef(r.oid);

    if position('ops.headers_sistema' in v_def) > 0 then
      raise notice '% já assina — nada a fazer', r.proname;
      continue;
    end if;

    if position(v_antigo in v_def) = 0 then
      raise warning '% não tem o literal de headers esperado; NÃO foi alterada — conferir à mão', r.proname;
      continue;
    end if;

    v_novo := replace(v_def, v_antigo, format('ops.headers_sistema(%L)', r.job));
    execute v_novo;
    raise notice '% passou a assinar como %', r.proname, r.job;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Os jobs de cron passam a assinar
-- ---------------------------------------------------------------------------
do $$
declare
  j record;
  v_cmd text;
  v_job text;
  v_antigo constant text :=
    '''{"Content-Type": "application/json", "x-region": "sa-east-1"}''::jsonb';
begin
  -- Só produção tem pg_cron: no staging e na cópia local os jobs não existem,
  -- e esta parte vira no-op (a mesma migration roda nos três ambientes).
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não instalado neste banco — nenhum job a reescrever';
    return;
  end if;

  for j in execute $q$ select jobid, jobname, schedule, command from cron.job
                        where command like '%functions/v1/%' $q$
  loop
    if position('ops.headers_sistema' in j.command) > 0 then
      raise notice 'job % já assina', j.jobname;
      continue;
    end if;

    v_job := case
      when j.command like '%sync-datajud-movimentacoes%' then 'cron:datajud'
      when j.command like '%digest-diario%'              then 'cron:digest-diario'
      when j.command like '%inss-email-processor%'       then 'cron:inss-email'
      else null
    end;

    if v_job is null then
      raise warning 'job % chama uma function que esta migration não conhece; NÃO foi alterado', j.jobname;
      continue;
    end if;

    if position(v_antigo in j.command) = 0 then
      raise warning 'job % não tem o literal de headers esperado; NÃO foi alterado', j.jobname;
      continue;
    end if;

    v_cmd := replace(j.command, v_antigo, format('ops.headers_sistema(%L)', v_job));
    execute format('select cron.schedule(%L, %L, %L)', j.jobname, j.schedule, v_cmd);
    raise notice 'job % passou a assinar como %', j.jobname, v_job;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from vault.secrets where name = 'msc_system_secret') as segredo,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enviar_lembretes_evento','enviar_lembretes_solicitacao')
      and pg_get_functiondef(p.oid) like '%ops.headers_sistema%') as rotinas_assinando,
  (select count(*) from pg_extension where extname = 'pg_cron') as tem_cron;

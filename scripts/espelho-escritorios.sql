-- Passo 3b do espelho (scripts/espelho-staging.sh): os dados restaurados de
-- produção passam a apontar para os escritórios DO STAGING.
--
-- Por quê (#481, 27/10): o staging PRESERVA os próprios escritórios (o Canário
-- de teste, o padrão com o id do staging), mas os dados de produção carregam o
-- id do escritório de PRODUÇÃO. Sem esta troca, a primeira escrita da
-- anonimização esbarra na FK (`comentarios_escritorio_fk`) e, como ela roda
-- numa transação só, o banco desfaz a anonimização inteira — o staging fica
-- com dado de produção sem máscara.
--
-- Regra (v1, um escritório em produção): todo escritorio_id que não existe no
-- staging vira o escritório padrão do staging. Mais de um id desconhecido =
-- produção já tem vários escritórios: falha (o script então limpa o staging).
--
-- Entrada: a variável psql `nao_limpar` (tabelas PRESERVAR, separadas por
-- vírgula), que ficam de fora.
--   psql "$STG_URL" -v ON_ERROR_STOP=1 -v nao_limpar=app_config,escritorios -f scripts/espelho-escritorios.sql

select set_config('espelho.nao_limpar', :'nao_limpar', false);

do $$
declare
  r record;
  v_padrao uuid;
  v_desconhecidos int;
  v_fora text[] := string_to_array(current_setting('espelho.nao_limpar'), ',');
begin
  select id into v_padrao from public.escritorios where padrao_sistema;
  if v_padrao is null then
    raise exception 'staging sem escritório padrão';
  end if;

  create temp table _ids_prod(id uuid primary key) on commit drop;
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'escritorio_id'
       and c.table_name::text <> all(v_fora)
  loop
    execute format(
      'insert into _ids_prod select distinct escritorio_id from public.%I
        where escritorio_id is not null and escritorio_id not in (select id from public.escritorios)
       on conflict do nothing', r.table_name);
  end loop;

  select count(*) into v_desconhecidos from _ids_prod;
  if v_desconhecidos > 1 then
    raise exception 'produção tem % escritórios desconhecidos no staging: a troca precisa ser por slug', v_desconhecidos;
  end if;
  if v_desconhecidos = 0 then
    raise notice 'nenhum escritório de produção para trocar';
    return;
  end if;

  -- Sem gatilhos (herança de escritório, trilha) nesta troca: é correção de
  -- referência, não escrita de negócio.
  set local session_replication_role = replica;
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'escritorio_id'
       and c.table_name::text <> all(v_fora)
  loop
    execute format('update public.%I set escritorio_id = $1 where escritorio_id in (select id from _ids_prod)', r.table_name)
      using v_padrao;
  end loop;
  raise notice 'escritório de produção trocado pelo padrão do staging';
end $$;

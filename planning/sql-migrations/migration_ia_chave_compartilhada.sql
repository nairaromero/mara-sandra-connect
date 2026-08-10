-- Chave de IA compartilhada com a equipe interna.
--
-- Hoje cada usuario precisa cadastrar a propria chave (BYOK). Na pratica so a
-- Naira cadastrou, entao toda funcionalidade de IA — assistente, triagem,
-- analise tecnica e a leitura de documento no cadastro — simplesmente nao
-- existe pros outros internos, que recebem "assistente nao configurado".
--
-- Esta migration permite marcar UMA integracao como compartilhada: internos
-- que nao tem chave propria passam a usar essa. Continua BYOK — a chave e do
-- escritorio, nao da Anthropic/OpenAI nem nossa — e continua opt-in: enquanto
-- ninguem marcar, nada muda.
--
-- Precedencia: chave propria SEMPRE ganha da compartilhada. Quem cadastrar a
-- sua depois passa a usar a sua, sem precisar desmarcar nada.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 0) Conserta o trigger de updated_at desta tabela
-- ---------------------------------------------------------------------------
-- ia_integracoes tinha o trigger tg_set_updated_at, que grava new.updated_at —
-- coluna que NAO existe aqui (a coluna e atualizado_em). Resultado: TODO UPDATE
-- na tabela falhava com 42703, entao ninguem conseguia trocar de modelo, trocar
-- a chave nem desativar o assistente; so o INSERT inicial funcionava. E a unica
-- tabela com esse descasamento (as outras 7 que usam o trigger tem updated_at),
-- entao a funcao compartilhada fica como esta e so a desta tabela muda.
create or replace function public.tg_set_atualizado_em()
returns trigger
 language plpgsql
as $function$
begin
  new.atualizado_em = now();
  return new;
end;
$function$;

drop trigger if exists tg_ia_integracoes_updated_at on public.ia_integracoes;
drop trigger if exists tg_ia_integracoes_atualizado_em on public.ia_integracoes;
create trigger tg_ia_integracoes_atualizado_em
  before update on public.ia_integracoes
  for each row execute function public.tg_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- 1) Coluna da chave compartilhada
-- ---------------------------------------------------------------------------
alter table public.ia_integracoes
  add column if not exists compartilhada boolean not null default false;

comment on column public.ia_integracoes.compartilhada is
  'Quando true, internos sem chave propria usam esta. No maximo uma por vez.';

-- Uma so compartilhada: duas chaves "do escritorio" tornariam imprevisivel
-- qual conta e cobrada.
create unique index if not exists ia_integracoes_uma_compartilhada
  on public.ia_integracoes ((true))
  where compartilhada;

-- ---------------------------------------------------------------------------
-- Resolucao da integracao efetiva de um usuario
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque le a chave cifrada de OUTRO usuario (a compartilhada)
-- — o RLS de ia_integracoes so deixa cada um ver a sua. O cipher so e util com
-- a IA_MASTER_KEY, que vive no Vault e nunca sai das edge functions; ainda
-- assim, a funcao e restrita a internos e nao expoe nada a parceiro.
create or replace function public.ia_integracao_efetiva(p_usuario uuid)
returns table (
  usuario_id     uuid,
  provider       text,
  modelo         text,
  api_key_cipher text,
  api_key_iv     text,
  ativo          boolean,
  compartilhada  boolean,
  eh_propria     boolean
)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Chave propria (mesmo inativa: quem desativou a sua quer que fique
  -- desativada, nao quer cair na do escritorio sem perceber).
  return query
    select i.usuario_id, i.provider, i.modelo, i.api_key_cipher, i.api_key_iv,
           i.ativo, i.compartilhada, true
      from public.ia_integracoes i
     where i.usuario_id = p_usuario;
  if found then return; end if;

  -- Sem chave propria: cai na compartilhada, e so pra interno.
  return query
    select i.usuario_id, i.provider, i.modelo, i.api_key_cipher, i.api_key_iv,
           i.ativo, i.compartilhada, false
      from public.ia_integracoes i
      join public.usuarios u on u.id = p_usuario
     where i.compartilhada
       and i.ativo
       and u.tipo = 'interno'
     limit 1;
end;
$function$;

revoke all on function public.ia_integracao_efetiva(uuid) from public, anon;
grant execute on function public.ia_integracao_efetiva(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Quem tem IA disponivel (usado pela UI pra decidir se mostra o launcher)
-- ---------------------------------------------------------------------------
-- Nao devolve nada da chave — so o booleano. Pode ser chamada pelo usuario
-- logado, ao contrario da funcao acima.
create or replace function public.ia_disponivel()
returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.ia_integracoes i
     where i.usuario_id = auth.uid() and i.ativo
  ) or exists (
    select 1
      from public.ia_integracoes i
      join public.usuarios u on u.id = auth.uid()
     where i.compartilhada and i.ativo and u.tipo = 'interno'
  );
$function$;

grant execute on function public.ia_disponivel() to authenticated;

-- =============================================================================
-- Migration: o procurador dos e-mails do INSS é UMA pessoa escolhida da equipe
-- (decisão da Naira, 29/10 — continuação do #503).
--
-- A primeira versão (migration_inss_procuradores) contava a equipe interna
-- inteira, e a tela listava todo mundo — a lista crescia com o escritório.
-- Agora o escritório escolhe UM procurador num menu com busca
-- (escritorio_config.extras.inss_procurador_id) e mantém a lista de nomes
-- "como o INSS escreve" (extras.inss_procuradores) para quem aparece no INSS
-- com outro nome. A regra está em supabase/functions/_shared/inss-procurador.ts.
--
-- escritorio_definir_inss_procuradores ganha p_procurador_id: só alguém com
-- vínculo ATIVO e acesso interno no escritório; nulo = nenhum. Mesma
-- permissão (integracoes:gerenciar), mesma trilha (antes e depois).
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

drop function if exists public.escritorio_definir_inss_procuradores(text[]);

create or replace function public.escritorio_definir_inss_procuradores(p_nomes text[], p_procurador_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esc uuid := private.escritorio_ativo();
  v_lista text[] := '{}';
  v_antes jsonb;
  v_depois jsonb;
  n text;
begin
  if v_esc is null or not private.tem_permissao('integracoes:gerenciar', null) then
    raise exception 'só quem gerencia integrações altera os procuradores do INSS' using errcode = '42501';
  end if;
  if p_procurador_id is not null and not exists (
    select 1
      from public.membros m
      join public.papeis p on p.id = m.papel_id
     where m.escritorio_id = v_esc and m.usuario_id = p_procurador_id
       and m.status = 'ativo' and p.tipo_acesso = 'interno'
  ) then
    raise exception 'o procurador precisa ser alguém ativo da equipe do escritório';
  end if;
  foreach n in array coalesce(p_nomes, '{}') loop
    n := regexp_replace(btrim(coalesce(n, '')), '\s+', ' ', 'g');
    continue when n = '';
    if length(n) > 120 then
      raise exception 'nome de procurador: no máximo 120 caracteres';
    end if;
    if array_length(regexp_split_to_array(n, ' '), 1) < 2 then
      raise exception 'nome de procurador: informe nome e sobrenome (%), um nome só casaria com cliente', n;
    end if;
    if not (lower(n) = any (select lower(x) from unnest(v_lista) x)) then
      v_lista := array_append(v_lista, n);
    end if;
  end loop;
  if coalesce(array_length(v_lista, 1), 0) > 20 then
    raise exception 'procuradores do INSS: no máximo 20 nomes';
  end if;

  insert into public.escritorio_config (escritorio_id) values (v_esc) on conflict (escritorio_id) do nothing;
  select jsonb_build_object(
           'procurador_id', c.extras -> 'inss_procurador_id',
           'nomes', coalesce(c.extras -> 'inss_procuradores', '[]'::jsonb))
    into v_antes
    from public.escritorio_config c where c.escritorio_id = v_esc;

  update public.escritorio_config
     set extras = (coalesce(extras, '{}'::jsonb) - 'inss_procurador_id')
                  || jsonb_build_object('inss_procuradores', to_jsonb(v_lista))
                  || case when p_procurador_id is null then '{}'::jsonb
                          else jsonb_build_object('inss_procurador_id', p_procurador_id) end,
         updated_at = now()
   where escritorio_id = v_esc;

  v_depois := jsonb_build_object('procurador_id', to_jsonb(p_procurador_id), 'nomes', to_jsonb(v_lista));
  perform private.auditar(v_esc, 'membro', 'escritorio.inss_procuradores', 'escritorio_config', v_esc::text,
                          jsonb_build_object('antes', v_antes, 'depois', v_depois));
  return v_depois;
end;
$$;

revoke all on function public.escritorio_definir_inss_procuradores(text[], uuid) from public, anon;
grant execute on function public.escritorio_definir_inss_procuradores(text[], uuid) to authenticated, service_role;

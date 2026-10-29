-- =============================================================================
-- Migration: quem é o procurador nos e-mails do INSS é do escritório (#503).
--
-- O inss-email-processor reconhecia o procurador (o "cliente" do e-mail que é,
-- na verdade, alguém da equipe) por uma lista fixa no código, com nomes de
-- pessoas do escritório padrão. Agora (_shared/inss-procurador.ts) valem o
-- marcador "(procurador)", o nome completo da equipe interna ativa e os nomes
-- "como o INSS escreve" que o escritório cadastra aqui
-- (escritorio_config.extras.inss_procuradores — Integrações → Gmail do INSS).
--
-- 1) escritorio_definir_inss_procuradores(p_nomes): quem gerencia integrações
--    (a mesma permissão da caixa do INSS); até 20 nomes de 2+ palavras e até
--    120 caracteres; auditada com antes e depois.
-- 2) O escritório padrão recebe "Mara Sandra Vian" — como o INSS escreve o
--    nome da Dra. Mara, que no cadastro do sistema é outro.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

create or replace function public.escritorio_definir_inss_procuradores(p_nomes text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esc uuid := private.escritorio_ativo();
  v_lista text[] := '{}';
  v_antes jsonb;
  n text;
begin
  if v_esc is null or not private.tem_permissao('integracoes:gerenciar', null) then
    raise exception 'só quem gerencia integrações altera os procuradores do INSS' using errcode = '42501';
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
  select coalesce(c.extras -> 'inss_procuradores', '[]'::jsonb) into v_antes
    from public.escritorio_config c where c.escritorio_id = v_esc;

  update public.escritorio_config
     set extras = coalesce(extras, '{}'::jsonb) || jsonb_build_object('inss_procuradores', to_jsonb(v_lista)),
         updated_at = now()
   where escritorio_id = v_esc;
  perform private.auditar(v_esc, 'membro', 'escritorio.inss_procuradores', 'escritorio_config', v_esc::text,
                          jsonb_build_object('antes', v_antes, 'depois', to_jsonb(v_lista)));
  return to_jsonb(v_lista);
end;
$$;

revoke all on function public.escritorio_definir_inss_procuradores(text[]) from public, anon;
grant execute on function public.escritorio_definir_inss_procuradores(text[]) to authenticated, service_role;

-- 2) Escritório padrão: o nome da Dra. Mara como o INSS escreve (só se ainda
-- não houver lista).
update public.escritorio_config c
   set extras = coalesce(c.extras, '{}'::jsonb) || jsonb_build_object('inss_procuradores', jsonb_build_array('Mara Sandra Vian')),
       updated_at = now()
  from public.escritorios e
 where e.id = c.escritorio_id
   and e.padrao_sistema
   and not (coalesce(c.extras, '{}'::jsonb) ? 'inss_procuradores');

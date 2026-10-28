-- =============================================================================
-- Migration: os dados legais que os termos do parceiro citam vêm do escritório
-- (card #496).
--
-- Até aqui o Acordo de Tratamento de Dados, o Termo de Uso e a Política de
-- Privacidade saíam com razão social, CNPJ, endereço, foro e canal de
-- privacidade de UM escritório, escritos no código (src/lib/legal/termos.ts).
-- Num produto com vários escritórios, o parceiro do Canário assinaria em nome
-- de outro. A coluna `escritorio_config.dados_legais` existe desde a
-- migration_rbac_01 e nunca foi usada.
--
-- 1) escritorio_definir_dados_legais(p_dados): quem configura o escritório
--    preenche (molde de escritorio_definir_marca: mesma permissão, mesma
--    trilha). Só os campos conhecidos, texto, até 300 caracteres.
-- 2) O escritório padrão recebe os dados que o código tinha — o texto que os
--    parceiros dele leem não muda, fora o nome da plataforma (Legal Connect).
--
-- Idempotente (o passo 2 só preenche o que estiver vazio). Local primeiro;
-- staging e produção só com aval.
-- =============================================================================

create or replace function public.escritorio_definir_dados_legais(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esc uuid := private.escritorio_ativo();
  v_campos constant text[] := array['razao_social', 'cnpj', 'endereco', 'foro',
                                    'privacidade_contato', 'privacidade_email', 'privacidade_tel'];
  v_novo jsonb := '{}'::jsonb;
  v_antes jsonb;
  k text;
  v text;
begin
  if v_esc is null or not private.tem_permissao('escritorio:configurar', null) then
    raise exception 'só quem configura o escritório altera os dados legais' using errcode = '42501';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'dados legais: envie um objeto';
  end if;
  foreach k in array v_campos loop
    if p_dados ? k then
      if jsonb_typeof(p_dados -> k) not in ('string', 'null') then
        raise exception 'dados legais: % precisa ser texto', k;
      end if;
      v := nullif(btrim(coalesce(p_dados ->> k, '')), '');
      if v is not null and length(v) > 300 then
        raise exception 'dados legais: % passa de 300 caracteres', k;
      end if;
      if v is not null then
        v_novo := v_novo || jsonb_build_object(k, v);
      end if;
    end if;
  end loop;

  insert into public.escritorio_config (escritorio_id) values (v_esc) on conflict (escritorio_id) do nothing;
  select coalesce(c.dados_legais, '{}'::jsonb) into v_antes from public.escritorio_config c where c.escritorio_id = v_esc;

  update public.escritorio_config set dados_legais = v_novo, updated_at = now() where escritorio_id = v_esc;
  perform private.auditar(v_esc, 'membro', 'escritorio.dados_legais', 'escritorio_config', v_esc::text,
                          jsonb_build_object('antes', v_antes, 'depois', v_novo));
  return v_novo;
end;
$$;

revoke all on function public.escritorio_definir_dados_legais(jsonb) from public, anon;
grant execute on function public.escritorio_definir_dados_legais(jsonb) to authenticated, service_role;

-- 2) O escritório padrão: os dados que estavam no código (só se ainda vazio).
update public.escritorio_config c
   set dados_legais = jsonb_build_object(
         'razao_social', 'Mara Vian Sociedade Individual de Advocacia',
         'cnpj', '60.244.853/0001-09',
         'endereco', 'Rua Alagoas, nº 3081, Sala 04 – Patrimônio Velho – Votuporanga/SP – CEP 15505-169',
         'foro', 'Votuporanga/SP',
         'privacidade_contato', 'Mara Sandra',
         'privacidade_email', 'contato.maravian@advocaciaprevi.com'),
       updated_at = now()
  from public.escritorios e
 where e.id = c.escritorio_id
   and e.padrao_sistema
   and coalesce(c.dados_legais, '{}'::jsonb) = '{}'::jsonb;

-- =============================================================================
-- Migration: o catálogo de um escritório (tipos de benefício e modelos de
-- tarefa) tem UM lugar (card #486).
--
-- Até aqui a cópia do catálogo morava dentro do qg_criar_escritorio: o
-- escritório só ganhava tipos e modelos no dia em que nascia. O espelho de
-- 27/10 limpou as tabelas de domínio do staging e o Canário (que o espelho
-- preserva, porque `escritorios` está em PRESERVAR) ficou sem catálogo: caso
-- do Canário sem tipo de benefício, sem modelo de tarefa, e a spec
-- rbac-isolamento quebrando.
--
-- Agora `private.semear_catalogo(escritório)` copia do escritório padrão o que
-- estiver VAZIO no destino (tabela por tabela). Quem chama:
--   * qg_criar_escritorio (escritório novo);
--   * o passo 6 do espelho (scripts/espelho-reconstruir-acesso.sql), para todo
--     escritório que não é o padrão;
--   * esta migration, uma vez, para recompor o Canário do staging.
--
-- qg_criar_escritorio reescrito a partir do pg_get_functiondef de PRODUÇÃO
-- (hash 001dab947b89efcfa0278a5ffa19929a, igual no staging em 27/10): a única
-- troca é o bloco das duas cópias virar a chamada.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- 1) O catálogo — só preenche tabela vazia; nunca mexe no padrão.
create or replace function private.semear_catalogo(p_destino uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base uuid := private.escritorio_padrao();
begin
  if p_destino is null or v_base is null or p_destino = v_base then
    return;
  end if;

  -- Conjunto padrão, sem nada do escritório de origem: tipos de benefício e
  -- templates (sem responsável fixo nem e-mail de executor).
  if not exists (select 1 from public.tipos_beneficio where escritorio_id = p_destino) then
    insert into public.tipos_beneficio (escritorio_id, nome, ativo, ordem)
    select p_destino, t.nome, t.ativo, t.ordem from public.tipos_beneficio t where t.escritorio_id = v_base;
  end if;

  if not exists (select 1 from public.tarefa_templates where escritorio_id = p_destino) then
    insert into public.tarefa_templates (escritorio_id, nome, gatilho, descricao, itens, ativo, oculto_na_ui, rotulo)
    select p_destino, t.nome, t.gatilho, t.descricao,
           (select jsonb_agg(i - 'responsavel_id' - 'executor_email' - 'executor_id') from jsonb_array_elements(t.itens) i),
           t.ativo, t.oculto_na_ui, t.rotulo
      from public.tarefa_templates t where t.escritorio_id = v_base;
  end if;
end;
$$;

revoke all on function private.semear_catalogo(uuid) from public, anon, authenticated;

-- 2) O QG chama o túnel (o resto da função é o de produção, intacto).
CREATE OR REPLACE FUNCTION public.qg_criar_escritorio(p_nome text, p_slug text, p_cnpj text DEFAULT NULL::text, p_plano text DEFAULT 'padrao'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id    uuid;
begin
  perform private.exigir_staff('escritorios_gerenciar');
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'informe o nome do escritório';
  end if;

  insert into public.escritorios (slug, nome, cnpj, plano, status)
  values (lower(btrim(p_slug)), btrim(p_nome), nullif(btrim(p_cnpj), ''), coalesce(nullif(btrim(p_plano), ''), 'padrao'), 'provisionando')
  returning id into v_id;
  insert into public.escritorio_config (escritorio_id) values (v_id);

  -- Tipos de benefício e modelos de tarefa do padrão (#486: um lugar só).
  perform private.semear_catalogo(v_id);

  perform private.auditar(v_id, 'plataforma', 'escritorio.criar', 'escritorios', v_id::text,
                          jsonb_build_object('slug', lower(btrim(p_slug)), 'plano', p_plano));
  return v_id;
end;
$function$;

-- 3) Recompõe quem ficou sem catálogo (o Canário do staging, depois do
-- espelho de 27/10). Em produção só há o escritório padrão: não faz nada.
select private.semear_catalogo(e.id) from public.escritorios e where not e.padrao_sistema;

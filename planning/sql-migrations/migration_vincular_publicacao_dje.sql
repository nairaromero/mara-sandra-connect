-- Triagem manual de publicações órfãs do DJEN.
--
-- Uma publicação fica status='sem_processo' quando o CNJ dela não casa com
-- nenhum processo_judicial cadastrado (ver sync-djen-publicacoes). Esta função
-- permite ao INTERNO vincular a publicação a um caso pela tela /publicacoes:
--   1) acha (ou cria) o processo judicial no caso, pelo número normalizado;
--   2) cria o andamento (origem='djen', visível ao parceiro) — reaproveita se
--      já houver um com o mesmo djen_id;
--   3) marca a publicação como 'vinculada' apontando caso/processo/andamento.
--
-- SECURITY DEFINER para furar a RLS de escrita; checa is_interno() na entrada.
-- Idempotente: chamar de novo numa publicação já vinculada é bloqueado.

create or replace function public.vincular_publicacao_dje(
  p_pub_id uuid,
  p_caso_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pub    public.publicacoes_dje%rowtype;
  v_proc_id uuid;
  v_and_id  uuid;
  v_titulo  text;
  v_norm    text;
begin
  if not public.is_interno() then
    raise exception 'apenas usuarios internos podem vincular publicacoes';
  end if;

  select * into v_pub from public.publicacoes_dje where id = p_pub_id;
  if not found then
    raise exception 'publicacao % nao encontrada', p_pub_id;
  end if;
  if v_pub.status = 'vinculada' then
    raise exception 'publicacao ja esta vinculada';
  end if;

  if not exists (select 1 from public.casos where id = p_caso_id) then
    raise exception 'caso % nao encontrado', p_caso_id;
  end if;

  v_norm := coalesce(
    nullif(v_pub.numero_normalizado, ''),
    regexp_replace(coalesce(v_pub.numero_processo, ''), '\D', '', 'g')
  );

  -- Acha processo judicial já existente no caso (pelo número normalizado).
  if v_norm <> '' then
    select id into v_proc_id
    from public.processos_judiciais
    where caso_id = p_caso_id
      and coalesce(
            numero_proc_normalizado,
            regexp_replace(coalesce(numero_processo, ''), '\D', '', 'g')
          ) = v_norm
    limit 1;
  end if;

  -- Senão, cria o processo judicial no caso.
  if v_proc_id is null then
    insert into public.processos_judiciais
      (caso_id, numero_processo, numero_proc_normalizado)
    values
      (p_caso_id, v_pub.numero_processo, nullif(v_norm, ''))
    returning id into v_proc_id;
  end if;

  v_titulo := coalesce(nullif(v_pub.tipo_comunicacao, ''), 'Publicação')
            || coalesce(' — ' || nullif(v_pub.sigla_tribunal, ''), '');

  -- Reaproveita o andamento se já existir um para este djen_id.
  select id into v_and_id
  from public.andamentos
  where origem = 'djen' and metadata->>'djen_id' = v_pub.djen_id
  limit 1;

  if v_and_id is null then
    insert into public.andamentos (
      caso_id, origem, titulo, descricao, data_evento, criado_por,
      visivel_parceiro, processo_judicial_id, metadata
    ) values (
      p_caso_id, 'djen', v_titulo, coalesce(v_pub.texto, v_titulo),
      coalesce(v_pub.data_disponibilizacao::timestamptz, now()), auth.uid(),
      true, v_proc_id,
      jsonb_build_object(
        'djen_id', v_pub.djen_id,
        'hash', v_pub.hash,
        'sigla_tribunal', v_pub.sigla_tribunal,
        'nome_orgao', v_pub.nome_orgao,
        'tipo_comunicacao', v_pub.tipo_comunicacao,
        'tipo_documento', v_pub.tipo_documento,
        'link', v_pub.link,
        'certidao_url', v_pub.certidao_url,
        'numero_processo', v_pub.numero_processo,
        'vinculado_manual', true
      )
    ) returning id into v_and_id;
  end if;

  update public.publicacoes_dje
     set status = 'vinculada',
         caso_id = p_caso_id,
         processo_judicial_id = v_proc_id,
         andamento_id = v_and_id
   where id = p_pub_id;

  return jsonb_build_object(
    'caso_id', p_caso_id,
    'processo_judicial_id', v_proc_id,
    'andamento_id', v_and_id
  );
end;
$$;

grant execute on function public.vincular_publicacao_dje(uuid, uuid) to authenticated;

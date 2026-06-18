-- migration_sync_tags_para_etiquetas.sql
--
-- Trigger que mantém public.etiquetas + public.clientes_etiquetas
-- sincronizados com clientes.tags (jsonb) — fonte de verdade do sync TI.
--
-- Comportamento (AFTER INSERT/UPDATE OF tags em clientes):
--   1. Pra cada item em NEW.tags: upsert em etiquetas por nome (mantém
--      ti_id, atualiza cor caso TI tenha mudado).
--   2. Insert em clientes_etiquetas pra cada (cliente, etiqueta).
--   3. Remove vínculos órfãos (etiquetas que vieram do TI mas não estão
--      mais em NEW.tags). Só apaga vínculos que tem etiqueta_id com
--      ti_id IS NOT NULL — preserva etiquetas customizadas adicionadas
--      manualmente pelo interno.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public._clientes_sync_tags_para_etiquetas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
declare
  v_tag jsonb;
  v_etiq_id uuid;
  v_ti_ids_atuais int[];
begin
  -- Sem tags → nada a sincronizar.
  if NEW.tags is null or jsonb_array_length(NEW.tags) = 0 then
    -- Limpa vínculos antigos vindos do TI desse cliente.
    delete from public.clientes_etiquetas ce
     using public.etiquetas e
     where ce.cliente_id = NEW.id
       and ce.etiqueta_id = e.id
       and e.ti_id is not null;
    return NEW;
  end if;

  -- Coleta ti_ids da NEW.tags pra usar no cleanup ao final.
  select array_agg((t->>'id')::int)
    into v_ti_ids_atuais
    from jsonb_array_elements(NEW.tags) t
   where t->>'id' is not null;

  -- 1) Upsert etiquetas + 2) Vincula.
  for v_tag in select * from jsonb_array_elements(NEW.tags) loop
    if v_tag->>'name' is null then continue; end if;

    insert into public.etiquetas (nome, cor, ti_id)
    values (
      v_tag->>'name',
      coalesce(v_tag->>'color', '#e3d0e5'),
      nullif(v_tag->>'id', '')::int
    )
    on conflict (nome) do update
      set cor = excluded.cor,
          ti_id = coalesce(public.etiquetas.ti_id, excluded.ti_id)
    returning id into v_etiq_id;

    insert into public.clientes_etiquetas (cliente_id, etiqueta_id)
    values (NEW.id, v_etiq_id)
    on conflict do nothing;
  end loop;

  -- 3) Remove vínculos do TI que sumiram da NEW.tags.
  delete from public.clientes_etiquetas ce
   using public.etiquetas e
   where ce.cliente_id = NEW.id
     and ce.etiqueta_id = e.id
     and e.ti_id is not null
     and (v_ti_ids_atuais is null or e.ti_id <> all(v_ti_ids_atuais));

  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS clientes_sync_tags_para_etiquetas ON public.clientes;
CREATE TRIGGER clientes_sync_tags_para_etiquetas
AFTER INSERT OR UPDATE OF tags ON public.clientes
FOR EACH ROW
EXECUTE FUNCTION public._clientes_sync_tags_para_etiquetas();

-- Backfill: roda o trigger nos clientes existentes que têm tags mas
-- não foram sincronizados ainda (depois da migração inicial).
UPDATE public.clientes SET tags = tags WHERE tags IS NOT NULL;

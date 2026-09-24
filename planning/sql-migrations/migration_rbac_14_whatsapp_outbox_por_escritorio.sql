-- RBAC 14 — saída de WhatsApp por escritório, sem n8n.
--
-- Quem drena `whatsapp_outbox` passa a ser a edge function
-- `whatsapp-outbox-enviar` (chamada pelo pg_cron com assinatura de sistema
-- `cron:whatsapp-outbox`), que decifra a chave do Evolution DO ESCRITÓRIO da
-- linha (`escritorio_integracoes`, tipo whatsapp) e faz o POST. Para isso o
-- lote reivindicado precisa dizer de que escritório é cada mensagem.
--
-- `whatsapp_claim_batch` muda o tipo de retorno (ganha escritorio_id), então
-- é drop + create; grants iguais (só service_role). `whatsapp_mark_result`
-- não muda. A pausa da saída (migration_pausa_whatsapp_saida: gatilho de
-- comentários desligado, fila cancelada) continua valendo — retomar é
-- decisão à parte (`alter table public.comentarios enable trigger
-- trg_whatsapp_comentario_novo`).
--
-- Idempotente.

drop function if exists public.whatsapp_claim_batch(int);
create or replace function public.whatsapp_claim_batch(p_limit int default 20)
returns table (
  outbox_id     uuid,
  escritorio_id uuid,
  telefone      text,
  tipo          text,
  texto         text,
  midia_url     text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select o.id
      from public.whatsapp_outbox o
     where o.status = 'pendente'
       and (o.proxima_tentativa_at is null or o.proxima_tentativa_at <= now())
     order by o.proxima_tentativa_at nulls first, o.created_at
       for update of o skip locked
     limit p_limit
  )
  update public.whatsapp_outbox o
     set status = 'enviando',
         tentativas = o.tentativas + 1,
         ultima_tentativa_at = now()
    from claimed c
   where o.id = c.id
  returning o.id, o.escritorio_id, o.telefone, o.tipo, o.texto, o.midia_url;
end;
$$;
revoke all on function public.whatsapp_claim_batch(int) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_batch(int) to service_role;

comment on function public.whatsapp_claim_batch(int) is
  'Reivindica um lote da fila de saída do WhatsApp (status enviando, tentativas+1). Consumidor: edge function whatsapp-outbox-enviar (pg_cron), por escritório.';

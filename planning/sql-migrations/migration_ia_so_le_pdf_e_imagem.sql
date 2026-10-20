-- =============================================================================
-- Migration: a fila da IA só pega o que a IA consegue ler (card #434)
--
-- O que estava errado: `.docx`, `.xlsx`, `.zip` e `.heic` entravam na fila de
-- leitura. O modelo não lê nenhum deles — a chamada volta com erro ou com
-- resposta que não dá para entender, o documento continua `ia_lido_em is null`
-- e o cron traz o MESMO caso a cada 10 minutos, para sempre, gastando chamada
-- de IA em todas as rodadas. Na tela, o botão "Ler 1 novo" também nunca
-- sumia: clicava, não acontecia nada, continuava lá.
--
-- A régua é a interseção do que OpenAI e Anthropic aceitam como anexo:
-- pdf, jpg/jpeg, png, webp e gif. HEIC fica de FORA de propósito — foto de
-- iPhone chega assim e NENHUM dos dois lê; até existir conversão, é arquivo
-- para a pessoa abrir, não para a IA.
--
-- Espelhos desta régua (mude os três juntos):
--   · supabase/functions/_shared/arquivo-ia.ts (a function que lê)
--   · src/lib/documentos/arquivo.ts (a tela, para não oferecer "Ler")
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- O que a IA lê, em um lugar só do lado do banco.
create or replace function private.ia_le_arquivo(p_nome text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(p_nome) ~ '\.(pdf|jpe?g|png|webp|gif)$', false);
$$;

-- ---------------------------------------------------------------------------
-- 1) A lista do caso (a function pede esta antes de ler)
-- ---------------------------------------------------------------------------
create or replace function public.documentos_leitura_pendente(p_caso_id uuid)
returns table(id uuid, nome_arquivo text, storage_path text, tipo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.nome_arquivo, d.storage_path, d.tipo
    from public.documentos d
   where d.caso_id = p_caso_id
     and d.ia_lido_em is null
     and private.ia_le_arquivo(d.nome_arquivo)
   order by d.created_at;
$$;

revoke all on function public.documentos_leitura_pendente(uuid) from public;
revoke all on function public.documentos_leitura_pendente(uuid) from anon;
grant execute on function public.documentos_leitura_pendente(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) A fila do cron
--
-- Reescrita a partir da migration_fila_leitura_documentos; o que muda é o
-- `private.ia_le_arquivo` nos dois lugares em que se conta o pendente.
-- ---------------------------------------------------------------------------
create or replace function public.casos_com_leitura_pendente(
  p_quieto_minutos int default 2,
  p_limite int default 20
)
returns table(caso_id uuid, pendentes bigint, ultimo_upload timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.caso_id,
         count(*) filter (
           where d.ia_lido_em is null and private.ia_le_arquivo(d.nome_arquivo)
         ) as pendentes,
         max(d.created_at) as ultimo_upload
    from public.documentos d
   where exists (
     select 1 from public.tarefas t
      where t.caso_id = d.caso_id
        and t.status = 'a_fazer'
        and (t.metadata->>'organizacao_documentos')::boolean is true
   )
   group by d.caso_id
  having count(*) filter (
           where d.ia_lido_em is null and private.ia_le_arquivo(d.nome_arquivo)
         ) > 0
     -- a poeira baixou: nada novo chegou nos últimos minutos
     and max(d.created_at) < now() - make_interval(mins => p_quieto_minutos)
   order by max(d.created_at)
   limit p_limite;
$$;

revoke all on function public.casos_com_leitura_pendente(int, int) from public;
revoke all on function public.casos_com_leitura_pendente(int, int) from anon;
grant execute on function public.casos_com_leitura_pendente(int, int) to authenticated;

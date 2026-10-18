-- =============================================================================
-- Migration: o que a IA leu fica guardado junto do documento (card #434)
--
-- Decisão da Naira (2026-10-18): "ler da melhor forma os documentos, sem ler
-- várias vezes os mesmos documentos". Então a leitura é registrada na linha do
-- documento: quem já tem `ia_lido_em` não volta pro modelo, e a conferência
-- mostra de onde veio cada palpite em vez de pedir que a pessoa preencha.
--
-- A IA ORGANIZA: quando reconhece com confiança, ela grava o `tipo` do
-- documento (é o que o resto do sistema lê — checklist, análise, nome do
-- arquivo). O que ela não reconhece fica como está e vira exceção na tarefa.
-- O rastro em `ia_*` permite conferir e corrigir sem perder o que ela achou.
--
-- Idempotente. Local primeiro.
-- =============================================================================

alter table public.documentos
  -- O que a IA concluiu. Fica separado de `tipo` de propósito: `tipo` é o que
  -- vale pro sistema (e a pessoa pode corrigir), `ia_tipo` é o que ela disse.
  add column if not exists ia_tipo text,
  add column if not exists ia_confianca text,
  -- Data do documento (emissão/competência) — alimenta o nome no padrão da
  -- casa e a ordem cronológica da pasta.
  add column if not exists ia_data_documento date,
  -- Uma frase do que é o documento, pra conferência não virar adivinhação.
  add column if not exists ia_resumo text,
  add column if not exists ia_lido_em timestamptz,
  add column if not exists ia_modelo text,
  -- Duplicado se acha por conteúdo, sem gastar IA (o padrão da casa manda
  -- mandar duplicata pra "- diversos").
  add column if not exists conteudo_sha256 text;

alter table public.documentos
  drop constraint if exists documentos_ia_confianca_check;
alter table public.documentos
  add constraint documentos_ia_confianca_check
  check (ia_confianca is null or ia_confianca in ('alta', 'media', 'baixa'));

comment on column public.documentos.ia_tipo is
  'Tipo que a IA reconheceu. `tipo` é o que vale; este é o rastro de quem sugeriu (card #434).';
comment on column public.documentos.ia_lido_em is
  'Quando a IA leu este arquivo. Preenchido = não relê (decisão da Naira, 2026-10-18).';
comment on column public.documentos.conteudo_sha256 is
  'Hash do conteúdo: acha duplicata sem gastar leitura de IA.';

-- Fila de leitura: o que ainda não passou pela IA, por caso.
create index if not exists idx_documentos_sem_leitura_ia
  on public.documentos (caso_id)
  where ia_lido_em is null;

-- Duplicata dentro do mesmo caso.
create index if not exists idx_documentos_sha256
  on public.documentos (caso_id, conteudo_sha256)
  where conteudo_sha256 is not null;

-- ---------------------------------------------------------------------------
-- O que falta ler num caso — é o que a function de leitura consulta e o que a
-- tarefa usa pra dizer "9 de 12 identificados".
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
   order by d.created_at;
$$;

revoke all on function public.documentos_leitura_pendente(uuid) from public;
revoke all on function public.documentos_leitura_pendente(uuid) from anon;
grant execute on function public.documentos_leitura_pendente(uuid) to authenticated;

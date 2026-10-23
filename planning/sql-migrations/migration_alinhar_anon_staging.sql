-- =============================================================================
-- Migration: o staging deixa de ser mais aberto que a produção para `anon`
-- (card #479).
--
-- O detector de deriva (scripts/conferir-deriva-ambientes.mjs, #478) achou 39
-- diferenças de permissão entre staging e produção, todas na mesma direção: o
-- staging dava a `anon` (visitante não logado) leitura em 34 tabelas, leitura
-- em `leads`, e fazia tabela/função/sequência NOVA nascer aberta para ele. Mais
-- duas sequências (auditoria_id_seq, ia_uso_id_seq) com UPDATE para
-- `authenticated` e tudo para `anon`.
--
-- A produção está certa. O risco era o inverso do item f44: algo que só
-- funciona porque o staging está aberto passa em todos os testes (o local é
-- cópia do staging) e quebra em produção.
--
-- Só FECHA, e só o que está aberto a mais, listado nominalmente — um
-- `revoke ... on all tables` apagaria leituras que a produção mantém de
-- propósito. Em produção nada muda: tudo aqui já está assim lá (conferido em
-- 24/10). A RLS seguia segurando as linhas nos dois ambientes; isto é deriva,
-- não furo.
--
-- Idempotente. Local primeiro; staging e produção só com aval.
-- =============================================================================

-- 1) Tabelas que anon lia no staging e não lê em produção
revoke select on
  public.aceites_termos, public.acessos_documento, public.agenda_eventos,
  public.andamentos_excluidos, public.app_config, public.clientes_etiquetas,
  public.comentario_email_throttle, public.comentarios, public.conversa_leitura,
  public.documentos_excluidos, public.etiquetas, public.ia_acoes,
  public.ia_integracoes, public.ia_tokens, public.ia_uso, public.inss_email_log,
  public.lead_comentarios, public.notificacao_dispensada, public.notificacoes,
  public.oabs_monitoradas, public.publicacoes_dje, public.tarefa_templates,
  public.tarefas, public.tarefas_excluidas, public.tipos_beneficio,
  public.usuario_gmail_oauth, public.webhook_config, public.webhook_destinos,
  public.webhook_eventos, public.whatsapp_ativacao_codigos, public.whatsapp_lid_map,
  public.whatsapp_mensagens, public.whatsapp_outbox, public.whatsapp_sessoes
from anon;

-- `leads`: o formulário do site grava (INSERT fica); ler, não.
revoke select on public.leads from anon;

-- 2) Sequências: anon nada; authenticated sem UPDATE (setval) — como em produção
revoke all on sequence public.auditoria_id_seq, public.ia_uso_id_seq from anon;
revoke update on sequence public.auditoria_id_seq, public.ia_uso_id_seq from authenticated;

-- 3) O que vier a nascer (migrations criam como postgres)
alter default privileges for role postgres in schema public revoke select on tables from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke update on sequences from authenticated;

-- 4) Confere: nenhuma das tabelas acima legível por anon, e o padrão fechado.
do $$
declare
  v text;
begin
  select string_agg(c.relname, ', ') into v
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relname = any (array[
           'aceites_termos','acessos_documento','agenda_eventos','andamentos_excluidos',
           'app_config','clientes_etiquetas','comentario_email_throttle','comentarios',
           'conversa_leitura','documentos_excluidos','etiquetas','ia_acoes','ia_integracoes',
           'ia_tokens','ia_uso','inss_email_log','lead_comentarios','notificacao_dispensada',
           'notificacoes','oabs_monitoradas','publicacoes_dje','tarefa_templates','tarefas',
           'tarefas_excluidas','tipos_beneficio','usuario_gmail_oauth','webhook_config',
           'webhook_destinos','webhook_eventos','whatsapp_ativacao_codigos','whatsapp_lid_map',
           'whatsapp_mensagens','whatsapp_outbox','whatsapp_sessoes','leads'])
     and has_table_privilege('anon', c.oid, 'SELECT');
  if v is not null then
    raise exception 'anon ainda lê: %', v;
  end if;

  if exists (
    select 1
      from pg_default_acl a
      join pg_namespace n on n.oid = a.defaclnamespace and n.nspname = 'public'
      cross join lateral aclexplode(a.defaclacl) x
     where a.defaclrole = 'postgres'::regrole
       and x.grantee = 'anon'::regrole
       and ((a.defaclobjtype = 'r' and x.privilege_type = 'SELECT')
         or (a.defaclobjtype = 'f' and x.privilege_type = 'EXECUTE')
         or (a.defaclobjtype = 'S'))
  ) then
    raise exception 'o padrão de objeto novo ainda abre para anon';
  end if;
end $$;

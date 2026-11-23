-- ============================================================================
-- #545 — o link de assinatura do ZapSign (`sign_url`) sai da leitura ampla e
--        passa a ser entregue sob demanda, com escopo e trilha
--        (revisão geral de RBAC de 23/11/2026, ponto D1)
--
-- O PROBLEMA
--   A policy de leitura de `assinaturas` é ampla — `is_interno()` — e a linha
--   carrega o jsonb `signatarios[]`, onde mora o `sign_url`: a URL portadora,
--   de curta duração, que É a credencial para assinar como aquele signatário.
--   Resultado: QUALQUER interno (até o financeiro, sem relação com o caso) lia
--   e copiava o link de um contrato em curso — e nada ficava na trilha.
--
-- A ESCOLHA (o servidor é o freio, nunca só a tela)
--   O `sign_url` CONTINUA persistido em `assinaturas.signatarios` — o webhook e
--   o `sincronizarAssinatura` (service role) não mudam nada. O que muda é o que
--   a TELA alcança:
--     1. a tela deixa de ler a tabela e passa a ler a VIEW `assinaturas_tela`,
--        que projeta tudo MENOS o `sign_url` (e troca por um booleano
--        `tem_link`, para a tela saber que há link sem ver qual é);
--     2. a COLUNA `signatarios` (onde mora o jsonb com o `sign_url`) sai do
--        SELECT de `authenticated`: a leitura passa a ser coluna a coluna, de
--        tudo MENOS `signatarios`. Assim o jsonb cru deixa de ser alcançável
--        pela API REST, mas as leituras legítimas de id continuam —
--        `exigirRecurso` das functions confere o acesso lendo a linha como a
--        pessoa (`quem.rls.from('assinaturas').select('id')`), e revogar a
--        tabela inteira a derrubava (503 no "Atualizar");
--     3. o link vem UMA assinatura/ signatário por vez, pela RPC
--        `assinatura_sign_url`, restrita a quem gerencia assinaturas
--        (`documentos:enviar`, a mesma régua do envio e do "Atualizar") OU ao
--        dono do caso (responsável), e que AUDITA cada entrega (`private.auditar`).
--
--   A view roda como DONA (não `security_invoker`): o `postgres` tem BYPASSRLS,
--   então ela mesma refaz o que as duas policies da tabela diziam —
--   `escritorio_ativo()` e `is_interno()` —, e só a tabela é que fica fechada.
--
-- Espelho: `assinaturas` já está em EXCLUIR no scripts/espelho-staging.sh (o
-- link é real; não sai de produção). A view não tem dados; o conferidor de RBAC
-- só olha tabelas.
--
-- Idempotente (create or replace / revoke / grant).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) A tabela deixa de ser lida pela tela; a view toma o lugar.
-- ---------------------------------------------------------------------------
-- O `grant select ... to authenticated` (tabela inteira) da
-- migration_zapsign_assinaturas vira um grant COLUNA A COLUNA de tudo menos
-- `signatarios`. A policy `assinaturas_select` (is_interno) e a `isolamento_
-- escritorio` seguem valendo — elas filtram LINHAS; o grant de coluna filtra o
-- `sign_url`. `exigirRecurso` (que lê `select id` como a pessoa) continua
-- funcionando; só a coluna `signatarios` fica fora do alcance da API REST.
-- Se a tabela ganhar uma coluna nova, ela nasce SEM leitura para a tela (fecha
-- por omissão) até ser acrescentada aqui e na view — o esperado.
revoke select on public.assinaturas from authenticated;
grant select (
  id, escritorio_id, caso_id, documento_id, documento_assinado_id, nome,
  zapsign_doc_token, sandbox, status, enviado_por, created_at, updated_at,
  assinado_em, modelo_token, tipo_documento
) on public.assinaturas to authenticated;

-- A view que a tela lê: tudo da linha, menos o `sign_url` de cada signatário.
-- `tem_link` diz se aquele signatário tem um link vivo, sem revelar qual —
-- é o que decide se o botão "Copiar link" aparece.
create or replace view public.assinaturas_tela
with (security_barrier = true) as
  select
    a.id,
    a.caso_id,
    a.documento_id,
    a.documento_assinado_id,
    a.nome,
    a.sandbox,
    a.status,
    coalesce((
      select jsonb_agg(
               (e.value - 'sign_url')
               || jsonb_build_object('tem_link', coalesce(e.value->>'sign_url', '') <> '')
               order by e.ord)
        from jsonb_array_elements(a.signatarios) with ordinality as e(value, ord)
    ), '[]'::jsonb) as signatarios,
    a.created_at,
    a.assinado_em
  from public.assinaturas a
  -- a view roda como dona (BYPASSRLS): refaz aqui o que as policies da tabela
  -- diziam — isolamento por escritório ativo + só a equipe interna.
  where a.escritorio_id = (select private.escritorio_ativo())
    and (select public.is_interno());

revoke all on public.assinaturas_tela from anon;
grant select on public.assinaturas_tela to authenticated;

-- ---------------------------------------------------------------------------
-- 2) O link sob demanda: RPC com escopo e trilha.
-- ---------------------------------------------------------------------------
-- Quem alcança o `sign_url`:
--   · quem gerencia assinaturas — `documentos:enviar`, a mesma permissão que o
--     envio e o "Atualizar" (zapsign-enviar) já cobram; OU
--   · o dono do caso — o responsável, mesmo sem a permissão.
-- Parceiro não passa por nenhum dos dois (não tem `documentos:enviar` e nunca é
-- responsável) e, de todo modo, a view já o barra. Cada entrega de link vira
-- linha na `auditoria` pelo túnel `private.auditar` (tipo_ator = 'membro').
create or replace function public.assinatura_sign_url(p_assinatura_id uuid, p_signatario_token text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caso uuid;
  v_signatarios jsonb;
  v_url text;
  v_pode boolean;
begin
  -- registro de outro escritório → "não encontrado" (não confirma que existe)
  perform private.exigir_no_escritorio('public.assinaturas', p_assinatura_id);

  select caso_id, signatarios into v_caso, v_signatarios
    from public.assinaturas where id = p_assinatura_id;
  if v_caso is null then
    raise exception 'assinatura não encontrada' using errcode = 'P0002';
  end if;

  v_pode := public.is_interno() and (
    private.tem_permissao('documentos:enviar')
    or exists (
      select 1 from public.casos c
       where c.id = v_caso and c.responsavel_id = (select auth.uid())
    )
  );
  if not coalesce(v_pode, false) then
    raise exception 'Sem permissao para ver o link de assinatura' using errcode = '42501';
  end if;

  -- o link do signatário pedido (por token); sem token, o primeiro com link vivo
  select e.value->>'sign_url' into v_url
    from jsonb_array_elements(coalesce(v_signatarios, '[]'::jsonb)) as e(value)
   where (p_signatario_token is null or e.value->>'token' = p_signatario_token)
     and coalesce(e.value->>'sign_url', '') <> ''
   limit 1;

  if v_url is null or v_url = '' then
    return null; -- nada a entregar: não há link, não audita (nada foi revelado)
  end if;

  perform private.auditar(
    (select private.escritorio_ativo()), 'membro', 'assinatura.link_copiado',
    'assinaturas', p_assinatura_id::text,
    jsonb_build_object('signatario', p_signatario_token)
  );
  return v_url;
end;
$function$;

-- função nova nasce com EXECUTE para PUBLIC: fecha (o conferidor de RBAC acusa).
revoke all on function public.assinatura_sign_url(uuid, text) from public, anon;
grant execute on function public.assinatura_sign_url(uuid, text) to authenticated;

-- PostgREST precisa reler o schema para enxergar a view e a RPC novas.
notify pgrst, 'reload schema';

-- ============================================================================
-- Caixas do INSS: desconectar por uma porta só, com trilha, e a caixa que parou
-- de ser lida aparece na tela (revisão do lote de 20/11/2026)
--
-- 1) DESCONECTAR. A `migration_gmail_inss_varias_caixas` abriu o DELETE para
--    "qualquer caixa do escritório ativo", mas a única policy de SELECT da
--    tabela continuou sendo "a caixa que EU conectei". O Postgres só apaga a
--    linha que a pessoa consegue ler: a admin que tentava desconectar a caixa
--    conectada por outra apagava ZERO linhas, sem erro, e a tela dizia
--    "desconectada". Abrir o SELECT não é saída (a linha guarda a credencial
--    cifrada). A porta passa a ser a RPC `gmail_inss_desconectar`: confere o
--    escritório e a permissão, apaga, e deixa trilha (antes ninguém sabia quem
--    tinha desligado a leitura dos e-mails do INSS). O DELETE direto pela API
--    deixa de existir.
--
-- 2) CAIXA QUE PAROU. Quando o Google revoga o acesso (troca de senha, 6 meses
--    sem uso), o `inss-email-processor` falhava naquela caixa todo dia e nada
--    aparecia: o card seguia com o "conectado" verde. A rotina passa a gravar
--    `ultimo_erro`/`ultimo_erro_em` na linha da caixa (e a limpar quando volta
--    a ler); `gmail_inss_status` devolve os dois e o card pede para reconectar.
--
-- Idempotente.
-- ============================================================================

alter table public.usuario_gmail_oauth add column if not exists ultimo_erro text;
alter table public.usuario_gmail_oauth add column if not exists ultimo_erro_em timestamptz;

-- ---------------------------------------------------------------------------
-- 1) Desconectar: só pela RPC
-- ---------------------------------------------------------------------------
drop policy if exists usuario_gmail_oauth_escritorio_delete on public.usuario_gmail_oauth;

create or replace function public.gmail_inss_desconectar(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_esc uuid := private.escritorio_ativo();
  v_caixa record;
begin
  -- caixa de outro escritório: "não encontrado", sem confirmar que existe
  perform private.exigir_no_escritorio('public.usuario_gmail_oauth'::regclass, p_id);
  if v_esc is null or not private.tem_permissao('integracoes:gerenciar', null) then
    raise exception 'só quem gerencia integrações desconecta a caixa do INSS' using errcode = '42501';
  end if;
  delete from public.usuario_gmail_oauth g
   where g.id = p_id and g.escritorio_id = v_esc
  returning g.email_conectado, g.usuario_id, g.connected_at into v_caixa;
  if not found then
    raise exception 'caixa não encontrada' using errcode = 'P0002';
  end if;
  perform private.auditar(v_esc, 'membro', 'integracao.caixa_desconectada', 'usuario_gmail_oauth', p_id::text,
                          jsonb_build_object('caixa', v_caixa.email_conectado, 'conectada_por', v_caixa.usuario_id,
                                             'conectada_em', v_caixa.connected_at));
  return v_caixa.email_conectado;
end;
$function$;

revoke execute on function public.gmail_inss_desconectar(uuid) from public, anon;
grant execute on function public.gmail_inss_desconectar(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Status: com a última falha de leitura de cada caixa
--    (muda o tipo de retorno: precisa cair e nascer de novo, com os grants)
-- ---------------------------------------------------------------------------
drop function if exists public.gmail_inss_status();
create function public.gmail_inss_status()
returns table (id uuid, email_conectado text, connected_at timestamptz, last_used_at timestamptz, conectado_por text,
               e_minha boolean, ultimo_erro text, ultimo_erro_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_esc uuid := private.escritorio_ativo();
begin
  if v_esc is null or not private.tem_permissao('integracoes:gerenciar', null) then
    raise exception 'só quem gerencia integrações vê a caixa do INSS' using errcode = '42501';
  end if;
  return query
  select g.id, g.email_conectado, g.connected_at, g.last_used_at, u.nome, g.usuario_id = auth.uid(),
         g.ultimo_erro, g.ultimo_erro_em
    from public.usuario_gmail_oauth g
    left join public.usuarios u on u.id = g.usuario_id
   where g.escritorio_id = v_esc
   order by g.connected_at, g.id;
end;
$function$;

revoke execute on function public.gmail_inss_status() from public, anon;
grant execute on function public.gmail_inss_status() to authenticated, service_role;

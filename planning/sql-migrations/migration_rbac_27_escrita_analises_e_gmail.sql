-- migration_rbac_27_escrita_analises_e_gmail.sql
--
-- Duas escritas que ficaram de fora da varredura de 24/09 e continuavam na
-- policy antiga `is_interno()` — classe inversa pura: a tela exige permissão e
-- o banco aceitava qualquer pessoa interna.
--
-- Achadas em 27/09 escrevendo a spec `rbac-matriz-por-papel`, que compara o que
-- cada papel consegue fazer com a matriz do banco. O teste ficou vermelho
-- porque o FINANCEIRO gravou uma análise técnica — e o comunicado à equipe diz,
-- com estas palavras, que ele "não cria nem edita nada do trabalho jurídico".
--
--   1. `analises_tecnicas` — tinha `perm_analises_ler_select` (restritiva, só
--      LEITURA, sobre `analises:ler`) e a escrita solta em `analises_modify`
--      com `is_interno()`. Passa a exigir `casos:editar`, como `andamentos` e
--      `solicitacoes_documento`.
--
--   2. `usuario_gmail_oauth` — a tela só mostra o card de Gmail para quem tem
--      `integracoes:gerenciar` (integracao-gmail-card.tsx:112) e o banco
--      deixava qualquer interno apagar a conexão da caixa do INSS. Passa a
--      exigir a mesma permissão da tela. A gravação do token continua vindo da
--      edge `gmail-oauth-callback` com service role, que não passa por RLS.
--
-- Por que restritiva e não trocar a policy antiga: restritiva soma com AND, e é
-- o padrão do lote (migration_rbac_18 é o molde). A permissiva antiga continua
-- lá dizendo "tem de ser interno"; a restritiva acrescenta "e com a permissão".
--
-- O que NÃO entra aqui, e fica anotado no planning/AUDITABILIDADE.md como
-- decisão pendente:
--   · `repasses` — a escrita não tem permissão no modelo (só existe
--     `repasses:ler`). Criar `repasses:gerenciar` é decisão de produto.
--   · `contratos_parceria` — nenhum código escreve nela hoje; gatear ou revogar
--     a escrita pede saber se alguém usa à mão.
--
-- Idempotente.

do $$
declare r record;
begin
  for r in
    select * from (values
      ('analises_tecnicas',   'casos:editar'),
      ('usuario_gmail_oauth', 'integracoes:gerenciar')
    ) as m(tabela, permissao)
  loop
    if to_regclass('public.' || r.tabela) is null then
      raise warning 'tabela public.% não existe — pulada', r.tabela;
      continue;
    end if;
    execute format('drop policy if exists perm_%s_insert on public.%I', replace(r.tabela, '_', ''), r.tabela);
    execute format('drop policy if exists perm_%s_update on public.%I', replace(r.tabela, '_', ''), r.tabela);
    execute format('drop policy if exists perm_%s_delete on public.%I', replace(r.tabela, '_', ''), r.tabela);

    execute format(
      'create policy perm_%s_insert on public.%I as restrictive for insert to authenticated with check ((select private.tem_permissao(%L)))',
      replace(r.tabela, '_', ''), r.tabela, r.permissao);
    execute format(
      'create policy perm_%s_update on public.%I as restrictive for update to authenticated using ((select private.tem_permissao(%L)))',
      replace(r.tabela, '_', ''), r.tabela, r.permissao);
    execute format(
      'create policy perm_%s_delete on public.%I as restrictive for delete to authenticated using ((select private.tem_permissao(%L)))',
      replace(r.tabela, '_', ''), r.tabela, r.permissao);
    raise notice 'escrita de %I passa a exigir %', r.tabela, r.permissao;
  end loop;
end $$;

notify pgrst, 'reload schema';

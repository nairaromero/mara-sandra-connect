-- =============================================================================
-- Migration: a escada do responsável nunca mais devolve NULL
-- (achado da própria Naira, 2026-09-09, perguntando "e dá pra trocar a Mara?")
--
-- O buraco: o degrau 5 é public.responsavel_padrao_analise(), que procura a
-- Mara pelo e-mail EXIGINDO `ativo is true`. Se a Mara for desligada um dia —
-- e public.desligar_interno() faz exatamente isso, põe ativo=false — a função
-- devolve NULL. Como ela era o ÚLTIMO item do coalesce, a escada inteira
-- devolvia NULL e as tarefas voltariam a nascer órfãs. Ou seja: o conserto
-- tinha um jeito silencioso de se desfazer sozinho.
--
-- Conferido no staging antes de escrever:
--   select ... where ativo is false and email='marasandra.adv@gmail.com' -> NULL
--
-- Remédio: um último degrau abaixo do 5 — o primeiro admin ativo. Hoje só a
-- Naira e a Mara são admin (ver CLAUDE.md), então a rede cai numa das duas.
--
-- IMPORTANTE — por que `email not like 'e2e+%'`: o helper irmão do DJE
-- (_dje_triagem_responsavel) usa `where ativo and eh_admin order by nome
-- limit 1`, e no STAGING isso escolhe **[E2E] Admin** — o colchete ordena
-- antes de qualquer letra. Rede final caindo em conta sintética é pior do que
-- não ter rede. Com a exclusão: Mara hoje; Naira se a Mara sair.
--   (O _dje_triagem_responsavel tem a mesma falha latente — hoje inofensiva
--    porque a chave de config resolve. Fica registrado, é PR de outro dia.)
--
-- Não toca em responsavel_padrao_analise() (é da #225) nem em nenhuma outra
-- função: só substitui responsavel_tarefa_caso, que é desta feature.
--
-- Idempotente. SÓ STAGING até a Naira validar.
-- =============================================================================

create or replace function public.responsavel_tarefa_caso(
  p_caso_id   uuid,
  p_preferido uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1) palpite de quem chamou (quem pediu o documento)
    (select u.id from public.usuarios u
      where u.id = p_preferido and u.ativo is true and u.tipo = 'interno'),
    -- 2) dono explícito do caso
    (select u.id
       from public.casos c
       join public.usuarios u on u.id = c.responsavel_id
      where c.id = p_caso_id and u.ativo is true),
    -- 3) dono de fato: quem carrega mais tarefa aberta nesse caso; empate
    --    (inclusive todo mundo com zero aberta) decide pela mais recente.
    (select t.responsavel_id
       from public.tarefas t
       join public.usuarios u on u.id = t.responsavel_id
      where t.caso_id = p_caso_id
        and u.ativo is true
        and u.tipo = 'interno'
      group by t.responsavel_id
      order by count(*) filter (where t.status in ('a_fazer', 'fazendo')) desc,
               max(t.created_at) desc
      limit 1),
    -- 4) override configurável, pra trocar o padrão sem migration
    (select u.id
       from public.app_config c
       join public.usuarios u on u.id::text = c.valor
      where c.chave = 'tarefa_analise_responsavel_id'
        and u.ativo is true),
    -- 5) padrão do escritório (hoje a Mara, por e-mail, exigindo ativo)
    public.responsavel_padrao_analise(),
    -- 6) ÚLTIMA REDE: o padrão do escritório saiu do ar (desligado/e-mail
    --    trocado) e ninguém pôs a chave do degrau 4. Cai no primeiro admin
    --    ativo — nunca em NULL, nunca numa conta sintética.
    (select u.id
       from public.usuarios u
      where u.ativo is true
        and u.eh_admin is true
        and u.tipo = 'interno'
        and u.email not like 'e2e+%'
      order by u.nome
      limit 1)
  );
$$;

comment on function public.responsavel_tarefa_caso(uuid, uuid) is
  'Resolve o responsável de uma tarefa nova: preferido -> dono do caso -> dono de fato -> app_config tarefa_analise_responsavel_id -> responsavel_padrao_analise() -> primeiro admin ativo (nunca NULL).';

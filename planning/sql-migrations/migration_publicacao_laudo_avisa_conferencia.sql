-- Publicação sobre o laudo avisa a conferência — sem decidir por ninguém.
--
-- Pedido da Naira (27/11/2026), "meio-termo": quando a publicação do tribunal
-- fala em manifestar sobre o laudo, o sistema
--   1. marca a tarefa aberta de conferir o laudo daquele processo e traz o
--      prazo dela para hoje (a tela mostra "chegou publicação sobre o laudo");
--   2. NÃO conclui a conferência nem diz favorável/desfavorável: lidas 14
--      publicações de produção, nenhuma traz o resultado do laudo, e 8 falavam
--      em "laudo" por outro motivo (LTCAT, acórdão, texto padrão de "ciência de
--      documentos");
--   3. mantém UMA tarefa de análise por laudo: a que a publicação cria leva a
--      marca `analise_laudo_pericia` (a mesma do template do botão); se a
--      análise já foi aberta pelo botão, a publicação entra nela.
--
-- `private.publicacao_fala_do_laudo` é o único lugar que decide se o texto é
-- "manifestem-se sobre o laudo". A régua e2e/unit/pericia-judicial.test.ts
-- guarda os exemplos reais.
--
-- A função do gatilho partiu do pg_get_functiondef da PRODUÇÃO em 27/11/2026
-- (md5 76a4062f…, igual em staging e local). Diferenças: a variável v_laudo, o
-- bloco entre >>> e <<<, e a marca no metadata da tarefa criada.
--
-- Idempotente.

create or replace function private.publicacao_fala_do_laudo(p_texto text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  -- "manifest…" seguido, na mesma frase, de "sobre o laudo" / "acerca do laudo".
  -- Fica de fora o texto padrão "ciência de documentos (como prontuários,
  -- laudos…)" e laudo citado de passagem.
  select coalesce(
    p_texto ~* 'manifest[^.]{0,120}(sobre|acerca\s+d[oe]s?)\s+(os?\s+)?laudo', false)
$$;

comment on function private.publicacao_fala_do_laudo(text) is
  'A publicacao manda manifestar sobre o laudo? Unica decisao desse texto; usada pelo gatilho da publicacao.';

revoke all on function private.publicacao_fala_do_laudo(text) from public, anon, authenticated;
grant execute on function private.publicacao_fala_do_laudo(text) to service_role;

CREATE OR REPLACE FUNCTION public.tg_publicacao_acionavel_cria_tarefa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_texto    text;
  v_cliente  text;
  v_gatilho  text;
  v_titulo   text;
  v_uteis    int;
  v_due      timestamptz;
  v_laudo    boolean := false;
begin
  if NEW.caso_id is null then return NEW; end if;
  -- Só o que chega automaticamente dos tribunais.
  if NEW.origem not in ('djen', 'datajud') then return NEW; end if;
  -- Andamento nascido dos próprios fluxos de aviso: não morder o rabo.
  if NEW.metadata ? 'tipo_aviso' then return NEW; end if;
  if NEW.data_evento is not null and NEW.data_evento < (now() - interval '30 days') then
    return NEW;
  end if;

  v_texto := coalesce(NEW.titulo, '') || ' ' || coalesce(NEW.descricao, '');

  -- Perícia/audiência marcada: o gatilho irmão (tg_rascunho_pericia_andamento)
  -- já cria a tarefa de aviso — aqui não duplica.
  if (v_texto ~* 'per[ií]cia' and v_texto ~* '(marcad|agendad|reagendad|remarcad|designad)')
     or (v_texto ~* 'audi[eê]nci' and v_texto ~* '(marcad|agendad|designad|redesignad|pautad)') then
    return NEW;
  end if;

  -- Um gatilho por publicação; o mais específico vence.
  if v_texto ~* 'proposta de acordo' then
    v_gatilho := 'acordo';
    v_titulo  := 'Manifestar sobre proposta de acordo';
    v_uteis   := 2;
  elsif v_texto ~* 'senten[çc]a' then
    v_gatilho := 'sentenca';
    v_titulo  := 'Analisar sentença - decidir recurso';
    v_uteis   := 2;
  elsif v_texto ~* 'laudo' then
    v_gatilho := 'laudo';
    v_titulo  := 'Analisar laudo pericial';
    v_uteis   := 3;
  elsif v_texto ~* 'rpv|precat[óo]rio|requisi[çc][ãa]o de pequeno valor' then
    v_gatilho := 'rpv';
    v_titulo  := 'Verificar pagamento (RPV/precatório)';
    v_uteis   := 5;
  elsif v_texto ~* 'manifest' then
    v_gatilho := 'manifestacao';
    v_titulo  := 'Manifestar nos autos';
    v_uteis   := 2;
  else
    return NEW;
  end if;

  select cl.nome into v_cliente
    from public.casos c join public.clientes cl on cl.id = c.cliente_id
   where c.id = NEW.caso_id;

  v_due := (public._dia_util_apos((now() at time zone 'America/Sao_Paulo')::date, v_uteis)::timestamp
            + interval '9 hours') at time zone 'America/Sao_Paulo';

  -- >>> laudo da perícia judicial (migration_publicacao_laudo_avisa_conferencia)
  -- Bloco próprio: se falhar, a tarefa da publicação nasce do mesmo jeito.
  v_laudo := false;
  if v_gatilho = 'laudo' and NEW.processo_judicial_id is not null
     and private.publicacao_fala_do_laudo(v_texto) then
    v_laudo := true;
    begin
      -- 1. Avisa a conferência aberta deste processo: prazo para hoje e a
      --    marca que a tela mostra. NÃO conclui — favorável ou não é leitura
      --    de gente, e a publicação não diz.
      update public.tarefas t
         set due_at   = least(coalesce(t.due_at, now()), now()),
             metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
                          'laudo_publicado_em', now(),
                          'laudo_publicacao_andamento_id', NEW.id)
       where t.caso_id = NEW.caso_id
         and t.processo_judicial_id = NEW.processo_judicial_id
         and t.status in ('a_fazer', 'fazendo')
         and coalesce(t.metadata->>'acompanhamento_pericia', '') = 'true'
         and private.eh_pericia_judicial(t.metadata, t.processo_judicial_id);

      -- 2. A análise do laudo já está aberta neste processo (alguém registrou
      --    o laudo pelo botão antes de a publicação chegar): a publicação entra
      --    nela, em vez de abrir uma segunda tarefa para a mesma análise.
      update public.tarefas t
         set descricao = coalesce(t.descricao, '') || E'\n\n'
                         || 'Publicação sobre o laudo chegou em '
                         || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
                         || ': "' || left(coalesce(NEW.titulo, ''), 120)
                         || '". Leia a publicação no caso e confira o prazo REAL nela.',
             metadata  = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
                           'laudo_publicado_em', now(),
                           'origem_andamento_id', NEW.id)
       where t.caso_id = NEW.caso_id
         and t.processo_judicial_id = NEW.processo_judicial_id
         and t.status in ('a_fazer', 'fazendo')
         and coalesce(t.metadata->>'analise_laudo_pericia', '') = 'true'
         and not (coalesce(t.metadata, '{}'::jsonb) ? 'laudo_publicacao_andamento_id')
         and coalesce(t.metadata->>'origem_andamento_id', '') <> NEW.id::text;
      if found then return NEW; end if;
    exception when others then
      raise warning 'aviso do laudo falhou (andamento %): % / %', NEW.id, SQLSTATE, SQLERRM;
    end;
  end if;
  -- <<< laudo da perícia judicial

  insert into public.tarefas
    (caso_id, tipo, status, prioridade, titulo, descricao,
     due_at, origem, origem_ref, processo_admin_id, processo_judicial_id, metadata)
  select
    NEW.caso_id, 'prazo', 'a_fazer', 1,
    v_titulo || ' - ' || coalesce(v_cliente, 'cliente'),
    'Publicação detectada (' || v_gatilho || '): "'
      || left(coalesce(NEW.titulo, ''), 120) || '". Leia a publicação no caso, '
      || 'confira o prazo REAL nela e aja. O prazo desta tarefa ('
      || v_uteis || ' dias úteis) é só o lembrete de segurança.',
    v_due,
    'sync_djen',
    'andamento:' || NEW.id::text || ':acionavel',
    NEW.processo_admin_id,
    NEW.processo_judicial_id,
    jsonb_build_object(
      'publicacao_acionavel', v_gatilho,
      'origem_andamento_id', NEW.id
    ) || case when v_laudo then jsonb_build_object('analise_laudo_pericia', true)
              else '{}'::jsonb end
  where not exists (
    select 1 from public.tarefas t
     where t.origem = 'sync_djen'  -- casa com o índice parcial uq_tarefas_origem_ref
       and t.origem_ref = 'andamento:' || NEW.id::text || ':acionavel'
  );

  return NEW;
exception when others then
  raise warning 'tg_publicacao_acionavel_cria_tarefa falhou (andamento %): % / %',
    NEW.id, SQLSTATE, SQLERRM;
  return NEW;
end;
$function$;

-- As análises que a publicação já abriu e seguem abertas ganham a mesma marca,
-- para o botão do laudo enxergá-las e não abrir outra.
update public.tarefas t
   set metadata = t.metadata || jsonb_build_object('analise_laudo_pericia', true)
  from public.andamentos a
 where a.id::text = t.metadata->>'origem_andamento_id'
   and t.metadata->>'publicacao_acionavel' = 'laudo'
   and t.status in ('a_fazer', 'fazendo')
   and t.processo_judicial_id is not null
   and coalesce(t.metadata->>'analise_laudo_pericia', '') <> 'true'
   and private.publicacao_fala_do_laudo(coalesce(a.titulo, '') || ' ' || coalesce(a.descricao, ''));

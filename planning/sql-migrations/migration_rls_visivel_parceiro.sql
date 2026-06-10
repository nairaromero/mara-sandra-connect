-- BLINDAGEM LGPD: enforce `visivel_parceiro` na camada de RLS.
--
-- Problema (auditoria 2026-06-09): a flag visivel_parceiro era respeitada só no
-- frontend. As policies liberavam TODO o conteúdo do caso do parceiro, então um
-- parceiro com o próprio token conseguia ler, via API REST direta, andamentos e
-- documentos internos (visivel_parceiro=false) e análises técnicas inteiras.
--
-- Correção: o banco passa a exigir o que a UI já exige. A UI do parceiro já
-- filtra `visivel_parceiro === true` (andamentos/documentos) e nunca lê
-- analises_tecnicas (aba e query são gated a interno) — então nada quebra.

-- 1) Andamentos: parceiro só lê os visíveis.
alter policy andamentos_select on public.andamentos
  using (
    public.is_interno()
    or (public.caso_do_parceiro(caso_id) and visivel_parceiro)
  );

-- 2) Documentos (tabela): parceiro só lê os visíveis.
alter policy documentos_select on public.documentos
  using (
    public.is_interno()
    or (public.caso_do_parceiro(caso_id) and visivel_parceiro)
  );

-- 3) Análises técnicas: conteúdo interno. Parceiro não lê (hoje nem consulta).
--    O dia que quiser expor o resumo ao parceiro, criar uma view dedicada.
alter policy analises_select on public.analises_tecnicas
  using (public.is_interno());

-- 4) Storage (bucket 'documentos'): a geração de signed URL também precisa
--    respeitar visivel_parceiro. Consolida as duas policies de SELECT antigas
--    (que só checavam posse do caso) numa só, com join na tabela documentos.
drop policy if exists "documentos_select_interno_ou_parceiro_do_caso" on storage.objects;
drop policy if exists "documentos_storage_parceiro_select" on storage.objects;

create policy "documentos_select_visivel_parceiro" on storage.objects
  for select to public
  using (
    bucket_id = 'documentos'
    and (
      public.is_interno()
      or exists (
        select 1
        from public.documentos d
        where d.storage_path = storage.objects.name
          and public.caso_do_parceiro(d.caso_id)
          and d.visivel_parceiro
      )
    )
  );

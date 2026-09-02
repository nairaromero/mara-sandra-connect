-- Uso de armazenamento por parceiro (2026-08-23)
--
-- Degrau 1 da atribuicao de storage por parceiro (DECISOES.md, discussao de
-- 2026-08-23): SO MEDIR E MOSTRAR. Sem quota, sem bloqueio, sem cobranca —
-- esses sao degraus futuros, se um dia o custo justificar (hoje: 3,9 GB dos
-- 100 GB inclusos no plano; 1 parceiro concentra ~62%).
--
-- A atribuicao usa o que ja existe: o caminho do objeto no bucket comeca com
-- o caso_id, e casos.parceiro_id diz de quem e o caso.
--
-- Permissao: SECURITY DEFINER porque storage.objects nao e legivel pelo
-- usuario comum. A guarda dentro da query limita o resultado: interno ve
-- todos; parceiro ve apenas a propria linha; anon nao executa (revoke).
--
-- Idempotente: pode rodar varias vezes.

create or replace function public.uso_storage_parceiro()
returns table (parceiro_id uuid, nome text, arquivos bigint, bytes bigint)
language sql
stable
security definer
set search_path = public, storage
as $$
  select c.parceiro_id,
         coalesce(u.nome, '(sem parceiro)') as nome,
         count(*)::bigint as arquivos,
         sum(coalesce((o.metadata->>'size')::bigint, 0))::bigint as bytes
    from storage.objects o
    join public.casos c on c.id::text = split_part(o.name, '/', 1)
    left join public.usuarios u on u.id = c.parceiro_id
   where o.bucket_id = 'documentos'
     and (
       public.is_interno()
       or (c.parceiro_id is not null and c.parceiro_id = auth.uid())
     )
   group by c.parceiro_id, u.nome
   order by 4 desc
$$;

comment on function public.uso_storage_parceiro() is
  'Bytes e arquivos no bucket documentos por parceiro (via caso do caminho). Interno ve todos; parceiro so a propria linha.';

revoke all on function public.uso_storage_parceiro() from public;
revoke all on function public.uso_storage_parceiro() from anon;
grant execute on function public.uso_storage_parceiro() to authenticated;

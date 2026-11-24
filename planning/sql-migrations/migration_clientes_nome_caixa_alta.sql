-- ============================================================================
-- Nome do cliente sempre em CAIXA ALTA (pedido da Naira, 23/11/2026)
--
-- Quem cadastra (equipe ou parceiro) digita como quiser — "maria da silva",
-- "Maria Da Silva", "mArIa" —; o nome fica gravado "MARIA DA SILVA".
--
-- Por que no banco, num gatilho só: o cliente nasce e muda por vários caminhos
-- (Novo caso, página do caso, Comercial → cliente, importação por Excel,
-- documento criado direto no ZapSign, edge functions). Regra na tela seria
-- uma cópia por caminho; aqui é uma, e vale para o que ainda vier.
-- As telas só MOSTRAM o campo em caixa alta (`className="uppercase"`).
--
-- upper() do Postgres respeita acento com o ctype do banco (en_US.UTF-8 nos
-- três ambientes, conferido em 23/11): "joão" → "JOÃO". Espaço nas pontas sai.
--
-- Busca por nome não muda: quem procura cliente pelo nome já usa `ilike`.
-- Em produção, 6 de 548 nomes estavam fora do padrão (23/11); o passo 2 acerta.
-- Idempotente.
-- ============================================================================

create or replace function private.tg_clientes_nome_caixa_alta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.nome is not null then
    new.nome := upper(btrim(new.nome));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clientes_nome_caixa_alta on public.clientes;
create trigger trg_clientes_nome_caixa_alta
  before insert or update of nome on public.clientes
  for each row execute function private.tg_clientes_nome_caixa_alta();

-- 2) Os que já existem. Só toca quem está fora do padrão.
update public.clientes
   set nome = upper(btrim(nome))
 where nome is not null and nome is distinct from upper(btrim(nome));

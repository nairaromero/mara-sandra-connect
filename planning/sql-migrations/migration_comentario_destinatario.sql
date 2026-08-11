-- migration_comentario_destinatario.sql
--
-- Dá dono às conversas com parceiro.
--
-- Problema: `comentarios` nunca teve destinatário. Quem recebia estava fixo no
-- código da notify-novo-comentario: parceiro comenta -> notifica TODOS os
-- internos ativos. Com 5 pessoas na equipe, todo mundo recebia tudo, ninguém era
-- responsável por nada, e a tela /conversas virava uma pilha sem dono.
--
-- Depois desta migration:
--   destinatario_id preenchido -> a conversa é daquela pessoa
--   destinatario_id NULL       -> "Todos" (comportamento de hoje, e é o default
--                                 pros 22 comentários que já existem)
--
-- ESCOPO: o destinatário é da CONVERSA, não da mensagem. Ele é gravado na raiz
-- da thread (parent_id is null) e as respostas herdam — quem lê resolve subindo
-- pro parent. Foi decisão da Naira: "essa conversa é com a Mariane", do começo
-- ao fim, em vez de conversa picada entre várias caixas. Hoje não existe nenhuma
-- resposta no banco (22 comentários, 22 raízes), então nada precisa ser migrado.
--
-- Idempotente.

alter table public.comentarios
  add column if not exists destinatario_id uuid references public.usuarios(id);

comment on column public.comentarios.destinatario_id is
  'Para quem é a conversa. NULL = Todos (equipe interna inteira), que é o '
  'comportamento historico. So faz sentido na raiz da thread (parent_id is '
  'null); respostas herdam da raiz. Filtro Eu/pessoa/Todos em /conversas e '
  'roteamento da notify-novo-comentario dependem disto.';

-- A caixa filtra por destinatário dentro do que já é visível, e quase sempre
-- junto de "raiz da thread". Índice parcial: linha com destinatário é minoria.
create index if not exists comentarios_destinatario_idx
    on public.comentarios (destinatario_id)
 where destinatario_id is not null;

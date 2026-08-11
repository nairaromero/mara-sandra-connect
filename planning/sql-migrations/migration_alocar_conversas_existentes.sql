-- migration_alocar_conversas_existentes.sql
--
-- Dá dono às conversas que já existiam antes do destinatário existir.
--
-- Sem isto, as 22 conversas anteriores ficam todas como "Todos" e continuam
-- aparecendo na caixa de todo mundo — o filtro "Minhas conversas" só teria
-- efeito daqui pra frente.
--
-- O sinal usado é o mais forte que existe e não é chute: em 13 dos 14 casos,
-- exatamente UMA pessoa da equipe escreveu naquela conversa. Essa pessoa já é,
-- de fato, quem está tocando o assunto com o parceiro — então a conversa é
-- dela, e a resposta do parceiro deve cair na caixa dela.
--
-- Levantamento em 2026-08-11 (produção):
--   Naira Romero ......... 6 casos,  8 mensagens
--   Mara Sandra .......... 6 casos, 12 mensagens
--   Beatriz Santiago ..... 1 caso,   1 mensagem
--   sem ninguém da equipe. 1 caso,   1 mensagem  -> fica "Todos", de propósito:
--                                     só o parceiro falou, ninguém assumiu ainda.
--   ambíguos (2+ pessoas)  0 casos            -> nada a decidir a mão.
--
-- Nota sobre o caso em que o próprio interno escreveu: o destinatário fica
-- sendo ele mesmo. Não é "mandar pra si" — `destinatario_id` responde "de quem
-- é esta conversa", e é o que faz a resposta do parceiro voltar pra pessoa
-- certa em vez de acordar a equipe inteira.
--
-- REVERSÍVEL: desfazer é `update comentarios set destinatario_id = null`.
-- Idempotente: só preenche o que está nulo.

begin;

with dono as (
  -- Uma linha por caso, só quando há exatamente 1 interno envolvido.
  select c.caso_id,
         -- min() nao existe pra uuid; como o HAVING garante 1 distinto,
         -- qualquer elemento serve.
         (array_agg(distinct u.id))[1] as usuario_id
    from public.comentarios c
    join public.usuarios u on u.id = c.autor_id
   where c.rascunho = false
     and u.tipo = 'interno'
   group by c.caso_id
  having count(distinct u.id) = 1
)
update public.comentarios c
   set destinatario_id = d.usuario_id
  from dono d
 where c.caso_id = d.caso_id
   and c.parent_id is null      -- destinatário vive na raiz; resposta herda
   and c.rascunho = false
   and c.destinatario_id is null;

commit;

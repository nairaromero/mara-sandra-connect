-- migration_eh_parceiro_flag.sql
--
-- Separa "modo de acesso" de "papel comercial de parceiro".
--
-- Ate agora `usuarios.tipo` fazia dois trabalhos ao mesmo tempo:
--   1) qual interface a pessoa ve (equipe ve tudo / parceiro ve o portal
--      restrito aos casos dele);
--   2) se a pessoa e parceira do escritorio (indica casos, recebe repasse).
--
-- Isso funcionou enquanto os dois conjuntos eram disjuntos. Quebrou quando
-- apareceu alguem que e das duas coisas: advogada da equipe que tambem indica
-- casos e recebe repasse. Como `tipo` e um valor so, nao dava pra representar.
--
-- A separacao e barata porque o acesso do parceiro nas RLS nunca dependeu de
-- `tipo` — sempre foi `casos.parceiro_id = auth.uid()`. E quem recebe repasse
-- e `casos.parceiro_id` + `usuarios.percentual_parceiro`, tambem independente
-- de `tipo`. O unico lugar que amarrava os dois era o seletor "quem e o
-- parceiro deste caso", que filtrava por tipo='parceiro'.
--
-- Depois desta migration:
--   tipo         = modo de acesso   (interno | parceiro)
--   eh_parceiro  = papel comercial  (indica casos, recebe repasse)
--
-- Idempotente.

alter table public.usuarios
  add column if not exists eh_parceiro boolean not null default false;

comment on column public.usuarios.eh_parceiro is
  'Papel comercial: indica casos e recebe repasse. Independe de tipo — um '
  'usuario tipo=interno pode ter eh_parceiro=true (advogada da equipe que '
  'tambem indica casos). Os seletores de "parceiro do caso" filtram por esta '
  'coluna, nao por tipo.';

-- Backfill: todo mundo que hoje e tipo='parceiro' e, por definicao, parceiro
-- comercial. Sem isso os seletores ficariam vazios.
update public.usuarios
   set eh_parceiro = true
 where tipo = 'parceiro'
   and eh_parceiro is distinct from true;

-- Os seletores sempre filtram eh_parceiro = true, entao indice parcial basta.
create index if not exists usuarios_eh_parceiro_idx
    on public.usuarios (eh_parceiro)
 where eh_parceiro;

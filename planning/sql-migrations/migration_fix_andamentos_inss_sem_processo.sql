-- Conserta os andamentos criados pelo processador de e-mail que ficaram SEM
-- vínculo com o requerimento e caíram em "Andamentos Gerais".
--
-- Causa: quando o cliente casava por nome/CPF, o matcher devolvia
-- processo_admin_id = null e ninguém tentava o protocolo depois — mesmo com o
-- protocolo vindo no e-mail e o requerimento existindo no caso. Corrigido na
-- edge function (acharProcessoAdminDoCaso); aqui arrumamos o que já nasceu
-- torto.
--
-- Só toca andamento que: veio do processador (metadata.gmail_message_id),
-- está sem processo, e cujo protocolo casa com um requerimento DO MESMO CASO.
-- Protocolo de outro caso fica como está — melhor solto que no lugar errado.
--
-- Idempotente: rodar de novo não altera nada (o filtro exige processo nulo).

with alvo as (
  select a.id as andamento_id, pa.id as processo_admin_id
    from public.andamentos a
    join public.processos_admin pa
      on pa.caso_id = a.caso_id
     and pa.numero_req_normalizado = regexp_replace(
           coalesce(
             a.metadata->'campos_extraidos'->>'protocolo',
             substring(a.descricao from 'Protocolo:\s*([0-9]+)')
           ), '\D', '', 'g')
   where a.processo_admin_id is null
     and a.metadata ? 'gmail_message_id'
     and coalesce(
           a.metadata->'campos_extraidos'->>'protocolo',
           substring(a.descricao from 'Protocolo:\s*([0-9]+)')
         ) is not null
)
update public.andamentos a
   set processo_admin_id = alvo.processo_admin_id
  from alvo
 where a.id = alvo.andamento_id;

-- Segunda passada: andamentos do template ("Benefício Indeferido — iremos
-- analisar e repassar") escrevem o protocolo em prosa, num formato que a
-- extração acima não pega. Mas eles vieram do MESMO e-mail que o andamento
-- "INSS — <classificação>", que já está vinculado — então herdam dele.
with irmao as (
  select a.metadata->>'gmail_message_id' as msg_id, a.processo_admin_id, a.caso_id
    from public.andamentos a
   where a.processo_admin_id is not null
     and a.metadata ? 'gmail_message_id'
)
update public.andamentos a
   set processo_admin_id = irmao.processo_admin_id
  from irmao
 where a.processo_admin_id is null
   and a.metadata ? 'gmail_message_id'
   and a.metadata->>'gmail_message_id' = irmao.msg_id
   and a.caso_id = irmao.caso_id;

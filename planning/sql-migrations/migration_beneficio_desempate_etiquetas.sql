-- Desempate de casos "a_definir" que tinham DUAS etiquetas de benefício.
--
-- Regras dadas pela Naira (2026-08-15), em cima dos pares reais da base:
--   REVISAO_APOSENTADORIA + APOSENTADORIA_POR_IDADE = APOSENTADORIA_POR_IDADE
--   AUXILIO_DOENCA        + AUXILIO_ACIDENTE        = AUXILIO_ACIDENTE
--
-- Generalizando o que ela decidiu: REVISAO_APOSENTADORIA e AUXILIO_DOENCA são
-- etiquetas FRACAS — descrevem o entorno, não o benefício em si. Quando
-- aparecem ao lado de outra etiqueta de benefício, a outra é que vale.
--
-- NÃO entram aqui (decisão pendente, seguem "a_definir"): os pares em que a
-- Naira pediu "os dois", porque o campo guarda um valor só —
--   AUXILIO_ACIDENTE + APOSENTADORIA_ESPECIAL
--   APOSENTADORIA_POR_TEMPO_CONTRIBUICAO + APOSENTADORIA_POR_IDADE
--
-- Idempotente: só toca linha ainda em "a_definir".

with mapa(tag, beneficio) as (
  values
    ('APOSENTADORIA_RURAL',                  'Aposentadoria Rural'),
    ('AUXILIO_ACIDENTE',                     'Auxílio-acidente'),
    ('APOSENTADORIA_ESPECIAL',               'Aposentadoria especial'),
    ('APOSENTADORIA_PCD_TEMPO_CONTRIBUICAO', 'Aposentadoria da PCD (LC 142/2013)'),
    ('APOSENTADORIA_POR_TEMPO_CONTRIBUICAO', 'Aposentadoria por tempo de contribuição'),
    ('APOSENTADORIA_POR_IDADE',              'Aposentadoria por idade')
),
fracas(tag) as (
  values ('REVISAO_APOSENTADORIA'), ('AUXILIO_DOENCA')
),
tags_beneficio as (
  select c.id as caso_id, e.nome as tag
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
    join public.clientes_etiquetas ce on ce.cliente_id = cl.id
    join public.etiquetas e on e.id = ce.etiqueta_id
   where c.tipo_beneficio = 'a_definir'
     and e.nome ~* '^(AUXILIO|APOSENTADORIA|PENSAO|BPC|LOAS|SALARIO|REVISAO)'
),
pares as (
  select caso_id
    from tags_beneficio
   group by caso_id
  having count(*) = 2
     -- exatamente uma das duas é fraca: aí o desempate é objetivo
     and count(*) filter (where tag in (select tag from fracas)) = 1
),
vencedora as (
  select t.caso_id, t.tag
    from tags_beneficio t
    join pares p on p.caso_id = t.caso_id
   where t.tag not in (select tag from fracas)
)
update public.casos c
   set tipo_beneficio = mapa.beneficio
  from vencedora
  join mapa on mapa.tag = vencedora.tag
 where c.id = vencedora.caso_id
   and c.tipo_beneficio = 'a_definir';

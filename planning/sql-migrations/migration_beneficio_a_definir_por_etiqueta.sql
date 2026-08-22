-- Preenche tipo_beneficio dos casos "a_definir" a partir da ETIQUETA do cliente.
--
-- Regra combinada com a Naira: o benefício está na etiqueta. Sem etiqueta,
-- continua "a_definir" — não se inventa classificação.
--
-- CONSERVADOR de propósito. Só entra caso que atende às DUAS condições:
--   1. tem exatamente UMA etiqueta de benefício (duas = ambíguo, ex.
--      "REVISAO_APOSENTADORIA + APOSENTADORIA_POR_IDADE");
--   2. essa etiqueta tem correspondente EXATO no vocabulário de benefícios
--      já usado nos casos.
--
-- Fora daqui (e mantidos como "a_definir" pra decisão humana):
--   - AUXILIO_DOENCA_POSTERIOR_APOSENTADORIA_POR_INVALIDEZ — a etiqueta
--     descreve uma sequência, não um benefício;
--   - REVISAO_PENSAO_MORTE — não há canônico equivalente;
--   - os 12 casos com duas etiquetas de benefício.
--
-- Idempotente: só toca linha que ainda está em "a_definir".

with mapa(tag, beneficio) as (
  values
    ('APOSENTADORIA_RURAL',                  'Aposentadoria Rural'),
    ('AUXILIO_ACIDENTE',                     'Auxílio-acidente'),
    ('APOSENTADORIA_ESPECIAL',               'Aposentadoria especial'),
    ('APOSENTADORIA_PCD_TEMPO_CONTRIBUICAO', 'Aposentadoria da PCD (LC 142/2013)'),
    ('APOSENTADORIA_POR_TEMPO_CONTRIBUICAO', 'Aposentadoria por tempo de contribuição'),
    ('APOSENTADORIA_POR_IDADE',              'Aposentadoria por idade'),
    ('REVISAO_APOSENTADORIA',                'Revisão de aposentadoria')
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
unicos as (
  select caso_id, min(tag) as tag
    from tags_beneficio
   group by caso_id
  having count(*) = 1
)
update public.casos c
   set tipo_beneficio = mapa.beneficio
  from unicos
  join mapa on mapa.tag = unicos.tag
 where c.id = unicos.caso_id
   and c.tipo_beneficio = 'a_definir';

-- Mesma limpa, agora nos casos marcados como "Outro".
--
-- Diferença importante em relação a "a_definir": "Outro" foi uma ESCOLHA de
-- alguém, não um vazio. Por isso a regra aqui é ainda mais estrita — só troca
-- quando a etiqueta aponta um tipo específico e há UM só resultado possível.
-- Sem etiqueta que diga a natureza, continua "Outro".
--
-- Idempotente: só toca linha ainda em "Outro".

with mapa(tag, beneficio) as (
  values
    ('APOSENTADORIA_RURAL',                  'Aposentadoria Rural'),
    ('AUXILIO_ACIDENTE',                     'Auxílio-acidente'),
    ('APOSENTADORIA_ESPECIAL',               'Aposentadoria especial'),
    ('APOSENTADORIA_PCD_TEMPO_CONTRIBUICAO', 'Aposentadoria da PCD (LC 142/2013)'),
    ('APOSENTADORIA_POR_TEMPO_CONTRIBUICAO', 'Aposentadoria por tempo de contribuição'),
    ('APOSENTADORIA_POR_IDADE',              'Aposentadoria por idade'),
    ('CIVEL/CONSUMIDOR',                     'Cível/Consumidor'),
    ('CALCULO_PREVIDENCIARIO',               'Cálculo previdenciário'),
    ('PLANEJAMENTO_PREVIDENCIARIO',          'Planejamento previdenciário'),
    ('ADICIONAL_25_INSS',                    'Adicional 25% INSS'),
    ('ACERTOS_DE_VINCULOS_INSS',             'Acertos de vínculos'),
    ('BENEFICIO_POR_INCAPACIDADE_TEMPORARIA','Incapacidade temporária'),
    ('AUXILIO_DOENCA_POSTERIOR_APOSENTADORIA_POR_INVALIDEZ',
     'Auxílio-doença posterior à aposentadoria por invalidez')
),
candidatos as (
  select c.id as caso_id, min(mapa.beneficio) as beneficio
    from public.casos c
    join public.clientes cl on cl.id = c.cliente_id
    join public.clientes_etiquetas ce on ce.cliente_id = cl.id
    join public.etiquetas e on e.id = ce.etiqueta_id
    join mapa on mapa.tag = e.nome
   where c.tipo_beneficio = 'Outro'
   group by c.id
  having count(distinct mapa.beneficio) = 1   -- duas naturezas = deixa quieto
)
update public.casos c
   set tipo_beneficio = candidatos.beneficio
  from candidatos
 where c.id = candidatos.caso_id
   and c.tipo_beneficio = 'Outro';

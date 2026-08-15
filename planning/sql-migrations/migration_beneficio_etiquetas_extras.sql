-- Mais classificações de "a_definir" por etiqueta (regras da Naira, 2026-08-15).
--
-- Vários destes não são benefício do INSS (planejamento, cálculo, acerto de
-- vínculos): são serviços/áreas. Entram no mesmo campo porque é ele que
-- classifica o caso na tela — melhor a natureza correta do que "a definir".
--
-- INVALIDEZ não entra sozinha: no único caso em que aparece, vem junto de
-- BENEFICIO_POR_INCAPACIDADE_TEMPORARIA, e a Naira definiu que vale a
-- incapacidade temporária.
--
-- Idempotente: só toca linha ainda em "a_definir".

with mapa(tag, beneficio) as (
  values
    ('CALCULO_PREVIDENCIARIO',                              'Cálculo previdenciário'),
    ('PLANEJAMENTO_PREVIDENCIARIO',                         'Planejamento previdenciário'),
    ('ADICIONAL_25_INSS',                                   'Adicional 25% INSS'),
    ('ACERTOS_DE_VINCULOS_INSS',                            'Acertos de vínculos'),
    ('BENEFICIO_POR_INCAPACIDADE_TEMPORARIA',               'Incapacidade temporária'),
    ('AUXILIO_DOENCA_POSTERIOR_APOSENTADORIA_POR_INVALIDEZ',
     'Auxílio-doença posterior à aposentadoria por invalidez')
)
update public.casos c
   set tipo_beneficio = mapa.beneficio
  from public.clientes cl
  join public.clientes_etiquetas ce on ce.cliente_id = cl.id
  join public.etiquetas e on e.id = ce.etiqueta_id
  join mapa on mapa.tag = e.nome
 where cl.id = c.cliente_id
   and c.tipo_beneficio = 'a_definir';

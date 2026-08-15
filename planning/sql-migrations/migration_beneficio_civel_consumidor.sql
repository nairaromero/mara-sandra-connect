-- Casos "a_definir" com a etiqueta CIVEL/CONSUMIDOR passam a ter esse tipo.
--
-- Não é benefício do INSS: é área de atuação. Mas o campo tipo_beneficio é o
-- que classifica o caso na tela, e deixar como "a_definir" escondia trabalho
-- que já tem natureza conhecida.
--
-- Grafia segue a da etiqueta que já existe na base (CÍVEL, não "civil").
-- Idempotente: só toca linha ainda em "a_definir".

update public.casos c
   set tipo_beneficio = 'Cível/Consumidor'
  from public.clientes cl
  join public.clientes_etiquetas ce on ce.cliente_id = cl.id
  join public.etiquetas e on e.id = ce.etiqueta_id
 where cl.id = c.cliente_id
   and e.nome = 'CIVEL/CONSUMIDOR'
   and c.tipo_beneficio = 'a_definir';

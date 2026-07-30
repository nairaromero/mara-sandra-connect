-- Corrige acentuacao dos valores de casos.tipo_beneficio (o texto exibido
-- no dropdown e o proprio valor salvo). Acompanha a correcao das listas
-- TIPOS_BENEFICIO no frontend.
--
-- Idempotente: rodar de novo nao acha mais as versoes sem acento.

UPDATE casos SET tipo_beneficio = 'Aposentadoria por tempo de contribuição'
 WHERE tipo_beneficio = 'Aposentadoria por tempo de contribuicao';

UPDATE casos SET tipo_beneficio = 'Auxílio por incapacidade temporária'
 WHERE tipo_beneficio = 'Auxilio por incapacidade temporaria';

UPDATE casos SET tipo_beneficio = 'Auxílio-acidente'
 WHERE tipo_beneficio = 'Auxilio-acidente';

UPDATE casos SET tipo_beneficio = 'Pensão por morte'
 WHERE tipo_beneficio = 'Pensao por morte';

UPDATE casos SET tipo_beneficio = 'Salário-maternidade'
 WHERE tipo_beneficio = 'Salario-maternidade';

UPDATE casos SET tipo_beneficio = 'Revisão da vida toda'
 WHERE tipo_beneficio = 'Revisao da vida toda';

UPDATE casos SET tipo_beneficio = 'Revisão de aposentadoria'
 WHERE tipo_beneficio = 'Revisao de aposentadoria';

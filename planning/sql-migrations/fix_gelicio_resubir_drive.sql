-- Caso GELICIO JOAO CANDIDO (08c8628c-cf73-4862-8af4-6aa19f30fdae)
-- 17 arquivos foram apagados da pasta do Drive e nao estao na lixeira.
-- Os arquivos continuam no Storage do app; so o vinculo aponta pra um
-- arquivo que nao existe mais.
--
-- Limpar gdrive_file_id SO desses 17 faz eles voltarem pra fila de
-- "Subir pendentes", que re-sobe do Storage pro Drive e grava o novo id.
-- Os 8 que ainda existem no Drive nao sao tocados (evita duplicata la).

update public.documentos
set gdrive_file_id = null
where caso_id = '08c8628c-cf73-4862-8af4-6aa19f30fdae'
  and gdrive_file_id in (
    '1c3Rzmijafq2C7ziUsq1t6NLQlOMbS0Fk', -- 00 - Req Adm INSS .docx
    '1c-d1fWWSeqlYGDPaiyOz8-51XTDekI4q', -- 00 - Req Adm INSS .pdf
    '1RCvr5QX_hQN4PjpIy7Mh_jsLXyBB-O3u', -- 01 - RG
    '15MOAhjuluy3LQgjKG_9zC6SnudJmEvQ6', -- 02 - comprovante de endereco
    '1aJ47X75--l1IJRBuyzVHLm6Xjsm4G70y', -- 03 - Procuracao
    '1IDE9NOEYR8IPcXMZz6B55Faw4Xbqzx8y', -- 04 - Declaracao
    '18NcHV1LKCMv9yS9vAxBM3nFJm5mLcW9W', -- 05 - Termo de Autorizacao
    '1p-bqcD8E8a-09AkeSC6jetMICF_i2AF3', -- 06 - Termo de Representacao
    '1xNT4marvLcU_BdpDYsPJ22KYqWbAF1R_', -- 07 - CTPS
    '1hXckBtwGW-FM1WxZ31QW3VqDXHiQ40iN', -- 08 - CNIS
    '1D8Q2qKUjiF8RdLxJNztYIW4z8en6RSAL', -- 10 - relatorio medico 01 07 2025
    '11jrRTsfErvSehw6FqhaEyODtJk8ZLqVn', -- 100 - PEDIDO DE IMPULSO .docx
    '1Xt8OmldF3wlJVV5SGi3umUtFCVy-DGKo', -- 100 - PEDIDO DE IMPULSO .pdf
    '1ITpHRTBVpDjJptC9qA5c28yy17O9HiMm', -- 11 - Protocolo ADM
    '1xpSDVU3M__6n_EPRWQaqYljq79G_WOkd', -- 12 - INSS OUVIDORIA
    '1e_7jqld5-y4AmGR3crQKYMbBXLSLv1OB', -- 13 - Carta_Medico
    '1R8MX9_5eKlhGVYhve9-4WoTfuQOtyK1v'  -- Contrato Prestacao de Servico (Diversos)
  );

-- Conferencia: deve voltar 17 em pendentes e 8 em com_id.
select
  count(*) filter (where gdrive_file_id is null) as pendentes,
  count(*) filter (where gdrive_file_id is not null) as com_id
from public.documentos
where caso_id = '08c8628c-cf73-4862-8af4-6aa19f30fdae';

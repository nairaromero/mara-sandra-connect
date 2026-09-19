-- migration_documento_tipo_label_intake.sql
--
-- documento_tipo_label() passa a conhecer os 8 tipos de documento do PR #367
-- (migration_tipos_documento_intake.sql) e o 'senha_meu_inss'.
--
-- Contexto (2026-09-19): a função mapeia tipo → rótulo e é usada por
-- _analise_docs_parceiro_descricao (migration_tarefa_analise_documento_parceiro.sql),
-- que monta a descrição da tarefa "analisar documentos do parceiro". Quem não
-- está no `case` cai no fallback `initcap(replace(...))`, então um documento
-- enviado pelo parceiro aparecia na tarefa como "Termo Renuncia Teto",
-- "Pgr Ppra" ou "Cnis Resumido".
--
-- Os rótulos são os mesmos do front, para o parceiro ler a mesma coisa nos
-- dois lugares: TIPOS_DOCUMENTO_LABEL em src/lib/documentos/tipos.ts e
-- ROTULO_PEDIDO_SENHA em src/lib/documentos/senha-meu-inss.ts.
--
-- Partiu do `pg_get_functiondef` da PRODUÇÃO em 2026-09-19
-- (md5 824fa229947c695199710ed8a3a7b8bb, idêntico ao do staging): o corpo
-- abaixo é aquele texto mais as 9 linhas novas. Nada mais mudou — nem a
-- assinatura, nem IMMUTABLE, nem o fallback.
--
-- Idempotente (create or replace) e reversível: reaplicar a definição anterior
-- volta ao estado de hoje.

create or replace function public.documento_tipo_label(p_tipo text)
returns text
language sql
immutable
as $function$
  select coalesce(
    case p_tipo
      when 'cnis'                            then 'CNIS'
      when 'cnis_resumido'                   then 'CNIS resumido'
      when 'rg_cpf'                          then 'RG / CPF'
      when 'comprovante_residencia'          then 'Comprovante de residência'
      when 'ctps'                            then 'CTPS'
      when 'holerite'                        then 'Holerite / contracheque'
      when 'ppp'                             then 'PPP'
      when 'laudo_medico'                    then 'Laudo médico'
      when 'laudo_inss'                      then 'Laudo INSS (SABI / perícia federal)'
      when 'ltcat'                           then 'LTCAT'
      when 'pgr_ppra'                        then 'PGR / PPRA'
      when 'atestado_medico'                 then 'Atestado médico'
      when 'cat'                             then 'CAT'
      when 'carne_gps'                       then 'Carnê de contribuição (GPS)'
      when 'ctc'                             then 'CTC'
      when 'carta_concessao_inss'            then 'Carta de concessão/indeferimento INSS'
      when 'hiscre'                          then 'HISCRE'
      when 'certidao_casamento'              then 'Certidão de casamento'
      when 'certidao_obito'                  then 'Certidão de óbito'
      when 'certidao_nascimento'             then 'Certidão de nascimento'
      when 'declaracao_uniao_estavel'        then 'Declaração de união estável'
      when 'declaracao_atividade_rural'      then 'Declaração de atividade rural'
      when 'procuracao'                      then 'Procuração'
      when 'substabelecimento'               then 'Substabelecimento'
      when 'contrato_honorarios'             then 'Contrato de honorários'
      when 'declaracao_hipossuficiencia'     then 'Declaração de hipossuficiência'
      when 'declaracao_ausencia_duplicidade' then 'Declaração de ausência de duplicidade de ação'
      when 'termo_representacao'             then 'Termo de representação e autorização (INSS)'
      when 'autodeclaracao_veracidade'       then 'Autodeclaração de autenticidade e veracidade'
      when 'termo_renuncia_teto'             then 'Termo de renúncia ao teto dos JEF'
      when 'termo_responsabilidade'          then 'Termo de responsabilidade'
      when 'cnpj_empregadora'                then 'CNPJ (empresa empregadora)'
      when 'senha_meu_inss'                  then 'Troca da senha do Meu INSS'
      when 'outro'                           then 'Outro'
    end,
    initcap(replace(coalesce(p_tipo, 'documento'), '_', ' '))
  );
$function$;

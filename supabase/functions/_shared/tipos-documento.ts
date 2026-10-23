// Tipos de documento: UMA lista. As functions (ferramentas de IA e
// identificação de documentos) e a tela leem daqui — a tela por
// `@shared/tipos-documento`, e o rótulo de cada chave em
// src/lib/documentos/tipos.ts é conferido contra ESTA lista pelo tsc (falta ou
// sobra de chave não compila). Antes eram duas cópias, e divergir já nos
// custou um enum com 25 tipos aqui e 33 lá.
//
// O banco tem o enum `public.tipo_documento`; a régua
// e2e/unit/fonte-unica-documentos.test.ts confere que os dois dizem o mesmo.
//
// Módulo PURO (sem import): a tela importa este arquivo.
export const TIPOS_DOCUMENTO_CHAVES = [
  "cnis", "cnis_resumido", "rg_cpf", "comprovante_residencia", "ctps", "holerite",
  "ppp", "laudo_medico", "laudo_inss", "ltcat", "pgr_ppra", "atestado_medico",
  "cat", "carne_gps", "ctc", "carta_concessao_inss", "hiscre", "certidao_casamento",
  "certidao_obito", "certidao_nascimento", "declaracao_uniao_estavel", "declaracao_atividade_rural", "procuracao", "substabelecimento",
  "contrato_honorarios", "declaracao_hipossuficiencia", "declaracao_ausencia_duplicidade", "termo_representacao", "autodeclaracao_veracidade", "termo_renuncia_teto",
  "termo_responsabilidade", "cnpj_empregadora", "outro",
] as const;

export type TipoDocumento = (typeof TIPOS_DOCUMENTO_CHAVES)[number];

/** A mesma lista como `string[]`, para quem confere texto que veio de fora. */
export const TIPOS_DOCUMENTO: string[] = [...TIPOS_DOCUMENTO_CHAVES];

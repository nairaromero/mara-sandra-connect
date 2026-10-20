// Tipos de documento: UMA lista, usada pelas functions (ferramentas de IA e
// identificação de documentos). Espelha src/lib/documentos/tipos.ts, que é a
// mesma lista do lado da tela — duas cópias divergindo já nos custou um enum
// com 25 tipos aqui e 33 lá.
export const TIPOS_DOCUMENTO: string[] = [
  "cnis", "cnis_resumido", "rg_cpf", "comprovante_residencia", "ctps", "holerite",
  "ppp", "laudo_medico", "laudo_inss", "ltcat", "pgr_ppra", "atestado_medico",
  "cat", "carne_gps", "ctc", "carta_concessao_inss", "hiscre", "certidao_casamento",
  "certidao_obito", "certidao_nascimento", "declaracao_uniao_estavel", "declaracao_atividade_rural", "procuracao", "substabelecimento",
  "contrato_honorarios", "declaracao_hipossuficiencia", "declaracao_ausencia_duplicidade", "termo_representacao", "autodeclaracao_veracidade", "termo_renuncia_teto",
  "termo_responsabilidade", "cnpj_empregadora", "outro",
];

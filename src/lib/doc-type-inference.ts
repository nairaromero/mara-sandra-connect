// =============================================================================
// Heuristica pra inferir tipo de documento a partir do nome do arquivo.
//
// Usada principalmente na importacao do Google Drive (Fase 51) pra pre-encher
// o dropdown de tipo - o usuario revisa e ajusta o que estiver errado.
//
// A ordem das regras importa: regras mais especificas vem primeiro.
// Caso nada case, retorna "outro" (tipo coringa que aceita rotulo livre).
// =============================================================================

/** Normaliza string: lowercase + sem acento + separadores virando espaco. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    // remove extensao (.pdf, .jpg, etc.) - eh ruido pra heuristica
    .replace(/\.[a-z0-9]{2,5}$/, "")
    // remove acentos
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // separadores comuns viram espaco
    .replace(/[_\-\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Retorna o tipo de documento inferido. Sempre retorna algo (default "outro").
 *
 * Exemplos:
 *   inferirTipoPorNome("CNIS_jose.pdf")           -> "cnis"
 *   inferirTipoPorNome("RG-frente.jpg")           -> "rg_cpf"
 *   inferirTipoPorNome("01 - PPP empresa X.pdf")  -> "ppp"
 *   inferirTipoPorNome("foto random.jpg")         -> "outro"
 */
export function inferirTipoPorNome(filename: string): string {
  const s = normalize(filename);
  const has = (kw: string) => s.includes(kw);
  const hasWord = (kw: string) => new RegExp(`\\b${kw}\\b`).test(s);

  // === Documentos super-especificos primeiro ===
  if (hasWord("hiscre")) return "hiscre";
  if (hasWord("ltcat")) return "ltcat";
  if (hasWord("cnis")) return "cnis";
  if (hasWord("ppp") || has("perfil profissiografico")) return "ppp";
  if (has("substabelecimento")) return "substabelecimento";
  if (has("hipossuficiencia") || has("hipossuficiente")) {
    return "declaracao_hipossuficiencia";
  }
  if (has("ausencia de duplicidade") || has("nao duplicidade") || hasWord("duplicidade")) {
    return "declaracao_ausencia_duplicidade";
  }
  if (has("honorario")) return "contrato_honorarios";
  if (has("procuracao")) return "procuracao";
  if (has("uniao estavel") || (has("uniao") && has("estavel"))) {
    return "declaracao_uniao_estavel";
  }
  if (has("atividade rural") || (has("declaracao") && has("rural"))) {
    return "declaracao_atividade_rural";
  }
  if (has("concessao") || has("indeferimento")) return "carta_concessao_inss";
  if (hasWord("ctc") || has("certidao de tempo de contribuicao")) return "ctc";

  // === Trabalho ===
  if (hasWord("ctps") || (has("carteira") && has("trabalho"))) return "ctps";
  if (has("holerite") || has("contracheque") || has("contra cheque")) {
    return "holerite";
  }
  if (hasWord("gps") || (has("carne") && has("inss"))) return "carne_gps";

  // === Certidoes ===
  if (has("certidao") && has("nascimento")) return "certidao_nascimento";
  if (has("certidao") && has("casamento")) return "certidao_casamento";
  if (has("certidao") && has("obito")) return "certidao_obito";

  // === Medicos ===
  if (has("atestado") && (has("medico") || has("medica") || has("saude"))) {
    return "atestado_medico";
  }
  if (has("laudo")) return "laudo_medico";
  if (hasWord("cat") || has("acidente de trabalho")) return "cat";

  // === Endereco ===
  if (has("residencia") || (has("comprovante") && has("endereco"))) {
    return "comprovante_residencia";
  }

  // === Identidade (testes broad por ultimo) ===
  if (hasWord("rg") || has("identidade") || has("registro geral")) {
    return "rg_cpf";
  }
  if (hasWord("cpf")) return "rg_cpf";

  return "outro";
}

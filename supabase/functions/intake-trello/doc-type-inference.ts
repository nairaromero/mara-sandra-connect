// ATENCAO: copia de src/lib/doc-type-inference.ts (edge function nao importa de src/).
// Mudou la, muda aqui — os dois arquivos devem ser identicos do primeiro comentario
// original em diante.
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
    .replace(/[_\-.]+/g, " ")
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
  if (hasWord("pgr") || hasWord("ppra")) return "pgr_ppra";
  if (hasWord("cnis") && has("resumido")) return "cnis_resumido";
  if (hasWord("cnis")) return "cnis";
  // SABI/PMF/pericia federal = laudo do INSS, antes do "laudo" generico.
  if (hasWord("sabi") || hasWord("pmf") || (has("laudo") && has("inss")) || has("pericia federal")) {
    return "laudo_inss";
  }
  if (has("cnpj") || has("cartao cnpj")) return "cnpj_empregadora";
  if (has("representacao e autorizacao") || has("termo de representacao")) {
    return "termo_representacao";
  }
  if (has("autodeclaracao") || (has("autenticidade") && has("veracidade"))) {
    return "autodeclaracao_veracidade";
  }
  if (has("renuncia") && (has("teto") || has("jef"))) return "termo_renuncia_teto";
  if (has("termo de responsabilidade")) return "termo_responsabilidade";
  if (hasWord("ppp") || has("perfil profissiografico")) return "ppp";
  if (has("substabelecimento")) return "substabelecimento";
  if (has("hipossuficiencia") || has("hipossuficiente")) {
    return "declaracao_hipossuficiencia";
  }
  if (has("ausencia de duplicidade") || has("nao duplicidade") || hasWord("duplicidade")) {
    return "declaracao_ausencia_duplicidade";
  }
  if (has("honorario")) return "contrato_honorarios";
  // "procurac" cobre singular e plural (procuracao / procuracoes).
  // KIT contrato+procuracao entra como contrato de honorarios (grupo 3).
  if (has("contrato") && has("procurac")) return "contrato_honorarios";
  if (has("procurac")) return "procuracao";
  // "Contrato Fulano.pdf" sozinho e contrato de honorarios no escritorio,
  // exceto contrato de trabalho / contrato social de empresa.
  if (hasWord("contrato") && !has("trabalho") && !has("empresa")) {
    return "contrato_honorarios";
  }
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

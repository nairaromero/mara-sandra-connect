// Tipos de documento — fonte única.
//
// Antes esta lista existia em TRÊS lugares (casos.$id.tsx, casos.novo.tsx e
// documentos.tsx) e já tinha divergido: a de documentos.tsx estava sem
// substabelecimento, declaração de hipossuficiência e declaração de ausência
// de duplicidade. Documento salvo com um desses tipos aparecia lá com a chave
// crua ("substabelecimento") em vez do nome.

export const TIPOS_DOCUMENTO_LABEL: Record<string, string> = {
  cnis: "CNIS",
  rg_cpf: "RG / CPF",
  comprovante_residencia: "Comprovante de residência",
  ctps: "CTPS",
  holerite: "Holerite / contracheque",
  ppp: "PPP",
  laudo_medico: "Laudo médico",
  ltcat: "LTCAT",
  atestado_medico: "Atestado médico",
  cat: "CAT",
  carne_gps: "Carnê de contribuição (GPS)",
  ctc: "CTC",
  carta_concessao_inss: "Carta de concessão/indeferimento INSS",
  hiscre: "HISCRE",
  certidao_casamento: "Certidão de casamento",
  certidao_obito: "Certidão de óbito",
  certidao_nascimento: "Certidão de nascimento",
  declaracao_uniao_estavel: "Declaração de união estável",
  declaracao_atividade_rural: "Declaração de atividade rural",
  procuracao: "Procuração",
  substabelecimento: "Substabelecimento",
  contrato_honorarios: "Contrato de honorários",
  declaracao_hipossuficiencia: "Declaração de hipossuficiência",
  declaracao_ausencia_duplicidade: "Declaração de ausência de duplicidade de ação",
  outro: "Outro",
};

/**
 * Opções em ordem alfabética, com "Outro" sempre por último — ele não é um
 * tipo, é a saída pros que não estão na lista, então no meio do alfabeto
 * atrapalharia mais do que ajudaria.
 *
 * localeCompare com "pt-BR" pra "Ó" ficar junto de "O" e não no fim.
 */
export const TIPOS_DOCUMENTO_OPTIONS: Array<{ value: string; label: string }> =
  Object.keys(TIPOS_DOCUMENTO_LABEL)
    .map((value) => ({ value, label: TIPOS_DOCUMENTO_LABEL[value] }))
    .sort((a, b) => {
      if (a.value === "outro") return 1;
      if (b.value === "outro") return -1;
      return a.label.localeCompare(b.label, "pt-BR");
    });

/** Caracteres que quebram nome de arquivo em Windows/macOS/Drive. */
function sanitizarNome(texto: string): string {
  return texto
    .replace(/[/\\?*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .trim();
}

/**
 * Nome do arquivo a partir do tipo escolhido: RG / CPF → "RG_CPF.pdf".
 *
 * Existe porque o nome que vem do celular ou do scanner ("IMG_20260807.jpg",
 * "documento (3).pdf") não diz nada pra quem abre a pasta do cliente depois.
 * Com tipo "outro", usa o texto que a pessoa digitou.
 */
export function nomeArquivoPorTipo(
  tipo: string,
  tipoPersonalizado: string | null | undefined,
  nomeOriginal: string,
): string {
  const ext = nomeOriginal.includes(".")
    ? (nomeOriginal.split(".").pop() || "pdf").toLowerCase()
    : "pdf";
  const base =
    tipo === "outro" && tipoPersonalizado?.trim()
      ? tipoPersonalizado.trim()
      : TIPOS_DOCUMENTO_LABEL[tipo] || tipo;
  const limpo = sanitizarNome(base);
  // Se a sanitização comer tudo (nome só com caracteres proibidos), mantém o
  // original — melhor um nome feio do que um arquivo chamado ".pdf".
  return limpo ? `${limpo}.${ext}` : nomeOriginal;
}

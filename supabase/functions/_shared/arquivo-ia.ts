// O que a IA consegue LER — uma lista só (card #434).
//
// Por que existe: sem esta régua, `.docx`, `.xlsx`, `.zip` e `.heic` entravam
// na fila de leitura, o modelo recusava (ou devolvia resposta que não dá para
// entender), o documento continuava `ia_lido_em is null` — e o cron tentava de
// novo a cada 10 minutos, para sempre, gastando chamada em todas as rodadas.
//
// A lista é a interseção do que OpenAI e Anthropic aceitam como anexo. HEIC
// fica de FORA de propósito: foto de iPhone chega assim e NENHUM dos dois lê —
// até existir conversão, ela é um arquivo para a pessoa abrir, não para a IA.
//
// Espelhos desta régua (mude os três juntos):
//   · public.documentos_leitura_pendente / casos_com_leitura_pendente (SQL)
//   · src/lib/documentos/arquivo.ts (a tela, para não oferecer "Ler")

export const EXTENSOES_IA = ["pdf", "jpg", "jpeg", "png", "webp", "gif"];

export function extensaoDe(nome: string | null | undefined): string {
  if (!nome) return "";
  const partes = nome.split(".");
  return partes.length > 1 ? (partes.pop() ?? "").toLowerCase().trim() : "";
}

export function iaConsegueLer(nome: string | null | undefined): boolean {
  return EXTENSOES_IA.includes(extensaoDe(nome));
}

/** Media type do anexo. Só faz sentido para o que `iaConsegueLer` aceita. */
export function mediaTypeIA(nome: string | null | undefined): string {
  const ext = extensaoDe(nome);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

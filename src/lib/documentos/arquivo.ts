// O que dá para ver na tela sem baixar — um lugar só.
//
// Por que existe: a resposta depende da EXTENSÃO, e a extensão aparecia em
// dois lugares (a aba Documentos tinha `ehImagemDoc`/`ehPdfDoc` dentro do
// componente). Qualquer formato novo tinha de ser lembrado nos dois. Aqui é
// uma fonte só, e quem precisa decidir "abre ou baixa?" pergunta a ela.
//
// A régua é o que o navegador renderiza INLINE: imagem (em `<img>`) e PDF
// (no visualizador do Chrome, dentro de um iframe com blob: same-origin).
// DOCX, XLSX, ZIP e companhia viram download forçado dentro do iframe — o que
// furaria o bloqueio de download do parceiro. Por isso ficam de fora.

/** Extensão em minúsculas, sem ponto ("" quando não dá para saber). */
export function extensaoDe(nome?: string | null): string {
  if (!nome) return "";
  const partes = nome.split(".");
  return partes.length > 1 ? (partes.pop() ?? "").toLowerCase().trim() : "";
}

/** Imagem que o `<img>` mostra. HEIC e TIFF ficam fora: o Chrome não abre. */
export function ehImagemDoc(nome?: string | null): boolean {
  return /^(jpe?g|png|gif|webp|bmp|avif)$/.test(extensaoDe(nome));
}

/** PDF — o único formato além de imagem que renderiza inline. */
export function ehPdfDoc(nome?: string | null): boolean {
  return extensaoDe(nome) === "pdf";
}

/** Dá para abrir na tela? Falso = só baixando. */
export function abreNoNavegador(nome?: string | null): boolean {
  return ehImagemDoc(nome) || ehPdfDoc(nome);
}

/** "PDF", "JPG", "DOCX"… para a mensagem de quem não abre. */
export function rotuloDaExtensao(nome?: string | null): string {
  return extensaoDe(nome).toUpperCase() || "?";
}

/**
 * A IA consegue LER este arquivo?
 *
 * Régua da interseção entre OpenAI e Anthropic: pdf, jpg/jpeg, png, webp e
 * gif. HEIC fica de fora de propósito — foto de iPhone chega assim e nenhum
 * dos dois lê. Serve para a tela não oferecer "Ler" o que nunca vai ser lido:
 * sem isso, o botão "Ler 1 novo" ficava para sempre, sem nada acontecer.
 *
 * Espelhos desta régua (mude os três juntos):
 *   · supabase/functions/_shared/arquivo-ia.ts (a function que lê)
 *   · private.ia_le_arquivo, no banco (a fila do cron)
 */
export function iaConsegueLer(nome?: string | null): boolean {
  return /^(pdf|jpe?g|png|webp|gif)$/.test(extensaoDe(nome));
}

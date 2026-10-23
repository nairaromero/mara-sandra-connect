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

import { extensaoDe } from "@shared/arquivo-ia";

// A extensão e "o que a IA lê" são da mesma fonte que a edge function usa
// (supabase/functions/_shared/arquivo-ia.ts) — antes eram cópias aqui.
export { extensaoDe, iaConsegueLer } from "@shared/arquivo-ia";

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

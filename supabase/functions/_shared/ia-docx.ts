// =============================================================================
// _shared/ia-docx.ts — gera um arquivo Word (.docx) a partir de texto markdown.
//
// Markdown suportado (linha a linha): # / ## / ### (titulos), '- ' ou '* '
// (lista com marcador), **negrito** inline. Linhas "N. ..." ficam como paragrafo
// normal (preserva o numero). Visual Law (caixas coloridas) fica para depois.
// Usado pela tool salvar_peca_docx (a IA externa redige; o servidor gera o Word).
// =============================================================================

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "https://esm.sh/docx@8.5.0";

// Quebra um trecho em runs, aplicando **negrito**.
function inlineRuns(text: string): InstanceType<typeof TextRun>[] {
  const runs: InstanceType<typeof TextRun>[] = [];
  for (const p of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!p) continue;
    const m = /^\*\*([^*]+)\*\*$/.exec(p);
    if (m) runs.push(new TextRun({ text: m[1], bold: true }));
    else runs.push(new TextRun(p.replace(/\*\*/g, "")));
  }
  if (!runs.length) runs.push(new TextRun(""));
  return runs;
}

export async function markdownToDocx(texto: string, titulo?: string): Promise<Uint8Array> {
  // deno-lint-ignore no-explicit-any
  const children: any[] = [];
  if (titulo) children.push(new Paragraph({ text: titulo, heading: HeadingLevel.TITLE }));

  for (const raw of texto.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      children.push(new Paragraph({}));
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^###\s+(.*)$/.exec(line))) {
      children.push(new Paragraph({ children: inlineRuns(m[1]), heading: HeadingLevel.HEADING_3 }));
    } else if ((m = /^##\s+(.*)$/.exec(line))) {
      children.push(new Paragraph({ children: inlineRuns(m[1]), heading: HeadingLevel.HEADING_2 }));
    } else if ((m = /^#\s+(.*)$/.exec(line))) {
      children.push(new Paragraph({ children: inlineRuns(m[1]), heading: HeadingLevel.HEADING_1 }));
    } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      children.push(new Paragraph({ children: inlineRuns(m[1]), bullet: { level: 0 } }));
    } else {
      children.push(new Paragraph({ children: inlineRuns(line) }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  // toBlob usa Blob (disponivel no Deno/Supabase Edge); evita depender de Buffer.
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

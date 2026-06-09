// =============================================================================
// _shared/ia-docs.ts — leitura do CONTEUDO dos documentos de um caso.
//
// Extrai texto de PDFs/TXT (unpdf) e coleta PDFs escaneados como ANEXOS (base64)
// para a IA ler por OCR nativo. Compartilhado entre superficies do plugin de IA.
//
// Fix do pdf.js: o unpdf carrega o pdf.js via import() dinamico, que o eszip do
// Supabase Edge NAO empacota -> "PDF.js is not available". Importamos o build
// serverless do pdf.js ESTATICAMENTE e injetamos via configureUnPDF. A config e
// LAZY (so na 1a extracao) p/ nao penalizar o cold start de funcoes que importam
// este modulo mas nunca leem PDF (ex.: chat in-app).
// =============================================================================

import { configureUnPDF, extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.0";
import { resolvePDFJS } from "https://esm.sh/unpdf@0.12.0/pdfjs";
import { encode as toBase64 } from "https://deno.land/std@0.177.0/encoding/base64.ts";

// pdf.js usa Promise.withResolvers(), ausente em runtimes mais antigos. Polyfill
// defensivo (no-op onde ja existe).
const _P = Promise as unknown as { withResolvers?: () => unknown };
if (typeof _P.withResolvers !== "function") {
  _P.withResolvers = function () {
    let resolve!: (v?: unknown) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

let _configured = false;
async function ensureUnPDF(): Promise<void> {
  if (_configured) return;
  await configureUnPDF({ pdfjs: () => resolvePDFJS() });
  _configured = true;
}

export type DocRow = { tipo: unknown; nome_arquivo?: unknown; storage_path?: unknown };

// Subset do supabase storage bucket que usamos (facilita testes/tipagem).
export type DocBucket = {
  download: (path: string) => Promise<{
    data: { arrayBuffer: () => Promise<ArrayBuffer>; text: () => Promise<string> } | null;
    error: { message?: string } | null;
  }>;
};

export type DocAnexo = { nome: string; mediaType: string; base64: string };

export type DocExtract = {
  documentos: Array<{ tipo: unknown; nome: string; texto: string; scan: boolean; anexado: boolean }>;
  anexos: DocAnexo[];
  debug: Array<{ nome: string; via: string; len: number }>;
};

export type ExtractOpts = {
  maxChars?: number; // orcamento total de texto extraido
  maxDocs?: number; // teto de documentos lidos
  anexar?: boolean; // coletar PDFs escaneados como anexos (OCR)
  scopeAnexo?: Set<string>; // tipos elegiveis a anexo
  maxAtt?: number; // teto de anexos
  maxAttFile?: number; // bytes por arquivo (acima disso nem parseia: estoura memoria)
  maxAttTotal?: number; // bytes somados dos anexos
};

// Prioriza o que importa para viabilidade: CNIS (tempo/carencia), laudos
// (incapacidade) e "outro"; o restante (RG, procuracao...) vem por ultimo.
const PRIO: Record<string, number> = { cnis: 0, laudo_medico: 1, outro: 2 };

export async function extractCasoDocs(
  bucket: DocBucket,
  docs: DocRow[],
  opts: ExtractOpts = {},
): Promise<DocExtract> {
  const maxChars = opts.maxChars ?? 45000;
  const maxDocs = opts.maxDocs ?? 14;
  const anexar = opts.anexar ?? true;
  const scope = opts.scopeAnexo ?? new Set(["cnis", "laudo_medico", "outro"]);
  const maxAtt = opts.maxAtt ?? 8;
  const maxAttFile = opts.maxAttFile ?? 5 * 1024 * 1024;
  const maxAttTotal = opts.maxAttTotal ?? 12 * 1024 * 1024;

  await ensureUnPDF();

  const ordenados = [...docs].sort((a, b) => {
    const pa = PRIO[String(a.tipo)] ?? 9;
    const pb = PRIO[String(b.tipo)] ?? 9;
    return pa - pb;
  });

  const documentos: DocExtract["documentos"] = [];
  const anexos: DocAnexo[] = [];
  const debug: DocExtract["debug"] = [];
  let totalChars = 0;
  let attBytes = 0;

  for (const d of ordenados.slice(0, maxDocs)) {
    if (totalChars >= maxChars) break;
    const path = typeof d.storage_path === "string" ? d.storage_path : "";
    const nome = String(d.nome_arquivo ?? "");
    const low = nome.toLowerCase();
    let texto = "";
    let via = "?";
    let scan = false;
    let anexado = false;
    try {
      if (!path) {
        texto = "[sem caminho de arquivo]";
        via = "sem_path";
      } else {
        const dl = await bucket.download(path);
        if (dl.error || !dl.data) {
          texto = "[arquivo ainda nao enviado ou indisponivel]";
          via = "download_err:" + (dl.error ? String(dl.error.message || dl.error) : "sem_data");
        } else if (low.endsWith(".pdf")) {
          const buf = new Uint8Array(await dl.data.arrayBuffer());
          if (buf.length > maxAttFile) {
            // PDFs grandes (scans com muitas imagens) estouram a memoria do worker
            // no parse do pdf.js E no base64 -> nao processa; sinaliza leitura manual.
            texto = "[PDF grande (" + (buf.length / 1048576).toFixed(1) + " MB) nao processado " +
              "automaticamente para nao exceder a memoria; requer OCR/leitura manual]";
            via = "pdf_grande(bytes=" + buf.length + ")";
            scan = true;
          } else {
            const pdf = await getDocumentProxy(buf);
            try {
              const r = await extractText(pdf, { mergePages: true });
              texto = Array.isArray(r?.text) ? r.text.join("\n") : String(r?.text ?? "");
            } finally {
              // libera os buffers internos do pdf.js antes da proxima iteracao
              await (pdf as { destroy?: () => Promise<void> }).destroy?.();
            }
            via = "pdf_ok(bytes=" + buf.length + ")";
            const limpo = texto.trim();
            if (!limpo) {
              texto = "[PDF sem texto extraivel (provavel imagem/scan; precisa OCR ou leitura manual)]";
              via = "pdf_vazio(bytes=" + buf.length + ")";
              scan = true;
            } else if (limpo.length < 120) {
              texto = limpo + "\n[ATENCAO: pouquissimo texto extraido - documento provavelmente " +
                "escaneado/imagem; conteudo NAO confiavel sem OCR/leitura manual]";
              via = "pdf_curto(" + limpo.length + ")";
              scan = true;
            }
            if (
              anexar && scan && scope.has(String(d.tipo)) && anexos.length < maxAtt &&
              attBytes + buf.length <= maxAttTotal
            ) {
              anexos.push({ nome, mediaType: "application/pdf", base64: toBase64(buf) });
              attBytes += buf.length;
              anexado = true;
              texto = "[documento escaneado ANEXADO como arquivo PDF para leitura direta da IA (OCR " +
                "nativo) - leia o anexo '" + nome + "' e use seu conteudo]";
              via += "+anexado";
            }
          }
        } else if (low.endsWith(".txt")) {
          texto = await dl.data.text();
          via = "txt";
        } else {
          texto = "[arquivo nao textual (imagem?) - nao lido automaticamente]";
          via = "nao_textual";
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      texto = "[erro ao ler o documento: " + msg + "]";
      via = "EXC:" + msg.slice(0, 120);
    }
    texto = texto.replace(/[ \t\r]+/g, " ").trim();
    const restante = maxChars - totalChars;
    if (texto.length > restante) texto = texto.slice(0, restante) + " [...truncado]";
    totalChars += texto.length;
    documentos.push({ tipo: d.tipo, nome, texto, scan, anexado });
    debug.push({ nome, via, len: texto.length });
  }

  return { documentos, anexos, debug };
}

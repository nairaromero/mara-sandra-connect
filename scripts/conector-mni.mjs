#!/usr/bin/env node
// conector-mni.mjs — CONECTOR LOCAL pros autos do processo via MNI (CNJ).
//
// Roda NA MÁQUINA DA NAIRA: consulta o webservice oficial dos tribunais
// (Modelo Nacional de Interoperabilidade, SOAP) com as credenciais do
// advogado e sobe os PDFs pro sistema (bucket documentos + aba Documentos
// do caso). Credenciais NUNCA saem do computador — a nuvem recebe só os
// arquivos. Ver planning/PILOTO_JUDIT.md (seção MNI).
//
// Tribunais habilitados: TJMT (PJe, MNI aberto). TRF1/TRF3 exigem
// credenciamento prévio do tribunal — adicionar em ENDPOINTS quando liberar.
//
// Credenciais em .env.local (gitignored), na raiz do repo:
//   MNI_CPF=18448524829          # CPF do advogado habilitado (Mara)
//   MNI_SENHA=<senha do PJe do tribunal>
//   SUPABASE_ACCESS_TOKEN=<já existe — usado pro upload>
//
// Uso:
//   node scripts/conector-mni.mjs --numero 1000767-26.2024.8.11.0025
//     → lista movimentos/documentos (dry-run, não salva nada)
//   node scripts/conector-mni.mjs --numero <cnj> --salvar [--max-docs 10]
//     → baixa os documentos e arquiva no caso

import fs from "node:fs";
import path from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "llugytkdsfsrciavhrfw";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

// Endpoints MNI por J.TR do número CNJ (dígitos 14-16).
const ENDPOINTS = {
  "811": {
    nome: "TJMT (PJe)",
    url: "https://pje.tjmt.jus.br/pje/intercomunicacao",
  },
  // "401": TRF1 (PJe) — 403/WAF: exige credenciamento prévio no tribunal.
  // "403": TRF3 (PJe) — conexão bloqueada: idem.
};

function readEnvLocal(key) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function arg(nome, temValor = true) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--" + nome);
  if (i === -1) return null;
  return temValor ? args[i + 1] : true;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Extrai atributo de uma tag XML crua.
function attr(tag, nome) {
  const m = tag.match(new RegExp(nome + '="([^"]*)"'));
  return m ? m[1] : null;
}

function slugArquivo(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

async function consultarProcesso({ endpoint, cpf, senha, numero, incluirDocumentos }) {
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' xmlns:ser="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/"' +
    ' xmlns:tip="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2">' +
    "<soapenv:Header/><soapenv:Body><ser:consultarProcesso>" +
    `<tip:idConsultante>${xmlEscape(cpf)}</tip:idConsultante>` +
    `<tip:senhaConsultante>${xmlEscape(senha)}</tip:senhaConsultante>` +
    `<tip:numeroProcesso>${xmlEscape(numero)}</tip:numeroProcesso>` +
    "<tip:movimentos>true</tip:movimentos>" +
    "<tip:incluirCabecalho>true</tip:incluirCabecalho>" +
    `<tip:incluirDocumentos>${incluirDocumentos ? "true" : "false"}</tip:incluirDocumentos>` +
    "</ser:consultarProcesso></soapenv:Body></soapenv:Envelope>";

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
    body: envelope,
    signal: AbortSignal.timeout(120_000),
  });
  // PJe responde em MTOM/XOP (multipart): o XML é a 1ª parte e os PDFs podem
  // vir como partes binárias referenciadas por cid. Lemos como Buffer pra não
  // corromper os binários.
  const bruto = Buffer.from(await resp.arrayBuffer());
  const { texto, anexos } = separarMtom(bruto);
  return { status: resp.status, texto, anexos };
}

// Separa resposta MTOM: devolve o XML (utf8) e um mapa cid → Buffer.
function separarMtom(bruto) {
  const inicio = bruto.subarray(0, 200).toString("utf8");
  const bm = inicio.match(/^--([^\r\n]+)/);
  if (!bm) return { texto: bruto.toString("utf8"), anexos: new Map() };
  const boundary = Buffer.from("--" + bm[1]);
  const anexos = new Map();
  let texto = "";
  let pos = 0;
  while (true) {
    const ini = bruto.indexOf(boundary, pos);
    if (ini === -1) break;
    const fim = bruto.indexOf(boundary, ini + boundary.length);
    if (fim === -1) break;
    const parte = bruto.subarray(ini + boundary.length, fim);
    const sep = parte.indexOf("\r\n\r\n");
    if (sep !== -1) {
      const headers = parte.subarray(0, sep).toString("utf8");
      const corpo = parte.subarray(sep + 4, parte.length - 2); // tira \r\n final
      const cid = headers.match(/Content-ID:\s*<([^>]+)>/i)?.[1] ?? null;
      if (/application\/xop\+xml|text\/xml/i.test(headers)) {
        texto = corpo.toString("utf8");
      } else if (cid) {
        anexos.set(cid, Buffer.from(corpo));
      }
    }
    pos = fim;
  }
  return { texto: texto || bruto.toString("utf8"), anexos };
}

function parseResposta(texto) {
  const fault = texto.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
  if (fault) return { erro: fault[1].trim() };

  const sucesso = /<(?:\w+:)?sucesso>\s*true\s*<\/(?:\w+:)?sucesso>/i.test(texto);
  const msg = texto.match(/<(?:\w+:)?mensagem>([\s\S]*?)<\/(?:\w+:)?mensagem>/i);
  if (!sucesso) return { erro: msg ? msg[1].trim() : "resposta sem sucesso=true" };

  // Documentos: tags <documento ...> com atributos + conteúdo base64 opcional.
  const documentos = [];
  const reDoc = /<(?:\w+:)?documento\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?documento>|<(?:\w+:)?documento\b([^>]*)\/>/gi;
  let m;
  while ((m = reDoc.exec(texto)) !== null) {
    const attrs = m[1] ?? m[3] ?? "";
    const corpo = m[2] ?? "";
    const conteudoM = corpo.match(/<(?:\w+:)?conteudo[^>]*>([\s\S]*?)<\/(?:\w+:)?conteudo>/i);
    // Conteúdo pode vir inline (base64) ou como referência XOP (cid de anexo MTOM).
    const cidM = corpo.match(/<xop:Include[^>]*href="cid:([^"]+)"/i);
    documentos.push({
      id: attr(attrs, "idDocumento"),
      tipo: attr(attrs, "tipoDocumento"),
      descricao: attr(attrs, "descricao") || attr(attrs, "tipoDocumentoLocal") || "documento",
      mimetype: attr(attrs, "mimetype") || "application/pdf",
      dataHora: attr(attrs, "dataHora"),
      nivelSigilo: attr(attrs, "nivelSigilo"),
      conteudoBase64: !cidM && conteudoM ? conteudoM[1].replace(/\s+/g, "") : null,
      cid: cidM ? decodeURIComponent(cidM[1]) : null,
    });
  }
  const movimentos = (texto.match(/<(?:\w+:)?movimento\b/gi) || []).length;
  const classe = attr(texto.match(/<(?:\w+:)?dadosBasicos\b([^>]*)/i)?.[1] ?? "", "classeProcessual");
  return { documentos, movimentos, classe };
}

// --- Upload pro sistema (service key obtida na hora via Management API) -----
async function obterServiceKey(accessToken) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`management api ${resp.status}`);
  const keys = await resp.json();
  const svc = keys.find((k) => k.name === "service_role");
  if (!svc?.api_key) throw new Error("service_role key nao encontrada");
  return svc.api_key;
}

async function main() {
  const numeroRaw = arg("numero");
  const salvar = arg("salvar", false) === true;
  const maxDocs = Number(arg("max-docs") ?? 10);
  if (!numeroRaw) {
    console.error("Uso: node scripts/conector-mni.mjs --numero <cnj> [--salvar] [--max-docs N]");
    process.exit(1);
  }
  const numero = numeroRaw.replace(/\D/g, "");
  if (numero.length !== 20) {
    console.error("Número CNJ inválido (esperado 20 dígitos).");
    process.exit(1);
  }
  const jtr = numero.slice(13, 16);
  const ep = ENDPOINTS[jtr];
  if (!ep) {
    console.error(
      `Tribunal J.TR=${jtr} ainda não habilitado no conector. Disponíveis: ` +
        Object.entries(ENDPOINTS).map(([k, v]) => `${k} (${v.nome})`).join(", "),
    );
    process.exit(1);
  }

  const cpf = readEnvLocal("MNI_CPF");
  const senha = readEnvLocal("MNI_SENHA");
  if (!cpf || !senha) {
    console.error("Configure MNI_CPF e MNI_SENHA no .env.local (senha do PJe do tribunal).");
    process.exit(1);
  }

  console.log(`Consultando ${numeroRaw} no ${ep.nome} via MNI...`);
  const { status, texto, anexos } = await consultarProcesso({
    endpoint: ep.url,
    cpf,
    senha,
    numero,
    incluirDocumentos: true,
  });
  const r = parseResposta(texto);
  if (r.erro) {
    console.error(`Tribunal respondeu (HTTP ${status}): ${r.erro}`);
    process.exit(2);
  }
  console.log(
    `OK: classe ${r.classe ?? "?"} · ${r.movimentos} movimentos · ${r.documentos.length} documentos no processo.`,
  );
  const bytesDoc = (d) => {
    if (d.conteudoBase64) return Buffer.from(d.conteudoBase64, "base64");
    if (d.cid && anexos.has(d.cid)) return anexos.get(d.cid);
    return null;
  };
  const comConteudo = r.documentos.filter((d) => bytesDoc(d));
  for (const d of r.documentos.slice(0, 30)) {
    const b = bytesDoc(d);
    console.log(
      `  - [${d.id}] ${d.descricao} (${d.mimetype}${b ? `, ${Math.round(b.length / 1024)} KB` : ", sem conteúdo"})`,
    );
  }

  if (!salvar) {
    console.log("\nDry-run: nada foi salvo. Use --salvar pra arquivar no caso.");
    return;
  }

  // --- Arquivar no sistema ---------------------------------------------------
  const accessToken = readEnvLocal("SUPABASE_ACCESS_TOKEN");
  if (!accessToken) {
    console.error("SUPABASE_ACCESS_TOKEN ausente no .env.local.");
    process.exit(1);
  }
  const svcKey = await obterServiceKey(accessToken);
  const rest = (p, init = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1${p}`, {
      ...init,
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

  const procResp = await rest(
    `/processos_judiciais?numero_proc_normalizado=eq.${numero}&select=id,caso_id,numero_processo`,
  );
  const procs = await procResp.json();
  if (!procs?.[0]) {
    console.error("Processo não cadastrado no sistema — cadastre no caso antes de arquivar.");
    process.exit(2);
  }
  const proc = procs[0];
  const pasta = `Processo ${proc.numero_processo}`;

  let baixados = 0;
  let pulados = 0;
  for (const d of comConteudo.slice(0, maxDocs)) {
    const ext = d.mimetype.includes("pdf") ? "pdf" : (d.mimetype.split("/")[1] || "bin");
    const arquivo = slugArquivo(`${d.descricao}_${d.id ?? baixados}.${ext}`);
    const storagePath = `${proc.caso_id}/mni/${arquivo}`;

    const ja = await rest(`/documentos?storage_path=eq.${encodeURIComponent(storagePath)}&select=id`);
    if ((await ja.json())?.[0]) {
      pulados++;
      continue;
    }

    const bytes = bytesDoc(d);
    if (!bytes) continue;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${storagePath}`, {
      method: "POST",
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
        "Content-Type": d.mimetype,
      },
      body: bytes,
    });
    if (!up.ok && up.status !== 409) {
      console.error(`  upload falhou (${up.status}): ${arquivo}`);
      continue;
    }
    const ins = await rest("/documentos", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        caso_id: proc.caso_id,
        tipo: "outro",
        tipo_personalizado: String(d.descricao).slice(0, 120),
        nome_arquivo: arquivo,
        storage_path: storagePath,
        tamanho_bytes: bytes.length,
        visivel_parceiro: false,
        download_parceiro: false,
        pasta_relativa: pasta,
      }),
    });
    if (!ins.ok) {
      console.error(`  registro falhou (${ins.status}): ${arquivo}`);
      continue;
    }
    baixados++;
    console.log(`  ✓ arquivado: ${arquivo} (${Math.round(bytes.length / 1024)} KB)`);
  }
  console.log(`\nConcluído: ${baixados} arquivados, ${pulados} já existiam.`);
  console.log(`Ver em: aba Documentos do caso (pasta "${pasta}").`);
}

main().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});

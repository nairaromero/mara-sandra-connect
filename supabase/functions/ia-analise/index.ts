// =============================================================================
// Edge Function: ia-analise  (Plugin de IA — analise tecnica / triagem Nivel 1)
//
// Gera uma analise tecnica PRELIMINAR de um caso usando a IA do usuario (BYOK),
// a partir dos DADOS do sistema (NAO le o conteudo dos PDFs). Salva em
// analises_tecnicas (nova versao) para aparecer na aba Analise.
//
// Body: { caso_id }
// Auth: JWT de usuario INTERNO (analise e so interno).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IA_MASTER_KEY.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { chatWith } from "../_shared/ia-providers.ts";
import { maskCpf } from "../_shared/ia-redact.ts";
import { configureUnPDF, extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.0";
// O unpdf carrega o pdf.js via import() dinamico, que o bundler do Supabase Edge
// (eszip) NAO empacota -> em runtime da "PDF.js is not available". Importamos o
// build serverless do pdf.js ESTATICAMENTE (eszip empacota imports estaticos) e
// injetamos no unpdf. O pdfjs.mjs traz o pdf.js inline (~1.6MB).
import { resolvePDFJS } from "https://esm.sh/unpdf@0.12.0/pdfjs";
await configureUnPDF({ pdfjs: () => resolvePDFJS() });

// O pdf.js usa Promise.withResolvers(), ausente em runtimes mais antigos (Deno do
// Supabase Edge). Polyfill defensivo p/ extrair texto sem quebrar. (no-op onde ja existe.)
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function idadeDe(dataNasc: string | null): number | null {
  if (!dataNasc) return null;
  const d = new Date(dataNasc);
  if (isNaN(d.getTime())) return null;
  const hoje = new Date();
  let anos = hoje.getFullYear() - d.getFullYear();
  const m = hoje.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) anos--;
  return anos;
}

function extrairJson(texto: string): Record<string, unknown> | null {
  const i = texto.indexOf("{");
  const j = texto.lastIndexOf("}");
  if (i < 0 || j < 0 || j < i) return null;
  try {
    return JSON.parse(texto.slice(i, j + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function numOuNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SYSTEM =
  "Voce e um analista previdenciario brasileiro (RGPS). Recebe os DADOS do caso e o TEXTO extraido dos " +
  "documentos anexados (campo 'documentos_conteudo'), quando disponivel. Faca uma ANALISE DE VIABILIDADE " +
  "concreta: com base no conteudo (ex.: CNIS), avalie tempo de contribuicao, carencia, idade e os " +
  "requisitos do beneficio pretendido; cite periodos/datas/valores quando o documento permitir. Se um " +
  "documento vier como imagem/scan nao lido, diga que precisa de OCR/leitura manual e analise com o que " +
  "houver. E analise tecnica de APOIO, nao substitui conferencia humana. Responda SOMENTE com um JSON valido " +
  "(sem markdown, sem texto fora do JSON), neste formato:\n" +
  "{\n" +
  '  "veredito": "viavel" | "precisa_mais_dados" | "inviavel",\n' +
  '  "beneficio_recomendado": "string",\n' +
  '  "requisitos": [{ "item": "string", "situacao": "ok" | "verificar" | "falta", "nota": "string" }],\n' +
  '  "documentos_faltantes": ["string"],\n' +
  '  "rmi_estimada": number | null,\n' +
  '  "valor_estimado_acao": number | null,\n' +
  '  "resumo": "string (3 a 6 frases, para o advogado interno)",\n' +
  '  "resumo_parceiro": "string (1 a 2 frases, linguagem simples para o advogado parceiro)",\n' +
  '  "proximos_passos": ["string"]\n' +
  "}";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: "env ausente" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "nao autenticado" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonResponse({ error: "sessao invalida" }, 401);
  const uid = userData.user.id;

  const { data: perfil } = await admin
    .from("usuarios")
    .select("tipo")
    .eq("id", uid)
    .maybeSingle();
  if (perfil?.tipo !== "interno") {
    return jsonResponse({ error: "apenas interno pode gerar analise" }, 403);
  }

  const { data: integ } = await admin
    .from("ia_integracoes")
    .select("provider,modelo,api_key_cipher,api_key_iv,ativo")
    .eq("usuario_id", uid)
    .maybeSingle();
  if (!integ) return jsonResponse({ error: "assistente nao configurado", code: "nao_configurado" }, 412);
  if (!integ.ativo) return jsonResponse({ error: "assistente desativado", code: "desativado" }, 412);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  const casoId = String(body.caso_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(casoId)) return jsonResponse({ error: "caso_id invalido" }, 400);

  // ---- Reune o contexto do caso (service-role; interno ve tudo) ----
  const { data: caso } = await admin
    .from("casos")
    .select("id,cliente_id,tipo_beneficio,fase,status,observacoes")
    .eq("id", casoId)
    .maybeSingle();
  if (!caso) return jsonResponse({ error: "caso nao encontrado" }, 404);

  const { data: cliente } = await admin
    .from("clientes")
    .select("nome,cpf,data_nascimento,observacoes")
    .eq("id", caso.cliente_id)
    .maybeSingle();

  const { data: procs } = await admin
    .from("processos_admin")
    .select("tipo_beneficio,numero_requerimento,decisao")
    .eq("caso_id", casoId);

  const { data: docs } = await admin
    .from("documentos")
    .select("tipo,nome_arquivo,storage_path")
    .eq("caso_id", casoId);

  const { data: ands } = await admin
    .from("andamentos")
    .select("titulo,descricao,data_evento")
    .eq("caso_id", casoId)
    .order("data_evento", { ascending: false })
    .limit(25);

  const { data: solics } = await admin
    .from("solicitacoes_documento")
    .select("tipo,status")
    .eq("caso_id", casoId);

  // ---- Nivel 2: le o CONTEUDO dos documentos (defensivo) ----
  // Prioriza os documentos que importam para viabilidade: CNIS (tempo/carencia),
  // depois laudos medicos (incapacidade) e "outro" (ex.: Laudo INSS); o restante
  // (RG, procuracao, certidao - normalmente scans pouco uteis) vem por ultimo.
  const PRIO: Record<string, number> = { cnis: 0, laudo_medico: 1, outro: 2 };
  const docsOrdenados = [...(docs ?? [])].sort((a, b) => {
    const pa = PRIO[String((a as Record<string, unknown>).tipo)] ?? 9;
    const pb = PRIO[String((b as Record<string, unknown>).tipo)] ?? 9;
    return pa - pb;
  });
  const documentos_conteudo: Array<{ tipo: unknown; nome: string; texto: string }> = [];
  const debug_docs: Array<{ nome: string; via: string; len: number }> = [];
  let totalChars = 0;
  const MAX_CHARS = 60000;
  for (const d of docsOrdenados.slice(0, 14)) {
    if (totalChars >= MAX_CHARS) break;
    const dd = d as Record<string, unknown>;
    const path = typeof dd.storage_path === "string" ? dd.storage_path : "";
    const nome = String(dd.nome_arquivo ?? "");
    const low = nome.toLowerCase();
    let texto = "";
    let via = "?";
    try {
      if (!path) {
        texto = "[sem caminho de arquivo]";
        via = "sem_path";
      } else {
        const dl = await admin.storage.from("documentos").download(path);
        if (dl.error || !dl.data) {
          texto = "[arquivo ainda nao enviado ou indisponivel]";
          via = "download_err:" + (dl.error ? String(dl.error.message || dl.error) : "sem_data");
        } else if (low.endsWith(".pdf")) {
          const buf = new Uint8Array(await dl.data.arrayBuffer());
          const pdf = await getDocumentProxy(buf);
          const r = await extractText(pdf, { mergePages: true });
          texto = Array.isArray(r?.text) ? r.text.join("\n") : String(r?.text ?? "");
          via = "pdf_ok(bytes=" + buf.length + ")";
          const limpo = texto.trim();
          if (!limpo) {
            texto = "[PDF sem texto extraivel (provavel imagem/scan; precisa OCR ou leitura manual)]";
            via = "pdf_vazio(bytes=" + buf.length + ")";
          } else if (limpo.length < 120) {
            texto = limpo + "\n[ATENCAO: pouquissimo texto extraido - documento provavelmente " +
              "escaneado/imagem; conteudo NAO confiavel sem OCR/leitura manual]";
            via = "pdf_curto(" + limpo.length + ")";
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
      console.error("[ia-analise] falha lendo doc", path, "->", msg);
      texto = "[erro ao ler o documento: " + msg + "]";
      via = "EXC:" + msg.slice(0, 160);
    }
    texto = texto.replace(/[ \t\r]+/g, " ").trim();
    const restante = MAX_CHARS - totalChars;
    if (texto.length > restante) texto = texto.slice(0, restante) + " [...truncado]";
    totalChars += texto.length;
    documentos_conteudo.push({ tipo: dd.tipo, nome, texto });
    debug_docs.push({ nome, via, len: texto.length });
  }

  const idade = idadeDe(cliente?.data_nascimento ?? null);
  const contexto = {
    cliente: {
      nome: cliente?.nome ?? null,
      cpf: maskCpf(cliente?.cpf),
      idade,
      data_nascimento: cliente?.data_nascimento ?? null,
      observacoes: cliente?.observacoes ?? null,
    },
    pasta: { tipo_beneficio: caso.tipo_beneficio, fase: caso.fase, status: caso.status, observacoes: caso.observacoes },
    processos: procs ?? [],
    documentos_anexados: (docs ?? []).map((d) => {
      const dd = d as Record<string, unknown>;
      return { tipo: dd.tipo, nome: dd.nome_arquivo };
    }),
    documentos_conteudo,
    solicitacoes_documento: solics ?? [],
    andamentos: ands ?? [],
  };

  let apiKey: string;
  try {
    apiKey = await decryptSecret(integ.api_key_cipher, integ.api_key_iv);
  } catch {
    return jsonResponse({ error: "falha ao abrir a chave configurada" }, 500);
  }

  let res: { text: string; usage: { input: number; output: number } };
  try {
    res = await chatWith(integ.provider, apiKey, integ.modelo, {
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            "Analise (triagem) este caso previdenciario. Dados do sistema (JSON):\n" +
            JSON.stringify(contexto),
        },
      ],
      tools: [],
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: m.slice(0, 300) }, 502);
  }

  const parsed = extrairJson(res.text) ?? {};
  const veredito = String(parsed.veredito ?? "precisa_mais_dados");
  const beneficio = String(parsed.beneficio_recomendado ?? caso.tipo_beneficio ?? "A definir").slice(0, 200);
  const resumo = String(parsed.resumo ?? res.text).slice(0, 4000);
  const resumoParceiro = parsed.resumo_parceiro ? String(parsed.resumo_parceiro).slice(0, 1000) : null;
  const docsFaltantes = Array.isArray(parsed.documentos_faltantes)
    ? parsed.documentos_faltantes.map((x) => String(x))
    : [];
  const proximos = Array.isArray(parsed.proximos_passos)
    ? parsed.proximos_passos.map((x) => String(x))
    : [];

  // Resumo legivel mostrado na aba (campo observacoes ja renderizado pela UI).
  const vereditoLabel =
    veredito === "viavel" ? "VIAVEL" : veredito === "inviavel" ? "INVIAVEL" : "PRECISA DE MAIS DADOS";
  const obsTexto =
    "[Analise por IA - viabilidade]\n" +
    "Veredito: " + vereditoLabel + "\n\n" +
    resumo +
    (docsFaltantes.length ? "\n\nDocumentos faltantes:\n- " + docsFaltantes.join("\n- ") : "") +
    (proximos.length ? "\n\nProximos passos:\n- " + proximos.join("\n- ") : "");

  const versaoResp = await admin
    .from("analises_tecnicas")
    .select("versao")
    .eq("caso_id", casoId)
    .order("versao", { ascending: false })
    .limit(1);
  const versao = versaoResp.data && versaoResp.data[0] ? Number(versaoResp.data[0].versao) + 1 : 1;

  const ins = await admin
    .from("analises_tecnicas")
    .insert({
      caso_id: casoId,
      versao,
      beneficio_recomendado: beneficio,
      rmi_estimada: numOuNull(parsed.rmi_estimada),
      valor_estimado_acao: numOuNull(parsed.valor_estimado_acao),
      resultado_json: {
        gerado_por_ia: true,
        veredito,
        requisitos: parsed.requisitos ?? [],
        documentos_faltantes: docsFaltantes,
        proximos_passos: proximos,
        observacoes: obsTexto,
        debug_docs,
      },
      resumo_parceiro: resumoParceiro,
      modelo_ia: integ.modelo,
      tokens_input: res.usage.input,
      tokens_output: res.usage.output,
      criado_por: uid,
    })
    .select("id,versao")
    .maybeSingle();
  if (ins.error) return jsonResponse({ error: ins.error.message }, 400);

  return jsonResponse({
    ok: true,
    analise_id: ins.data?.id,
    versao,
    veredito,
    beneficio_recomendado: beneficio,
  });
});

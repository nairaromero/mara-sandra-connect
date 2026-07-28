// supabase/functions/sync-judit-autos/index.ts
//
// PILOTO Judit (planning/PILOTO_JUDIT.md): busca os AUTOS de um processo
// judicial (sentenças, decisões, petições — os PDFs que o Tramitação
// Inteligente mostra) via API da Judit e arquiva no caso:
//   - PDF vai pro bucket `documentos` em {caso_id}/judit/{arquivo}
//   - registro em `documentos` (tipo='outro', tipo_personalizado com o nome
//     da peça, pasta_relativa='Processo <numero>', visivel_parceiro=false —
//     interno decide o que liberar)
//   - dedup por storage_path (reprocessar não duplica)
//
// Fluxo Judit (assíncrono): POST /requests {search lawsuit_cnj,
// with_attachments} → poll GET /requests/{id} até completed → GET /responses
// → download de cada attachment. Se o polling estourar o orçamento, devolve
// request_id — invocar de novo com {"request_id": "..."} continua de onde
// parou (a consulta na Judit segue processando).
//
// Requer o secret JUDIT_API_KEY (conta trial/paga da Judit):
//   bunx supabase secrets set JUDIT_API_KEY=<chave> --project-ref llugytkdsfsrciavhrfw
//
// Chamada (manual, piloto):
//   { "numero": "5009313-34.2026.4.03.6315", "max_docs": 10, "dry_run": true }
//   { "request_id": "<uuid devolvido antes>" }  // retomar

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const JUDIT_API_KEY = Deno.env.get("JUDIT_API_KEY");

const REQUESTS_BASE = "https://requests.production.judit.io";
const LAWSUITS_BASE = "https://lawsuits.production.judit.io";

const BUDGET_MS = 110_000;
const POLL_MS = 4_000;
const MAX_DOCS_DEFAULT = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCnj(s: string): string {
  return s.replace(/\D/g, "");
}

// Nome de arquivo seguro pro Storage.
function slugArquivo(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

interface JuditAttachment {
  attachment_id?: string;
  id?: string;
  name?: string;
  title?: string;
  instance?: string | number;
  extension?: string;
  [k: string]: unknown;
}

async function juditFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(url, {
    ...init,
    headers: {
      "api-key": JUDIT_API_KEY!,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }
  if (!JUDIT_API_KEY) {
    return jsonResponse(
      {
        error: "JUDIT_API_KEY ausente",
        code: "sem_chave",
        como_configurar:
          "Crie a conta trial em judit.io, gere a chave de API e rode: " +
          "bunx supabase secrets set JUDIT_API_KEY=<chave> --project-ref llugytkdsfsrciavhrfw",
      },
      412,
    );
  }

  let numero = "";
  let requestId: string | null = null;
  let maxDocs = MAX_DOCS_DEFAULT;
  let dryRun = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.numero) numero = String(body.numero).trim();
    if (body.request_id) requestId = String(body.request_id);
    if (typeof body.max_docs === "number" && body.max_docs > 0) {
      maxDocs = Math.min(body.max_docs, 50);
    }
    if (body.dry_run === true) dryRun = true;
  } catch (err) {
    return jsonResponse({ error: "body invalido", detail: String(err) }, 400);
  }
  if (!numero && !requestId) {
    return jsonResponse({ error: "informe numero (CNJ) ou request_id" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const inicio = Date.now();

  // --- 1. Cria (ou retoma) a consulta na Judit -----------------------------
  if (!requestId) {
    const resp = await juditFetch(`${REQUESTS_BASE}/requests/`, {
      method: "POST",
      body: JSON.stringify({
        search: { search_type: "lawsuit_cnj", search_key: numero },
        with_attachments: true,
      }),
    });
    if (!resp.ok) {
      return jsonResponse(
        { error: `judit requests ${resp.status}: ${(await resp.text()).slice(0, 300)}` },
        502,
      );
    }
    const j = (await resp.json()) as { request_id?: string };
    requestId = j.request_id ?? null;
    if (!requestId) return jsonResponse({ error: "judit nao devolveu request_id" }, 502);
  }

  // --- 2. Polling até completed (dentro do orçamento) ----------------------
  let status = "pending";
  while (Date.now() - inicio < BUDGET_MS - 30_000) {
    const resp = await juditFetch(`${REQUESTS_BASE}/requests/${requestId}`);
    if (resp.ok) {
      const j = (await resp.json()) as { status?: string };
      status = j.status ?? "pending";
      if (status === "completed") break;
      if (status === "failed" || status === "cancelled") {
        return jsonResponse({ error: `consulta judit ${status}`, request_id: requestId }, 502);
      }
    }
    await sleep(POLL_MS);
  }
  if (status !== "completed") {
    return jsonResponse({
      concluido: false,
      status,
      request_id: requestId,
      dica: "consulta ainda processando na Judit — invocar de novo com este request_id",
    });
  }

  // --- 3. Resultado --------------------------------------------------------
  const respResp = await juditFetch(
    `${REQUESTS_BASE}/responses?page_size=20&request_id=${requestId}`,
  );
  if (!respResp.ok) {
    return jsonResponse(
      { error: `judit responses ${respResp.status}`, request_id: requestId },
      502,
    );
  }
  const respJson = (await respResp.json()) as {
    page_data?: Array<{ response_type?: string; response_data?: Record<string, unknown> }>;
  };
  const lawsuit = (respJson.page_data || []).find(
    (p) => p.response_type === "lawsuit" && p.response_data,
  )?.response_data;
  if (!lawsuit) {
    return jsonResponse({ error: "sem response_data de lawsuit", request_id: requestId }, 404);
  }

  const cnjRetornado = String(lawsuit.code ?? numero ?? "");
  const attachments = (lawsuit.attachments as JuditAttachment[] | undefined) ?? [];

  // --- 4. Resolve o processo/caso no nosso banco ---------------------------
  const cnjNorm = normalizeCnj(cnjRetornado || numero);
  const { data: proc } = await supabase
    .from("processos_judiciais")
    .select("id, caso_id, numero_processo")
    .eq("numero_proc_normalizado", cnjNorm)
    .maybeSingle();
  if (!proc) {
    return jsonResponse(
      {
        error: "processo nao cadastrado no sistema",
        numero: cnjRetornado,
        anexos_encontrados: attachments.length,
        request_id: requestId,
      },
      404,
    );
  }

  if (dryRun) {
    return jsonResponse({
      dry_run: true,
      request_id: requestId,
      numero: cnjRetornado,
      caso_id: proc.caso_id,
      anexos_encontrados: attachments.length,
      amostra: attachments.slice(0, 15).map((a) => ({
        id: a.attachment_id ?? a.id,
        nome: a.name ?? a.title,
        instancia: a.instance,
      })),
    });
  }

  // --- 5. Baixa e arquiva os anexos (mais recentes primeiro) ---------------
  let baixados = 0;
  let jaExistiam = 0;
  const erros: string[] = [];
  const pasta = `Processo ${cnjRetornado || proc.numero_processo}`;

  for (const att of attachments.slice(0, maxDocs)) {
    if (Date.now() - inicio > BUDGET_MS) break;
    const attId = String(att.attachment_id ?? att.id ?? "");
    if (!attId) continue;
    const nomeBase = String(att.name ?? att.title ?? `documento_${attId}`);
    const ext = String(att.extension ?? "pdf").replace(/^\./, "");
    const arquivo = slugArquivo(`${nomeBase}_${attId.slice(0, 8)}.${ext}`);
    const storagePath = `${proc.caso_id}/judit/${arquivo}`;

    // Dedup: já arquivado?
    const { data: jaDoc } = await supabase
      .from("documentos")
      .select("id")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (jaDoc) {
      jaExistiam++;
      continue;
    }

    try {
      const instance = String(att.instance ?? "1");
      const dl = await juditFetch(
        `${LAWSUITS_BASE}/lawsuits/${encodeURIComponent(cnjRetornado)}/${instance}/attachments/${attId}`,
      );
      if (!dl.ok) {
        erros.push(`${nomeBase}: download ${dl.status}`);
        continue;
      }
      const bytes = new Uint8Array(await dl.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from("documentos")
        .upload(storagePath, bytes, {
          contentType: ext === "pdf" ? "application/pdf" : "application/octet-stream",
          upsert: false,
        });
      if (upErr && !upErr.message.includes("already exists")) {
        erros.push(`${nomeBase}: upload ${upErr.message}`);
        continue;
      }
      const { error: docErr } = await supabase.from("documentos").insert({
        caso_id: proc.caso_id,
        tipo: "outro",
        tipo_personalizado: nomeBase.slice(0, 120),
        nome_arquivo: arquivo,
        storage_path: storagePath,
        tamanho_bytes: bytes.length,
        uploaded_by: null,
        visivel_parceiro: false,
        download_parceiro: false,
        pasta_relativa: pasta,
      });
      if (docErr) {
        erros.push(`${nomeBase}: registro ${docErr.message}`);
        continue;
      }
      baixados++;
    } catch (err) {
      erros.push(`${nomeBase}: ${String(err).slice(0, 120)}`);
    }
  }

  return jsonResponse({
    concluido: true,
    request_id: requestId,
    numero: cnjRetornado,
    caso_id: proc.caso_id,
    anexos_encontrados: attachments.length,
    baixados,
    ja_existiam: jaExistiam,
    pasta,
    erros: erros.slice(0, 10),
  });
});

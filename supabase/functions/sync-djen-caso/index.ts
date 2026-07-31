// supabase/functions/sync-djen-caso/index.ts
//
// Puxa o TEOR COMPLETO das publicações de um caso via Comunica API/DJEN,
// consultando POR NÚMERO DE PROCESSO (a sync-djen-publicacoes busca por OAB;
// esta busca direto pelos processos judiciais do caso). Traz o texto integral
// da intimação/despacho/sentença publicada — o conteúdo que o DataJud não dá.
//
// Grava cada publicação como andamento origem='djen' com o texto completo em
// `descricao` (o card do caso já expande) e também em `publicacoes_dje`.
// Dedup por metadata->>'djen_id'. visivel_parceiro=true.
//
// Geo-block: invocar com header x-region: sa-east-1.
//
// Chamada (botão "Buscar teor" / demo):
//   { "caso_id": "<uuid>", "usuario_id": "<uuid interno, opcional>",
//     "dry_run": false }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const COMUNICA_BASE = "https://comunicaapi.pje.jus.br/api/v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ITENS_POR_PAGINA = 100;
const MAX_PAGINAS = 10;

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

function normalizeCnj(s: string | null | undefined): string {
  return String(s || "").replace(/\D/g, "");
}

function htmlParaTexto(html: string | null | undefined): string {
  if (!html) return "";
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ordm;/g, "º")
    .replace(/&ccedil;/g, "ç")
    .replace(/&atilde;/g, "ã")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ComItem {
  id: string | number;
  hash?: string | null;
  numeroprocessocommascara?: string | null;
  numero_processo?: string | null;
  siglaTribunal?: string | null;
  nomeOrgao?: string | null;
  tipoComunicacao?: string | null;
  tipoDocumento?: string | null;
  texto?: string | null;
  data_disponibilizacao?: string | null;
  datadisponibilizacao?: string | null;
  link?: string | null;
}

async function fetchPorProcesso(cnjDigits: string, pagina: number): Promise<ComItem[]> {
  const url =
    `${COMUNICA_BASE}/comunicacao?numeroProcesso=${cnjDigits}` +
    `&itensPorPagina=${ITENS_POR_PAGINA}&pagina=${pagina}`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "MaraSandraConnect/1.0 (djen-caso)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`comunica ${resp.status}`);
  const data = await resp.json();
  const items = (data && (data.items ?? data.data)) as ComItem[] | undefined;
  return Array.isArray(items) ? items : [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let casoId = "";
  let usuarioId: string | null = null;
  let dryRun = false;
  try {
    const body = await req.json().catch(() => ({}));
    casoId = String(body.caso_id || "");
    if (body.usuario_id) usuarioId = String(body.usuario_id);
    if (body.dry_run === true) dryRun = true;
  } catch (err) {
    return jsonResponse({ error: "body invalido", detail: String(err) }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(casoId)) {
    return jsonResponse({ error: "caso_id invalido" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Processos judiciais do caso.
  const { data: procs, error: procErr } = await admin
    .from("processos_judiciais")
    .select("id, numero_processo")
    .eq("caso_id", casoId)
    .not("numero_processo", "is", null);
  if (procErr) return jsonResponse({ error: "processos: " + procErr.message }, 500);
  if (!procs || procs.length === 0) {
    return jsonResponse({ error: "caso sem processo judicial cadastrado" }, 404);
  }

  let recebidas = 0;
  let criadas = 0;
  let jaExistiam = 0;
  const erros: string[] = [];
  const amostra: Array<{ tipo: string; data: string | null; chars: number }> = [];

  for (const proc of procs) {
    const cnj = normalizeCnj(proc.numero_processo as string);
    if (cnj.length !== 20) continue;
    try {
      for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
        const items = await fetchPorProcesso(cnj, pagina);
        if (items.length === 0) break;
        for (const item of items) {
          // Confere que a publicação é DESTE processo (o filtro da API às vezes
          // é frouxo — descarta o que não bate).
          const numItem = normalizeCnj(
            item.numeroprocessocommascara || item.numero_processo || "",
          );
          if (numItem && numItem !== cnj) continue;
          recebidas++;

          const djenId = String(item.id);
          const texto = htmlParaTexto(item.texto);
          const tribunal = item.siglaTribunal || "";
          const tipo = item.tipoComunicacao || "Publicação";
          const titulo = tribunal ? `${tipo} — ${tribunal}` : tipo;
          const dataEvento = item.data_disponibilizacao || item.datadisponibilizacao || null;
          const certidaoUrl = item.hash ? `${COMUNICA_BASE}/comunicacao/${item.hash}/certidao` : null;

          if (amostra.length < 8) {
            amostra.push({ tipo, data: dataEvento, chars: texto.length });
          }
          if (dryRun) continue;

          // Dedup: já existe andamento djen com esse id?
          const { data: jaAnd } = await admin
            .from("andamentos")
            .select("id")
            .eq("origem", "djen")
            .eq("metadata->>djen_id", djenId)
            .maybeSingle();
          if (jaAnd) {
            jaExistiam++;
            continue;
          }

          const { error: insErr } = await admin.from("andamentos").insert({
            caso_id: casoId,
            origem: "djen",
            titulo,
            descricao: texto || titulo,
            data_evento: dataEvento,
            criado_por: usuarioId,
            visivel_parceiro: true,
            processo_judicial_id: proc.id,
            metadata: {
              djen_id: djenId,
              hash: item.hash || null,
              sigla_tribunal: item.siglaTribunal || null,
              nome_orgao: item.nomeOrgao || null,
              tipo_comunicacao: item.tipoComunicacao || null,
              tipo_documento: item.tipoDocumento || null,
              certidao_url: certidaoUrl,
              numero_processo: item.numeroprocessocommascara || proc.numero_processo,
            },
          });
          if (insErr) {
            erros.push(`insert ${djenId}: ${insErr.message}`);
          } else {
            criadas++;
          }
        }
        if (items.length < ITENS_POR_PAGINA) break;
      }
    } catch (err) {
      erros.push(`${proc.numero_processo}: ${String(err).slice(0, 120)}`);
    }
  }

  return jsonResponse({
    dry_run: dryRun,
    caso_id: casoId,
    processos: procs.length,
    publicacoes_recebidas: recebidas,
    andamentos_criados: criadas,
    ja_existiam: jaExistiam,
    amostra,
    erros: erros.slice(0, 10),
  });
});

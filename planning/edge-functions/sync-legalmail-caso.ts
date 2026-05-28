// supabase/functions/sync-legalmail-caso/index.ts
//
// Edge function que importa processos judiciais do Legalmail para um caso.
// Recebe uma lista de idprocessos (ja selecionados pela usuaria via UI) e:
//
//   1. Para cada idprocesso:
//      a. GET /api/v1/lawsuit/detail?idprocesso=<id> -> dados completos do processo
//      b. UPSERT em `processos_judiciais` (dedup por legalmail_id OU numero_processo
//         dentro do mesmo caso_id - se cadastrou manualmente antes, atualiza)
//      c. GET /api/v1/lawsuit/case-files?idprocesso=<id> -> movimentacoes
//      d. Para cada movimentacao: INSERT em `andamentos` (origem='legalmail',
//         dedup por metadata->>legalmail_mov_id, processo_judicial_id auto-populado,
//         visivel_parceiro=true)
//
// Respeita rate limit do Legalmail (30 req/min) via pausa de 2.1s entre requests.
//
// Chamada do frontend:
//   const { data } = await supabase.functions.invoke("sync-legalmail-caso", {
//     body: {
//       caso_id: "<uuid>",
//       usuario_id: "<uuid do interno>",
//       idprocessos: [12345, 67890]
//     }
//   });
//
// Response:
//   {
//     processos_criados: number,
//     processos_atualizados: number,
//     movimentacoes_importadas: number,
//     movimentacoes_ja_existentes: number,
//     erros: Array<{ idprocesso, motivo }>
//   }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const LM_BASE = "https://app.legalmail.com.br";
const LM_TOKEN = Deno.env.get("LEGALMAIL_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Pausa entre requests ao Legalmail para respeitar rate limit de 30 req/min.
const RATE_DELAY_MS = 2100;
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// =============================================================================
// Whitelist de movimentacoes a importar do Legalmail
// =============================================================================
// O Legalmail retorna TODAS as pecas do tribunal, inclusive coisas tecnicas
// (Documento Comprobatorio, Procuracao, Ato ordinatorio, etc.) que poluem a
// timeline e nao trazem informacao util ao parceiro indicador.
//
// Esta whitelist filtra: importa SOMENTE movimentacoes cujo titulo CONTENHA
// (case-insensitive, sem acentos) qualquer uma das substrings abaixo.
//
// Para adicionar/remover, edite a lista e faca redeploy da function.
const WHITELIST_LEGALMAIL = [
  "sentenca",
  "acordao",
  "decisao",
  "despacho",
  "conclusos",
  "transito em julgado",
  "cumprimento",
  "implantacao de beneficio",
  "intimacao polo",
  "audiencia",
  "pericia",
  "laudo",
  "manifestacao",
  "contestacao",
  "replica",
  "recurso",
  "apelacao",
  "embargos",
  "pagamento",
  "citacao",
];

// Normaliza string: minusculas, sem acentos
function normalizeForWhitelist(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function tituloPassaWhitelist(titulo: string): boolean {
  const norm = normalizeForWhitelist(titulo || "");
  if (!norm) return false;
  for (const term of WHITELIST_LEGALMAIL) {
    if (norm.includes(term)) return true;
  }
  return false;
}

interface LMProcesso {
  idprocessos: string | number;
  numero_processo: string;
  poloativo_nome?: string;
  polopassivo_nome?: string;
  tribunal?: string | null;
  juizo?: string | null;
  foro?: string | null;
  data_distribuicao?: string | null;
  last_import?: string | null;
  processo_tema?: string | null;
  sistema_tribunal?: string | null;
  inbox_atual?: string | null;
  valor_causa?: number | null;
  [k: string]: unknown;
}

interface LMMovimentacao {
  idmovimentacoes: string | number;
  fk_processo?: string | number;
  titulo: string;
  id?: string | number;
  data_movimentacao: string;
  tipo?: string | null;
  hash_documento?: string | null;
  [k: string]: unknown;
}

async function fetchLM(path: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${LM_BASE}${path}${sep}api_key=${LM_TOKEN}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (resp.status === 429) {
    throw new Error("rate_limit");
  }
  if (!resp.ok) {
    throw new Error(`legalmail ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  return await resp.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!LM_TOKEN) {
    return jsonResponse({ error: "LEGALMAIL_TOKEN nao configurado" }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let casoId: string;
  let usuarioId: string | null = null;
  let idprocessos: Array<number>;
  try {
    const body = await req.json();
    casoId = String(body.caso_id || "");
    if (body.usuario_id) usuarioId = String(body.usuario_id);
    const raw = body.idprocessos;
    if (!Array.isArray(raw)) throw new Error("idprocessos deve ser array");
    idprocessos = raw.map((x: unknown) => Number(x)).filter((n) => !isNaN(n));
  } catch (err) {
    return jsonResponse(
      { error: "body invalido", detail: String(err) },
      400,
    );
  }

  if (!casoId) {
    return jsonResponse({ error: "caso_id obrigatorio" }, 400);
  }
  if (idprocessos.length === 0) {
    return jsonResponse({ error: "idprocessos vazio" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let processosCriados = 0;
  let processosAtualizados = 0;
  let movsImportadas = 0;
  let movsJaExistentes = 0;
  let movsIgnoradas = 0;
  const erros: Array<{ idprocesso: number; motivo: string }> = [];

  for (let i = 0; i < idprocessos.length; i++) {
    const idproc = idprocessos[i];

    // --- Passo 1: detail do processo ---
    let proc: LMProcesso | null = null;
    try {
      if (i > 0) await sleep(RATE_DELAY_MS);
      const data = await fetchLM(
        `/api/v1/lawsuit/detail?idprocesso=${idproc}`,
      );
      // detail pode retornar objeto direto ou array com 1 item
      if (Array.isArray(data) && data.length > 0) {
        proc = data[0] as LMProcesso;
      } else if (data && typeof data === "object") {
        proc = data as LMProcesso;
      }
    } catch (err) {
      erros.push({ idprocesso: idproc, motivo: "detail: " + String(err) });
      continue;
    }
    if (!proc || !proc.numero_processo) {
      erros.push({ idprocesso: idproc, motivo: "processo nao encontrado no Legalmail" });
      continue;
    }

    const numCnj = String(proc.numero_processo).trim();
    const lmIdStr = String(proc.idprocessos);

    // --- Passo 2: dedup em processos_judiciais ---
    // Procura por legalmail_id OU numero_processo dentro do mesmo caso.
    const { data: existentes, error: dedupErr } = await supabase
      .from("processos_judiciais")
      .select("id, legalmail_id, numero_processo")
      .eq("caso_id", casoId)
      .or(`legalmail_id.eq.${lmIdStr},numero_processo.eq.${numCnj}`);

    if (dedupErr) {
      erros.push({ idprocesso: idproc, motivo: "dedup: " + dedupErr.message });
      continue;
    }

    const procFields: Record<string, unknown> = {
      caso_id: casoId,
      numero_processo: numCnj,
      vara: proc.juizo || null,
      comarca: proc.foro || null,
      uf: null, // pode ser inferido do tribunal depois (opcional)
      data_distribuicao: proc.data_distribuicao || null,
      legalmail_id: lmIdStr,
      ultima_sync: new Date().toISOString(),
    };

    let processoJudId: string | null = null;
    if (existentes && existentes.length > 0) {
      // Atualiza o primeiro existente (deveria ser unico no escopo do caso)
      const existente = existentes[0];
      const { data: upRows, error: upErr } = await supabase
        .from("processos_judiciais")
        .update(procFields)
        .eq("id", existente.id)
        .select();
      if (upErr) {
        erros.push({ idprocesso: idproc, motivo: "update: " + upErr.message });
        continue;
      }
      if (upRows && upRows.length > 0) {
        processoJudId = existente.id;
        processosAtualizados++;
      }
    } else {
      // INSERT
      const { data: insRows, error: insErr } = await supabase
        .from("processos_judiciais")
        .insert(procFields)
        .select();
      if (insErr) {
        erros.push({ idprocesso: idproc, motivo: "insert: " + insErr.message });
        continue;
      }
      if (insRows && insRows.length > 0) {
        processoJudId = (insRows[0] as { id: string }).id;
        processosCriados++;
      }
    }

    if (!processoJudId) {
      erros.push({ idprocesso: idproc, motivo: "nao obteve id do processo apos upsert" });
      continue;
    }

    // --- Passo 3: case-files (movimentacoes) ---
    let movs: Array<LMMovimentacao> = [];
    try {
      await sleep(RATE_DELAY_MS);
      const data = await fetchLM(
        `/api/v1/lawsuit/case-files?idprocesso=${idproc}`,
      );
      if (Array.isArray(data)) {
        movs = data as Array<LMMovimentacao>;
      } else if (data && typeof data === "object") {
        // Pode vir empacotado como { case_files: [...] }
        const d = data as Record<string, unknown>;
        const arr = (d.case_files || d.movimentacoes || d.data) as
          | Array<LMMovimentacao>
          | undefined;
        if (Array.isArray(arr)) movs = arr;
      }
    } catch (err) {
      erros.push({
        idprocesso: idproc,
        motivo: "case-files: " + String(err),
      });
      // processo foi criado, mas movs falhou. Continua pro proximo idproc.
      continue;
    }

    // --- Passo 4: inserir movimentacoes como andamentos ---
    for (const mov of movs) {
      const lmMovIdStr = String(mov.idmovimentacoes);

      // Filtro whitelist: ignora movimentacoes tecnicas que nao trazem
      // informacao util ao parceiro (Documento Comprobatorio, Procuracao,
      // Ato ordinatorio, etc.). Mantem rastreabilidade no Legalmail.
      if (!tituloPassaWhitelist(mov.titulo || "")) {
        movsIgnoradas++;
        continue;
      }

      // Dedup
      const { data: jaExiste, error: ddErr } = await supabase
        .from("andamentos")
        .select("id")
        .eq("origem", "legalmail")
        .eq("metadata->>legalmail_mov_id", lmMovIdStr)
        .maybeSingle();
      if (ddErr) {
        console.error("erro dedup mov", lmMovIdStr, ddErr);
        continue;
      }
      if (jaExiste) {
        movsJaExistentes++;
        continue;
      }

      const titulo = mov.titulo || "(sem titulo)";
      const descricaoPartes: Array<string> = [];
      if (mov.titulo) descricaoPartes.push(mov.titulo);
      if (mov.tipo) descricaoPartes.push("Tipo: " + mov.tipo);
      const descricao = descricaoPartes.join("\n") || null;

      const insertObj = {
        caso_id: casoId,
        origem: "legalmail",
        titulo: titulo,
        descricao: descricao,
        data_evento: mov.data_movimentacao || null,
        criado_por: usuarioId,
        visivel_parceiro: true,
        processo_admin_id: null,
        processo_judicial_id: processoJudId,
        metadata: {
          legalmail_mov_id: lmMovIdStr,
          fk_processo: mov.fk_processo ? String(mov.fk_processo) : null,
          hash_documento: mov.hash_documento || null,
          tipo_mov: mov.tipo || null,
        },
      };

      const { error: insAndErr } = await supabase
        .from("andamentos")
        .insert(insertObj);
      if (insAndErr) {
        console.error("erro insert andamento mov", lmMovIdStr, insAndErr);
        continue;
      }
      movsImportadas++;
    }
  }

  return jsonResponse({
    processos_criados: processosCriados,
    processos_atualizados: processosAtualizados,
    movimentacoes_importadas: movsImportadas,
    movimentacoes_ja_existentes: movsJaExistentes,
    movimentacoes_ignoradas: movsIgnoradas,
    erros: erros,
  });
});

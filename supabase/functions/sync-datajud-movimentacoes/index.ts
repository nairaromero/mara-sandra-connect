// supabase/functions/sync-datajud-movimentacoes/index.ts
//
// Fase 2 do planning/PROCESSOS_GLOBAL.md: acompanha as MOVIMENTAÇÕES dos
// processos judiciais cadastrados via API pública DataJud/CNJ (Elasticsearch).
//
// Pra cada processo em `processos_judiciais` (com número CNJ), consulta o
// endpoint do tribunal correspondente e grava os movimentos novos como
// `andamentos` com origem='datajud'. Dedup por movimento via
// metadata->>'datajud_mov' = "<grau>:<codigo>:<dataHora>".
//
// Diferença pras outras fontes:
//   - DJEN (sync-djen-publicacoes): teor das PUBLICAÇÕES do diário, por OAB.
//   - Legalmail: rótulo de intimação recebida na caixa.
//   - DataJud (esta): TODOS os passos processuais (conclusão, despacho,
//     juntada, remessa...), mesmo os que não geram publicação.
//
// Geo-block: mesmo esquema da Comunica API — invocar com header
// `x-region: sa-east-1` pra garantir egress brasileiro.
//
// Chamada (cron n8n -> invoke, botão "Atualizar" do front, ou manual):
//   supabase.functions.invoke("sync-datajud-movimentacoes", {
//     body: { dias: 7, limite: 0, dry_run: false, numeros: ["0805123-..."] }
//   })  // + header x-region: sa-east-1
//
//   dias    — janela de movimentos considerados (default 90; cron diário usa 7)
//   limite  — máx. de processos por execução (0 = todos; prioriza nunca-sincados)
//   numeros — restringe a esses números CNJ (teste)
//   dry_run — não grava nada, só conta e traz amostra
//
// Response (resumo):
//   { dry_run, janela_dias, processos_total, processos_consultados,
//     processos_encontrados, movimentos_recebidos, ja_no_banco,
//     andamentos_criados, would_insert, interrompido, amostra, erros }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Chave pública documentada pelo CNJ para uso aberto (mesma da
// cnj-consulta-processo; se quebrar, conferir wiki.pje.jus.br REST_API_DataJud).
const DATAJUD_API_KEY =
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
const DATAJUD_BASE = "https://api-publica.datajud.cnj.jus.br";

const DELAY_MS = 150;
// O gateway derruba a request em 150s sem resposta (IDLE_TIMEOUT); paramos
// antes e reportamos `interrompido` — o chamador roda de novo (ultima_sync
// nulls-first garante que a fila continua de onde parou).
const BUDGET_MS = 110_000;

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

function normalizeCnj(s: string | null | undefined): string {
  return String(s || "").replace(/\D/g, "");
}

// --- Mapeamento número CNJ -> endpoint DataJud (mesma lógica da
// cnj-consulta-processo; duplicado porque edge functions não compartilham
// import local sem _shared — candidato a extração futura). ---
const TJ_ENDPOINT: Record<string, string> = {
  AC: "api_publica_tjac", AL: "api_publica_tjal", AM: "api_publica_tjam",
  AP: "api_publica_tjap", BA: "api_publica_tjba", CE: "api_publica_tjce",
  DF: "api_publica_tjdft", ES: "api_publica_tjes", GO: "api_publica_tjgo",
  MA: "api_publica_tjma", MG: "api_publica_tjmg", MS: "api_publica_tjms",
  MT: "api_publica_tjmt", PA: "api_publica_tjpa", PB: "api_publica_tjpb",
  PE: "api_publica_tjpe", PI: "api_publica_tjpi", PR: "api_publica_tjpr",
  RJ: "api_publica_tjrj", RN: "api_publica_tjrn", RO: "api_publica_tjro",
  RR: "api_publica_tjrr", RS: "api_publica_tjrs", SC: "api_publica_tjsc",
  SE: "api_publica_tjse", SP: "api_publica_tjsp", TO: "api_publica_tjto",
};
const TJ_UF: Record<string, string> = {
  "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA",
  "06": "CE", "07": "DF", "08": "ES", "09": "GO", "10": "MA",
  "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB",
  "16": "PR", "17": "PE", "18": "PI", "19": "RJ", "20": "RN",
  "21": "RS", "22": "RO", "23": "RR", "24": "SC", "25": "SE",
  "26": "SP", "27": "TO",
};

function endpointPara(
  numeroDigitos: string,
): { endpoint: string; tribunal: string } | null {
  if (numeroDigitos.length !== 20) return null;
  const j = numeroDigitos.slice(13, 14);
  const tr = numeroDigitos.slice(14, 16);
  if (j === "8") {
    const uf = TJ_UF[tr];
    if (uf && TJ_ENDPOINT[uf]) {
      return { endpoint: TJ_ENDPOINT[uf], tribunal: `TJ${uf}` };
    }
  } else if (j === "4") {
    const n = Number(tr);
    if (n >= 1 && n <= 6) {
      return { endpoint: `api_publica_trf${n}`, tribunal: `TRF${n}` };
    }
  } else if (j === "5") {
    const n = Number(tr);
    if (n >= 1 && n <= 24) {
      return { endpoint: `api_publica_trt${n}`, tribunal: `TRT${n}` };
    }
  }
  return null;
}

interface Complemento {
  codigo?: number;
  valor?: number;
  nome?: string | null;
  descricao?: string | null;
}

interface Movimento {
  codigo?: number;
  nome?: string | null;
  dataHora?: string | null;
  complementosTabelados?: Complemento[];
}

interface DataJudSource {
  numeroProcesso?: string;
  tribunal?: string;
  grau?: string;
  orgaoJulgador?: { nome?: string };
  movimentos?: Movimento[];
}

// "motivo_da_remessa: em grau de recurso" — legível pra timeline.
function descricaoDoMovimento(m: Movimento): string | null {
  const partes = (m.complementosTabelados || [])
    .filter((c) => c.nome)
    .map((c) =>
      c.descricao ? `${String(c.descricao).replace(/_/g, " ")}: ${c.nome}` : String(c.nome),
    );
  return partes.length > 0 ? partes.join(" · ") : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let dias = 90;
  let limite = 0;
  let dryRun = false;
  let numerosFiltro: Set<string> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.dias === "number" && body.dias > 0) dias = body.dias;
    if (typeof body.limite === "number" && body.limite > 0) limite = body.limite;
    if (body.dry_run === true) dryRun = true;
    if (Array.isArray(body.numeros) && body.numeros.length > 0) {
      numerosFiltro = new Set(
        body.numeros.map((n: unknown) => normalizeCnj(String(n))).filter(Boolean),
      );
    }
  } catch (err) {
    return jsonResponse({ error: "body invalido", detail: String(err) }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const inicio = Date.now();
  const cutoffISO = new Date(Date.now() - dias * 86400000).toISOString();

  // Processos alvo. Nunca-sincados primeiro pra um `limite` baixo do cron
  // ainda cobrir todo mundo ao longo dos dias.
  const { data: procs, error: procErr } = await supabase
    .from("processos_judiciais")
    .select("id, caso_id, numero_processo, ultima_sync")
    .not("numero_processo", "is", null)
    .order("ultima_sync", { ascending: true, nullsFirst: true });
  if (procErr) {
    return jsonResponse(
      { error: "erro lendo processos_judiciais", detail: procErr.message },
      500,
    );
  }

  let alvos = (procs || [])
    .map((p) => ({
      id: p.id as string,
      caso_id: p.caso_id as string,
      cnj: normalizeCnj(p.numero_processo as string),
      numero: String(p.numero_processo),
    }))
    .filter((p) => p.cnj.length === 20);
  if (numerosFiltro) alvos = alvos.filter((p) => numerosFiltro!.has(p.cnj));
  const processosTotal = alvos.length;
  if (limite > 0) alvos = alvos.slice(0, limite);

  let consultados = 0;
  let encontrados = 0;
  let movimentosRecebidos = 0;
  let jaNoBanco = 0;
  let criados = 0;
  let wouldInsert = 0;
  let interrompido = false;
  const amostra: Array<{
    numero: string;
    grau: string;
    titulo: string;
    data: string | null;
    descricao: string | null;
  }> = [];
  const erros: Array<{ numero: string; motivo: string }> = [];

  for (const proc of alvos) {
    if (Date.now() - inicio > BUDGET_MS) {
      interrompido = true;
      break;
    }
    const cfg = endpointPara(proc.cnj);
    if (!cfg) continue; // segmento não suportado (ex.: trabalhista antigo)
    if (consultados > 0) await sleep(DELAY_MS);
    consultados++;

    let sources: DataJudSource[] = [];
    try {
      // Alguns endpoints do DataJud penduram; sem timeout um processo lento
      // come o orçamento inteiro da execução.
      const resp = await fetch(`${DATAJUD_BASE}/${cfg.endpoint}/_search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `APIKey ${DATAJUD_API_KEY}`,
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          query: { match: { numeroProcesso: proc.cnj } },
          // Um hit por instância (1º grau, 2º grau, turma recursal...).
          size: 10,
        }),
      });
      if (!resp.ok) {
        erros.push({
          numero: proc.numero,
          motivo: `datajud ${resp.status}: ${(await resp.text()).slice(0, 120)}`,
        });
        continue;
      }
      const j = (await resp.json()) as {
        hits?: { hits?: Array<{ _source: DataJudSource }> };
      };
      sources = (j.hits?.hits || []).map((h) => h._source).filter(Boolean);
    } catch (err) {
      erros.push({ numero: proc.numero, motivo: String(err).slice(0, 160) });
      continue;
    }
    if (sources.length === 0) continue;
    encontrados++;

    // Chaves já gravadas pra esse processo (dedup).
    const jaTem = new Set<string>();
    if (!dryRun) {
      const { data: exist, error: exErr } = await supabase
        .from("andamentos")
        .select("chave:metadata->>datajud_mov")
        .eq("origem", "datajud")
        .eq("processo_judicial_id", proc.id)
        .limit(5000);
      if (exErr) {
        erros.push({ numero: proc.numero, motivo: "dedup: " + exErr.message });
        continue;
      }
      for (const r of (exist || []) as Array<{ chave: string | null }>) {
        if (r.chave) jaTem.add(r.chave);
      }
    }

    const novos: Array<Record<string, unknown>> = [];
    for (const src of sources) {
      const grau = src.grau || "";
      for (const mov of src.movimentos || []) {
        if (!mov.dataHora || !mov.nome) continue;
        movimentosRecebidos++;
        if (mov.dataHora < cutoffISO) continue;
        const chave = `${grau}:${mov.codigo ?? ""}:${mov.dataHora}`;
        if (jaTem.has(chave)) {
          jaNoBanco++;
          continue;
        }
        jaTem.add(chave);

        const descricao = descricaoDoMovimento(mov);
        if (dryRun) {
          wouldInsert++;
          if (amostra.length < 15) {
            amostra.push({
              numero: proc.numero,
              grau,
              titulo: mov.nome,
              data: mov.dataHora,
              descricao,
            });
          }
          continue;
        }

        novos.push({
          caso_id: proc.caso_id,
          origem: "datajud",
          titulo: grau ? `${mov.nome} (${grau})` : mov.nome,
          descricao,
          data_evento: mov.dataHora,
          criado_por: null,
          visivel_parceiro: true,
          processo_admin_id: null,
          processo_judicial_id: proc.id,
          metadata: {
            datajud_mov: chave,
            codigo: mov.codigo ?? null,
            grau: grau || null,
            tribunal: src.tribunal || cfg.tribunal,
            orgao: src.orgaoJulgador?.nome || null,
            numero_processo: proc.numero,
          },
        });
      }
    }
    if (novos.length > 0) {
      // Insert em lote: 1 round-trip por processo em vez de 1 por movimento.
      const { error: insErr } = await supabase.from("andamentos").insert(novos);
      if (insErr) {
        erros.push({ numero: proc.numero, motivo: "insert: " + insErr.message });
      } else {
        criados += novos.length;
      }
    }

    if (!dryRun) {
      await supabase
        .from("processos_judiciais")
        .update({ ultima_sync: new Date().toISOString() })
        .eq("id", proc.id);
    }
  }

  return jsonResponse({
    dry_run: dryRun,
    janela_dias: dias,
    processos_total: processosTotal,
    processos_consultados: consultados,
    processos_encontrados: encontrados,
    movimentos_recebidos: movimentosRecebidos,
    ja_no_banco: jaNoBanco,
    andamentos_criados: criados,
    would_insert: wouldInsert,
    interrompido,
    amostra,
    erros: erros.slice(0, 20),
  });
});

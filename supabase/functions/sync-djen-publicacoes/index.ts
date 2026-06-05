// supabase/functions/sync-djen-publicacoes/index.ts
//
// Edge function que importa publicações do DJE (Diário de Justiça Eletrônico
// Nacional) via Comunica API do CNJ, casando-as com processos já cadastrados e
// criando andamentos com o TEXTO COMPLETO da publicação (origem='djen').
//
// Diferença pro Legalmail: o Legalmail manda só o RÓTULO da movimentação
// (titulo/tipo); a Comunica API traz o `texto` integral publicado no diário,
// que é informação pública e dá atualização real ao parceiro indicador.
//
// IMPORTANTE — geo-block: a Comunica API de produção (comunicaapi.pje.jus.br)
// só aceita requisições de IP brasileiro. A Edge Function da Supabase NÃO sai
// do Brasil por padrão (roda em rede global, não na região do banco), então
// dá 403. SOLUÇÃO confirmada: invocar com o header `x-region: sa-east-1`, que
// força a execução em São Paulo -> egress BR -> 403 some. O cron do n8n DEVE
// enviar esse header. Não dá pra chamar a API direto do n8n (Alemanha).
//
// Fonte das OABs: tabela `oabs_monitoradas` (ativo=true). Pode-se passar uma
// OAB avulsa no body p/ teste, sem depender da tabela.
//
// Chamada (cron n8n -> invoke, ou manual):
//   const { data } = await supabase.functions.invoke("sync-djen-publicacoes", {
//     body: {
//       dias: 1,                       // janela de disponibilização (default 1)
//       // dataInicio: "2026-06-01",   // ou janela explícita (yyyy-mm-dd)
//       // dataFim:    "2026-06-04",
//       usuario_id: "<uuid interno>",  // vira criado_por nos andamentos
//       dry_run: true,                 // não grava; só relata o que faria
//       // oab:  { numero: "123456", uf: "GO" }            // 1 OAB avulsa p/ teste
//       // oabs: [{ numero: "439016", uf: "SP" }, ...]     // várias OABs avulsas
//     }
//   });
//
// Response:
//   {
//     dry_run: boolean,
//     oabs_consultadas: number,
//     publicacoes_recebidas: number,
//     andamentos_criados: number,       // 0 em dry_run (usar would_create)
//     would_create: number,             // quantos seriam criados (dry_run)
//     ja_existentes: number,            // dedup por metadata.djen_id
//     sem_processo: number,             // publicação de processo não cadastrado
//     sem_processo_amostra: Array<{ numero, tribunal, tipo }>,  // até 20
//     amostra_match: Array<{ titulo, caso_id, data, texto_preview }>, // até 10
//     erros: Array<{ oab, motivo }>
//   }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const COMUNICA_BASE = "https://comunicaapi.pje.jus.br/api/v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const ITENS_POR_PAGINA = 100;
const PAGE_DELAY_MS = 300; // educado entre páginas/OABs
const MAX_PAGINAS = 50; // backstop anti-loop (50 * 100 = 5000 pubs/OAB)

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Só dígitos. CNJ tem 20 dígitos; comparamos por igualdade exata.
function normalizeCnj(s: string | null | undefined): string {
  return String(s || "").replace(/\D/g, "");
}

// yyyy-mm-dd no fuso de Brasília (UTC-3), p/ a janela de disponibilização.
function dataBrasilia(offsetDias = 0): string {
  const agora = new Date();
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  brasilia.setUTCDate(brasilia.getUTCDate() + offsetDias);
  return brasilia.toISOString().slice(0, 10);
}

// Tira tags HTML e decodifica entidades comuns, preservando quebras de linha.
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
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface OabAlvo {
  numero: string;
  uf: string;
}

interface ComunicacaoItem {
  id: string | number;
  hash?: string | null;
  numero_processo?: string | null;
  numeroprocessocommascara?: string | null;
  siglaTribunal?: string | null;
  nomeOrgao?: string | null;
  tipoComunicacao?: string | null;
  tipoDocumento?: string | null;
  texto?: string | null;
  data_disponibilizacao?: string | null;
  datadisponibilizacao?: string | null;
  link?: string | null;
  [k: string]: unknown;
}

// GET uma página da Comunica API. Sem token (consulta é pública).
async function fetchComunica(
  oab: OabAlvo,
  dataInicio: string,
  dataFim: string,
  pagina: number,
): Promise<ComunicacaoItem[]> {
  const qs = new URLSearchParams({
    numeroOab: oab.numero,
    ufOab: oab.uf,
    dataDisponibilizacaoInicio: dataInicio,
    dataDisponibilizacaoFim: dataFim,
    itensPorPagina: String(ITENS_POR_PAGINA),
    pagina: String(pagina),
  });
  const url = `${COMUNICA_BASE}/comunicacao?${qs.toString()}`;
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MaraSandraConnect/1.0 (sync-djen)",
    },
  });
  if (!resp.ok) {
    throw new Error(
      `comunica ${resp.status}: ${(await resp.text()).slice(0, 200)}`,
    );
  }
  const data = await resp.json();
  // Envelope: { status, message, count, items: [...] }
  const items = (data && (data.items ?? data.data)) as
    | ComunicacaoItem[]
    | undefined;
  return Array.isArray(items) ? items : [];
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

  let dias = 1;
  let dataInicio: string;
  let dataFim: string;
  let usuarioId: string | null = null;
  let dryRun = false;
  let oabOverride: OabAlvo[] | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.usuario_id) usuarioId = String(body.usuario_id);
    if (body.dry_run === true) dryRun = true;
    if (typeof body.dias === "number" && body.dias > 0) dias = body.dias;
    dataFim = body.dataFim ? String(body.dataFim) : dataBrasilia(0);
    dataInicio = body.dataInicio
      ? String(body.dataInicio)
      : dataBrasilia(-(dias - 1));
    const rawOabs: Array<{ numero?: unknown; uf?: unknown }> = Array.isArray(
        body.oabs,
      )
      ? body.oabs
      : (body.oab && body.oab.numero ? [body.oab] : []);
    if (rawOabs.length > 0) {
      oabOverride = rawOabs
        .filter((o) => o && o.numero && o.uf)
        .map((o) => ({
          numero: String(o.numero).replace(/\D/g, ""),
          uf: String(o.uf).toUpperCase(),
        }));
    }
  } catch (err) {
    return jsonResponse({ error: "body invalido", detail: String(err) }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // --- OABs alvo ---
  let oabs: OabAlvo[];
  if (oabOverride) {
    oabs = oabOverride;
  } else {
    const { data: rows, error: oabErr } = await supabase
      .from("oabs_monitoradas")
      .select("numero, uf")
      .eq("ativo", true);
    if (oabErr) {
      return jsonResponse(
        { error: "erro lendo oabs_monitoradas", detail: oabErr.message },
        500,
      );
    }
    oabs = (rows || []).map((r) => ({
      numero: String(r.numero),
      uf: String(r.uf).toUpperCase(),
    }));
  }
  if (oabs.length === 0) {
    return jsonResponse(
      { error: "nenhuma OAB ativa (tabela vazia e sem override)" },
      400,
    );
  }

  // --- Mapa CNJ -> processo, carregado uma vez ---
  const { data: procs, error: procErr } = await supabase
    .from("processos_judiciais")
    .select("id, caso_id, numero_processo")
    .not("numero_processo", "is", null);
  if (procErr) {
    return jsonResponse(
      { error: "erro lendo processos_judiciais", detail: procErr.message },
      500,
    );
  }
  const cnjMap = new Map<string, { id: string; caso_id: string }>();
  for (const p of procs || []) {
    const k = normalizeCnj(p.numero_processo as string);
    if (k) cnjMap.set(k, { id: p.id as string, caso_id: p.caso_id as string });
  }

  let publicacoesRecebidas = 0;
  let andamentosCriados = 0;
  let wouldCreate = 0;
  let jaExistentes = 0;
  let semProcesso = 0;
  let matched = 0; // publicações que casaram com processo cadastrado
  const dedupErros: Array<{ numero: string; motivo: string }> = [];
  const semProcessoAmostra: Array<
    { numero: string; tribunal: string | null; tipo: string | null }
  > = [];
  const amostraMatch: Array<
    {
      titulo: string;
      caso_id: string;
      data: string | null;
      texto_preview: string;
    }
  > = [];
  // Amostra do texto BRUTO (independe de casar com processo) — só p/ inspeção em dry_run.
  const amostraBruta: Array<
    {
      tipo: string | null;
      tribunal: string | null;
      numero: string | null;
      texto_preview: string;
    }
  > = [];
  const erros: Array<{ oab: string; motivo: string }> = [];

  for (const oab of oabs) {
    const oabLabel = `${oab.numero}/${oab.uf}`;
    try {
      for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
        if (pagina > 1 || oabs.indexOf(oab) > 0) await sleep(PAGE_DELAY_MS);
        const items = await fetchComunica(oab, dataInicio, dataFim, pagina);
        if (items.length === 0) break;
        publicacoesRecebidas += items.length;

        for (const item of items) {
          const djenId = String(item.id);

          if (dryRun && amostraBruta.length < 3) {
            amostraBruta.push({
              tipo: item.tipoComunicacao || null,
              tribunal: item.siglaTribunal || null,
              numero: item.numeroprocessocommascara ||
                (item.numero_processo ? String(item.numero_processo) : null),
              texto_preview: htmlParaTexto(item.texto).slice(0, 600),
            });
          }

          const cnj = normalizeCnj(
            item.numeroprocessocommascara || item.numero_processo,
          );
          const match = cnj ? cnjMap.get(cnj) : undefined;

          if (!match) {
            semProcesso++;
            if (semProcessoAmostra.length < 20) {
              semProcessoAmostra.push({
                numero: item.numeroprocessocommascara ||
                  String(item.numero_processo || ""),
                tribunal: item.siglaTribunal || null,
                tipo: item.tipoComunicacao || null,
              });
            }
            continue;
          }

          matched++;

          // Dedup por metadata.djen_id
          const { data: jaExiste, error: ddErr } = await supabase
            .from("andamentos")
            .select("id")
            .eq("origem", "djen")
            .eq("metadata->>djen_id", djenId)
            .maybeSingle();
          if (ddErr) {
            if (dedupErros.length < 5) {
              dedupErros.push({
                numero: item.numeroprocessocommascara ||
                  String(item.numero_processo || ""),
                motivo: ddErr.message,
              });
            }
            console.error("erro dedup djen", djenId, ddErr);
            continue;
          }
          if (jaExiste) {
            jaExistentes++;
            continue;
          }

          const dataEvento = item.data_disponibilizacao ||
            item.datadisponibilizacao || null;
          const tribunal = item.siglaTribunal || "";
          const tipo = item.tipoComunicacao || "Publicação";
          const titulo = tribunal ? `${tipo} — ${tribunal}` : tipo;
          const texto = htmlParaTexto(item.texto);

          if (dryRun) {
            wouldCreate++;
            if (amostraMatch.length < 10) {
              amostraMatch.push({
                titulo,
                caso_id: match.caso_id,
                data: dataEvento,
                texto_preview: texto.slice(0, 280),
              });
            }
            continue;
          }

          const insertObj = {
            caso_id: match.caso_id,
            origem: "djen",
            titulo: titulo,
            descricao: texto || titulo,
            data_evento: dataEvento,
            criado_por: usuarioId,
            visivel_parceiro: true,
            processo_admin_id: null,
            processo_judicial_id: match.id,
            metadata: {
              djen_id: djenId,
              hash: item.hash || null,
              sigla_tribunal: item.siglaTribunal || null,
              nome_orgao: item.nomeOrgao || null,
              tipo_comunicacao: item.tipoComunicacao || null,
              tipo_documento: item.tipoDocumento || null,
              link: item.link || null,
              certidao_url: item.hash
                ? `${COMUNICA_BASE}/comunicacao/${item.hash}/certidao`
                : null,
              numero_processo: item.numeroprocessocommascara ||
                item.numero_processo || null,
            },
          };

          const { error: insErr } = await supabase
            .from("andamentos")
            .insert(insertObj);
          if (insErr) {
            console.error("erro insert andamento djen", djenId, insErr);
            continue;
          }
          andamentosCriados++;
        }

        if (items.length < ITENS_POR_PAGINA) break; // última página
      }
    } catch (err) {
      erros.push({ oab: oabLabel, motivo: String(err) });
    }
  }

  return jsonResponse({
    dry_run: dryRun,
    oabs_consultadas: oabs.length,
    janela: { inicio: dataInicio, fim: dataFim },
    publicacoes_recebidas: publicacoesRecebidas,
    matched: matched,
    andamentos_criados: andamentosCriados,
    would_create: wouldCreate,
    ja_existentes: jaExistentes,
    dedup_erros: dedupErros.length,
    dedup_erros_amostra: dedupErros,
    sem_processo: semProcesso,
    sem_processo_amostra: semProcessoAmostra,
    amostra_match: amostraMatch,
    amostra_bruta: amostraBruta,
    erros: erros,
  });
});

// supabase/functions/sync-djen-publicacoes/index.ts
//
// Edge function que importa publicações do DJE (Diário de Justiça Eletrônico
// Nacional) via Comunica API do CNJ.
//
// Grava TODAS as publicações na tabela `publicacoes_dje` (fonte da aba interna
// "/publicacoes"): as que casam com um processo cadastrado ficam status
// 'vinculada' e TAMBÉM viram andamento no caso (origem='djen', texto completo);
// as demais ficam 'sem_processo' (órfãs, pra triagem manual).
//
// Diferença pro Legalmail: o Legalmail manda só o RÓTULO da movimentação; a
// Comunica API traz o `texto` integral publicado no diário.
//
// IMPORTANTE — geo-block: a Comunica API de produção (comunicaapi.pje.jus.br)
// só aceita requisições de IP brasileiro. A Edge Function da Supabase NÃO sai
// do Brasil por padrão (roda em rede global, não na região do banco), então
// dá 403. SOLUÇÃO confirmada: invocar com o header `x-region: sa-east-1`, que
// força a execução em São Paulo -> egress BR -> 403 some. O cron do n8n DEVE
// enviar esse header. Não dá pra chamar a API direto do n8n (Alemanha).
//
// Fonte das OABs: tabela `oabs_monitoradas` (ativo=true). Pode-se passar OAB(s)
// avulsa(s) no body p/ teste, sem depender da tabela.
//
// Chamada (cron n8n -> invoke, ou manual):
//   supabase.functions.invoke("sync-djen-publicacoes", {
//     body: { dias: 1, usuario_id: "<uuid>", dry_run: false }
//   })  // + header x-region: sa-east-1
//
// Response (resumo):
//   {
//     dry_run, oabs_consultadas, janela, publicacoes_recebidas,
//     ja_no_banco, vinculadas_novas, orfas_novas, andamentos_criados,
//     would_vincular, would_orfa (dry_run), dedup_erros, amostra, erros
//   }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const COMUNICA_BASE = "https://comunicaapi.pje.jus.br/api/v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const ITENS_POR_PAGINA = 100;
const PAGE_DELAY_MS = 300;
const MAX_PAGINAS = 50;

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

function normalizeCnj(s: string | null | undefined): string {
  return String(s || "").replace(/\D/g, "");
}

function dataBrasilia(offsetDias = 0): string {
  const agora = new Date();
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  brasilia.setUTCDate(brasilia.getUTCDate() + offsetDias);
  return brasilia.toISOString().slice(0, 10);
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

  // --- Mapa CNJ -> processo (carregado uma vez) ---
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
  let jaNoBanco = 0;
  let vinculadasNovas = 0;
  let orfasNovas = 0;
  let andamentosCriados = 0;
  let wouldVincular = 0;
  let wouldOrfa = 0;
  const dedupErros: Array<{ numero: string; motivo: string }> = [];
  const amostra: Array<
    {
      status: string;
      titulo: string;
      numero: string | null;
      caso_id: string | null;
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
          const numeroMasc = item.numeroprocessocommascara ||
            (item.numero_processo ? String(item.numero_processo) : null);
          const cnj = normalizeCnj(numeroMasc);
          const match = cnj ? cnjMap.get(cnj) : undefined;

          const tribunal = item.siglaTribunal || "";
          const tipo = item.tipoComunicacao || "Publicação";
          const titulo = tribunal ? `${tipo} — ${tribunal}` : tipo;
          const texto = htmlParaTexto(item.texto);
          const dataEvento = item.data_disponibilizacao ||
            item.datadisponibilizacao || null;
          const certidaoUrl = item.hash
            ? `${COMUNICA_BASE}/comunicacao/${item.hash}/certidao`
            : null;

          if (dryRun) {
            if (match) wouldVincular++;
            else wouldOrfa++;
            if (amostra.length < 10) {
              amostra.push({
                status: match ? "vinculada" : "sem_processo",
                titulo,
                numero: numeroMasc,
                caso_id: match?.caso_id || null,
                texto_preview: texto.slice(0, 280),
              });
            }
            continue;
          }

          // Dedup primário: já está em publicacoes_dje?
          const { data: jaPub, error: jaErr } = await supabase
            .from("publicacoes_dje")
            .select("id")
            .eq("djen_id", djenId)
            .maybeSingle();
          if (jaErr) {
            if (dedupErros.length < 5) {
              dedupErros.push({
                numero: numeroMasc || "",
                motivo: jaErr.message,
              });
            }
            continue;
          }
          if (jaPub) {
            jaNoBanco++;
            continue;
          }

          // Se casou com processo: cria (ou reaproveita) o andamento no caso.
          let andamentoId: string | null = null;
          if (match) {
            const { data: jaAnd } = await supabase
              .from("andamentos")
              .select("id")
              .eq("origem", "djen")
              .eq("metadata->>djen_id", djenId)
              .maybeSingle();
            if (jaAnd) {
              andamentoId = (jaAnd as { id: string }).id;
            } else {
              const { data: andRows, error: andErr } = await supabase
                .from("andamentos")
                .insert({
                  caso_id: match.caso_id,
                  origem: "djen",
                  titulo,
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
                    certidao_url: certidaoUrl,
                    numero_processo: numeroMasc,
                  },
                })
                .select("id");
              if (andErr) {
                erros.push({
                  oab: oabLabel,
                  motivo: "andamento: " + andErr.message,
                });
              } else {
                andamentoId = (andRows?.[0] as { id: string } | undefined)?.id ||
                  null;
                andamentosCriados++;
              }
            }
          }

          // Persiste a publicação (vinculada ou órfã) na tabela de triagem.
          const { error: pubErr } = await supabase
            .from("publicacoes_dje")
            .insert({
              djen_id: djenId,
              hash: item.hash || null,
              numero_processo: numeroMasc,
              numero_normalizado: cnj || null,
              sigla_tribunal: item.siglaTribunal || null,
              nome_orgao: item.nomeOrgao || null,
              tipo_comunicacao: item.tipoComunicacao || null,
              tipo_documento: item.tipoDocumento || null,
              data_disponibilizacao: dataEvento,
              texto: texto || null,
              oab_numero: oab.numero,
              oab_uf: oab.uf,
              status: match ? "vinculada" : "sem_processo",
              caso_id: match?.caso_id || null,
              processo_judicial_id: match?.id || null,
              andamento_id: andamentoId,
              certidao_url: certidaoUrl,
              link: item.link || null,
            });
          if (pubErr) {
            erros.push({ oab: oabLabel, motivo: "publicacao: " + pubErr.message });
            continue;
          }
          if (match) vinculadasNovas++;
          else orfasNovas++;
        }

        if (items.length < ITENS_POR_PAGINA) break;
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
    ja_no_banco: jaNoBanco,
    vinculadas_novas: vinculadasNovas,
    orfas_novas: orfasNovas,
    andamentos_criados: andamentosCriados,
    would_vincular: wouldVincular,
    would_orfa: wouldOrfa,
    dedup_erros: dedupErros.length,
    dedup_erros_amostra: dedupErros,
    amostra: amostra,
    erros: erros,
  });
});

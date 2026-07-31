// supabase/functions/digest-diario/index.ts
//
// Fase 3 do planning/PROCESSOS_GLOBAL.md: e-mail diário de resumo pro
// escritório — espelho do e-mail do Tramitação Inteligente, mas acionável
// (cada item linka direto pro caso no sistema).
//
// Seções (janela = últimas `horas`, default 24):
//   1. Movimentações processuais novas (andamentos origem='datajud')
//   2. Publicações DJEN novas — vinculadas (com cliente) e órfãs
//   3. Processos fora do sistema (fila "processo novo detectado": órfãs cujo
//      CNJ não está em processos_judiciais → triagem em /publicacoes)
//   4. Tarefas atrasadas e vencendo hoje
//
// Destinatários: usuários internos com e-mail. Sem novidades, não envia
// (a menos que body.sempre=true).
//
// Chamada (cron n8n 1x/dia de manhã, ou manual):
//   supabase.functions.invoke("digest-diario", {
//     body: { horas: 24, dry_run: false, para: "email@teste.com", sempre: false }
//   })
//
//   dry_run — não envia; retorna contagens + HTML pra conferência
//   para    — override de destinatário (string ou array; teste)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://marasandraconnect.com";
const FROM_EMAIL = "Mara Sandra Advocacia <noreply@marasandraconnect.com>";

const GOLD = "#c9a14a";
const MAX_ITENS_SECAO = 25;

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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Horário de Brasília (UTC-3, sem DST desde 2019).
  const br = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const dd = String(br.getUTCDate()).padStart(2, "0");
  const mm = String(br.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(br.getUTCHours()).padStart(2, "0");
  const mi = String(br.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

function hojeBrasilia(): string {
  const br = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return br.toISOString().slice(0, 10);
}

interface ItemLinha {
  titulo: string;
  detalhe: string;
  href: string | null;
}

function secaoHtml(titulo: string, itens: ItemLinha[], vazio: string): string {
  const linhas = itens.length === 0
    ? `<p style="color:#888;font-size:13px;margin:8px 0 0">${esc(vazio)}</p>`
    : itens
      .slice(0, MAX_ITENS_SECAO)
      .map((i) => {
        const t = i.href
          ? `<a href="${i.href}" style="color:#1a1a1a;text-decoration:underline">${esc(i.titulo)}</a>`
          : esc(i.titulo);
        return `<tr><td style="padding:6px 0;border-bottom:1px solid #f0ede6;font-size:14px">` +
          `${t}<br><span style="color:#888;font-size:12px">${esc(i.detalhe)}</span></td></tr>`;
      })
      .join("");
  const extra = itens.length > MAX_ITENS_SECAO
    ? `<p style="color:#888;font-size:12px">… e mais ${itens.length - MAX_ITENS_SECAO}.</p>`
    : "";
  const corpo = itens.length === 0
    ? linhas
    : `<table style="width:100%;border-collapse:collapse">${linhas}</table>${extra}`;
  return `<h3 style="margin:24px 0 4px;font-size:15px;color:#1a1a1a;` +
    `border-left:3px solid ${GOLD};padding-left:8px">${esc(titulo)}` +
    ` <span style="color:#888;font-weight:normal">(${itens.length})</span></h3>${corpo}`;
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

  let horas = 24;
  let dryRun = false;
  let sempre = false;
  let paraOverride: string[] | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.horas === "number" && body.horas > 0) horas = body.horas;
    if (body.dry_run === true) dryRun = true;
    if (body.sempre === true) sempre = true;
    if (body.para) {
      paraOverride = (Array.isArray(body.para) ? body.para : [body.para])
        .map((e: unknown) => String(e).trim())
        .filter(Boolean);
    }
  } catch (err) {
    return jsonResponse({ error: "body invalido", detail: String(err) }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const cutoff = new Date(Date.now() - horas * 3600000).toISOString();
  const hoje = hojeBrasilia();

  // --- 1. Movimentações DataJud novas -------------------------------------
  const { data: movs, error: movErr } = await supabase
    .from("andamentos")
    .select("id, titulo, data_evento, caso_id, metadata, casos:caso_id(clientes(nome))")
    .eq("origem", "datajud")
    .gt("created_at", cutoff)
    .order("data_evento", { ascending: false })
    .limit(200);
  if (movErr) return jsonResponse({ error: "movimentacoes: " + movErr.message }, 500);
  const itensMov: ItemLinha[] = (movs || []).map((r) => {
    const m = (r.metadata as Record<string, unknown> | null) || {};
    const cliente =
      (r.casos as { clientes?: { nome?: string | null } } | null)?.clientes?.nome ?? "Cliente";
    return {
      titulo: `${cliente} — ${r.titulo || "Movimentação"}`,
      detalhe: [m.numero_processo, m.tribunal, fmtDataHora(r.data_evento as string | null)]
        .filter(Boolean)
        .join(" · "),
      href: `${APP_URL}/casos/${r.caso_id}?tab=andamentos&foco=${r.id}`,
    };
  });

  // --- 2. Publicações DJEN novas (vinculadas) ------------------------------
  const { data: pubs, error: pubErr } = await supabase
    .from("publicacoes_dje")
    .select(
      "id, numero_processo, sigla_tribunal, tipo_comunicacao, status, caso_id, andamento_id, created_at, casos:caso_id(clientes(nome))",
    )
    .gt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(200);
  if (pubErr) return jsonResponse({ error: "publicacoes: " + pubErr.message }, 500);
  const vinculadas = (pubs || []).filter((p) => p.status === "vinculada");
  const orfas = (pubs || []).filter((p) => p.status === "sem_processo");
  const itensPub: ItemLinha[] = vinculadas.map((p) => {
    const cliente =
      (p.casos as { clientes?: { nome?: string | null } } | null)?.clientes?.nome ?? "Cliente";
    return {
      titulo: `${cliente} — ${p.tipo_comunicacao || "Publicação"}`,
      detalhe: [p.numero_processo, p.sigla_tribunal].filter(Boolean).join(" · "),
      href: p.caso_id
        ? `${APP_URL}/casos/${p.caso_id}?tab=andamentos${p.andamento_id ? `&foco=${p.andamento_id}` : ""}`
        : `${APP_URL}/publicacoes`,
    };
  });

  // --- 3. Fila "processo novo detectado" (órfãs) ---------------------------
  // Publicação de CNJ que não está em processos_judiciais = possível processo
  // novo das OABs monitoradas. Triagem manual em /publicacoes (vincular cria
  // o processo; criação de caso continua decisão humana).
  const numerosOrfaos = new Map<string, { tribunal: string | null; tipos: number }>();
  for (const p of orfas) {
    const num = p.numero_processo || "(sem número)";
    const atual = numerosOrfaos.get(num);
    if (atual) atual.tipos++;
    else numerosOrfaos.set(num, { tribunal: p.sigla_tribunal, tipos: 1 });
  }
  const itensNovos: ItemLinha[] = [...numerosOrfaos.entries()].map(([num, info]) => ({
    titulo: num,
    detalhe: [info.tribunal, `${info.tipos} publicação${info.tipos === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · "),
    href: `${APP_URL}/publicacoes`,
  }));

  // --- 4. Tarefas atrasadas / vencendo hoje --------------------------------
  const { data: tarefas, error: tarErr } = await supabase
    .from("tarefas")
    .select("id, titulo, due_at, status, caso_id, casos:caso_id(clientes(nome))")
    .in("status", ["a_fazer", "fazendo"])
    .not("due_at", "is", null)
    .lte("due_at", hoje + "T23:59:59-03:00")
    .order("due_at", { ascending: true })
    .limit(200);
  if (tarErr) return jsonResponse({ error: "tarefas: " + tarErr.message }, 500);
  const itensTarefas: ItemLinha[] = (tarefas || []).map((t) => {
    const cliente =
      (t.casos as { clientes?: { nome?: string | null } } | null)?.clientes?.nome ?? null;
    const dueDia = String(t.due_at).slice(0, 10);
    const atrasada = dueDia < hoje;
    return {
      titulo: `${atrasada ? "[ATRASADA] " : "[hoje] "}${t.titulo || "Tarefa"}`,
      detalhe: [cliente, `vence ${fmtDataHora(t.due_at as string)}`].filter(Boolean).join(" · "),
      href: `${APP_URL}/tarefas`,
    };
  });

  const totais = {
    movimentacoes: itensMov.length,
    publicacoes_vinculadas: itensPub.length,
    processos_novos_detectados: itensNovos.length,
    tarefas_vencendo: itensTarefas.length,
  };
  const temNovidade = Object.values(totais).some((n) => n > 0);

  // --- Monta o e-mail -------------------------------------------------------
  const dataLabel = new Date(Date.now() - 3 * 3600000).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  const subject =
    `Resumo do dia ${dataLabel} — ` +
    `${totais.movimentacoes} movimentações · ${totais.publicacoes_vinculadas} publicações · ` +
    `${totais.tarefas_vencendo} tarefas`;

  const html =
    `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">` +
    `<h2 style="color:#111;margin-bottom:2px">Resumo diário</h2>` +
    `<p style="color:#888;font-size:13px;margin-top:0">${dataLabel} · últimas ${horas}h</p>` +
    secaoHtml("Movimentações processuais", itensMov, "Nenhuma movimentação nova.") +
    secaoHtml("Publicações do diário (DJEN)", itensPub, "Nenhuma publicação nova.") +
    secaoHtml(
      "Processos fora do sistema (triagem)",
      itensNovos,
      "Nenhum processo novo detectado.",
    ) +
    secaoHtml("Tarefas atrasadas ou vencendo hoje", itensTarefas, "Nenhuma tarefa vencendo.") +
    `<p style="margin:28px 0 0"><a href="${APP_URL}/processos" style="background:${GOLD};` +
    `color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">` +
    `Abrir o sistema</a></p>` +
    `<hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px">` +
    `<p style="color:#999;font-size:12px">Mara Sandra Advocacia &middot; marasandraconnect.com</p>` +
    `</div>`;

  if (dryRun) {
    return jsonResponse({ dry_run: true, totais, tem_novidade: temNovidade, subject, html });
  }
  if (!temNovidade && !sempre) {
    return jsonResponse({ enviado: false, motivo: "sem novidades", totais });
  }
  if (!RESEND_API_KEY) {
    return jsonResponse({ error: "RESEND_API_KEY ausente" }, 500);
  }

  // --- Destinatários --------------------------------------------------------
  let destinos: string[];
  if (paraOverride && paraOverride.length > 0) {
    destinos = paraOverride;
  } else {
    const { data: internos, error: intErr } = await supabase
      .from("usuarios")
      .select("email")
      .eq("tipo", "interno")
      .not("email", "is", null);
    if (intErr) return jsonResponse({ error: "usuarios: " + intErr.message }, 500);
    destinos = (internos || []).map((u) => String(u.email)).filter(Boolean);
  }
  if (destinos.length === 0) {
    return jsonResponse({ enviado: false, motivo: "sem destinatarios", totais });
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: destinos, subject, html }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    return jsonResponse({ error: `resend ${resp.status}: ${detail.slice(0, 200)}` }, 502);
  }

  return jsonResponse({ enviado: true, destinatarios: destinos.length, totais, subject });
});

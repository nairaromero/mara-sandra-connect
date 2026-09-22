// integracoes-escritorio — configuração de integrações POR ESCRITÓRIO
// (WhatsApp/Evolution hoje; Legalmail/TI depois), gravada pela function porque
// o segredo (chave da API) é cifrado com a master key antes de ir ao banco e
// nunca volta ao navegador. Quem chama: quem gerencia integrações no
// escritório ativo (admin). Ações:
//   salvar      { tipo, config, segredo?, ativo? }  — upsert; segredo só se vier
//   gerar_token { tipo: "whatsapp" }                — novo token de entrada do webhook
//   testar      { tipo: "whatsapp" }                — GET connectionState no Evolution
//   status      { tipo }                            — config sem segredo + "segredo definido em"

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { exigirUsuario, fetchT } from "../_shared/auth.ts";
import { encryptSecret, decryptSecret } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-escritorio-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TIPOS = new Set(["whatsapp", "legalmail", "ti", "djen"]);
// campos de config aceitos por tipo (o resto é descartado: nada de segredo em config)
const CAMPOS: Record<string, string[]> = {
  whatsapp: ["base_url", "instance", "inbound_token", "numero"],
  legalmail: ["usuario"],
  ti: ["base_url", "usuario"],
  djen: [],
};

function tokenAleatorio(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const quem = await exigirUsuario(req, { tipo: "interno", permissao: "integracoes:gerenciar" });
  if (quem instanceof Response) return quem;
  const escritorioId = quem.perfil.escritorio_id;
  if (!escritorioId) return json({ error: "sem escritório ativo" }, 400);

  let body: { action?: string; tipo?: string; config?: Record<string, unknown>; segredo?: string; ativo?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "body inválido" }, 400);
  }
  const tipo = String(body.tipo ?? "");
  if (!TIPOS.has(tipo)) return json({ error: "tipo de integração desconhecido" }, 400);
  const admin = quem.admin;

  const { data: atual, error: eAtual } = await admin
    .from("escritorio_integracoes")
    .select("config, ativo, segredo_cipher, segredo_iv, segredo_definido_em, updated_at")
    .eq("escritorio_id", escritorioId)
    .eq("tipo", tipo)
    .maybeSingle();
  if (eAtual) return json({ error: `lendo integração: ${eAtual.message}` }, 500);

  const semSegredo = (row: typeof atual) =>
    row
      ? { tipo, config: row.config ?? {}, ativo: row.ativo, segredo_definido_em: row.segredo_definido_em, updated_at: row.updated_at }
      : { tipo, config: {}, ativo: false, segredo_definido_em: null, updated_at: null };

  async function auditar(acao: string, detalhes: Record<string, unknown> = {}) {
    await admin.from("auditoria").insert({
      escritorio_id: escritorioId, ator_id: quem.uid, tipo_ator: "membro",
      acao, recurso: "escritorio_integracoes", recurso_id: tipo, detalhes,
    });
  }

  if (body.action === "status" || !body.action) return json(semSegredo(atual));

  if (body.action === "salvar" || body.action === "gerar_token") {
    const permitidos = CAMPOS[tipo];
    const configNova: Record<string, unknown> = { ...(atual?.config ?? {}) };
    for (const k of permitidos) {
      if (body.config && k in body.config) {
        const v = body.config[k];
        configNova[k] = typeof v === "string" ? v.trim() : v;
      }
    }
    if (body.action === "gerar_token") {
      if (tipo !== "whatsapp") return json({ error: "token de entrada só existe para whatsapp" }, 400);
      configNova.inbound_token = tokenAleatorio();
    }
    const linha: Record<string, unknown> = {
      escritorio_id: escritorioId,
      tipo,
      config: configNova,
      ativo: typeof body.ativo === "boolean" ? body.ativo : (atual?.ativo ?? true),
      atualizado_por: quem.uid,
      updated_at: new Date().toISOString(),
    };
    const segredo = typeof body.segredo === "string" ? body.segredo.trim() : "";
    if (segredo) {
      try {
        const { cipher, iv } = await encryptSecret(segredo);
        linha.segredo_cipher = cipher;
        linha.segredo_iv = iv;
        linha.segredo_definido_em = new Date().toISOString();
      } catch (e) {
        // sem master key no ambiente: erro claro (e nada gravado), não 500 mudo
        return json({ error: `não consegui cifrar a chave: ${String((e as Error)?.message ?? e)}` }, 500);
      }
    }
    const { data: salvo, error } = await admin
      .from("escritorio_integracoes")
      .upsert(linha, { onConflict: "escritorio_id,tipo" })
      .select("config, ativo, segredo_cipher, segredo_iv, segredo_definido_em, updated_at")
      .single();
    if (error) return json({ error: `salvando: ${error.message}` }, 500);
    await auditar(body.action === "gerar_token" ? "integracao.token" : "integracao.salvar", {
      campos: Object.keys(body.config ?? {}), segredo: !!segredo, ativo: linha.ativo,
    });
    return json({ ok: true, ...semSegredo(salvo) });
  }

  if (body.action === "testar") {
    if (tipo !== "whatsapp") return json({ error: "teste só existe para whatsapp" }, 400);
    if (!atual) return json({ ok: false, erro: "integração ainda não configurada" });
    const cfg = (atual.config ?? {}) as { base_url?: string; instance?: string };
    if (!cfg.base_url || !cfg.instance) return json({ ok: false, erro: "informe a URL e a instância" });
    if (!atual.segredo_cipher || !atual.segredo_iv) return json({ ok: false, erro: "informe a chave da API" });
    const chave = await decryptSecret(atual.segredo_cipher, atual.segredo_iv);
    try {
      const r = await fetchT(`${cfg.base_url.replace(/\/+$/, "")}/instance/connectionState/${encodeURIComponent(cfg.instance)}`, {
        headers: { apikey: chave },
        timeoutMs: 10_000,
      });
      const texto = await r.text();
      let estado: string | null = null;
      try {
        const j = JSON.parse(texto) as { instance?: { state?: string }; state?: string };
        estado = j.instance?.state ?? j.state ?? null;
      } catch { /* resposta sem JSON */ }
      await auditar("integracao.testar", { http: r.status, estado });
      return json({ ok: r.ok, http: r.status, estado, detalhe: r.ok ? null : texto.slice(0, 200) });
    } catch (e) {
      return json({ ok: false, erro: `não alcancei o Evolution: ${String((e as Error)?.message ?? e)}` });
    }
  }

  return json({ error: "ação desconhecida" }, 400);
});

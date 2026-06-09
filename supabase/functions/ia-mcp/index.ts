// =============================================================================
// Edge Function: ia-mcp  (Plugin de IA — Superficie B: Claude/ChatGPT externos)
//
// Servidor MCP (JSON-RPC 2.0 sobre HTTP) que publica as MESMAS tools de leitura
// do app. O usuario usa o modelo do PROPRIO Claude/ChatGPT (nao consome BYOK).
//
// Auth: Personal Access Token (PAT) no header Authorization: Bearer msc_xxx.
//   - valida sha256(token) em ia_tokens (nao revogado, nao expirado)
//   - resolve o usuario e MINTA um JWT curto (HS256) -> client RLS-escopado.
//     Assim o parceiro continua preso aos casos dele, sem reimplementar authz.
//
// Metodos: initialize, tools/list, tools/call, ping. Notifications -> 202.
// Auditoria em ia_acoes (superficie='mcp').
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//          SUPABASE_JWT_SECRET (legacy JWT secret do projeto).
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sha256Hex, signUserJwt } from "../_shared/tokens.ts";
import { findTool, toolsForRole } from "../_shared/ia-tools.ts";
import { redactArgs } from "../_shared/ia-redact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ?? "";

const SERVER_INFO = { name: "mara-sandra-connect", version: "0.1.0" };
const PROTOCOL = "2024-11-05";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function rpc(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcErr(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function httpJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

// Converte o retorno de uma tool em blocos de conteudo MCP. Caso a tool devolva
// `_anexos` (PDFs base64, ex.: ler_documentos_caso), eles viram blocos `resource`
// para o cliente (Claude/ChatGPT) ler o PDF por OCR nativo; o resto vira texto.
function mcpContent(out: unknown): Array<Record<string, unknown>> {
  if (out && typeof out === "object" && Array.isArray((out as Record<string, unknown>)._anexos)) {
    const o = out as Record<string, unknown>;
    const anexos = o._anexos as Array<{ nome: string; mediaType: string; base64: string }>;
    const { _anexos: _omit, ...rest } = o;
    const blocks: Array<Record<string, unknown>> = [
      { type: "text", text: JSON.stringify(rest).slice(0, 60000) },
    ];
    for (const a of anexos) {
      blocks.push({
        type: "resource",
        resource: {
          uri: "mcp://documento/" + encodeURIComponent(a.nome),
          mimeType: a.mediaType,
          blob: a.base64,
        },
      });
    }
    return blocks;
  }
  return [{ type: "text", text: JSON.stringify(out).slice(0, 8000) }];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // GET simples: ajuda a depurar a URL no navegador.
  if (req.method === "GET") {
    return httpJson({ ok: true, server: SERVER_INFO, transport: "http", protocol: PROTOCOL });
  }
  if (req.method !== "POST") return httpJson({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) return httpJson({ error: "env ausente" }, 500);

  // ---- Auth por PAT ----
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "token ausente" }), {
      status: 401,
      headers: { ...cors, "content-type": "application/json", "WWW-Authenticate": "Bearer" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const hash = await sha256Hex(token);
  const { data: tok } = await admin
    .from("ia_tokens")
    .select("id,usuario_id,escopo,expira_em,revogado_em")
    .eq("token_hash", hash)
    .maybeSingle();

  const agora = Date.now();
  const expirado = tok?.expira_em ? new Date(tok.expira_em).getTime() < agora : false;
  if (!tok || tok.revogado_em || expirado) {
    return httpJson({ error: "token invalido ou expirado" }, 401);
  }

  // Marca uso (best-effort).
  admin.from("ia_tokens").update({ ultimo_uso: new Date(agora).toISOString() }).eq("id", tok.id).then(
    () => {},
    () => {},
  );

  const { data: perfil } = await admin
    .from("usuarios")
    .select("tipo")
    .eq("id", tok.usuario_id)
    .maybeSingle();
  const tipo: "interno" | "parceiro" = perfil?.tipo === "interno" ? "interno" : "parceiro";

  // ---- Body JSON-RPC ----
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return httpJson(rpcErr(null, -32700, "JSON invalido"), 400);
  }

  // Client usado para executar as tools.
  //   - Com SUPABASE_JWT_SECRET (projetos com JWT HS256/legacy): minta um JWT do
  //     usuario -> client RLS-escopado (interno E parceiro seguros pelo RLS).
  //   - Sem o secret (projetos com JWT assimetrico/novo): interno usa service-role
  //     (ve tudo, que e o esperado para interno). PARCEIRO e RECUSADO para nao
  //     furar o escopo dele — habilitar exige config adicional.
  let scoped: ReturnType<typeof createClient> | null = null;
  async function getClient(): Promise<ReturnType<typeof createClient>> {
    if (scoped) return scoped;
    if (JWT_SECRET) {
      const jwt = await signUserJwt(JWT_SECRET, tok.usuario_id);
      scoped = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: "Bearer " + jwt } },
        auth: { persistSession: false },
      });
      return scoped;
    }
    if (tipo === "interno") {
      scoped = admin;
      return scoped;
    }
    throw new Error(
      "conexao de parceiro via MCP ainda nao habilitada neste projeto (escopo RLS pendente de config)",
    );
  }

  async function handle(msg: Record<string, unknown>): Promise<unknown | null> {
    const id = msg.id;
    const method = String(msg.method || "");

    // Notificacoes (sem id) nao tem resposta.
    if (id === undefined || id === null) {
      return null;
    }

    if (method === "initialize") {
      return rpc(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "ping") return rpc(id, {});

    // Escrita so quando o token tem escopo 'completo'.
    const escrita = tok.escopo === "completo";

    if (method === "tools/list") {
      const tools = toolsForRole(tipo, escrita).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
      }));
      return rpc(id, { tools });
    }

    if (method === "tools/call") {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const nome = String(params.name || "");
      const args = params.arguments ?? {};
      const tool = findTool(nome, tipo, escrita);
      if (!tool) {
        return rpc(id, {
          content: [
            {
              type: "text",
              text: escrita
                ? "Ferramenta indisponivel para seu perfil."
                : "Este token e somente leitura; gere um token com escopo completo para escrever.",
            },
          ],
          isError: true,
        });
      }
      try {
        const client = await getClient();
        const out = await tool.execute(client, args, { uid: tok.usuario_id, tipo });
        await admin.from("ia_acoes").insert({
          usuario_id: tok.usuario_id,
          superficie: "mcp",
          tipo: tool.tipo,
          ferramenta: nome,
          argumentos: redactArgs(args),
          resultado: { ok: true },
          status: "aplicada",
          caso_id: typeof args.caso_id === "string" ? args.caso_id : null,
        });
        return rpc(id, { content: mcpContent(out) });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        await admin.from("ia_acoes").insert({
          usuario_id: tok.usuario_id,
          superficie: "mcp",
          tipo: tool.tipo,
          ferramenta: nome,
          argumentos: redactArgs(args),
          resultado: { ok: false },
          status: "erro",
        }).then(() => {}, () => {});
        return rpc(id, {
          content: [{ type: "text", text: "Erro: " + m.slice(0, 200) }],
          isError: true,
        });
      }
    }

    return rpcErr(id, -32601, "metodo nao suportado: " + method);
  }

  try {
    if (Array.isArray(payload)) {
      const out: unknown[] = [];
      for (const msg of payload) {
        const r = await handle(msg as Record<string, unknown>);
        if (r !== null) out.push(r);
      }
      if (!out.length) return new Response(null, { status: 202, headers: cors });
      return httpJson(out);
    }
    const r = await handle((payload ?? {}) as Record<string, unknown>);
    if (r === null) return new Response(null, { status: 202, headers: cors });
    return httpJson(r);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return httpJson(rpcErr(null, -32603, m.slice(0, 200)), 500);
  }
});

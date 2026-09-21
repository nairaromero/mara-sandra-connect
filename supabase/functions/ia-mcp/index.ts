// =============================================================================
// Edge Function: ia-mcp  (Plugin de IA — Superficie B: Claude/ChatGPT externos)
//
// Servidor MCP (JSON-RPC 2.0 sobre HTTP) que publica as MESMAS tools de leitura
// do app. O usuario usa o modelo do PROPRIO Claude/ChatGPT (nao consome BYOK).
//
// Auth: Personal Access Token (PAT) no header Authorization: Bearer msc_xxx.
//   - valida sha256(token) em ia_tokens (nao revogado, nao expirado)
//   - troca o token por uma SESSAO de verdade da pessoa (abrirSessaoDe, em
//     _shared/auth.ts) -> client RLS-escopado. Assim o parceiro continua preso
//     aos casos dele, sem reimplementar authz. Sem sessao, nada roda (503) —
//     ate 2026-09 o codigo caia calado para service role (#374).
//
// Metodos: initialize, tools/list, tools/call, ping. Notifications -> 202.
// Auditoria em ia_acoes (superficie='mcp').
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (os
//          injetados pela plataforma; nenhum segredo proprio).
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sha256Hex } from "../_shared/tokens.ts";
import { abrirSessaoDe, SessaoIndisponivel, type SessaoDePessoa } from "../_shared/auth.ts";
import { findTool, toolsForRole } from "../_shared/ia-tools.ts";
import { redactArgs } from "../_shared/ia-redact.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SERVER_INFO = { name: "mara-sandra-connect", version: "0.1.0" };
const PROTOCOL = "2024-11-05";

// So no MCP (Claude/ChatGPT externos): o modelo so usa as ferramentas quando a
// pessoa pede. O chat interno do app (ia-assistant) usa as mesmas tools SEM essa
// restricao — por isso fica aqui, e nao nas descricoes de ia-tools.ts.
const INSTRUCOES =
  "Ferramentas do sistema do escritorio Mara Sandra (casos, clientes, andamentos, documentos). " +
  "Use-as SOMENTE quando o usuario pedir explicitamente para consultar ou alterar algo no " +
  "sistema - por exemplo: 'use o MCP para...', 'consulta no sistema', 'no Mara Sandra'. " +
  "Se o usuario apenas mencionar um cliente ou caso, sem pedir consulta ao sistema, NAO chame " +
  "as ferramentas: responda com o que ja tem ou pergunte se ele quer que voce consulte o sistema.";
const PREFIXO_DESCRICAO = "[Sistema Mara Sandra - usar so quando o usuario pedir] ";
const ULTIMO_USO_INTERVALO_MS = 5 * 60_000;

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
  if (req.method === "GET") {
    // Cliente MCP (Streamable HTTP) usa GET para abrir um stream SSE. Nao temos
    // stream: pela spec, responde 405. Com 200 o mcp-remote reconectava em loop
    // (~100+ requests/min por cliente conectado, medido em 2026-09-11).
    if ((req.headers.get("Accept") || "").includes("text/event-stream")) {
      return new Response(null, { status: 405, headers: { ...cors, Allow: "POST, OPTIONS" } });
    }
    // GET simples: ajuda a depurar a URL no navegador.
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
  // Token e dono numa consulta so (FK ia_tokens.usuario_id -> usuarios): toda
  // chamada MCP passa por aqui.
  const { data: tok, error: tokErr } = await admin
    .from("ia_tokens")
    .select("id,usuario_id,escopo,expira_em,revogado_em,ultimo_uso,usuarios(tipo,ativo,desligado_em,eh_admin)")
    .eq("token_hash", hash)
    .maybeSingle();
  // Falha de banco NAO e token invalido: com 401 o mcp-remote tenta login OAuth
  // (que nao temos) e a conexao morre ate reiniciar o Claude Desktop.
  if (tokErr) return httpJson({ error: "falha ao validar o token, tente de novo" }, 503);

  const agora = Date.now();
  const expirado = tok?.expira_em ? new Date(tok.expira_em).getTime() < agora : false;
  if (!tok || tok.revogado_em || expirado) {
    return httpJson({ error: "token invalido ou expirado" }, 401);
  }

  // O token nao passa pelo login: quem foi desligado/desativado e barrado aqui
  // (o client e service-role, entao nenhuma RLS faria isso por nos).
  const perfil = tok.usuarios as
    | { tipo: string; ativo: boolean; desligado_em: string | null; eh_admin: boolean }
    | null;
  if (!perfil || !perfil.ativo || perfil.desligado_em) {
    return httpJson({ error: "usuario desativado" }, 403);
  }
  // O token e o controle de acesso ao MCP e so admin libera o uso (decisao de
  // 2026-09-21). Hoje o admin so gera token para si, entao o dono tem que
  // SEGUIR admin: quem perde o papel perde o MCP na hora, sem precisar revogar.
  // Liberar para outra pessoa (token emitido em nome de interno/parceiro) e a
  // #385 — la esta checagem passa a olhar o emissor.
  if (perfil.eh_admin !== true) {
    return httpJson({ error: "o MCP esta liberado so para administradores" }, 403);
  }
  const tipo: "interno" | "parceiro" = perfil.tipo === "interno" ? "interno" : "parceiro";

  // Marca uso (best-effort) so de token aceito, e no maximo a cada 5 min: o card
  // mostra "ultimo uso", nao precisa de uma escrita em ia_tokens por chamada.
  const ultimoUso = tok.ultimo_uso ? new Date(tok.ultimo_uso).getTime() : 0;
  if (agora - ultimoUso > ULTIMO_USO_INTERVALO_MS) {
    admin.from("ia_tokens").update({ ultimo_uso: new Date(agora).toISOString() }).eq("id", tok.id).then(
      () => {},
      () => {},
    );
  }

  // ---- Body JSON-RPC ----
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return httpJson(rpcErr(null, -32700, "JSON invalido"), 400);
  }

  // Client usado para executar as tools: SEMPRE a sessao da pessoa, com RLS.
  // Aberta so quando uma tool roda (initialize/tools/list nao precisam) e
  // encerrada no fim do request. O service role (`admin`) fica so para o que e
  // do servidor: validar o token, marcar uso e gravar a auditoria.
  let sessao: SessaoDePessoa | null = null;
  async function getClient() {
    sessao ??= await abrirSessaoDe(tok.usuario_id);
    return sessao.client;
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
        instructions: INSTRUCOES,
      });
    }
    if (method === "ping") return rpc(id, {});

    // Escrita so quando o token tem escopo 'completo'.
    const escrita = tok.escopo === "completo";

    if (method === "tools/list") {
      const tools = toolsForRole(tipo, escrita).map((t) => ({
        name: t.name,
        // Reforco para clientes que ignoram `instructions` (ex.: ChatGPT).
        description: PREFIXO_DESCRICAO + t.description,
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
        // Sem sessao nao e erro da tool: sobe para virar 503 (ver abaixo).
        if (e instanceof SessaoIndisponivel) throw e;
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
    if (e instanceof SessaoIndisponivel) {
      // Nunca contornar a RLS: sem a sessao da pessoa, a chamada falha.
      console.error("[ia-mcp] sessao indisponivel:", m);
      return httpJson(rpcErr(null, -32603, "nao consegui abrir sua sessao; tente de novo"), 503);
    }
    return httpJson(rpcErr(null, -32603, m.slice(0, 200)), 500);
  } finally {
    await sessao?.encerrar();
  }
});

// =============================================================================
// Edge Function: ia-config  (Plugin de IA)
//
// Acoes (body.action):
//   - "status"  : a IA está disponível para esta pessoa? (chave do escritório
//                 ativo, provedor e modelo) + lista de modelos sugeridos.
//   - "token_*" : tokens do MCP (Claude/ChatGPT) — ver adiante.
// A chave de IA é do ESCRITÓRIO desde #451 (parte 2) e é gravada pela function
// integracoes-escritorio (tipo "ia"). salvar/testar/ativar/compartilhar da
// antiga chave pessoal respondem 410 apontando para lá.
//
// Auth: JWT do usuario (Authorization: Bearer ...).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { PROVIDERS } from "../_shared/ia-providers.ts";
import { carregarIntegracao } from "../_shared/ia-integracao.ts";
import { generateToken, sha256Hex } from "../_shared/tokens.ts";
import { exigirUsuario } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: "env ausente" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ---- Autorizacao: pessoa ATIVA no escritório ativo ----
  // Autorização em dois níveis, porque esta function faz duas coisas:
  //   - cofre de chaves de IA (status/testar/salvar/ativar/compartilhar): é de
  //     quem usa IA, e a permissão `ia:usar` é conferida ADIANTE, por ação;
  //   - tokens do MCP (token_*): o DONO pode ser qualquer pessoa escolhida pelo
  //     admin, inclusive parceiro (#385) — exigir `ia:usar` aqui tirava da dona
  //     o direito de ver e revogar o próprio token.
  const quem = await exigirUsuario(req);
  if (quem instanceof Response) return quem;
  const uid = quem.uid;
  // Chave de IA e token do MCP pertencem a UM escritório (nulo só em banco sem
  // as migrations do RBAC).
  const escritorioId = quem.perfil.escritorio_id;

  // ---- Body ----
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  const action = String(body.action || "");

  // Status da IA: exige ser interno e ter `ia:usar` (decisão de 24/09 — antes
  // bastava estar autenticado, e a tela era o único freio).
  const ACOES_DE_IA = ["status", "testar", "salvar", "ativar", "compartilhar"];
  if (ACOES_DE_IA.includes(action)) {
    if (quem.perfil.tipo !== "interno" || !quem.perfil.permissoes.includes("ia:usar")) {
      return jsonResponse({ error: "sem permissao para usar IA", code: "sem_permissao" }, 403);
    }
  }

  try {
    if (action === "status") {
      // A chave é do ESCRITÓRIO (#451, parte 2): quem gerencia integrações
      // cadastra em Configurações › Integrações (integracoes-escritorio).
      // `disponivel` decide se a tela mostra a IA para esta pessoa.
      const efetiva = await carregarIntegracao(admin, escritorioId);
      const integ = efetiva.ok ? efetiva.integ : null;
      return jsonResponse({
        disponivel: efetiva.ok,
        motivo: efetiva.ok ? null : efetiva.code,
        provider: integ?.provider ?? null,
        modelo: integ?.modelo ?? null,
        providers_suportados: Object.fromEntries(
          Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, models: v.models }]),
        ),
      });
    }

    // Cofre de chave PESSOAL: saiu (#451). Resposta clara para tela antiga em cache.
    if (["testar", "salvar", "ativar", "compartilhar"].includes(action)) {
      return jsonResponse({
        error: "a chave de IA agora é do escritório: Configurações › Integrações › IA do escritório",
        code: "chave_do_escritorio",
      }, 410);
    }

    // ---- Tokens da Superficie B (Claude/ChatGPT) ----
    if (action === "token_listar") {
      // Os tokens DESTE escritório (quem atua em dois vê cada lista no seu):
      // os meus e os que EU emiti para outras pessoas (#385). Um admin não vê
      // o que outro admin emitiu.
      let lista = admin
        .from("ia_tokens")
        .select("id,nome,prefixo,escopo,expira_em,ultimo_uso,revogado_em,criado_em,usuario_id,emitido_por,dono:usuarios!ia_tokens_usuario_id_fkey(nome,email)")
        .or(`usuario_id.eq.${uid},emitido_por.eq.${uid}`);
      if (escritorioId) lista = lista.eq("escritorio_id", escritorioId);
      const { data, error } = await lista.order("criado_em", { ascending: false });
      // Falha de banco nao pode virar "voce nao tem tokens" (o card sumiria com
      // tokens ativos, que continuam valendo no MCP).
      if (error) return jsonResponse({ error: "falha ao listar tokens" }, 500);
      return jsonResponse({ tokens: data ?? [] });
    }

    // Pessoas ativas do escritório, para o admin escolher a quem emitir (#385).
    if (action === "token_membros") {
      if (!quem.perfil.permissoes.includes("ia:mcp_conceder") || !escritorioId) {
        return jsonResponse({ error: "apenas quem concede o MCP lista as pessoas" }, 403);
      }
      const { data, error } = await admin
        .from("membros")
        .select("usuario_id, papel:papeis!membros_papel_id_fkey(nome, tipo_acesso), usuario:usuarios!membros_usuario_id_fkey(nome, email)")
        .eq("escritorio_id", escritorioId)
        .eq("status", "ativo");
      if (error) return jsonResponse({ error: "falha ao listar pessoas" }, 500);
      const pessoas = ((data ?? []) as Array<Record<string, unknown>>)
        .map((m) => {
          const u = m.usuario as { nome?: string | null; email?: string | null } | null;
          const p = m.papel as { nome?: string; tipo_acesso?: string } | null;
          return { usuario_id: m.usuario_id as string, nome: u?.nome ?? null, email: u?.email ?? null, papel_nome: p?.nome ?? null, tipo_acesso: p?.tipo_acesso ?? null };
        })
        .sort((a, b) => String(a.nome ?? a.email).localeCompare(String(b.nome ?? b.email), "pt-BR"));
      return jsonResponse({ pessoas });
    }

    if (action === "token_criar") {
      // O token e o controle de acesso ao MCP: so quem tem ia:mcp_conceder
      // (admin) emite — para si ou para outra pessoa do escritorio (#385). O
      // token roda como o DONO (sessao dele, RLS dele) e o ia-mcp exige que o
      // emissor siga admin ativo no escritorio.
      if (!quem.perfil.permissoes.includes("ia:mcp_conceder")) {
        return jsonResponse({ error: "apenas administradores emitem tokens do MCP" }, 403);
      }
      const donoId = typeof body.usuario_id === "string" && body.usuario_id ? body.usuario_id : uid;
      if (donoId !== uid) {
        if (!escritorioId) return jsonResponse({ error: "sem escritório ativo" }, 400);
        const { data: vinc, error: eVinc } = await admin
          .from("membros")
          .select("status")
          .eq("escritorio_id", escritorioId)
          .eq("usuario_id", donoId)
          .maybeSingle();
        if (eVinc) return jsonResponse({ error: "falha ao conferir a pessoa" }, 500);
        if (!vinc || vinc.status !== "ativo") {
          return jsonResponse({ error: "a pessoa precisa ser membro ativo deste escritório" }, 400);
        }
      }
      const nome = String(body.nome || "").trim() || "Token";
      const escopo = body.escopo === "leitura" ? "leitura" : "completo";
      const dias = Number(body.dias);
      const expira = Number.isFinite(dias) && dias > 0
        ? new Date(Date.now() + dias * 86400000).toISOString()
        : null;
      const { token, prefixo } = generateToken();
      const token_hash = await sha256Hex(token);
      const { error } = await admin.from("ia_tokens").insert({
        usuario_id: donoId,
        emitido_por: uid,
        nome,
        token_hash,
        prefixo,
        escopo,
        expira_em: expira,
        // O token vale NESTE escritório: o ia-mcp abre a sessão do dono aqui.
        ...(escritorioId ? { escritorio_id: escritorioId } : {}),
      });
      if (error) return jsonResponse({ error: error.message }, 400);
      // O token em claro so e retornado AQUI, uma unica vez.
      return jsonResponse({ ok: true, token, prefixo });
    }

    if (action === "token_revogar") {
      const id = String(body.id || "");
      // dono ou emissor revogam
      const { error } = await admin
        .from("ia_tokens")
        .update({ revogado_em: new Date().toISOString() })
        .or(`usuario_id.eq.${uid},emitido_por.eq.${uid}`)
        .eq("id", id);
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "action desconhecida" }, 400);
  } catch (e) {
    // Nunca vaza a chave; so a mensagem do erro (truncada).
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg.slice(0, 300) }, 400);
  }
});

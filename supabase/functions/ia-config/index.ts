// =============================================================================
// Edge Function: ia-config  (Plugin de IA — cofre BYOK por usuario)
//
// Acoes (body.action):
//   - "status"  : devolve a config MASCARADA do usuario (nunca o cipher/chave).
//   - "salvar"  : cifra a api_key (AES-GCM via IA_MASTER_KEY) e faz upsert.
//   - "testar"  : faz um ping barato no provider p/ validar a chave (nao grava).
//   - "ativar"  : liga/desliga o assistente do usuario (sem reenviar a chave).
//
// Auth: JWT do usuario (Authorization: Bearer ...). Opera so sobre a PROPRIA
// linha (usuario_id = auth.uid()).
//
// Secrets: IA_MASTER_KEY (base64 32 bytes), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { encryptSecret, decryptSecret, hintFor } from "../_shared/crypto.ts";
import { chatWith, PROVIDERS } from "../_shared/ia-providers.ts";
import { generateToken, sha256Hex } from "../_shared/tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function ping(provider: string, apiKey: string, modelo: string): Promise<void> {
  await chatWith(provider, apiKey, modelo, {
    system: "Responda apenas: ok",
    messages: [{ role: "user", content: "ping" }],
    tools: [],
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: "env ausente" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ---- Autorizacao ----
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "nao autenticado" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonResponse({ error: "sessao invalida" }, 401);
  const uid = userData.user.id;

  // ---- Body ----
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  const action = String(body.action || "");

  try {
    if (action === "status") {
      const { data } = await admin
        .from("ia_integracoes")
        .select("provider,modelo,ativo,api_key_hint,atualizado_em")
        .eq("usuario_id", uid)
        .maybeSingle();
      return jsonResponse({
        configurado: !!data,
        provider: data?.provider ?? null,
        modelo: data?.modelo ?? null,
        ativo: data?.ativo ?? false,
        hint: data?.api_key_hint ?? null,
        providers_suportados: Object.fromEntries(
          Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, models: v.models }]),
        ),
      });
    }

    if (action === "testar") {
      const provider = String(body.provider || "");
      const modelo = String(body.modelo || "").trim();
      if (!PROVIDERS[provider]) return jsonResponse({ ok: false, error: "provider invalido" }, 400);
      if (!modelo) return jsonResponse({ ok: false, error: "modelo obrigatorio" }, 400);
      // Usa a chave enviada; se ausente, testa a ja salva.
      let apiKey = String(body.api_key || "").trim();
      if (!apiKey) {
        const { data } = await admin
          .from("ia_integracoes")
          .select("api_key_cipher,api_key_iv")
          .eq("usuario_id", uid)
          .maybeSingle();
        if (!data) return jsonResponse({ ok: false, error: "sem chave salva" }, 400);
        apiKey = await decryptSecret(data.api_key_cipher, data.api_key_iv);
      }
      await ping(provider, apiKey, modelo);
      return jsonResponse({ ok: true });
    }

    if (action === "salvar") {
      const provider = String(body.provider || "");
      const modelo = String(body.modelo || "").trim();
      const apiKey = String(body.api_key || "").trim();
      if (!PROVIDERS[provider]) return jsonResponse({ error: "provider invalido" }, 400);
      if (!modelo) return jsonResponse({ error: "modelo obrigatorio" }, 400);
      if (apiKey.length < 12) return jsonResponse({ error: "api_key invalida" }, 400);

      const { cipher, iv } = await encryptSecret(apiKey);
      const ativo = body.ativo === false ? false : true;
      const { error } = await admin.from("ia_integracoes").upsert(
        {
          usuario_id: uid,
          provider,
          modelo,
          api_key_cipher: cipher,
          api_key_iv: iv,
          api_key_hint: hintFor(apiKey),
          ativo,
        },
        { onConflict: "usuario_id" },
      );
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true, ativo, hint: hintFor(apiKey) });
    }

    if (action === "ativar") {
      const ativo = body.ativo === true;
      const { error } = await admin
        .from("ia_integracoes")
        .update({ ativo })
        .eq("usuario_id", uid);
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true, ativo });
    }

    // ---- Tokens da Superficie B (Claude/ChatGPT) ----
    if (action === "token_listar") {
      const { data } = await admin
        .from("ia_tokens")
        .select("id,nome,prefixo,escopo,expira_em,ultimo_uso,revogado_em,criado_em")
        .eq("usuario_id", uid)
        .order("criado_em", { ascending: false });
      return jsonResponse({ tokens: data ?? [] });
    }

    if (action === "token_criar") {
      const nome = String(body.nome || "").trim() || "Token";
      const escopo = body.escopo === "leitura" ? "leitura" : "completo";
      const dias = Number(body.dias);
      const expira = Number.isFinite(dias) && dias > 0
        ? new Date(Date.now() + dias * 86400000).toISOString()
        : null;
      const { token, prefixo } = generateToken();
      const token_hash = await sha256Hex(token);
      const { error } = await admin.from("ia_tokens").insert({
        usuario_id: uid,
        nome,
        token_hash,
        prefixo,
        escopo,
        expira_em: expira,
      });
      if (error) return jsonResponse({ error: error.message }, 400);
      // O token em claro so e retornado AQUI, uma unica vez.
      return jsonResponse({ ok: true, token, prefixo });
    }

    if (action === "token_revogar") {
      const id = String(body.id || "");
      const { error } = await admin
        .from("ia_tokens")
        .update({ revogado_em: new Date().toISOString() })
        .eq("usuario_id", uid)
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

// supabase/functions/gmail-oauth-start/index.ts
//
// Início do fluxo OAuth do Gmail. Chamada pela UI (botão "Conectar Gmail"
// em Configurações). Retorna a URL de consent do Google que o front abre
// numa janela.
//
// Estado: o `state` é assinado HMAC (IA_MASTER_KEY) com {usuario_id, nonce,
// ts} para o callback validar quem iniciou o fluxo e que não passou muito
// tempo (TTL 15min).
//
// Pré-requisitos (segredos da function):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI
//
// GMAIL_REDIRECT_URI deve estar exatamente cadastrada no Google Cloud
// (Authorized redirect URIs do OAuth client tipo "Web application"):
//   https://<project-ref>.supabase.co/functions/v1/gmail-oauth-callback

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { signPayload } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") ?? "";
const GMAIL_REDIRECT_URI = Deno.env.get("GMAIL_REDIRECT_URI") ?? "";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

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

function randomNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  let s = "";
  for (const b of arr) s += b.toString(16).padStart(2, "0");
  return s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  if (!GMAIL_CLIENT_ID || !GMAIL_REDIRECT_URI) {
    return jsonResponse({
      error: "Configuração ausente: GMAIL_CLIENT_ID / GMAIL_REDIRECT_URI nos secrets da function",
    }, 500);
  }

  // Auth do usuário chamando: extrai o JWT do header e valida com o admin
  // client. Mesmo padrão usado em convidar-parceiro/excluir-parceiro.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "não autenticado" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "sessão inválida" }, 401);
  }
  const usuarioId = userData.user.id;

  // Verifica que é interno (parceiro não conecta Gmail aqui — esse fluxo é
  // só do escritório).
  const { data: usuario } = await sb
    .from("usuarios")
    .select("tipo, ativo")
    .eq("id", usuarioId)
    .maybeSingle();
  if (!usuario || usuario.tipo !== "interno" || !usuario.ativo) {
    return jsonResponse({ error: "apenas usuários internos" }, 403);
  }

  const nonce = randomNonce();
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${usuarioId}.${nonce}.${ts}`;
  const sig = await signPayload(payload);
  const state = `${payload}.${sig}`;

  const params = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    redirect_uri: GMAIL_REDIRECT_URI,
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",      // <- garante refresh_token
    prompt: "consent",            // <- força entrega de refresh_token em re-conexão
    include_granted_scopes: "true",
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return jsonResponse({ auth_url: authUrl });
});

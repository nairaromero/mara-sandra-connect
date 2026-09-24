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
import { exigirUsuario } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") ?? "";
const GMAIL_REDIRECT_URI = Deno.env.get("GMAIL_REDIRECT_URI") ?? "";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-escritorio-id",
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

  // Checagem no topo: antes ela vinha depois das variáveis de ambiente e do corpo, então a função respondia (400/500, e até 200) sem saber quem chamou. `exigirUsuario` também confere `ativo`, que faltava aqui.
  // Conectar a caixa do INSS é configurar integração do escritório: só quem
  // gerencia integrações (admin). O escritório ativo vai no state — a caixa é
  // DELE, não da pessoa.
  const quem = await exigirUsuario(req, { tipo: "interno", permissao: "integracoes:gerenciar" });
  if (quem instanceof Response) return quem;

  if (!GMAIL_CLIENT_ID || !GMAIL_REDIRECT_URI) {
    return jsonResponse({
      error: "Configuração ausente: GMAIL_CLIENT_ID / GMAIL_REDIRECT_URI nos secrets da function",
    }, 500);
  }

  const sb = quem.admin;
  const usuarioId = quem.uid;

  const escritorioId = quem.perfil.escritorio_id;
  if (!escritorioId) return jsonResponse({ error: "sem escritório ativo" }, 400);

  const nonce = randomNonce();
  const ts = Math.floor(Date.now() / 1000);
  // state = usuario.escritorio.nonce.ts.sig (o callback aceita o formato antigo de 4 partes)
  const payload = `${usuarioId}.${escritorioId}.${nonce}.${ts}`;
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

  // GOOGLE_OAUTH_AUTH_URL so existe no ambiente LOCAL (mock); fora dele e o Google.
  const authBase = Deno.env.get("GOOGLE_OAUTH_AUTH_URL") ?? "https://accounts.google.com/o/oauth2/v2/auth";
  const authUrl = `${authBase}?${params.toString()}`;
  return jsonResponse({ auth_url: authUrl });
});

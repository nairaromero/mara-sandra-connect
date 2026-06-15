// supabase/functions/gmail-oauth-callback/index.ts
//
// Recebe o redirect do Google após consent. Valida o `state` (HMAC + TTL),
// troca `code` por tokens, cifra o refresh_token e faz upsert em
// usuario_gmail_oauth. Por fim, redireciona o navegador de volta para
// Configurações com `?gmail=ok` (ou `?gmail=error&motivo=...`).
//
// Tem que ser GET (Google faz redirect com query params, não POST).
//
// Pré-requisitos: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI,
// APP_BASE_URL (ex: https://app.marasandraconnect.com.br), IA_MASTER_KEY.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { encryptSecret, verifyPayload } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") ?? "";
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") ?? "";
const GMAIL_REDIRECT_URI = Deno.env.get("GMAIL_REDIRECT_URI") ?? "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "";
const STATE_TTL_SECONDS = 15 * 60;

function redirectBack(motivo: "ok" | "error", detalhe?: string): Response {
  const base = APP_BASE_URL || "/";
  const url = new URL("/configuracoes", base);
  url.searchParams.set("gmail", motivo);
  if (detalhe) url.searchParams.set("motivo", detalhe);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString() },
  });
}

serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return redirectBack("error", `google:${oauthError}`);
  if (!code || !state) return redirectBack("error", "params_faltando");

  // Valida state = usuario_id.nonce.ts.sig
  const parts = state.split(".");
  if (parts.length !== 4) return redirectBack("error", "state_malformado");
  const [usuarioId, nonce, tsStr, sig] = parts;
  const payload = `${usuarioId}.${nonce}.${tsStr}`;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return redirectBack("error", "state_ts_invalido");

  const agora = Math.floor(Date.now() / 1000);
  if (agora - ts > STATE_TTL_SECONDS) return redirectBack("error", "state_expirado");

  const sigOk = await verifyPayload(payload, sig);
  if (!sigOk) return redirectBack("error", "state_assinatura_invalida");

  // Troca o code por tokens.
  const body = new URLSearchParams({
    code,
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    redirect_uri: GMAIL_REDIRECT_URI,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("Token exchange falhou:", r.status, txt);
    return redirectBack("error", "token_exchange_falhou");
  }
  const tok = await r.json() as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (!tok.refresh_token) {
    // Pode acontecer se a usuária já tinha conectado antes e Google não
    // reenviou o refresh_token. O `prompt=consent` em gmail-oauth-start
    // mitiga, mas defendemos aqui também.
    return redirectBack("error", "sem_refresh_token");
  }

  // Descobre qual e-mail conectou (chama userinfo).
  let emailConectado = "";
  try {
    const ui = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (ui.ok) {
      const uij = await ui.json() as { email?: string };
      emailConectado = uij.email ?? "";
    }
  } catch (_) { /* sem email é OK; segue */ }

  // Cifra o refresh_token com a master key.
  const { cipher, iv } = await encryptSecret(tok.refresh_token);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { error: upsertErr } = await sb
    .from("usuario_gmail_oauth")
    .upsert({
      usuario_id: usuarioId,
      email_conectado: emailConectado || "(desconhecido)",
      refresh_cipher: cipher,
      refresh_iv: iv,
      scope: tok.scope ?? "https://www.googleapis.com/auth/gmail.readonly",
      connected_at: new Date().toISOString(),
    });
  if (upsertErr) {
    console.error("Upsert gmail oauth falhou:", upsertErr);
    return redirectBack("error", "db_upsert_falhou");
  }

  return redirectBack("ok");
});

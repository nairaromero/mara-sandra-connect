// supabase/functions/gmail-oauth-callback/index.ts
//
// Recebe o redirect do Google após consent. Valida o `state` (HMAC + TTL),
// troca `code` por tokens, cifra o refresh_token e faz upsert em
// usuario_gmail_oauth (uma linha por caixa; o escritório pode ter várias). Por fim, redireciona o navegador de volta para
// Configurações com `?gmail=ok` (ou `?gmail=error&motivo=...`).
//
// Tem que ser GET (Google faz redirect com query params, não POST).
//
// Pré-requisitos: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI,
// APP_BASE_URL (ex: https://app.marasandraconnect.com.br), IA_MASTER_KEY.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { encryptSecret, verifyPayload } from "../_shared/crypto.ts";
import { fetchT } from "../_shared/auth.ts";
import { auditarVerificado } from "../_shared/auditoria.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") ?? "";
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") ?? "";
const GMAIL_REDIRECT_URI = Deno.env.get("GMAIL_REDIRECT_URI") ?? "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "";
const STATE_TTL_SECONDS = 15 * 60;
// Sobrescritos so no ambiente LOCAL (mock de e2e/demo/mocks); fora dele, Google.
const GOOGLE_TOKEN_URL = Deno.env.get("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = (Deno.env.get("GMAIL_API_BASE") ?? "https://gmail.googleapis.com/gmail/v1").replace(/\/+$/, "");

function redirectBack(motivo: "ok" | "error", detalhe?: string): Response {
  const base = APP_BASE_URL || "/";
  const url = new URL("/configuracoes", base);
  // Configuracoes tem abas desde 2026-09-14: sem `tab` a pessoa caia no Perfil,
  // longe do card do Gmail (e do toast de resultado).
  url.searchParams.set("tab", "integracoes");
  // No catálogo de integrações a linha fechada não monta o card — e é o card
  // que lê `gmail=` e diz se conectou ou por que falhou. Sem `abrir`, a pessoa
  // voltava do Google para uma lista fechada, sem resposta nenhuma.
  url.searchParams.set("abrir", "gmail");
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

  // Valida state = usuario_id.escritorio_id.nonce.ts.sig (ou o antigo, sem
  // escritório: cai no escritório padrão).
  const parts = state.split(".");
  if (parts.length !== 4 && parts.length !== 5) return redirectBack("error", "state_malformado");
  const [usuarioId, escritorioNoState, nonce, tsStr, sig] = parts.length === 5
    ? parts
    : [parts[0], null, parts[1], parts[2], parts[3]];
  const payload = parts.length === 5
    ? `${usuarioId}.${escritorioNoState}.${nonce}.${tsStr}`
    : `${usuarioId}.${nonce}.${tsStr}`;
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
  const r = await fetchT(GOOGLE_TOKEN_URL, {
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

  // Descobre qual e-mail conectou.
  //
  // Usa o profile do PRÓPRIO Gmail, não o `userinfo` do Google: userinfo exige
  // o escopo `userinfo.email`, que a gente não pede — o resultado era gravar
  // "(desconhecido)" e o processador não achar mais a conexão depois.
  // O profile do Gmail responde com o escopo `gmail.readonly`, que já temos.
  let emailConectado = "";
  try {
    const pr = await fetchT(
      `${GMAIL_API_BASE}/users/me/profile`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } },
    );
    if (pr.ok) {
      const prj = await pr.json() as { emailAddress?: string };
      emailConectado = prj.emailAddress ?? "";
    }
  } catch (_) { /* segue; o fallback abaixo cobre */ }
  // Reserva: userinfo, caso o escopo de e-mail tenha sido concedido.
  if (!emailConectado) {
    try {
      const ui = await fetchT("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (ui.ok) {
        const uij = await ui.json() as { email?: string };
        emailConectado = uij.email ?? "";
      }
    } catch (_) { /* sem email é OK; segue */ }
  }

  // Sem saber QUAL caixa é, não grava: a linha é única por (escritório, e-mail),
  // e duas caixas "(desconhecido)" no mesmo escritório trocariam a credencial
  // uma da outra em silêncio.
  emailConectado = emailConectado.trim().toLowerCase();
  if (!emailConectado.includes("@")) return redirectBack("error", "email_nao_identificado");

  // Cifra o refresh_token com a master key.
  const { cipher, iv } = await encryptSecret(tok.refresh_token);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let escritorioId = escritorioNoState;
  if (!escritorioId) {
    const { data: padrao } = await sb.from("escritorios").select("id").eq("padrao_sistema", true).maybeSingle();
    escritorioId = (padrao?.id as string | undefined) ?? null;
  }
  if (!escritorioId) return redirectBack("error", "sem_escritorio");

  // A linha é a CAIXA: única por (escritório, e-mail). Conectar de novo a
  // mesma caixa troca a credencial dela; outra caixa vira outra linha — o
  // escritório pode ter várias (migration_gmail_inss_varias_caixas).
  const { error: upsertErr } = await sb
    .from("usuario_gmail_oauth")
    .upsert({
      usuario_id: usuarioId,
      escritorio_id: escritorioId,
      email_conectado: emailConectado,
      refresh_cipher: cipher,
      refresh_iv: iv,
      scope: tok.scope ?? "https://www.googleapis.com/auth/gmail.readonly",
      connected_at: new Date().toISOString(),
      // reconectar é o conserto da caixa que tinha parado de ser lida
      ultimo_erro: null,
      ultimo_erro_em: null,
    }, { onConflict: "escritorio_id,email_conectado" });
  if (upsertErr) {
    console.error("Upsert gmail oauth falhou:", upsertErr);
    return redirectBack("error", "db_upsert_falhou");
  }

  // Quem ligou a leitura de qual caixa: pessoa e escritório vêm do `state`
  // assinado, conferido lá em cima.
  await auditarVerificado(sb, { usuarioId, escritorioId }, {
    acao: "integracao.caixa_conectada", recurso: "usuario_gmail_oauth", detalhes: { caixa: emailConectado },
  });

  return redirectBack("ok");
});

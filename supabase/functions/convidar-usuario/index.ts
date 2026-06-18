// supabase/functions/convidar-usuario/index.ts
//
// Cria um usuario (interno OU parceiro) e envia o link de acesso via API admin
// (admin.inviteUserByEmail). Nao mexe na sessao do interno logado. Cria a linha
// em public.usuarios explicitamente (NAO existe trigger auth.users->usuarios).
//
//   - tipo='interno': onboarded_em=now() (pula o fluxo de boas-vindas do
//     parceiro), oab opcional.
//   - tipo='parceiro': onboarded_em=NULL (passa por /boas-vindas).
//
// Body: { nome, email, tipo: 'interno'|'parceiro', oab?, telefone?, observacoes?, redirect_to? }
// Auth: JWT de usuario interno.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ---- Autorizacao: precisa ser usuario interno ----
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "nao autenticado" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "sessao invalida" }, 401);
  }
  const { data: perfil } = await admin
    .from("usuarios")
    .select("tipo")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (perfil?.tipo !== "interno") {
    return jsonResponse({ error: "apenas usuarios internos podem convidar" }, 403);
  }

  // ---- Body ----
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  const nome = String(body.nome || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const tipo = body.tipo === "interno" ? "interno" : "parceiro";
  const oab = String(body.oab || "").trim();
  const telefone = String(body.telefone || "").trim();
  const observacoes = body.observacoes ? String(body.observacoes).trim() : null;
  const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;
  const percentualRaw = body.percentual_parceiro ?? body.percentual;
  const percentual =
    percentualRaw === null || percentualRaw === undefined || percentualRaw === ""
      ? null
      : Number(percentualRaw);

  if (nome.length < 3) return jsonResponse({ error: "nome obrigatorio" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return jsonResponse({ error: "email invalido" }, 400);
  }

  // ---- Convite via admin API ----
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      nome,
      oab,
      telefone,
      tipo,
      observacoes_iniciais: observacoes,
    },
    redirectTo,
  });

  if (error) {
    const msg = error.message || "";
    if (/already.*regist|already.*exist/i.test(msg)) {
      const { data: existente } = await admin
        .from("usuarios")
        .select("id, nome, email, tipo")
        .eq("email", email)
        .maybeSingle();
      if (existente?.id) {
        return jsonResponse({
          ok: true,
          ja_existia: true,
          id: existente.id,
          nome: existente.nome,
          email: existente.email,
          tipo: existente.tipo,
        });
      }
    }
    return jsonResponse({ error: "erro ao convidar: " + msg }, 400);
  }

  // Cria/atualiza a linha em usuarios (nao ha trigger).
  const newId = data.user?.id || null;
  if (newId) {
    const { error: upErr } = await admin.from("usuarios").upsert(
      {
        id: newId,
        nome,
        email,
        oab: oab || null,
        telefone: telefone || null,
        tipo,
        ativo: true,
        percentual_parceiro: tipo === "parceiro" ? percentual : null,
        // interno ja entra "onboarded" (boas-vindas e fluxo do parceiro).
        onboarded_em: tipo === "interno" ? new Date().toISOString() : null,
      },
      { onConflict: "id" },
    );
    if (upErr) {
      return jsonResponse({
        ok: false,
        id: newId,
        error: "Convite enviado, mas falha ao criar o perfil: " + upErr.message,
      });
    }
  }

  return jsonResponse({ ok: true, id: newId, nome, email, tipo });
});

// supabase/functions/update-parceiro/index.ts
//
// Permite que interno edite os dados de um parceiro (nome, email, OAB,
// telefone) e, quando o email muda, dispare um novo magic link pro novo
// endereco. Util pra:
//   - Testar com naira+nome@gmail.com agora e trocar pro email real depois.
//   - Corrigir typo no email ao convidar parceiro.
//   - Atualizar dados quando o parceiro mudou contato.
//
// Como funciona:
//   1) Valida que o caller eh interno (via JWT do Authorization).
//   2) Usa service role pra alterar auth.users.email via admin.updateUserById
//      (com email_confirm: true pra nao precisar verificar email antigo).
//   3) Atualiza public.usuarios.
//   4) Se email mudou e flag enviar_link=true: chama signInWithOtp pra enviar
//      magic link pro novo endereco (via Resend SMTP configurado).
//
// Chamada do frontend:
//   await supabase.functions.invoke("update-parceiro", {
//     body: {
//       usuario_id: "<uuid>",
//       nome: "...",
//       email: "...",
//       oab: "...",
//       telefone: "...",
//       enviar_link: true   // opcional, default true se email mudou
//     }
//   });
//
// Secrets necessarios:
//   - SUPABASE_URL (automatico)
//   - SUPABASE_SERVICE_ROLE_KEY (automatico)
//   - APP_BASE_URL (do convite original)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ||
  "https://marasandraconnect.com";

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

  // ---------------------------------------------------------------------------
  // 1) Valida JWT do caller e que eh interno
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return jsonResponse({ error: "sem authorization header" }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Decodifica JWT pra pegar user_id
  const { data: userResp, error: userErr } = await supabaseAdmin.auth.getUser(
    jwt,
  );
  if (userErr || !userResp.user) {
    return jsonResponse({ error: "jwt invalido" }, 401);
  }
  const callerId = userResp.user.id;

  // Confirma que caller eh interno
  const { data: caller, error: callerErr } = await supabaseAdmin
    .from("usuarios")
    .select("tipo")
    .eq("id", callerId)
    .maybeSingle();
  if (callerErr) {
    return jsonResponse(
      { error: "erro ao verificar tipo do caller", detail: callerErr.message },
      500,
    );
  }
  if (!caller || (caller as { tipo: string }).tipo !== "interno") {
    return jsonResponse(
      { error: "apenas usuarios internos podem editar parceiros" },
      403,
    );
  }

  // ---------------------------------------------------------------------------
  // 2) Parse body
  // ---------------------------------------------------------------------------
  let body: {
    usuario_id?: string;
    nome?: string;
    email?: string;
    oab?: string;
    telefone?: string;
    enviar_link?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  const usuarioId = String(body.usuario_id || "").trim();
  if (!usuarioId) {
    return jsonResponse({ error: "usuario_id obrigatorio" }, 400);
  }

  // Busca estado atual pra comparar
  const { data: atual, error: atualErr } = await supabaseAdmin
    .from("usuarios")
    .select("id, nome, email, oab, telefone, tipo")
    .eq("id", usuarioId)
    .maybeSingle();
  if (atualErr || !atual) {
    return jsonResponse({ error: "parceiro nao encontrado" }, 404);
  }
  const a = atual as {
    id: string;
    nome: string | null;
    email: string | null;
    oab: string | null;
    telefone: string | null;
    tipo: string;
  };
  if (a.tipo !== "parceiro") {
    return jsonResponse(
      { error: "este endpoint so edita parceiros" },
      400,
    );
  }

  const novoNome = body.nome !== undefined ? String(body.nome).trim() : a.nome;
  const novoEmail = body.email !== undefined
    ? String(body.email).trim().toLowerCase()
    : a.email;
  const novoOab = body.oab !== undefined ? String(body.oab).trim() : a.oab;
  const novoTelefone = body.telefone !== undefined
    ? String(body.telefone).trim()
    : a.telefone;

  const emailMudou = novoEmail !== a.email;
  const enviarLink = emailMudou && (body.enviar_link !== false);

  // ---------------------------------------------------------------------------
  // 3) Se email mudou, atualiza auth.users via admin
  // ---------------------------------------------------------------------------
  if (emailMudou) {
    if (!novoEmail) {
      return jsonResponse({ error: "novo email vazio" }, 400);
    }
    const updResp = await supabaseAdmin.auth.admin.updateUserById(usuarioId, {
      email: novoEmail,
      email_confirm: true, // pula confirmacao do email antigo
    });
    if (updResp.error) {
      return jsonResponse(
        {
          error: "erro ao atualizar auth.users",
          detail: updResp.error.message,
        },
        500,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 4) Atualiza public.usuarios
  // ---------------------------------------------------------------------------
  const upUsr = await supabaseAdmin
    .from("usuarios")
    .update({
      nome: novoNome,
      email: novoEmail,
      oab: novoOab,
      telefone: novoTelefone,
    })
    .eq("id", usuarioId);
  if (upUsr.error) {
    return jsonResponse(
      { error: "erro ao atualizar usuarios", detail: upUsr.error.message },
      500,
    );
  }

  // ---------------------------------------------------------------------------
  // 5) Se email mudou e enviar_link=true: dispara novo magic link
  // ---------------------------------------------------------------------------
  let linkEnviado = false;
  if (enviarLink && novoEmail) {
    // signInWithOtp envia magic link via SMTP configurado (Resend).
    // Como usamos service role, o cliente nao tem sessao - signInWithOtp
    // funciona normal porque so dispara o email.
    const otp = await supabaseAdmin.auth.signInWithOtp({
      email: novoEmail,
      options: {
        shouldCreateUser: false, // usuario ja existe
        emailRedirectTo: `${APP_BASE_URL}/login`,
      },
    });
    if (otp.error) {
      return jsonResponse({
        atualizado: true,
        link_enviado: false,
        warning: "Dados salvos mas magic link falhou: " + otp.error.message,
      });
    }
    linkEnviado = true;
  }

  return jsonResponse({
    atualizado: true,
    email_mudou: emailMudou,
    link_enviado: linkEnviado,
    usuario: {
      id: usuarioId,
      nome: novoNome,
      email: novoEmail,
      oab: novoOab,
      telefone: novoTelefone,
    },
  });
});

// supabase/functions/notify-novo-comentario/index.ts
//
// Envia email quando um comentario novo (top-level ou reply) eh criado em
// um caso. Disparada do frontend (fire-and-forget) apos INSERT em
// public.comentarios.
//
// Regras de destinatario:
//   - Autor = interno  -> manda pro parceiro do caso (se houver)
//   - Autor = parceiro -> manda pra TODOS os usuarios.tipo='interno'
//                         com usuarios.ativo=true (equipe pequena, simples)
//
// Chamada do frontend:
//   await supabase.functions.invoke("notify-novo-comentario", {
//     body: { comentario_id: "<uuid>" }
//   });
//
// Secrets necessarios no Supabase Edge Functions:
//   - RESEND_API_KEY
//   - APP_BASE_URL
//   - SUPABASE_URL (automatico)
//   - SUPABASE_SERVICE_ROLE_KEY (automatico)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ||
  "https://marasandraconnect.com";

const FROM_EMAIL = "Mara Sandra Advocacia <noreply@marasandraconnect.com>";

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3).trimEnd() + "...";
}

function renderEmail(opts: {
  destinatarioNome: string;
  autorNome: string;
  autorTipo: string;
  clienteNome: string;
  texto: string;
  ehReply: boolean;
  linkCaso: string;
}): { html: string; text: string } {
  const {
    destinatarioNome,
    autorNome,
    autorTipo,
    clienteNome,
    texto,
    ehReply,
    linkCaso,
  } = opts;
  const acao = ehReply ? "respondeu" : "comentou";
  const tipoLabel = autorTipo === "interno" ? "Equipe interna" : "Parceiro";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Novo comentario</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:24px 24px 0 24px;">
              <h1 style="margin:0 0 4px 0;font-size:18px;font-weight:600;color:#111827;">Mara Sandra Advocacia</h1>
              <p style="margin:0;font-size:13px;color:#6b7280;">Plataforma Mara Sandra Connect</p>
            </td>
          </tr>
          <tr><td style="padding:0 24px;"><hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0;"/></td></tr>
          <tr>
            <td style="padding:0 24px;">
              <p style="margin:0 0 12px 0;font-size:15px;">Ola, <strong>${
    escapeHtml(destinatarioNome)
  }</strong>.</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;">
                <strong>${escapeHtml(autorNome)}</strong> ${acao} no caso de
                <strong>${escapeHtml(clienteNome)}</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-left:3px solid #c9a14a;border-radius:4px;padding:12px 16px;margin:0 0 20px 0;width:100%;">
                <tr>
                  <td style="font-size:12px;color:#6b7280;padding:0 0 6px 0;">${
    escapeHtml(tipoLabel)
  }</td>
                </tr>
                <tr>
                  <td style="font-size:14px;line-height:1.5;color:#1f2937;white-space:pre-wrap;">${
    escapeHtml(truncate(texto, 600))
  }</td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;">Responda direto na plataforma:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;">
                <tr>
                  <td bgcolor="#1f2937" style="border-radius:6px;">
                    <a href="${linkCaso}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Abrir caso e responder</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">Caso o botao nao funcione, copie e cole este endereco:</p>
              <p style="margin:0 0 24px 0;font-size:12px;color:#3b82f6;word-break:break-all;">${linkCaso}</p>
            </td>
          </tr>
          <tr><td style="padding:0 24px;"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0;"/></td></tr>
          <tr>
            <td style="padding:16px 24px 24px 24px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                Este email foi enviado automaticamente. Nao responda direto - use a plataforma.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Ola, ${destinatarioNome}.`,
    "",
    `${autorNome} ${acao} no caso de ${clienteNome}.`,
    "",
    `[${tipoLabel}]`,
    truncate(texto, 600),
    "",
    "Responda direto na plataforma:",
    linkCaso,
    "",
    "--",
    "Mara Sandra Advocacia",
  ].join("\n");

  return { html, text };
}

interface Destinatario {
  nome: string;
  email: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!RESEND_API_KEY) {
    return jsonResponse({ error: "RESEND_API_KEY nao configurado" }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let comentarioId: string;
  try {
    const body = await req.json();
    comentarioId = String(body.comentario_id || "");
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  if (!comentarioId) {
    return jsonResponse({ error: "comentario_id obrigatorio" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) Busca o comentario + caso + cliente + autor
  const { data: comentario, error } = await supabase
    .from("comentarios")
    .select(
      "id, texto, parent_id, caso_id, casos:caso_id(id, parceiro_id, clientes:cliente_id(nome), usuarios_parceiro:parceiro_id(id, nome, email)), autor:autor_id(id, nome, email, tipo)",
    )
    .eq("id", comentarioId)
    .maybeSingle();

  if (error) {
    return jsonResponse(
      { error: "erro ao buscar comentario", detail: error.message },
      500,
    );
  }
  if (!comentario) {
    return jsonResponse({ error: "comentario nao encontrado" }, 404);
  }

  const c = comentario as unknown as {
    id: string;
    texto: string;
    parent_id: string | null;
    caso_id: string;
    casos: {
      id: string;
      parceiro_id: string | null;
      clientes: { nome: string } | null;
      usuarios_parceiro:
        | { id: string; nome: string | null; email: string | null }
        | null;
    } | null;
    autor: {
      id: string;
      nome: string | null;
      email: string | null;
      tipo: string;
    } | null;
  };

  if (!c.autor || !c.casos) {
    return jsonResponse({
      enviado: false,
      motivo: "autor ou caso ausente (dado inconsistente)",
    });
  }

  const autorTipo = c.autor.tipo;
  const autorNome = c.autor.nome || c.autor.email || "(autor sem nome)";
  const clienteNome = c.casos.clientes
    ? c.casos.clientes.nome
    : "(cliente sem nome)";
  const linkCaso = `${APP_BASE_URL}/casos/${c.casos.id}`;
  const ehReply = c.parent_id !== null;

  // 2) Descobre destinatarios conforme tipo do autor
  const destinatarios: Destinatario[] = [];

  if (autorTipo === "interno") {
    // Manda pro parceiro do caso
    if (!c.casos.parceiro_id || !c.casos.usuarios_parceiro) {
      return jsonResponse({
        enviado: false,
        motivo: "caso sem parceiro (sem destinatario)",
      });
    }
    if (!c.casos.usuarios_parceiro.email) {
      return jsonResponse({
        enviado: false,
        motivo: "parceiro sem email",
      });
    }
    destinatarios.push({
      nome: c.casos.usuarios_parceiro.nome ||
        c.casos.usuarios_parceiro.email,
      email: c.casos.usuarios_parceiro.email,
    });
  } else if (autorTipo === "parceiro") {
    // Manda pra todos internos ativos
    const { data: internos, error: intErr } = await supabase
      .from("usuarios")
      .select("nome, email")
      .eq("tipo", "interno")
      .eq("ativo", true);
    if (intErr) {
      return jsonResponse(
        { error: "erro ao listar internos", detail: intErr.message },
        500,
      );
    }
    if (!internos || internos.length === 0) {
      return jsonResponse({
        enviado: false,
        motivo: "nenhum interno ativo pra notificar",
      });
    }
    for (const u of internos) {
      const usr = u as { nome: string | null; email: string | null };
      if (usr.email) {
        destinatarios.push({
          nome: usr.nome || usr.email,
          email: usr.email,
        });
      }
    }
  } else {
    return jsonResponse({
      enviado: false,
      motivo: "tipo de autor desconhecido",
    });
  }

  // 3) Envia email pra cada destinatario
  const resultados: Array<{ email: string; ok: boolean; detail?: string }> = [];
  for (const dest of destinatarios) {
    const { html, text } = renderEmail({
      destinatarioNome: dest.nome,
      autorNome,
      autorTipo,
      clienteNome,
      texto: c.texto,
      ehReply,
      linkCaso,
    });

    const subject = ehReply
      ? `Nova resposta em comentario - ${clienteNome}`
      : `Novo comentario - ${clienteNome}`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: dest.email,
        subject,
        html,
        text,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      resultados.push({ email: dest.email, ok: false, detail });
    } else {
      resultados.push({ email: dest.email, ok: true });
    }
  }

  const algumOk = resultados.some((r) => r.ok);
  return jsonResponse({
    enviado: algumOk,
    total: resultados.length,
    sucesso: resultados.filter((r) => r.ok).length,
    resultados,
  });
});

// supabase/functions/notify-novo-andamento/index.ts
//
// Envia email ao parceiro quando um andamento novo eh adicionado ao caso.
// Disparada do frontend (fire-and-forget) apos INSERT em public.andamentos.
//
// Regras de envio:
//   - SO envia se andamento.visivel_parceiro=true
//   - SO envia se caso tem parceiro_id e parceiro tem email
//   - Conteudo do andamento (titulo + descricao) vai no corpo do email
//
// Chamada do frontend:
//   await supabase.functions.invoke("notify-novo-andamento", {
//     body: { andamento_id: "<uuid>" }
//   });
//
// Secrets necessarios:
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

function formatData(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const ORIGEM_LABEL: Record<string, string> = {
  interno: "Equipe interna",
  tramitacao: "Tramitacao Inteligente",
  legalmail: "Legalmail",
  sistema: "Sistema",
};

function renderEmail(opts: {
  parceiroNome: string;
  clienteNome: string;
  titulo: string;
  descricao: string | null;
  dataEvento: string;
  origemLabel: string;
  linkCaso: string;
}): { html: string; text: string } {
  const {
    parceiroNome,
    clienteNome,
    titulo,
    descricao,
    dataEvento,
    origemLabel,
    linkCaso,
  } = opts;
  const desc = descricao ? escapeHtml(descricao) : null;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Novo andamento</title>
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
    escapeHtml(parceiroNome)
  }</strong>.</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;">Ha um novo andamento no caso de <strong>${
    escapeHtml(clienteNome)
  }</strong>:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-left:3px solid #c9a14a;border-radius:6px;margin:0 0 20px 0;width:100%;">
                <tr>
                  <td style="padding:14px 16px 6px 16px;">
                    <p style="margin:0 0 4px 0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">${
    escapeHtml(origemLabel)
  } - ${escapeHtml(formatData(dataEvento))}</p>
                    <p style="margin:0;font-size:16px;font-weight:600;color:#111827;">${
    escapeHtml(titulo)
  }</p>
                  </td>
                </tr>
                ${
    desc
      ? `<tr>
                  <td style="padding:8px 16px 14px 16px;">
                    <p style="margin:0;font-size:14px;line-height:1.5;color:#1f2937;white-space:pre-wrap;">${desc}</p>
                  </td>
                </tr>`
      : ""
  }
              </table>
              <p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;">Veja a timeline completa do caso na plataforma:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;">
                <tr>
                  <td bgcolor="#1f2937" style="border-radius:6px;">
                    <a href="${linkCaso}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Abrir caso</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">Caso o botao nao funcione:</p>
              <p style="margin:0 0 24px 0;font-size:12px;color:#3b82f6;word-break:break-all;">${linkCaso}</p>
            </td>
          </tr>
          <tr><td style="padding:0 24px;"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0;"/></td></tr>
          <tr>
            <td style="padding:16px 24px 24px 24px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                Este email foi enviado automaticamente.
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
    `Ola, ${parceiroNome}.`,
    "",
    `Ha um novo andamento no caso de ${clienteNome}:`,
    "",
    `[${origemLabel} - ${formatData(dataEvento)}]`,
    titulo,
    desc ? "" : "",
    desc ? descricao : "",
    "",
    "Veja a timeline completa na plataforma:",
    linkCaso,
    "",
    "--",
    "Mara Sandra Advocacia",
  ].filter((line) => line !== "").join("\n");

  return { html, text };
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

  let andamentoId: string;
  try {
    const body = await req.json();
    andamentoId = String(body.andamento_id || "");
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  if (!andamentoId) {
    return jsonResponse({ error: "andamento_id obrigatorio" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data, error } = await supabase
    .from("andamentos")
    .select(
      "id, titulo, descricao, data_evento, origem, visivel_parceiro, casos:caso_id(id, parceiro_id, clientes:cliente_id(nome), usuarios_parceiro:parceiro_id(id, nome, email))",
    )
    .eq("id", andamentoId)
    .maybeSingle();

  if (error) {
    return jsonResponse(
      { error: "erro ao buscar andamento", detail: error.message },
      500,
    );
  }
  if (!data) {
    return jsonResponse({ error: "andamento nao encontrado" }, 404);
  }

  const a = data as unknown as {
    id: string;
    titulo: string;
    descricao: string | null;
    data_evento: string;
    origem: string;
    visivel_parceiro: boolean;
    casos: {
      id: string;
      parceiro_id: string | null;
      clientes: { nome: string } | null;
      usuarios_parceiro:
        | { id: string; nome: string | null; email: string | null }
        | null;
    } | null;
  };

  if (!a.visivel_parceiro) {
    return jsonResponse({
      enviado: false,
      motivo: "andamento nao visivel ao parceiro",
    });
  }
  if (!a.casos || !a.casos.parceiro_id || !a.casos.usuarios_parceiro) {
    return jsonResponse({
      enviado: false,
      motivo: "caso sem parceiro vinculado",
    });
  }
  if (!a.casos.usuarios_parceiro.email) {
    return jsonResponse({
      enviado: false,
      motivo: "parceiro sem email",
    });
  }

  const parceiroNome = a.casos.usuarios_parceiro.nome ||
    a.casos.usuarios_parceiro.email;
  const parceiroEmail = a.casos.usuarios_parceiro.email;
  const clienteNome = a.casos.clientes
    ? a.casos.clientes.nome
    : "(cliente sem nome)";
  const origemLabel = ORIGEM_LABEL[a.origem] || a.origem;
  const linkCaso = `${APP_BASE_URL}/casos/${a.casos.id}`;

  const { html, text } = renderEmail({
    parceiroNome,
    clienteNome,
    titulo: a.titulo,
    descricao: a.descricao,
    dataEvento: a.data_evento,
    origemLabel,
    linkCaso,
  });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: parceiroEmail,
      subject: `Novo andamento - ${a.titulo} - ${clienteNome}`,
      html,
      text,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    return jsonResponse(
      { error: "erro ao enviar email", status: resp.status, detail },
      502,
    );
  }

  const result = await resp.json();
  return jsonResponse({
    enviado: true,
    to: parceiroEmail,
    resend_id: result.id || null,
  });
});

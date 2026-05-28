// supabase/functions/notify-solicitacao-doc/index.ts
//
// Envia email ao parceiro quando o interno cria uma solicitacao de documento.
// Disparada do frontend (fire-and-forget) apos INSERT bem-sucedido em
// public.solicitacoes_documento.
//
// Regras:
//   - Envia apenas se origem='externa' (solicitacao destinada ao parceiro/cliente)
//   - Envia apenas se o caso tiver parceiro_id (sem parceiro, nao tem destinatario)
//
// Chamada do frontend:
//   await supabase.functions.invoke("notify-solicitacao-doc", {
//     body: { solicitacao_id: "<uuid>" }
//   });
//
// Secrets necessarios no Supabase Edge Functions:
//   - RESEND_API_KEY  (api key do Resend, formato "re_...")
//   - APP_BASE_URL    (base url do app, ex.: "https://mara-sandra-connect.nairaromerovian.workers.dev")
//   - SUPABASE_URL    (automatico)
//   - SUPABASE_SERVICE_ROLE_KEY (automatico)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ||
  "https://mara-sandra-connect.nairaromerovian.workers.dev";

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

// Mesma tabela de labels do frontend, em sincronia.
const TIPOS_DOC_LABEL: Record<string, string> = {
  cnis: "CNIS",
  rg_cpf: "RG / CPF",
  comprovante_residencia: "Comprovante de residencia",
  ctps: "CTPS",
  holerite: "Holerite / Contracheque",
  ppp: "PPP",
  laudo_medico: "Laudo medico",
  ltcat: "LTCAT",
  certidao_nascimento: "Certidao de nascimento",
  certidao_casamento: "Certidao de casamento",
  certidao_obito: "Certidao de obito",
  certidao_militar: "Certificado militar",
  cat: "CAT",
  hiscre: "HISCRE",
  receituario: "Receituario medico",
  exame: "Exame medico",
  ficha_atendimento: "Ficha de atendimento",
  comprovante_pagamento: "Comprovante de pagamento",
  procuracao: "Procuracao",
  contrato: "Contrato",
  declaracao: "Declaracao",
  outro: "Outro",
};

// Sanitiza texto para HTML (evita XSS basico no template)
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderEmail(opts: {
  parceiroNome: string;
  clienteNome: string;
  tipoLabel: string;
  descricao: string | null;
  linkCaso: string;
}): { html: string; text: string } {
  const { parceiroNome, clienteNome, tipoLabel, descricao, linkCaso } = opts;
  const desc = descricao ? escapeHtml(descricao) : null;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Nova solicitacao de documento</title>
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
              <p style="margin:0 0 12px 0;font-size:15px;">Ola, <strong>${escapeHtml(parceiroNome)}</strong>.</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;">Voce tem uma nova solicitacao de documento para o caso de <strong>${escapeHtml(clienteNome)}</strong>.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin:0 0 20px 0;width:100%;">
                <tr>
                  <td style="padding:8px 12px;font-size:13px;color:#6b7280;width:140px;">Documento solicitado:</td>
                  <td style="padding:8px 12px;font-size:14px;font-weight:500;">${escapeHtml(tipoLabel)}</td>
                </tr>
                ${
    desc
      ? `<tr>
                  <td style="padding:8px 12px;font-size:13px;color:#6b7280;vertical-align:top;">Observacao:</td>
                  <td style="padding:8px 12px;font-size:14px;white-space:pre-wrap;">${desc}</td>
                </tr>`
      : ""
  }
                <tr>
                  <td style="padding:8px 12px;font-size:13px;color:#6b7280;">Cliente:</td>
                  <td style="padding:8px 12px;font-size:14px;">${escapeHtml(clienteNome)}</td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;">Para enviar o documento, clique no botao abaixo. Voce sera direcionado(a) ao caso na plataforma:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;">
                <tr>
                  <td bgcolor="#1f2937" style="border-radius:6px;">
                    <a href="${linkCaso}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Acessar caso e enviar documento</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">Caso o botao nao funcione, copie e cole este endereco no navegador:</p>
              <p style="margin:0 0 24px 0;font-size:12px;color:#3b82f6;word-break:break-all;">${linkCaso}</p>
            </td>
          </tr>
          <tr><td style="padding:0 24px;"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0;"/></td></tr>
          <tr>
            <td style="padding:16px 24px 24px 24px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                Este email foi enviado automaticamente. Se voce nao reconhece esta solicitacao, ignore esta mensagem ou entre em contato com o escritorio.
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
    `Voce tem uma nova solicitacao de documento para o caso de ${clienteNome}.`,
    "",
    `Documento solicitado: ${tipoLabel}`,
    desc ? `Observacao: ${descricao}` : "",
    `Cliente: ${clienteNome}`,
    "",
    "Para enviar o documento, acesse o caso na plataforma:",
    linkCaso,
    "",
    "--",
    "Mara Sandra Advocacia",
  ].filter(Boolean).join("\n");

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

  let solicitacaoId: string;
  try {
    const body = await req.json();
    solicitacaoId = String(body.solicitacao_id || "");
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  if (!solicitacaoId) {
    return jsonResponse({ error: "solicitacao_id obrigatorio" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Busca a solicitacao + caso + cliente + parceiro
  const { data, error } = await supabase
    .from("solicitacoes_documento")
    .select(
      "id, tipo, descricao, origem, casos:caso_id(id, parceiro_id, clientes:cliente_id(nome), usuarios_parceiro:parceiro_id(id, nome, email))",
    )
    .eq("id", solicitacaoId)
    .maybeSingle();

  if (error) {
    return jsonResponse(
      { error: "erro ao buscar solicitacao", detail: error.message },
      500,
    );
  }
  if (!data) {
    return jsonResponse({ error: "solicitacao nao encontrada" }, 404);
  }

  // Tipagem narrowing
  const solic = data as unknown as {
    id: string;
    tipo: string;
    descricao: string | null;
    origem: string;
    casos: {
      id: string;
      parceiro_id: string | null;
      clientes: { nome: string } | null;
      usuarios_parceiro: { id: string; nome: string | null; email: string | null } | null;
    } | null;
  };

  // Regras de envio
  if (solic.origem !== "externa") {
    return jsonResponse({
      enviado: false,
      motivo: "origem nao e externa (sem envio)",
    });
  }
  if (!solic.casos || !solic.casos.parceiro_id) {
    return jsonResponse({
      enviado: false,
      motivo: "caso sem parceiro vinculado (sem destinatario)",
    });
  }
  if (!solic.casos.usuarios_parceiro || !solic.casos.usuarios_parceiro.email) {
    return jsonResponse({
      enviado: false,
      motivo: "parceiro sem email cadastrado",
    });
  }

  const parceiroNome = solic.casos.usuarios_parceiro.nome ||
    solic.casos.usuarios_parceiro.email || "(parceiro sem nome)";
  const parceiroEmail = solic.casos.usuarios_parceiro.email;
  const clienteNome = solic.casos.clientes
    ? solic.casos.clientes.nome
    : "(cliente sem nome)";
  const tipoLabel = TIPOS_DOC_LABEL[solic.tipo] || solic.tipo;
  const linkCaso = `${APP_BASE_URL}/casos/${solic.casos.id}`;

  const { html, text } = renderEmail({
    parceiroNome,
    clienteNome,
    tipoLabel,
    descricao: solic.descricao,
    linkCaso,
  });

  // Envia via Resend API REST
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: parceiroEmail,
      subject: `Nova solicitacao de documento - ${tipoLabel} - ${clienteNome}`,
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

// supabase/functions/send-email-hook/index.ts
//
// Send Email Hook do Supabase Auth. Substitui o SMTP: todo e-mail de auth
// (convite, recovery, magic link, confirmacao) chega aqui e sai pela API REST
// do Resend com a RESEND_API_KEY — a mesma chave das funcoes notify-*, que
// comprovadamente entrega. Motivo: o smtp_pass da config de auth e uma chave
// Resend de outra conta, onde o dominio nao esta verificado (e-mails eram
// aceitos com 250 e descartados em silencio).
//
// Config (Management API /config/auth):
//   hook_send_email_enabled = true
//   hook_send_email_uri     = https://<ref>.supabase.co/functions/v1/send-email-hook
//   hook_send_email_secrets = v1,whsec_<base64>  (mesmo valor do secret abaixo)
//
// Secrets da funcao:
//   SEND_EMAIL_HOOK_SECRET  (v1,whsec_<base64>)
//   RESEND_API_KEY
//
// Payload documentado em https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "";
const FROM_EMAIL = "Mara Sandra Advocacia <noreply@marasandraconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

type EmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
};

function verifyLink(emailData: EmailData, tokenHash: string, type: string) {
  const redirect = emailData.redirect_to || emailData.site_url;
  return `${SUPABASE_URL}/auth/v1/verify?token=${tokenHash}&type=${type}&redirect_to=${encodeURIComponent(redirect)}`;
}

// Paleta do app (src/styles.css, tema claro, oklch -> hex):
//   background #FCFAF6 | card #FFFFFF | foreground #1B150F | primary #201914
//   muted-fg #6A615B | border #DED6C9 | gold #AF7C00 | gold-soft #F7E6C3
const LOGO_URL = "https://marasandraconnect.com/logo.png";

function buildEmail(emailData: EmailData): { subject: string; html: string } {
  const type = emailData.email_action_type;
  const link = verifyLink(emailData, emailData.token_hash, type);
  const btn = (label: string) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px">` +
    `<tr><td style="background:#201914;border-radius:8px">` +
    `<a href="${link}" style="display:inline-block;padding:13px 36px;font-family:Arial,Helvetica,sans-serif;` +
    `font-size:15px;font-weight:bold;color:#FCFAF6;text-decoration:none">${label}</a>` +
    `</td></tr></table>` +
    `<p style="margin:20px 0 0;color:#6A615B;font-size:12px;line-height:1.6">` +
    `Se o botao nao funcionar, copie e cole este endereco no navegador:<br>` +
    `<a href="${link}" style="color:#AF7C00;word-break:break-all">${link}</a></p>` +
    `<p style="margin:12px 0 0;color:#6A615B;font-size:12px">O link e de uso unico e expira em 1 hora.</p>`;
  const wrap = (title: string, body: string) =>
    `<body style="margin:0;padding:0;background:#FCFAF6">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCFAF6">` +
    `<tr><td align="center" style="padding:40px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">` +
    // logo
    `<tr><td align="center" style="padding-bottom:28px">` +
    `<img src="${LOGO_URL}" width="170" alt="Mara Sandra Vian Advocacia" style="display:block;border:0;max-width:170px;height:auto"></td></tr>` +
    // card
    `<tr><td style="background:#FFFFFF;border:1px solid #DED6C9;border-top:3px solid #AF7C00;border-radius:12px;padding:36px 40px" align="center">` +
    `<h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:normal;color:#1B150F">${title}</h2>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#1B150F">${body}</div>` +
    `</td></tr>` +
    // footer
    `<tr><td align="center" style="padding-top:24px">` +
    `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6A615B">` +
    `Mara Sandra Vian Advocacia &middot; <a href="https://marasandraconnect.com" style="color:#AF7C00;text-decoration:none">marasandraconnect.com</a></p>` +
    `</td></tr>` +
    `</table></td></tr></table></body>`;

  switch (type) {
    case "invite":
      return {
        subject: "Voce foi convidado(a) - Mara Sandra Advocacia",
        html: wrap(
          "Voce foi convidado(a)",
          `<p>Voce recebeu um convite para acessar a plataforma da Mara Sandra Advocacia. ` +
            `Clique abaixo para criar sua senha e entrar.</p>${btn("Aceitar convite")}`,
        ),
      };
    case "recovery":
      return {
        subject: "Redefinir sua senha - Mara Sandra Advocacia",
        html: wrap(
          "Redefinir senha",
          `<p>Recebemos um pedido para redefinir a sua senha. Clique abaixo para escolher uma nova.</p>` +
            `${btn("Redefinir senha")}<p style="color:#666;font-size:13px">Se voce nao pediu, ignore este e-mail.</p>`,
        ),
      };
    case "magiclink":
      return {
        subject: "Seu link de acesso - Mara Sandra Advocacia",
        html: wrap(
          "Link de acesso",
          `<p>Use o botao abaixo para entrar na plataforma.</p>${btn("Entrar")}`,
        ),
      };
    case "signup":
      return {
        subject: "Confirme seu e-mail - Mara Sandra Advocacia",
        html: wrap(
          "Confirme seu e-mail",
          `<p>Confirme seu endereco de e-mail para ativar sua conta.</p>${btn("Confirmar e-mail")}`,
        ),
      };
    case "email_change": {
      return {
        subject: "Confirme a troca de e-mail - Mara Sandra Advocacia",
        html: wrap(
          "Troca de e-mail",
          `<p>Confirme a alteracao do seu endereco de e-mail.</p>${btn("Confirmar troca")}`,
        ),
      };
    }
    case "reauthentication":
      return {
        subject: "Seu codigo de confirmacao - Mara Sandra Advocacia",
        html: wrap(
          "Codigo de confirmacao",
          `<p>Seu codigo de confirmacao e:</p>` +
            `<p style="font-size:28px;letter-spacing:4px;font-weight:bold">${emailData.token}</p>`,
        ),
      };
    default:
      return {
        subject: "Acesso - Mara Sandra Advocacia",
        html: wrap("Acesso", `<p>Use o botao abaixo para continuar.</p>${btn("Continuar")}`),
      };
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("metodo nao permitido", { status: 405 });
  }
  if (!RESEND_API_KEY || !HOOK_SECRET) {
    return Response.json(
      { error: { http_code: 500, message: "secrets ausentes na funcao" } },
      { status: 500 },
    );
  }

  const payload = await req.text();

  // Assinatura standardwebhooks — a lib espera o secret base64 sem o prefixo.
  let data: { user: { email: string }; email_data: EmailData };
  try {
    const wh = new Webhook(HOOK_SECRET.replace("v1,whsec_", ""));
    data = wh.verify(payload, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
    }) as typeof data;
  } catch {
    return Response.json(
      { error: { http_code: 401, message: "assinatura do webhook invalida" } },
      { status: 401 },
    );
  }

  const { subject, html } = buildEmail(data.email_data);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: data.user.email, subject, html }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    console.error("resend falhou", resp.status, detail);
    return Response.json(
      { error: { http_code: 502, message: `resend ${resp.status}: ${detail}` } },
      { status: 500 },
    );
  }

  return Response.json({});
});

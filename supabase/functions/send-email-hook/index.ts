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

function buildEmail(emailData: EmailData): { subject: string; html: string } {
  const type = emailData.email_action_type;
  const link = verifyLink(emailData, emailData.token_hash, type);
  const btn = (label: string) =>
    `<p style="margin:24px 0"><a href="${link}" style="background:#1a56db;color:#fff;` +
    `padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">${label}</a></p>` +
    `<p style="color:#666;font-size:13px">Se o botao nao funcionar, copie e cole este endereco no navegador:<br>${link}</p>` +
    `<p style="color:#666;font-size:13px">O link e de uso unico e expira em 1 hora.</p>`;
  const wrap = (title: string, body: string) =>
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">` +
    `<h2 style="color:#111">${title}</h2>${body}` +
    `<hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px">` +
    `<p style="color:#999;font-size:12px">Mara Sandra Advocacia &middot; marasandraconnect.com</p></div>`;

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

// supabase/functions/notify-solicitacao-doc/index.ts
//
// Envia email ao parceiro quando o interno cria uma solicitacao de documento
// — e tambem os LEMBRETES de prazo (7d/3d/no dia do "enviar até"), disparados
// pelo job diario enviar_lembretes_solicitacao() via pg_net.
//
// Pedido de troca da senha do Meu INSS (tipo 'senha_meu_inss', card #305):
// mesmo circuito, com texto proprio — pede pra informar a nova senha NA
// PLATAFORMA e nunca por e-mail. A senha nunca passa por aqui.
//
// Regras:
//   - Criacao: envia apenas se origem='externa' (as de template avisam o
//     parceiro pelo andamento visivel -> notify-novo-andamento).
//   - Lembrete: envia para origem != 'interna' (externa E template de
//     exigencia — justamente as com prazo fatal).
//   - Sempre: apenas se o caso tiver parceiro_id com email.
//
// Chamada do frontend (criacao, fire-and-forget):
//   await supabase.functions.invoke("notify-solicitacao-doc", {
//     body: { solicitacao_id: "<uuid>" }
//   });
// Chamada do job (lembrete):
//   body: { solicitacao_id: "<uuid>", lembrete: "7d" | "3d" | "0d" }
//
// Secrets necessarios no Supabase Edge Functions:
//   - RESEND_API_KEY  (api key do Resend, formato "re_...")
//   - APP_BASE_URL    (base url do app, ex.: "https://marasandraconnect.com")
//   - SUPABASE_URL    (automatico)
//   - SUPABASE_SERVICE_ROLE_KEY (automatico)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { exigirRecurso, exigirUsuarioOuSistema, fetchT } from "../_shared/auth.ts";
import { marcaDoEscritorio, remetente, type MarcaEscritorio } from "../_shared/marca.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ||
  "https://marasandraconnect.com";

const FROM_EMAIL = "Mara Vian Advocacia <noreply@marasandraconnect.com>";

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

// "dd/mm/aaaa" do prazo, no calendario de Brasilia.
function prazoBR(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

const TIPO_PEDIDO_SENHA = "senha_meu_inss";

// Resend pendurado nao pode segurar a funcao (e o job de lembretes) ate o
// gateway estourar.
const RESEND_TIMEOUT_MS = 20_000;

const LEMBRETE_FRASE: Record<string, string> = {
  "7d": "O prazo para envio esta chegando: faltam menos de 7 dias.",
  "3d": "Atencao: faltam 3 dias ou menos para o prazo de envio.",
  "0d": "O prazo de envio e HOJE. Se ja enviou, desconsidere esta mensagem.",
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
  marca: MarcaEscritorio;
  descricao: string | null;
  linkCaso: string;
  prazoLabel: string | null;
  lembrete: string | null;
  ehSenha: boolean;
}): { html: string; text: string } {
  const { parceiroNome, clienteNome, tipoLabel, descricao, linkCaso, prazoLabel, lembrete, ehSenha } = opts;
  const desc = descricao ? escapeHtml(descricao) : null;
  const oQue = ehSenha
    ? "um pedido para trocar a senha do Meu INSS"
    : "uma solicitacao de documento";
  const intro = lembrete
    ? `${LEMBRETE_FRASE[lembrete] ?? "O prazo de envio esta proximo."} Ainda ha ${oQue} aberto no caso de <strong>${escapeHtml(clienteNome)}</strong>.`
    : `Voce tem ${ehSenha ? "um novo pedido para trocar a senha do Meu INSS" : "uma nova solicitacao de documento"} do cliente <strong>${escapeHtml(clienteNome)}</strong>.`;
  const introText = lembrete
    ? `${LEMBRETE_FRASE[lembrete] ?? "O prazo de envio esta proximo."} Ainda ha ${oQue} aberto no caso de ${clienteNome}.`
    : `Voce tem ${ehSenha ? "um novo pedido para trocar a senha do Meu INSS" : "uma nova solicitacao de documento"} do cliente ${clienteNome}.`;
  const rotuloItem = ehSenha ? "Pedido:" : "Documento solicitado:";
  const rotuloPrazo = ehSenha ? "Prazo:" : "Prazo para envio:";
  const instrucao = ehSenha
    ? "Troque a senha no Meu INSS junto com o cliente e informe a nova senha na plataforma, pelo botao abaixo. Nunca envie a senha por e-mail ou WhatsApp."
    : "Para enviar o documento, clique no botao abaixo. Voce sera direcionado(a) ao caso na plataforma:";
  const botao = ehSenha ? "Acessar caso e informar a nova senha" : "Acessar caso e enviar documento";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${ehSenha ? "Pedido de troca da senha do Meu INSS" : "Nova solicitacao de documento"}</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:24px 24px 0 24px;">
              <h1 style="margin:0 0 4px 0;font-size:18px;font-weight:600;color:#111827;">${escapeHtml(opts.marca.nome)}</h1>
              <p style="margin:0;font-size:13px;color:#6b7280;">Legal Connect</p>
            </td>
          </tr>
          <tr><td style="padding:0 24px;"><hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0;"/></td></tr>
          <tr>
            <td style="padding:0 24px;">
              <p style="margin:0 0 12px 0;font-size:15px;">Ola, <strong>${escapeHtml(parceiroNome)}</strong>.</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;">${intro}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin:0 0 20px 0;width:100%;">
                <tr>
                  <td style="padding:8px 12px;font-size:13px;color:#6b7280;width:140px;">${rotuloItem}</td>
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
                ${
    prazoLabel
      ? `<tr>
                  <td style="padding:8px 12px;font-size:13px;color:#6b7280;">${rotuloPrazo}</td>
                  <td style="padding:8px 12px;font-size:14px;font-weight:600;color:#b91c1c;">${escapeHtml(prazoLabel)}</td>
                </tr>`
      : ""
  }
                <tr>
                  <td style="padding:8px 12px;font-size:13px;color:#6b7280;">Cliente:</td>
                  <td style="padding:8px 12px;font-size:14px;">${escapeHtml(clienteNome)}</td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;">${instrucao}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;">
                <tr>
                  <td bgcolor="#1f2937" style="border-radius:6px;">
                    <a href="${linkCaso}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${botao}</a>
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
    introText,
    "",
    `${rotuloItem} ${tipoLabel}`,
    desc ? `Observacao: ${descricao}` : "",
    prazoLabel ? `${rotuloPrazo} ${prazoLabel}` : "",
    `Cliente: ${clienteNome}`,
    "",
    ehSenha ? instrucao : "Para enviar o documento, acesse o caso na plataforma:",
    linkCaso,
    "",
    "--",
    opts.marca.nome,
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

  // Chamada pelo front e pela rotina de lembretes (pg_net).
  const quem = await exigirUsuarioOuSistema(req, "pgnet:notify-solicitacao-doc");
  if (quem instanceof Response) return quem;
  if (!RESEND_API_KEY) {
    return jsonResponse({ error: "RESEND_API_KEY nao configurado" }, 500);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let solicitacaoId: string;
  let lembrete: string | null;
  try {
    const body = await req.json();
    solicitacaoId = String(body.solicitacao_id || "");
    lembrete = body.lembrete ? String(body.lembrete) : null;
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }
  if (!solicitacaoId) {
    return jsonResponse({ error: "solicitacao_id obrigatorio" }, 400);
  }
  // Chamada de pessoa: só notifica sobre o que ela mesma enxerga. (Chamada de
  // sistema — gatilho, cron — passa: exigirRecurso ignora.)
  const semAcesso = await exigirRecurso(quem, "solicitacoes_documento", solicitacaoId);
  if (semAcesso) return semAcesso;
  if (lembrete && !(lembrete in LEMBRETE_FRASE)) {
    return jsonResponse({ error: "lembrete invalido (7d|3d|0d)" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Busca a solicitacao + caso + cliente + parceiro
  const { data, error } = await supabase
    .from("solicitacoes_documento")
    .select(
      "id, escritorio_id, tipo, tipos, descricao, origem, status, prazo_at, casos:caso_id(id, parceiro_id, clientes:cliente_id(nome), usuarios_parceiro:parceiro_id(id, nome, email))",
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
    // Pedido de varios documentos ([{tipo, label}]); null = pedido antigo.
    tipos: Array<{ tipo: string; label: string }> | null;
    descricao: string | null;
    origem: string;
    status: string;
    prazo_at: string | null;
    casos: {
      id: string;
      parceiro_id: string | null;
      clientes: { nome: string } | null;
      usuarios_parceiro: { id: string; nome: string | null; email: string | null } | null;
    } | null;
  };

  // Regras de envio. Criacao: so origem externa (template avisa pelo
  // andamento visivel). Lembrete: qualquer origem que nao seja interna —
  // as de exigencia sao justamente as com prazo fatal.
  if (lembrete) {
    if (solic.origem === "interna") {
      return jsonResponse({ enviado: false, motivo: "origem interna (sem lembrete)" });
    }
    if (solic.status !== "pendente") {
      return jsonResponse({ enviado: false, motivo: "solicitacao ja resolvida (sem lembrete)" });
    }
  } else if (solic.origem !== "externa") {
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
  // Um pedido pode listar varios documentos (Naira, 2026-08-26).
  const tipoLabel =
    solic.tipos && solic.tipos.length > 0
      ? solic.tipos.map((t) => t.label || t.tipo).join(", ")
      : TIPOS_DOC_LABEL[solic.tipo] || solic.tipo;
  const ehSenha = solic.tipo === TIPO_PEDIDO_SENHA;
  const linkCaso = `${APP_BASE_URL}/casos/${solic.casos.id}`;
  const prazoLabel = solic.prazo_at ? prazoBR(solic.prazo_at) : null;

  const marca = await marcaDoEscritorio(supabase, solic.escritorio_id as string | null);
  const { html, text } = renderEmail({
    parceiroNome,
    clienteNome,
    tipoLabel,
    marca,
    descricao: solic.descricao,
    linkCaso,
    prazoLabel,
    lembrete,
    ehSenha,
  });

  // Envia via Resend API REST
  const resp = await fetchT("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: remetente(marca),
      to: parceiroEmail,
      subject: lembrete
        ? `Lembrete de prazo${prazoLabel ? " " + prazoLabel : ""} - ${ehSenha ? "troca da senha do Meu INSS" : "documentos pendentes"} - ${clienteNome}`
        : ehSenha
        ? `Pedido: trocar a senha do Meu INSS - ${clienteNome}`
        : `Nova solicitacao de documento - ${tipoLabel} - ${clienteNome}`,
      html,
      text,
    }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
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

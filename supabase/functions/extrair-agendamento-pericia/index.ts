// =============================================================================
// Edge Function: extrair-agendamento-pericia
//
// Le o comprovante de agendamento de pericia (PDF/foto do Meu INSS, ou
// intimacao judicial) e devolve os campos do agendamento pra UI preencher o
// formulario e o aviso ao parceiro: data, hora, local, endereco, protocolo,
// servico e o nome do periciando (pra conferir contra o cliente do caso).
//
// Body: { arquivo: { nome, mime, base64 } }   (base64 SEM prefixo data:)
//   OU  { texto: "…" }  — publicação/intimação colada como texto puro.
// Resp: { campos: { data, hora, local, endereco, protocolo, servico,
//                   requerente }, aviso? }
//
// Mesmo padrao do extrair-dados-cliente: OCR nativo do modelo (BYOK, chave do
// proprio usuario ou a compartilhada do escritorio). A funcao NAO grava nada —
// quem preenche o form e sobe o documento e a tela, depois da conferencia.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { carregarIntegracao } from "../_shared/ia-integracao.ts";
import { chatWith, type Attachment } from "../_shared/ia-providers.ts";
import { extrairJson } from "../_shared/documento-campos.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MAX_BYTES = 8 * 1024 * 1024;

const SYSTEM =
  "Voce extrai os dados de agendamento de PERICIA de documentos brasileiros " +
  "para um escritorio de advocacia previdenciaria.\n\n" +
  "DOCUMENTOS TIPICOS:\n" +
  "- Comprovante do protocolo de agendamento do Meu INSS / Central 135: traz " +
  "'PROTOCOLO DE AGENDAMENTO' (numero longo), data em destaque (ex.: '06 AGO " +
  "2026'), 'Horario marcado' (ex.: 07:00), 'Unidade Responsavel' (nome da " +
  "agencia + endereco completo com CEP), 'Servico' (ex.: 'AGENDAMENTO - " +
  "PERICIA MEDICA DE AUXILIO-ACIDENTE') e 'Requerente' (nome do cliente). " +
  "Pode haver tambem 'Protocolo PAT' — o protocolo principal e o PROTOCOLO DE " +
  "AGENDAMENTO, nao o PAT.\n" +
  "- Intimacao judicial de pericia: data/hora/local no corpo do texto; o " +
  "'protocolo' nesse caso e o numero do processo, se houver.\n\n" +
  "REGRAS:\n" +
  "1. Extraia SOMENTE o que estiver legivel. Nunca deduza nem invente. Campo " +
  "ausente/ilegivel = null.\n" +
  "2. data em formato ISO AAAA-MM-DD; hora em HH:MM (24h).\n" +
  "3. local = nome da unidade/orgao (ex.: 'Agencia da Previdencia Social " +
  "Viana/MA'); endereco = logradouro completo com cidade/UF e CEP quando " +
  "houver, em uma linha.\n" +
  "4. servico sem o prefixo 'AGENDAMENTO - ' (ex.: 'Pericia medica de " +
  "auxilio-acidente').\n" +
  "5. requerente = nome completo do periciando como impresso.\n\n" +
  "RESPONDA APENAS com JSON neste formato exato:\n" +
  '{"data": "AAAA-MM-DD" | null, "hora": "HH:MM" | null, "local": string | null, ' +
  '"endereco": string | null, "protocolo": string | null, "servico": string | null, ' +
  '"requerente": string | null}';

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "secrets ausentes na funcao" }, 500);
  }

  let body: {
    arquivo?: { nome?: string; mime?: string; base64?: string };
    texto?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body invalido" }, 400);
  }
  const arq = body.arquivo;
  const textoColado = (body.texto ?? "").trim();
  if (!textoColado && (!arq?.base64 || !arq?.mime)) {
    return jsonResponse(
      { error: "arquivo { mime, base64 } ou texto obrigatorio" },
      400,
    );
  }
  if (arq?.base64 && (arq.base64.length * 3) / 4 > MAX_BYTES) {
    return jsonResponse({ error: "arquivo acima de 8MB" }, 413);
  }
  if (textoColado.length > 20000) {
    return jsonResponse({ error: "texto acima de 20 mil caracteres" }, 413);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  let usuarioId: string | null = null;
  if (jwt) {
    const { data: u } = await admin.auth.getUser(jwt);
    if (u?.user?.id) usuarioId = u.user.id;
  }
  if (!usuarioId) return jsonResponse({ error: "JWT valido obrigatorio" }, 401);
  const { data: perfil } = await admin
    .from("usuarios").select("tipo").eq("id", usuarioId).maybeSingle();
  if (perfil?.tipo !== "interno") {
    return jsonResponse({ error: "apenas usuario interno" }, 403);
  }

  const resIntegracao = await carregarIntegracao(admin, usuarioId);
  if (!resIntegracao.ok) {
    return jsonResponse(
      { error: resIntegracao.error, code: resIntegracao.code },
      resIntegracao.status,
    );
  }

  try {
    const apiKey = await decryptSecret(
      resIntegracao.integ.api_key_cipher,
      resIntegracao.integ.api_key_iv,
    );
    const attachments: Attachment[] = textoColado
      ? []
      : [{
        kind: arq!.mime === "application/pdf" ? "pdf" : "image",
        mediaType: arq!.mime!,
        base64: arq!.base64!,
        name: arq!.nome ?? "comprovante",
      }];
    const res = await chatWith(
      resIntegracao.integ.provider,
      apiKey,
      resIntegracao.integ.modelo,
      {
        system: SYSTEM,
        maxTokens: 700,
        tools: [],
        attachments,
        messages: [{
          role: "user",
          content: textoColado
            ? "Extraia os dados do agendamento de pericia do texto da " +
              "publicacao/intimacao abaixo. Responda apenas com o JSON.\n\n" +
              textoColado
            : "Extraia os dados do agendamento de pericia do documento anexado. " +
              "Responda apenas com o JSON.",
        }],
      },
    );
    const campos = extrairJson(res.text || "");
    if (!campos) {
      return jsonResponse({ campos: null, aviso: "nao consegui ler o documento" });
    }
    return jsonResponse({ campos });
  } catch (err) {
    console.warn("[extrair-agendamento-pericia] falha:", err);
    return jsonResponse({ error: "falha ao ler o documento" }, 502);
  }
});

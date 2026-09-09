// supabase/functions/inss-email-processor/index.ts
//
// MVP 1 do plano em planning/DECISOES.md (D5).
//
// Lê e-mails do INSS no Gmail da Naira (label `inss-agent`), extrai campos,
// classifica pelo despacho usando a mesma matriz da skill Cowork
// `agente-inss` e cria andamento + tarefas no caso correspondente — tudo
// automático, sem humano no meio.
//
// Trigger: HTTP POST. Em produção, pg_cron a cada 15min via
//   select net.http_post(url:='.../inss-email-processor', body:='{}');
//
// Dedup: tarefas têm UNIQUE(origem, origem_ref) where origem<>'manual'. A
// origem_ref aqui é o `gmail_message_id` (ou `<message_id>:<idx>` para itens
// múltiplos do template). Reprocessar o mesmo lote é seguro.
//
// Decisões (consolidadas com a Naira em 2026-06-15):
//   1c — Quando o e-mail aponta para responsável que ainda não está
//        cadastrado (Mara/Mariane/Beatriz), tudo cai pra Naira.
//   2  — Match cliente: nome completo (case-insensitive, trim) → CPF →
//        protocolo (via processos_admin.numero_req_normalizado).
//   3a — Sem match: cria tarefa 'revisar_email_nao_casado' (não perde e-mail).
//   4b — Classificação fora da matriz: cria tarefa 'revisar_classificacao'.
//
// Setup Gmail OAuth (uma vez):
//   O fluxo OAuth é feito pela UI (Configurações → "Conectar Gmail") via
//   edge functions `gmail-oauth-start` + `gmail-oauth-callback`. O
//   refresh_token cifrado vai pra tabela `usuario_gmail_oauth`. Esta
//   function lê de lá em vez do env.
//
//   Segredos necessários:
//     GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET   (do OAuth client GCP)
//     IA_MASTER_KEY                          (já existe; decifra refresh_token)
//
//   E configurações:
//     INSS_INBOX_EMAIL   (default 'nairaromerovian@gmail.com')
//     GMAIL_LABEL        (default 'inss-agent')
//
// Body do POST (todos opcionais):
//   {
//     "dias": 1,           // janela de busca em dias (default 1)
//     "limite": 50,        // máximo de mensagens por execução
//     "dry_run": false,    // se true, não escreve no banco
//     "label": "inss-agent" // override do label Gmail
//   }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { decryptSecret } from "../_shared/crypto.ts";
import { chatWith } from "../_shared/ia-providers.ts";
import { carregarIntegracao, type IntegracaoIA } from "../_shared/ia-integracao.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") ?? "";
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") ?? "";
const INSS_INBOX_EMAIL = Deno.env.get("INSS_INBOX_EMAIL") ?? "nairaromerovian@gmail.com";
const DEFAULT_LABEL = Deno.env.get("GMAIL_LABEL") ?? "inss-agent";
const NAIRA_EMAIL_DEFAULT = "nairaromerovian@gmail.com";

// Prazo do parceiro (regra da casa: fatal − 3, fim do dia BRT) com o MESMO
// tratamento de fim de semana do front (prazoParceiroDoFatal em
// src/lib/agenda/helpers.ts): caindo em sáb/dom, RECUA pra sexta — empurrar
// pra frente comeria a folga que o −3 existe pra garantir. Sem isto, a mesma
// exigência ganhava prazo de domingo por aqui e de sexta pelo formulário.
function prazoParceiroBrasiliaISO(diasAFrente: number): string {
  const alvo = new Date(Date.now() + diasAFrente * 86400_000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Meio-dia -03:00 pra ler o dia-da-semana do calendário de Brasília sem
  // risco de borda de fuso.
  const d = new Date(`${fmt.format(alvo)}T12:00:00-03:00`);
  const dow = d.getUTCDay(); // 12h BRT = 15h UTC — mesmo dia nos dois fusos
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
  return new Date(`${fmt.format(d)}T23:59:59-03:00`).toISOString();
}

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

// ============================================================================
// Gmail OAuth + API
// ============================================================================

async function obterAccessToken(sb: SupabaseClient): Promise<{ token: string; gmailAddress: string }> {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    throw new Error("GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET ausentes nos secrets");
  }

  // Lê o vínculo OAuth da caixa do INSS (Naira). Se Naira não conectou ainda,
  // erro claro pra UI mostrar "conecte o Gmail em Configurações".
  let { data: vinculo, error } = await sb
    .from("usuario_gmail_oauth")
    .select("usuario_id, refresh_cipher, refresh_iv, email_conectado, scope")
    .eq("email_conectado", INSS_INBOX_EMAIL)
    .maybeSingle();
  if (error) throw new Error(`Falha lendo usuario_gmail_oauth: ${error.message}`);
  // Reserva: conexão gravada sem o e-mail (o callback antigo salvava
  // "(desconhecido)" quando o escopo não permitia descobrir o endereço). Sem
  // isto, uma reconexão válida ficava invisível e a automação parava.
  if (!vinculo) {
    const { data: qualquer } = await sb
      .from("usuario_gmail_oauth")
      .select("usuario_id, refresh_cipher, refresh_iv, email_conectado, scope")
      .order("connected_at", { ascending: false })
      .limit(1);
    vinculo = qualquer?.[0] ?? null;
  }
  if (!vinculo) {
    throw new Error(
      `Gmail não conectado para ${INSS_INBOX_EMAIL}. Vá em Configurações → "Conectar Gmail".`
    );
  }

  const refreshToken = await decryptSecret(vinculo.refresh_cipher, vinculo.refresh_iv);

  const body = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    throw new Error(`Gmail OAuth refresh falhou: ${r.status} ${await r.text()}`);
  }
  const j = await r.json() as { access_token: string };

  // Atualiza last_used_at (não-bloqueante).
  sb.from("usuario_gmail_oauth")
    .update({ last_used_at: new Date().toISOString() })
    .eq("usuario_id", vinculo.usuario_id)
    .then(() => {}, () => {});

  // "me" quando o endereço não foi gravado: a API do Gmail aceita o alias e
  // resolve pela própria credencial, então o rótulo deixa de ser essencial.
  const endereco = (vinculo.email_conectado ?? "").includes("@")
    ? vinculo.email_conectado
    : "me";
  return { token: j.access_token, gmailAddress: endereco };
}

async function gmailListMessages(
  token: string,
  userEmail: string,
  query: string,
  maxResults: number,
): Promise<string[]> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages`,
  );
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    throw new Error(`Gmail list falhou: ${r.status} ${await r.text()}`);
  }
  const j = await r.json() as { messages?: Array<{ id: string }> };
  return (j.messages ?? []).map((m) => m.id);
}

interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
}

async function gmailGetMessage(
  token: string,
  userEmail: string,
  id: string,
): Promise<GmailMessage> {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages/${id}?format=full`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    throw new Error(`Gmail get(${id}) falhou: ${r.status} ${await r.text()}`);
  }
  const j = await r.json() as GmailMessageRaw;
  return {
    id: j.id,
    threadId: j.threadId,
    subject: headerValue(j.payload.headers, "Subject"),
    from: headerValue(j.payload.headers, "From"),
    date: headerValue(j.payload.headers, "Date"),
    body: extractMessageBody(j.payload),
  };
}

interface GmailMessageRaw {
  id: string;
  threadId: string;
  payload: GmailPayload;
}
interface GmailPayload {
  mimeType: string;
  headers: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

function headerValue(
  headers: Array<{ name: string; value: string }>,
  key: string,
): string {
  const h = headers.find((x) => x.name.toLowerCase() === key.toLowerCase());
  return h?.value ?? "";
}

function decodeB64Url(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
  const bytes = Uint8Array.from(atob(norm + pad), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function extractMessageBody(p: GmailPayload): string {
  // Preferência: text/plain. Fallback: text/html convertido. Recursivo em parts.
  if (p.mimeType === "text/plain" && p.body?.data) {
    return decodeB64Url(p.body.data);
  }
  if (p.parts) {
    // Primeiro tenta text/plain em qualquer profundidade.
    for (const part of p.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeB64Url(part.body.data);
      }
    }
    for (const part of p.parts) {
      const r = extractMessageBody(part);
      if (r) return r;
    }
  }
  if (p.mimeType === "text/html" && p.body?.data) {
    return htmlParaTexto(decodeB64Url(p.body.data));
  }
  return "";
}

function htmlParaTexto(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================================
// Extração de campos (port do runbook)
// ============================================================================

interface CamposEmail {
  nome_cliente: string;
  protocolo: string;
  cpf: string;
  nb: string;
  servico: string;
  status_assunto: string;
  despacho: string;
  data_cessacao: string;        // ISO YYYY-MM-DD se vier no e-mail (prorrogação)
}

function extrairCampos(subject: string, body: string): CamposEmail {
  const corpo = body.replace(/\r/g, "");
  return {
    nome_cliente: extrairNome(corpo),
    protocolo: extrairProtocolo(subject, corpo),
    cpf: extrairCpf(corpo),
    nb: extrairNb(corpo),
    servico: extrairServico(corpo),
    status_assunto: extrairStatusAssunto(subject, corpo),
    despacho: extrairDespacho(corpo),
    data_cessacao: extrairDataCessacao(corpo),
  };
}

function extrairDataCessacao(corpo: string): string {
  // Padrão: "Data da cessação do benefício: 14/09/2026" → "2026-09-14".
  const m = corpo.match(/Data\s+da\s+cessa[çc][ãa]o\s+do\s+benef[íi]cio:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function extrairNome(corpo: string): string {
  // "Prezado(a) Sr(a) NOME COMPLETO,"
  const m = corpo.match(/Prezad[oa]\s*\(?[oa]?\)?\s*Sr\(?[oa]?\)?\s*([^\n,]+?)\s*[,\n]/i);
  return (m?.[1] ?? "").trim();
}

function extrairProtocolo(subject: string, corpo: string): string {
  const mCorpo = corpo.match(/Protocolo:\s*([0-9.\-/]+)/i);
  if (mCorpo) return mCorpo[1].trim();
  const mAssunto = subject.match(/requerimento\s+([0-9.\-/]+)/i);
  return (mAssunto?.[1] ?? "").trim();
}

function extrairCpf(corpo: string): string {
  const m = corpo.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/);
  return (m?.[1] ?? "").trim();
}

function extrairNb(corpo: string): string {
  const m = corpo.match(/NB:\s*([0-9.\-/]+)/i) ??
    corpo.match(/benef[íi]cio\s+([0-9.\-/]+)/i);
  return (m?.[1] ?? "").trim();
}

function extrairServico(corpo: string): string {
  const m = corpo.match(/Serviço:\s*(.+?)\n/i);
  return (m?.[1] ?? "").trim();
}

function extrairStatusAssunto(subject: string, corpo: string): string {
  const mAssunto = subject.match(/alterado para\s+([A-ZÇÁÉÍÓÚÂÊÔÃÕ ]+)/i) ??
    subject.match(/status:\s*([A-ZÇÁÉÍÓÚÂÊÔÃÕ ]+)/i);
  if (mAssunto) return mAssunto[1].trim().toUpperCase();
  const mCorpo = corpo.match(/Status atual:\s*([A-ZÇÁÉÍÓÚÂÊÔÃÕ ]+)/i);
  return (mCorpo?.[1] ?? "").trim().toUpperCase();
}

function extrairDespacho(corpo: string): string {
  // Captura tudo do "Despacho:" até o rodapé padrão ("É possível acompanhar"
  // / "Atenciosamente" / "Instituto Nacional do Seguro Social"). NÃO trunca
  // em \n\n[A-Z] (quebrava o e-mail "CONCLUÍDA" com bloco NB+CTC no meio).
  const m = corpo.match(
    /Despacho:\s*([\s\S]*?)(?:\s*(?:É possível acompanhar|É poss[íi]vel acompanhar|Atenciosamente|Instituto Nacional do Seguro Social|http:\/\/meu\.inss\.gov\.br)|$)/i,
  );
  if (!m) return "";
  // Limpa indentação \t e linhas vazias múltiplas, mas preserva quebras
  // úteis pra leitura.
  return m[1]
    .replace(/\t+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================================
// Classificação (port do agente_inss_config.json)
// ============================================================================

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

const DETECTORES_PROCURADOR = ["(procurador)", "mara sandra vian", "naira"];

const PENDENTE_SUBTIPOS: Array<{ id: string; patterns: string[] }> = [
  {
    id: "pendente_cumprimento_protocolado",
    patterns: [
      "pedido na exigencia",
      "documentos conforme",
      "segue em anexo",
      "anexo os documentos",
      "juntam-se os documentos",          // Alexandre — "juntam-se os documentos solicitados"
      "juntam se os documentos",
      "cumprimento de exigencia",
      "cumprimento da exigencia",
    ],
  },
  { id: "pendente_pericia_remarcada", patterns: ["pericia foi remarcada", "pericia remarcada", "nova data"] },
];

const CLASSIFICACAO_ORDEM: Array<{ id: string; patterns: string[] }> = [
  // beneficio_prorrogado tem que vir ANTES de "concedido" porque o despacho
  // contém "perícia ... reconheceu" e poderia bater coisas amplas; também
  // antes de qualquer outra, pra não cair em "fora_da_matriz".
  { id: "beneficio_prorrogado", patterns: ["prorrogad", "foi prorrogado", "beneficio prorrogado"] },
  // cumprimento_realizado removido: o fluxo agora é controlado pelo
  // checklist "Exigência cumprida" no sistema. Emails do INSS dizendo que
  // o cumprimento foi realizado caem em "status_fora_da_matriz" e ficam
  // ignorados.
  { id: "indeferido", patterns: ["indeferid", "negad", "indeferimento", "nao houve direito"] },
  { id: "concedido", patterns: ["concedid", "conces", "deferid"] },
  { id: "exigencia", patterns: ["exigenc"] },
  { id: "pagamento_processado", patterns: ["pagamentos foram processados", "data liberacao", "valor liberado", "processados os seguintes pagamentos"] },
  { id: "em_analise", patterns: ["em analise"] },
  { id: "sobrestado", patterns: ["sobrestad", "diligenc"] },
];

function classificar(subject: string, c: CamposEmail): string {
  // 1) Requerimento aberto pelo assunto
  if (/requerimento realizado com sucesso/i.test(subject)) {
    return "requerimento_aberto";
  }

  // 2) Cliente é procurador (nome contém marcador) → fluxo especial
  const nomeNorm = normalize(c.nome_cliente);
  if (DETECTORES_PROCURADOR.some((p) => nomeNorm.includes(normalize(p)))) {
    return "cliente_eh_procurador";
  }

  // 3) Status PENDENTE com subtipos
  const despachoNorm = normalize(c.despacho);
  const statusNorm = normalize(c.status_assunto);
  if (statusNorm.includes("pendente")) {
    for (const sub of PENDENTE_SUBTIPOS) {
      if (sub.patterns.some((p) => despachoNorm.includes(p))) return sub.id;
    }
    return "pendente_outros";
  }

  // 4) Status EXIGÊNCIA no assunto
  if (statusNorm.includes("exigenc")) {
    return "exigencia";
  }

  // 5) Match por patterns do despacho
  for (const cls of CLASSIFICACAO_ORDEM) {
    if (cls.patterns.some((p) => despachoNorm.includes(p))) return cls.id;
  }

  // 6) Fora da matriz
  return "status_fora_da_matriz";
}

// ============================================================================
// Match cliente (nome completo case-insensitive → CPF → protocolo)
// ============================================================================

interface MatchCliente {
  cliente_id: string | null;
  caso_id: string | null;
  processo_admin_id: string | null;
  via: "nome" | "cpf" | "protocolo" | "sem_match";
}

async function acharCliente(
  sb: SupabaseClient,
  c: CamposEmail,
): Promise<MatchCliente> {
  // 1. Nome completo case-insensitive (trim em ambos os lados).
  // Decisão (Naira): match é EXATO no nome completo, sem fuzzy. Mas
  // normalizamos espaços (colapsa múltiplos) pra não falhar por digitação.
  if (c.nome_cliente) {
    const nomeNorm = c.nome_cliente.replace(/\s+/g, " ").trim();
    if (nomeNorm.length > 0) {
      const { data, error } = await sb
        .from("clientes")
        .select("id, nome")
        .ilike("nome", nomeNorm)
        .limit(5);
      if (!error && data) {
        // Filtra também por igualdade de nome normalizado (caso a base tenha
        // espaços duplos ou acentos diferentes — ilike compara como veio).
        const candidatos = data.filter(
          (d) => (d.nome ?? "").replace(/\s+/g, " ").trim().toLowerCase() === nomeNorm.toLowerCase(),
        );
        if (candidatos.length === 1) {
          const casoId = await casoMaisRecente(sb, candidatos[0].id);
          return { cliente_id: candidatos[0].id, caso_id: casoId, processo_admin_id: null, via: "nome" };
        }
      }
    }
  }

  // 2. CPF — normaliza pra dígitos só (banco guarda sem pontuação;
  // o e-mail manda com pontuação). Compara contra ambos os formatos por
  // segurança (caso algum cliente antigo tenha sido salvo formatado).
  if (c.cpf) {
    const cpfDigitos = c.cpf.replace(/\D/g, "");
    if (cpfDigitos.length === 11) {
      // CPF formatado canônico: XXX.XXX.XXX-XX
      const cpfFormatado = `${cpfDigitos.slice(0, 3)}.${cpfDigitos.slice(3, 6)}.${cpfDigitos.slice(6, 9)}-${cpfDigitos.slice(9)}`;
      const { data, error } = await sb
        .from("clientes")
        .select("id")
        .or(`cpf.eq.${cpfDigitos},cpf.eq.${cpfFormatado}`)
        .limit(2);
      if (!error && data && data.length === 1) {
        const casoId = await casoMaisRecente(sb, data[0].id);
        return { cliente_id: data[0].id, caso_id: casoId, processo_admin_id: null, via: "cpf" };
      }
    }
  }

  // 3. Protocolo → processos_admin.numero_req_normalizado.
  if (c.protocolo) {
    const norm = c.protocolo.replace(/\D/g, "");
    if (norm) {
      const { data, error } = await sb
        .from("processos_admin")
        .select("id, caso_id")
        .eq("numero_req_normalizado", norm)
        .limit(2);
      if (!error && data && data.length === 1) {
        const procAdmin = data[0];
        const { data: caso } = await sb
          .from("casos")
          .select("cliente_id")
          .eq("id", procAdmin.caso_id)
          .maybeSingle();
        return {
          cliente_id: caso?.cliente_id ?? null,
          caso_id: procAdmin.caso_id,
          processo_admin_id: procAdmin.id,
          via: "protocolo",
        };
      }
    }
  }

  return { cliente_id: null, caso_id: null, processo_admin_id: null, via: "sem_match" };
}

// O e-mail do INSS quase sempre traz o protocolo. Quando o cliente casou por
// nome/CPF, o andamento nascia SEM processo e caía em "Andamentos Gerais",
// solto — mesmo com o requerimento existindo no caso. Aqui resolvemos o
// processo pelo protocolo, exigindo que ele seja do MESMO caso: protocolo de
// outro caso é sinal de match errado, e nesse caso é melhor deixar solto do
// que pendurar a movimentação no processo errado.
async function acharProcessoAdminDoCaso(
  sb: SupabaseClient,
  protocolo: string | null | undefined,
  casoId: string | null,
): Promise<string | null> {
  if (!protocolo || !casoId) return null;
  const norm = String(protocolo).replace(/\D/g, "");
  if (!norm) return null;
  const { data, error } = await sb
    .from("processos_admin")
    .select("id")
    .eq("numero_req_normalizado", norm)
    .eq("caso_id", casoId)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].id;
}

async function casoMaisRecente(
  sb: SupabaseClient,
  clienteId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("casos")
    .select("id")
    .eq("cliente_id", clienteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// ============================================================================
// Aplicação de template (substituição + insert)
// ============================================================================

interface TemplateItem {
  titulo: string;
  descricao?: string;
  tipo: string;
  prioridade: number;
  offset_dias?: number;
  // Âncora alternativa: "hoje" (default) | "data_cessacao". Quando definido,
  // due_at = âncora + offset_dias (offset_dias pode ser negativo). Hoje
  // suportamos "data_cessacao" (do e-mail de prorrogação). Se a âncora não
  // estiver disponível no contexto, cai pro comportamento default.
  due_relative_to?: "hoje" | "data_cessacao";
  executor_email?: string;
  interessados_emails?: string[];
  meta?: Record<string, unknown>;
}

interface Template {
  nome: string;
  itens: TemplateItem[];
}

async function carregarTemplate(
  sb: SupabaseClient,
  nome: string,
): Promise<Template | null> {
  const { data, error } = await sb
    .from("tarefa_templates")
    .select("nome, itens")
    .eq("nome", nome)
    .eq("ativo", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as Template;
}

function substituir(s: string | undefined, c: CamposEmail): string {
  if (!s) return "";
  return s
    .replace(/\{nome_cliente\}/g, c.nome_cliente || "(sem nome)")
    .replace(/\{protocolo\}/g, c.protocolo || "(sem protocolo)")
    .replace(/\{despacho\}/g, c.despacho || "(sem despacho)")
    .replace(/\{servico\}/g, c.servico || "(sem serviço)")
    .replace(/\{nb\}/g, c.nb || "(sem NB)")
    .replace(/\{cpf\}/g, c.cpf || "(sem CPF)")
    .replace(/\{status_assunto\}/g, c.status_assunto || "(sem status)");
}

interface Lookups {
  emailParaUsuarioId: Map<string, string>;
  nairaUsuarioId: string | null;
}

// ---------------------------------------------------------------------------
// Mensagem simples pro parceiro (IA)
// ---------------------------------------------------------------------------
// A solicitação de documento de exigência ia pro parceiro com o despacho bruto
// do INSS colado — texto longo, burocrático, e parceiro leigo não entendia o
// que tinha que fazer. Aqui a IA reescreve: o que o INSS pediu, passos
// numerados, prazo fatal em destaque. Se a IA não estiver configurada ou
// falhar, cai no texto antigo (nunca bloqueia o processamento do e-mail).
//
// Chave: a integração efetiva da Naira (própria ou compartilhada do
// escritório), mesma infra do assistente. Carregada uma vez por execução.

const PROMPT_MENSAGEM_PARCEIRO = `Você redige mensagens curtas para parceiros comerciais de um escritório de advocacia previdenciária brasileiro. O parceiro é LEIGO: não entende de Direito Previdenciário nem os termos do INSS.

Você receberá o despacho de uma exigência do INSS. Elabore, de forma simples e objetiva, uma mensagem para o parceiro dizendo o que precisa ser providenciado para cumprir a exigência e qual é o prazo fatal.

Regras de conteúdo:
- Comece com "Olá!" e uma frase curta explicando o que o INSS pediu (em palavras simples, sem jargão; se houver termo técnico, explique).
- Liste o que o cliente/parceiro deve fazer em passos numerados (1., 2., 3., ...), um passo por linha, frases curtas.
- Destaque o prazo com "⚠️" e a data entre asteriscos, assim: *DD/MM/AAAA*. Avise que, se não for cumprido no prazo, o pedido pode ser arquivado sem análise.
- Se o despacho NÃO trouxer uma data, não invente: diga que o prazo é curto e que o escritório confirmará a data.
- Termine pedindo que providencie o quanto antes e envie ao escritório para fazermos o cumprimento da exigência.
- Não mencione números de protocolo, artigos de lei, matrícula de servidor, sites de validação nem instruções de uso do Meu INSS (quem protocola é o escritório).
- Quando o problema for assinatura eletrônica não validada (procuração, termos, declarações), oriente as duas saídas aceitas: (a) imprimir o documento e assinar de próprio punho, com caneta, enviando foto ou digitalização colorida, completa e legível, sem cortar nenhuma parte; ou (b) assinar digitalmente pelo gov.br (assinatura gov.br). Não cite outros sites.
- Documentos em foto/digitalização devem estar coloridos, legíveis e completos (frente e verso quando houver).

Regras de formato (importante — o texto é exibido como texto puro):
- Separe os blocos com UMA linha em branco: saudação/explicação, lista de passos, prazo, fechamento.
- Um item numerado por linha.
- Sem markdown além dos asteriscos da data (nada de #, **, listas com -, blocos de código).
- Responda SOMENTE com a mensagem final, sem comentários.`;

let integIACache: { integ: IntegracaoIA; apiKey: string } | null | undefined;

async function redigirMensagemParceiro(
  sb: SupabaseClient,
  lookups: Lookups,
  c: CamposEmail,
): Promise<string | null> {
  if (!c.despacho || !lookups.nairaUsuarioId) return null;
  try {
    if (integIACache === undefined) {
      const r = await carregarIntegracao(sb, lookups.nairaUsuarioId);
      if (!r.ok) {
        console.warn("[inss] IA nao configurada p/ mensagem ao parceiro:", r.error);
        integIACache = null;
      } else {
        integIACache = {
          integ: r.integ,
          apiKey: await decryptSecret(r.integ.api_key_cipher, r.integ.api_key_iv),
        };
      }
    }
    if (!integIACache) return null;

    const hoje = new Date(Date.now() - 3 * 3600_000).toLocaleDateString("pt-BR");
    const res = await chatWith(integIACache.integ.provider, integIACache.apiKey, integIACache.integ.modelo, {
      system: PROMPT_MENSAGEM_PARCEIRO,
      tools: [],
      maxTokens: 900,
      messages: [{
        role: "user",
        content:
          `Data de hoje: ${hoje}\n` +
          `Cliente: ${c.nome_cliente || "(sem nome)"}\n` +
          `Serviço/benefício: ${c.servico || "(não informado)"}\n\n` +
          `Despacho do INSS:\n${c.despacho}`,
      }],
    });
    const texto = (res.text || "").trim();
    // Resposta vazia ou curta demais = modelo se perdeu; melhor o texto antigo.
    if (texto.length < 40) return null;
    return texto;
  } catch (err) {
    console.warn("[inss] falha ao redigir mensagem ao parceiro:", err);
    return null;
  }
}

async function carregarLookups(sb: SupabaseClient): Promise<Lookups> {
  const { data } = await sb
    .from("usuarios")
    .select("id, email, tipo")
    .eq("tipo", "interno")
    .eq("ativo", true);
  const map = new Map<string, string>();
  for (const u of data ?? []) {
    if (u.email) map.set((u.email as string).toLowerCase(), u.id as string);
  }
  return {
    emailParaUsuarioId: map,
    nairaUsuarioId: map.get(NAIRA_EMAIL_DEFAULT) ?? null,
  };
}

function resolveResponsavel(
  item: TemplateItem,
  lookups: Lookups,
): { responsavel_id: string | null; metadata_extra: Record<string, unknown> } {
  // Decisão 1c: tudo cai pra Naira enquanto Mara/Mariane/Beatriz não estão.
  const emailReq = (item.executor_email ?? "").toLowerCase();
  if (emailReq && lookups.emailParaUsuarioId.has(emailReq)) {
    return {
      responsavel_id: lookups.emailParaUsuarioId.get(emailReq)!,
      metadata_extra: {},
    };
  }
  return {
    responsavel_id: lookups.nairaUsuarioId,
    metadata_extra: {
      responsavel_email_pendente: emailReq || null,
      interessados_emails: item.interessados_emails ?? [],
    },
  };
}

// ============================================================================
// Insert de andamento + tarefas
// ============================================================================

interface ProcessamentoResultado {
  message_id: string;
  subject?: string;
  campos_extraidos?: CamposEmail;
  body_preview?: string;
  classificacao: string;
  template_aplicado?: string;
  match_via: string;
  cliente_id: string | null;
  caso_id: string | null;
  andamento_id: string | null;
  tarefas_criadas: string[];
  pulado_por_dedup: boolean;
  erros: string[];
}

async function processarMensagem(
  sb: SupabaseClient,
  msg: GmailMessage,
  lookups: Lookups,
  dryRun: boolean,
): Promise<ProcessamentoResultado> {
  const res: ProcessamentoResultado = {
    message_id: msg.id,
    classificacao: "",
    match_via: "",
    cliente_id: null,
    caso_id: null,
    andamento_id: null,
    tarefas_criadas: [],
    pulado_por_dedup: false,
    erros: [],
  };

  // Dedup: esta mensagem já foi processada PRA VALER?
  //
  // A trava olha a auditoria, não as tarefas: tarefa concluída, arquivada ou
  // EXCLUÍDA não pode fazer o e-mail voltar a ser processado e duplicar tudo.
  // dry_run não conta — simular não pode bloquear a execução real.
  const { data: jaLido } = await sb
    .from("inss_email_log")
    .select("id")
    .eq("gmail_message_id", msg.id)
    .eq("dry_run", false)
    .eq("pulado_por_dedup", false)
    .limit(1);
  if (jaLido && jaLido.length > 0) {
    res.pulado_por_dedup = true;
    return res;
  }
  // Reserva histórica: e-mails processados antes da auditoria existir só
  // deixaram rastro nas tarefas.
  const { data: jaProcessado } = await sb
    .from("tarefas")
    .select("id")
    .eq("origem", "sync_inss_email")
    .like("origem_ref", `${msg.id}:%`)
    .limit(1);
  if (jaProcessado && jaProcessado.length > 0) {
    res.pulado_por_dedup = true;
    return res;
  }

  const campos = extrairCampos(msg.subject, msg.body);
  const classificacao = classificar(msg.subject, campos);
  res.classificacao = classificacao;
  res.subject = msg.subject;
  // Sempre: a auditoria guarda o que foi extraído mesmo na execução real, que
  // é como a gente descobre depois por que casou (ou não) com um cliente.
  res.campos_extraidos = campos;
  if (dryRun) {
    res.body_preview = msg.body.slice(0, 2000);
  }

  // Decisão 4b: fora da matriz → revisar_classificacao.
  const templateNome = classificacao === "status_fora_da_matriz"
    ? "revisar_classificacao"
    : classificacao;

  // Match cliente (decisão 2: nome → CPF → protocolo).
  const match = await acharCliente(sb, campos);
  // Casou por nome/CPF? O protocolo do e-mail ainda pode dizer em QUAL
  // requerimento a movimentação entra.
  if (!match.processo_admin_id) {
    match.processo_admin_id = await acharProcessoAdminDoCaso(sb, campos.protocolo, match.caso_id);
  }
  res.match_via = match.via;
  res.cliente_id = match.cliente_id;
  res.caso_id = match.caso_id;

  // Decisão 3a: sem match → revisar_email_nao_casado.
  const templateFinal = (match.via === "sem_match" || !match.caso_id)
    ? "revisar_email_nao_casado"
    : templateNome;

  res.template_aplicado = templateFinal;

  const template = await carregarTemplate(sb, templateFinal);
  if (!template) {
    res.erros.push(`Template '${templateFinal}' não encontrado`);
    return res;
  }

  if (dryRun) {
    res.tarefas_criadas = template.itens.map((it, i) =>
      `dryrun:${templateFinal}:${i}:${substituir(it.titulo, campos)}`
    );
    return res;
  }

  // Cria andamento (se houver caso).
  if (match.caso_id) {
    const { data: andamento, error: errAndamento } = await sb
      .from("andamentos")
      .insert({
        caso_id: match.caso_id,
        processo_admin_id: match.processo_admin_id,
        origem: "inss_email",
        titulo: `INSS — ${classificacao}`,
        descricao: [
          campos.protocolo && `Protocolo: ${campos.protocolo}`,
          campos.nb && `NB: ${campos.nb}`,
          campos.servico && `Serviço: ${campos.servico}`,
          campos.status_assunto && `Status: ${campos.status_assunto}`,
          `Classificação: ${classificacao}`,
          ``,
          `Despacho:`,
          campos.despacho || "(vazio)",
          ``,
          `---`,
          `Gmail message: ${msg.id}`,
          `Assunto: ${msg.subject}`,
        ].filter(Boolean).join("\n"),
        data_evento: msg.date ? new Date(msg.date).toISOString() : new Date().toISOString(),
        visivel_parceiro: false,
        metadata: {
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId,
          classificacao,
          campos_extraidos: campos,
          match_via: match.via,
        },
      })
      .select("id")
      .single();
    if (errAndamento) {
      res.erros.push(`andamento insert: ${errAndamento.message}`);
    } else {
      res.andamento_id = andamento.id;
    }
  }

  // Dedup cruzado com o botão de desfecho da UI (AcompanhamentoPericia):
  // concedido/indeferido também são aplicados programaticamente quando a
  // equipe vê o resultado no Meu INSS antes do e-mail chegar. Se o caso já
  // tem tarefa desta corrente (de qualquer origem, não cancelada), o e-mail
  // é notícia velha: fica só o andamento acima como registro — sem abrir a
  // corrente de novo. O botão faz a checagem espelhada (aplicador.ts).
  if (
    match.caso_id &&
    (templateFinal === "concedido" || templateFinal === "indeferido")
  ) {
    const { data: correnteJa } = await sb
      .from("tarefas")
      .select("id")
      .eq("caso_id", match.caso_id)
      .neq("status", "cancelado")
      .or(
        `metadata->>template_aplicado.eq.${templateFinal},metadata->>template.eq.${templateFinal}`,
      )
      .limit(1);
    if (correnteJa && correnteJa.length > 0) {
      res.pulado_por_dedup = true;
      res.tarefas_criadas.push(
        `dedup:corrente '${templateFinal}' já aberta pelo desfecho da UI`,
      );
      return res;
    }
  }

  // Cria tarefas (1+ por template).
  for (let i = 0; i < template.itens.length; i++) {
    const item = template.itens[i];

    // ----- destino=andamento → cria andamento adicional (ex: comunicar
    // parceiro automaticamente via "Benefício Concedido — iremos analisar
    // e repassar"). Pula a parte de tarefa.
    if ((item as { destino?: string }).destino === "andamento" && match.caso_id) {
      const visivel = (item as { visivel_parceiro?: boolean }).visivel_parceiro ?? true;
      const { data: andExtra, error: errAndamentoExtra } = await sb
        .from("andamentos")
        .insert({
          caso_id: match.caso_id,
          processo_admin_id: match.processo_admin_id,
          origem: "interno",
          titulo: substituir(item.titulo, campos),
          descricao: substituir(item.descricao, campos) || null,
          data_evento: new Date().toISOString(),
          visivel_parceiro: visivel,
          metadata: {
            gmail_message_id: msg.id,
            template: templateFinal,
            template_item_index: i,
            classificacao,
            destino: "andamento",
            ...(item.meta ?? {}),
          },
        })
        .select("id")
        .single();
      if (errAndamentoExtra) {
        res.erros.push(`andamento[${i}] insert: ${errAndamentoExtra.message}`);
      } else if (andExtra && visivel) {
        // Andamento visível ao parceiro é comunicação: tem que chegar por
        // e-mail, senão fica esperando ele entrar no portal por acaso.
        // Falha no envio não desfaz o andamento — só entra nos erros.
        try {
          const rNot = await fetch(`${SUPABASE_URL}/functions/v1/notify-novo-andamento`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE}`,
            },
            body: JSON.stringify({ andamento_id: andExtra.id }),
          });
          if (!rNot.ok) {
            res.erros.push(`email parceiro[${i}]: HTTP ${rNot.status}`);
          }
        } catch (e) {
          res.erros.push(`email parceiro[${i}]: ${String(e).slice(0, 120)}`);
        }
      }
      continue;
    }

    // ----- destino=solicitacao_documento → cria solicitação -----
    if ((item as { destino?: string }).destino === "solicitacao_documento" && match.caso_id) {
      const tituloSub = substituir(item.titulo, campos);
      const descSub = substituir(item.descricao ?? "", campos);
      // Texto simples pra quem vai ler (parceiro leigo). Cai no template se a
      // IA não responder.
      const mensagemIA = await redigirMensagemParceiro(sb, lookups, campos);
      // "Enviar até" do parceiro: fatal da exigência INSS é 30 dias corridos
      // (o item FATAL do template usa offset 30); o parceiro vê fatal − 3 =
      // hoje + 27, no fim do dia de Brasília. Alimenta o kanban dele, o
      // badge de prazo e os lembretes automáticos 7d/3d/0d.
      const { error: errSolic } = await sb
        .from("solicitacoes_documento")
        .insert({
          caso_id: match.caso_id,
          tipo: (item.tipo as string) || "outro",
          descricao: mensagemIA ?? (descSub || tituloSub),
          status: "pendente",
          origem: `template:${templateFinal}`,
          data_solicitacao: new Date().toISOString(),
          prazo_at: prazoParceiroBrasiliaISO(27),
        });
      if (errSolic) {
        res.erros.push(`solicitacao[${i}] insert: ${errSolic.message}`);
      }
      continue;
    }

    const resolved = resolveResponsavel(item, lookups);
    // Resolução do due_at:
    //  - due_relative_to='data_cessacao' + campos.data_cessacao  → cessação + offset
    //  - offset_dias definido (default âncora=hoje, mesmo 0)     → hoje + offset
    //  - undefined                                                → sem prazo
    let dueAt: string | null = null;
    if (item.due_relative_to === "data_cessacao" && campos.data_cessacao) {
      const ancora = new Date(`${campos.data_cessacao}T00:00:00Z`).getTime();
      dueAt = new Date(ancora + (item.offset_dias ?? 0) * 86400_000).toISOString();
    } else if (typeof item.offset_dias === "number") {
      dueAt = new Date(Date.now() + item.offset_dias * 86400_000).toISOString();
    }

    const titulo = substituir(item.titulo, campos);
    const descricao = substituir(item.descricao, campos);

    const { data: tarefa, error: errT } = await sb
      .from("tarefas")
      .insert({
        caso_id: match.caso_id, // pode ser null em revisar_email_nao_casado
        // Linka a tarefa ao processo admin quando o match veio por protocolo;
        // não temos judicial via INSS, então deixamos null.
        processo_admin_id: match.processo_admin_id,
        responsavel_id: resolved.responsavel_id,
        tipo: item.tipo || "interna",
        prioridade: item.prioridade ?? 2,
        titulo,
        descricao,
        due_at: dueAt,
        origem: "sync_inss_email",
        origem_ref: `${msg.id}:${i}`,
        metadata: {
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId,
          template: templateFinal,
          template_item_index: i,
          classificacao,
          match_via: match.via,
          campos_extraidos: campos,
          ...resolved.metadata_extra,
          ...(item.meta ?? {}),         // passthrough (ex: acompanhamento_processual)
        },
      })
      .select("id")
      .single();

    if (errT) {
      // UNIQUE de dedup? Se sim, é benigno.
      if (errT.code === "23505") {
        res.pulado_por_dedup = true;
        continue;
      }
      res.erros.push(`tarefa[${i}] insert: ${errT.message}`);
      continue;
    }
    res.tarefas_criadas.push(tarefa.id);
  }

  return res;
}

// ============================================================================
// Auditoria
// ============================================================================

// Grava a trilha de CADA mensagem lida, inclusive no dry_run e inclusive as
// puladas por dedup — é como a Naira consegue puxar depois "de que e-mail veio
// esta tarefa" e "por que este casou com aquele cliente".
//
// Nunca derruba o processamento: falhar a auditoria não pode custar o e-mail.
// Mantém só os 3 últimos dígitos: dá pra conferir se casou com o cliente
// certo, sem criar mais uma cópia de CPF inteiro no banco (LGPD). O CPF
// completo continua onde sempre esteve, no cadastro do cliente.
function mascararCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const d = String(cpf).replace(/\D/g, "");
  if (d.length !== 11) return "***";
  return `***.***.**${d[8]}-${d.slice(9)}`;
}

async function registrarAuditoria(
  sb: SupabaseClient,
  msg: GmailMessage,
  r: ProcessamentoResultado,
  dryRun: boolean,
): Promise<string | null> {
  try {
    const campos = r.campos_extraidos as { despacho?: string; cpf?: string } | undefined;
    // Só a auditoria é mascarada; o casamento de cliente já rodou com o CPF
    // completo antes daqui.
    const camposAuditoria = campos
      ? { ...campos, cpf: mascararCpf(campos.cpf) }
      : null;
    const { error: errLog } = await sb.from("inss_email_log").insert({
      gmail_message_id: msg.id,
      assunto: msg.subject,
      remetente: msg.from,
      recebido_em: msg.date,
      campos_extraidos: camposAuditoria,
      despacho: campos?.despacho ?? null,
      classificacao: r.classificacao || null,
      match_via: r.match_via || null,
      cliente_id: r.cliente_id,
      caso_id: r.caso_id,
      template_aplicado: r.template_aplicado ?? null,
      andamento_id: r.andamento_id,
      tarefas_criadas: r.tarefas_criadas,
      qtd_tarefas: r.tarefas_criadas.length,
      pulado_por_dedup: r.pulado_por_dedup,
      erros: r.erros.length > 0 ? r.erros : null,
      dry_run: dryRun,
    });
    if (errLog) {
      console.error("auditoria inss_email_log falhou:", errLog.message);
      return errLog.message;
    }
    return null;
  } catch (e) {
    console.error("auditoria inss_email_log falhou:", String(e));
    return String(e);
  }
}

// ============================================================================
// Handler HTTP
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body: {
    dias?: number;
    limite?: number;
    dry_run?: boolean;
    label?: string;
    message_id?: string;          // processa só uma mensagem específica
    message_ids?: string[];       // ou várias específicas
    // Só gera a mensagem simples pro parceiro a partir de um despacho e
    // devolve — sem ler Gmail nem gravar nada. Pra afinar o prompt.
    preview_mensagem_parceiro?: { despacho: string; nome_cliente?: string; servico?: string };
  } = {};
  try {
    body = await req.json();
  } catch (_) { /* body vazio é OK */ }

  const dias = Math.min(Math.max(body.dias ?? 1, 1), 30);
  const limite = Math.min(Math.max(body.limite ?? 50, 1), 200);
  const dryRun = body.dry_run === true;
  // Integração de IA é resolvida de novo a cada execução (a isolate pode
  // ficar quente entre chamadas do cron; chave trocada não pode ficar presa).
  integIACache = undefined;
  const label = body.label ?? DEFAULT_LABEL;
  const onlyIds = body.message_id
    ? [body.message_id]
    : body.message_ids && body.message_ids.length > 0
      ? body.message_ids
      : null;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  if (body.preview_mensagem_parceiro) {
    const pv = body.preview_mensagem_parceiro;
    const lookups = await carregarLookups(sb);
    const texto = await redigirMensagemParceiro(sb, lookups, {
      nome_cliente: pv.nome_cliente ?? "",
      protocolo: "",
      cpf: "",
      nb: "",
      servico: pv.servico ?? "",
      status_assunto: "",
      despacho: pv.despacho ?? "",
      data_cessacao: "",
    });
    return jsonResponse({ mensagem: texto, ia_usada: texto !== null });
  }

  try {
    const { token, gmailAddress } = await obterAccessToken(sb);
    // in:inbox de proposito: e-mail ja arquivado e passado, e reprocessar
    // passado criaria tarefa em cima de caso que a equipe ja resolveu.
    const query = `label:${label} in:inbox newer_than:${dias}d`;
    // Se body.message_id(s) foi passado, processa só esses (sem precisar
    // listar). Caso contrário, lista pela label/janela.
    const ids = onlyIds ?? await gmailListMessages(token, gmailAddress, query, limite);

    const lookups = await carregarLookups(sb);
    if (!lookups.nairaUsuarioId) {
      return jsonResponse({
        error: "Naira não encontrada como usuário interno ativo — pré-condição falhou",
      }, 500);
    }

    const resultados: ProcessamentoResultado[] = [];
    const auditoriaErros: string[] = [];
    for (const id of ids) {
      try {
        const msg = await gmailGetMessage(token, gmailAddress, id);
        const r = await processarMensagem(sb, msg, lookups, dryRun);
        resultados.push(r);
        const errAud = await registrarAuditoria(sb, msg, r, dryRun);
        if (errAud) auditoriaErros.push(errAud);
      } catch (e) {
        resultados.push({
          message_id: id,
          classificacao: "",
          match_via: "",
          cliente_id: null,
          caso_id: null,
          andamento_id: null,
          tarefas_criadas: [],
          pulado_por_dedup: false,
          erros: [String(e)],
        });
      }
    }

    return jsonResponse({
      dry_run: dryRun,
      auditoria_erros: auditoriaErros,
      query,
      mensagens_listadas: ids.length,
      processadas: resultados.filter((r) => !r.pulado_por_dedup && r.erros.length === 0 && r.tarefas_criadas.length > 0).length,
      puladas_dedup: resultados.filter((r) => r.pulado_por_dedup).length,
      com_erro: resultados.filter((r) => r.erros.length > 0).length,
      resultados,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});

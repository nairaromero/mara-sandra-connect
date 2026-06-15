// supabase/functions/inss-email-processor/index.ts
//
// MVP 1 do plano em planning/SUBSTITUIR_TRAMITACAO.md.
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") ?? "";
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") ?? "";
const INSS_INBOX_EMAIL = Deno.env.get("INSS_INBOX_EMAIL") ?? "nairaromerovian@gmail.com";
const DEFAULT_LABEL = Deno.env.get("GMAIL_LABEL") ?? "inss-agent";
const NAIRA_EMAIL_DEFAULT = "nairaromerovian@gmail.com";

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
  const { data: vinculo, error } = await sb
    .from("usuario_gmail_oauth")
    .select("usuario_id, refresh_cipher, refresh_iv, email_conectado, scope")
    .eq("email_conectado", INSS_INBOX_EMAIL)
    .maybeSingle();
  if (error) throw new Error(`Falha lendo usuario_gmail_oauth: ${error.message}`);
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

  return { token: j.access_token, gmailAddress: vinculo.email_conectado };
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
  };
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
  const m = corpo.match(/Despacho:\s*([\s\S]*?)(?:É possível acompanhar|Atenciosamente|\n\n[A-Z]|$)/i);
  return (m?.[1] ?? "").trim();
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
  { id: "pendente_cumprimento_protocolado", patterns: ["pedido na exigencia", "documentos conforme", "segue em anexo", "anexo os documentos"] },
  { id: "pendente_pericia_remarcada", patterns: ["pericia foi remarcada", "pericia remarcada", "nova data"] },
];

const CLASSIFICACAO_ORDEM: Array<{ id: string; patterns: string[] }> = [
  { id: "cumprimento_realizado", patterns: ["cumprimento de exigencia", "cumprimento da exigencia"] },
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
  if (c.status_assunto.toUpperCase().includes("PENDENTE")) {
    for (const sub of PENDENTE_SUBTIPOS) {
      if (sub.patterns.some((p) => despachoNorm.includes(p))) return sub.id;
    }
    return "pendente_outros";
  }

  // 4) Status EXIGÊNCIA no assunto
  if (c.status_assunto.toUpperCase().includes("EXIGENC")) {
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
  if (c.nome_cliente) {
    const { data, error } = await sb
      .from("clientes")
      .select("id")
      .ilike("nome", c.nome_cliente.trim())
      .limit(2);
    if (!error && data && data.length === 1) {
      const casoId = await casoMaisRecente(sb, data[0].id);
      return { cliente_id: data[0].id, caso_id: casoId, processo_admin_id: null, via: "nome" };
    }
  }

  // 2. CPF exato (texto inclui pontuação).
  if (c.cpf) {
    const { data, error } = await sb
      .from("clientes")
      .select("id")
      .eq("cpf", c.cpf)
      .limit(2);
    if (!error && data && data.length === 1) {
      const casoId = await casoMaisRecente(sb, data[0].id);
      return { cliente_id: data[0].id, caso_id: casoId, processo_admin_id: null, via: "cpf" };
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
  classificacao: string;
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

  // Dedup: já processado?
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

  // Decisão 4b: fora da matriz → revisar_classificacao.
  const templateNome = classificacao === "status_fora_da_matriz"
    ? "revisar_classificacao"
    : classificacao;

  // Match cliente (decisão 2: nome → CPF → protocolo).
  const match = await acharCliente(sb, campos);
  res.match_via = match.via;
  res.cliente_id = match.cliente_id;
  res.caso_id = match.caso_id;

  // Decisão 3a: sem match → revisar_email_nao_casado.
  const templateFinal = (match.via === "sem_match" || !match.caso_id)
    ? "revisar_email_nao_casado"
    : templateNome;

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

  // Cria tarefas (1+ por template).
  for (let i = 0; i < template.itens.length; i++) {
    const item = template.itens[i];
    const resolved = resolveResponsavel(item, lookups);
    // offset_dias definido (mesmo 0) = data relativa a hoje (0 = hoje).
    // Undefined = sem prazo.
    const dueAt = typeof item.offset_dias === "number"
      ? new Date(Date.now() + item.offset_dias * 86400_000).toISOString()
      : null;

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
// Handler HTTP
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body: { dias?: number; limite?: number; dry_run?: boolean; label?: string } = {};
  try {
    body = await req.json();
  } catch (_) { /* body vazio é OK */ }

  const dias = Math.min(Math.max(body.dias ?? 1, 1), 30);
  const limite = Math.min(Math.max(body.limite ?? 50, 1), 200);
  const dryRun = body.dry_run === true;
  const label = body.label ?? DEFAULT_LABEL;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  try {
    const { token, gmailAddress } = await obterAccessToken(sb);
    const query = `label:${label} newer_than:${dias}d`;
    const ids = await gmailListMessages(token, gmailAddress, query, limite);

    const lookups = await carregarLookups(sb);
    if (!lookups.nairaUsuarioId) {
      return jsonResponse({
        error: "Naira não encontrada como usuário interno ativo — pré-condição falhou",
      }, 500);
    }

    const resultados: ProcessamentoResultado[] = [];
    for (const id of ids) {
      try {
        const msg = await gmailGetMessage(token, gmailAddress, id);
        const r = await processarMensagem(sb, msg, lookups, dryRun);
        resultados.push(r);
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

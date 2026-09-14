// =============================================================================
// Edge Function: sugerir-proxima-tarefa
//
// Card #306 (Naira, 2026-09-14): ao concluir uma tarefa, o popup "Próxima
// tarefa do caso" mostra a tarefa de seguimento sugerida pela IA. A pessoa
// SEMPRE confere no formulário antes de criar — esta função não grava nada.
//
// Body: { tarefa_id: uuid }   (JWT de usuário INTERNO obrigatório)
// Resp: { sugestao: {...} | null, motivo: string | null }
//
// IA: chave compartilhada do escritório (ia_integracoes.compartilhada), como a
// leitura de audiência. Sem chave, erro ou "nada a sugerir" → sugestao null com
// o motivo, e a tela oferece criar uma tarefa em branco.
//
// Contexto enviado à IA: tipo de benefício/fase do caso, a tarefa concluída,
// tarefas abertas e andamentos recentes — sem nome do cliente, CPF ou senha. O
// nome volta só no título, montado aqui.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { chatWith } from "../_shared/ia-providers.ts";
import { extrairJson } from "../_shared/documento-campos.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS = ["interna", "prazo", "pericia", "pos_protocolo", "contato_cliente"] as const;

// O popup fica esperando: provedor pendurado vira "não consegui sugerir".
const IA_TIMEOUT_MS = 25_000;
function comTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout da IA (25s)")), IA_TIMEOUT_MS)
    ),
  ]);
}

const SYSTEM =
  "Voce e assistente de um escritorio de advocacia previdenciaria brasileiro " +
  "(clientes segurados do INSS; processos administrativos no INSS e acoes na Justica).\n" +
  "Uma tarefa do caso acabou de ser CONCLUIDA. Sugira a UNICA proxima tarefa de " +
  "seguimento que mantem o caso andando, com base no contexto.\n\n" +
  "REGRAS:\n" +
  "1. Nao repita tarefa que ja esta aberta no caso. Se o proximo passo ja esta " +
  "coberto por uma tarefa aberta, ou nao ha seguimento sensato, responda sugestao null.\n" +
  "2. titulo: curto, verbo no infinitivo, SEM nome do cliente (ex.: 'Acompanhar " +
  "implantacao do beneficio').\n" +
  "3. descricao: 1 a 2 frases objetivas do que fazer.\n" +
  "4. tipo: um de interna | prazo | pericia | pos_protocolo | contato_cliente.\n" +
  "5. prioridade: 1 (alta), 2 (media) ou 3 (baixa).\n" +
  "6. prazo_dias_uteis: inteiro de 1 a 30 a partir de hoje.\n" +
  "7. mesmo_processo: true se a tarefa e do mesmo processo da concluida.\n" +
  "8. motivo: uma frase explicando por que esse e o proximo passo.\n\n" +
  "RESPONDA APENAS com JSON neste formato exato:\n" +
  '{"sugestao": {"titulo": string, "descricao": string, "tipo": string, ' +
  '"prioridade": 1|2|3, "prazo_dias_uteis": number, "mesmo_processo": boolean} | null, ' +
  '"motivo": string}';

const pad = (n: number) => String(n).padStart(2, "0");

// "aaaa-mm-dd" de hoje em Brasília.
function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Hoje + N dias úteis (sáb/dom não contam; feriado não entra), às 09:00 de
// Brasília (-03:00, sem horário de verão desde 2019).
function vencimentoDiasUteis(n: number): string {
  const [y, m, d] = hojeBR().split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d));
  let restantes = n;
  while (restantes > 0) {
    dia.setUTCDate(dia.getUTCDate() + 1);
    if (dia.getUTCDay() !== 0 && dia.getUTCDay() !== 6) restantes--;
  }
  const chave = `${dia.getUTCFullYear()}-${pad(dia.getUTCMonth() + 1)}-${pad(dia.getUTCDate())}`;
  return new Date(`${chave}T09:00:00-03:00`).toISOString();
}

// "Analisar CNIS - Maria da Silva" → "Analisar CNIS" (o nome não vai pra IA).
function semCliente(titulo: string, cliente: string | null): string {
  if (!cliente) return titulo;
  return titulo.replace(new RegExp(`\\s*-\\s*${cliente.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
}

const dataBR = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })
      .format(new Date(iso))
    : "sem data";

function semSugestao(motivo: string) {
  return jsonResponse({ sugestao: null, motivo });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: "secrets ausentes" }, 500);

  let tarefaId = "";
  try {
    tarefaId = String((await req.json())?.tarefa_id ?? "");
  } catch {
    return jsonResponse({ error: "body invalido" }, 400);
  }
  if (!UUID_RE.test(tarefaId)) return jsonResponse({ error: "tarefa_id invalido" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Só interno ativo.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "JWT obrigatorio" }, 401);
  const { data: auth } = await admin.auth.getUser(jwt);
  const usuarioId = auth?.user?.id;
  if (!usuarioId) return jsonResponse({ error: "JWT invalido" }, 401);
  const { data: perfil, error: errPerfil } = await admin
    .from("usuarios").select("tipo, ativo").eq("id", usuarioId).maybeSingle();
  if (errPerfil) return jsonResponse({ error: "falha ao ler o usuario" }, 500);
  if (perfil?.tipo !== "interno" || perfil?.ativo !== true) {
    return jsonResponse({ error: "apenas usuario interno" }, 403);
  }

  const { data: tarefa, error: errT } = await admin
    .from("tarefas")
    .select("id, titulo, descricao, tipo, caso_id, responsavel_id, processo_admin_id, processo_judicial_id, metadata")
    .eq("id", tarefaId)
    .maybeSingle();
  if (errT) return jsonResponse({ error: "falha ao ler a tarefa" }, 500);
  if (!tarefa) return jsonResponse({ error: "tarefa nao encontrada" }, 404);
  if (!tarefa.caso_id) return semSugestao("A tarefa não tem caso ligado.");

  const [caso, abertas, feitas, andamentos] = await Promise.all([
    admin.from("casos").select("tipo_beneficio, fase, status, clientes(nome)").eq("id", tarefa.caso_id).maybeSingle(),
    admin.from("tarefas").select("titulo, due_at").eq("caso_id", tarefa.caso_id)
      .eq("status", "a_fazer").neq("id", tarefa.id).order("due_at", { ascending: true }).limit(15),
    admin.from("tarefas").select("titulo, completed_at").eq("caso_id", tarefa.caso_id)
      .eq("status", "feito").neq("id", tarefa.id).order("completed_at", { ascending: false }).limit(6),
    admin.from("andamentos").select("titulo, descricao, data_evento").eq("caso_id", tarefa.caso_id)
      .order("data_evento", { ascending: false }).limit(10),
  ]);
  for (const r of [caso, abertas, feitas, andamentos]) {
    // Contexto que falhou não pode virar "caso sem nada" e gerar sugestão errada.
    if (r.error) return semSugestao("Não consegui ler o contexto do caso.");
  }
  const cliente = (caso.data as { clientes?: { nome?: string } | null } | null)?.clientes?.nome ?? null;

  const { data: chave, error: errChave } = await admin
    .from("ia_integracoes")
    .select("provider, modelo, api_key_cipher, api_key_iv")
    .eq("compartilhada", true)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();
  if (errChave) return semSugestao("Não consegui carregar a IA do escritório.");
  if (!chave) return semSugestao("A IA do escritório não está configurada.");

  const meta = (tarefa.metadata ?? {}) as { template_aplicado?: string };
  const contexto = [
    `Hoje: ${hojeBR()}.`,
    `Caso: beneficio "${caso.data?.tipo_beneficio ?? "?"}", fase "${caso.data?.fase ?? "?"}", status "${caso.data?.status ?? "?"}".`,
    `Tarefa concluida agora: "${semCliente(tarefa.titulo, cliente)}" (tipo ${tarefa.tipo}` +
      `${meta.template_aplicado ? `, template ${meta.template_aplicado}` : ""}` +
      `${tarefa.processo_judicial_id ? ", processo judicial" : tarefa.processo_admin_id ? ", processo administrativo" : ""}).`,
    tarefa.descricao ? `Descricao da concluida: ${String(tarefa.descricao).slice(0, 500)}` : "",
    "Tarefas ABERTAS no caso:",
    ...(abertas.data ?? []).map((t) => `- ${semCliente(t.titulo, cliente)} (vence ${dataBR(t.due_at)})`),
    (abertas.data ?? []).length === 0 ? "- nenhuma" : "",
    "Tarefas concluidas recentes:",
    ...(feitas.data ?? []).map((t) => `- ${semCliente(t.titulo, cliente)} (${dataBR(t.completed_at)})`),
    "Andamentos recentes:",
    ...(andamentos.data ?? []).map((a) =>
      `- ${dataBR(a.data_evento)}: ${a.titulo ?? ""}${a.descricao ? " — " + String(a.descricao).slice(0, 200) : ""}`
    ),
  ].filter(Boolean).join("\n");

  let bruto: Record<string, unknown> | null = null;
  try {
    const apiKey = await decryptSecret(chave.api_key_cipher, chave.api_key_iv);
    const res = await comTimeout(chatWith(chave.provider, apiKey, chave.modelo, {
      system: SYSTEM,
      maxTokens: 500,
      tools: [],
      attachments: [],
      messages: [{ role: "user", content: contexto.slice(0, 12_000) }],
    }));
    bruto = extrairJson(res.text || "");
  } catch (err) {
    console.warn("[sugerir-proxima-tarefa] IA falhou:", err);
    return semSugestao("A IA não respondeu a tempo.");
  }
  if (!bruto) return semSugestao("A IA não devolveu uma sugestão válida.");

  const motivo = typeof bruto.motivo === "string" ? bruto.motivo.slice(0, 240) : null;
  const s = bruto.sugestao as Record<string, unknown> | null;
  const titulo = typeof s?.titulo === "string" ? s.titulo.trim().slice(0, 120) : "";
  if (!s || !titulo) return semSugestao(motivo ?? "A IA não viu próximo passo para este caso.");

  const tipo = TIPOS.includes(s.tipo as typeof TIPOS[number]) ? (s.tipo as string) : "interna";
  const prioridade = [1, 2, 3].includes(Number(s.prioridade)) ? Number(s.prioridade) : 2;
  const dias = Math.min(30, Math.max(1, Math.round(Number(s.prazo_dias_uteis) || 3)));
  const mesmoProcesso = s.mesmo_processo !== false;

  // Responsável: a escada do caso, preferindo quem cuidava da concluída.
  let responsavelId: string | null = null;
  let responsavelNome: string | null = null;
  const { data: resp, error: errResp } = await admin.rpc("responsavel_tarefa_caso", {
    p_caso_id: tarefa.caso_id,
    p_preferido: tarefa.responsavel_id,
  });
  if (!errResp && typeof resp === "string") {
    responsavelId = resp;
    const { data: u } = await admin.from("usuarios").select("nome").eq("id", resp).maybeSingle();
    responsavelNome = u?.nome ?? null;
  }

  return jsonResponse({
    sugestao: {
      titulo: cliente ? `${titulo} - ${cliente}` : titulo,
      descricao: typeof s.descricao === "string" ? s.descricao.trim().slice(0, 600) : null,
      tipo,
      prioridade,
      due_at: vencimentoDiasUteis(dias),
      responsavel_id: responsavelId,
      responsavel_nome: responsavelNome,
      processo_admin_id: mesmoProcesso ? tarefa.processo_admin_id : null,
      processo_judicial_id: mesmoProcesso ? tarefa.processo_judicial_id : null,
    },
    motivo,
  });
});

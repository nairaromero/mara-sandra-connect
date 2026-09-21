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
// tarefas abertas e andamentos recentes. TODO texto passa pela máscara — nome do
// cliente e CPF não saem daqui (andamento costuma repetir o título da tarefa,
// que traz o nome). O nome volta só no título, montado aqui.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { chatWith } from "../_shared/ia-providers.ts";
import { extrairJson } from "../_shared/documento-campos.ts";
import { exigirUsuario } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS = ["interna", "prazo", "pericia", "pos_protocolo", "contato_cliente"] as const;

// O popup fica esperando: provedor pendurado vira "não consegui sugerir". O
// signal aborta o fetch em si — nada fica rodando (nem cobrando) depois do limite.
const IA_TIMEOUT_MS = 25_000;

// Tamanho da resposta (#330). O tamanho certo vem do PROMPT, não do corte: o
// que a IA gera já é cobrado, então cortar depois não economiza nada. Os
// limites do prompt são os da tela (o popup mostra título + uma frase); o
// `motivo` só é pedido quando NÃO há sugestão, que é o único caso em que a
// tela o mostra. Com isso a saída cabe em ~100 tokens.
const LIMITE_PROMPT = { titulo: 60, descricao: 140, motivo: 90 };
// Rede de segurança acima do prompt: pequena folga para não cortar à toa.
const LIMITE_CORTE = { titulo: 80, descricao: 180, motivo: 120 };
const MAX_TOKENS_SAIDA = 200;

// Prioridade na MESMA escala da tela (PRIORIDADE_LABEL): 1 Urgente, 2 Alta,
// 3 Normal, 4 Baixa.
const SYSTEM =
  "Voce e assistente de um escritorio de advocacia previdenciaria brasileiro " +
  "(segurados do INSS; processos no INSS e na Justica).\n" +
  "Uma tarefa do caso foi CONCLUIDA. Sugira a UNICA proxima tarefa que mantem o caso andando.\n" +
  "No contexto, o nome do cliente aparece como [cliente] e o CPF como [cpf].\n\n" +
  "REGRAS:\n" +
  "1. Se o proximo passo ja esta nas tarefas abertas, ou nao ha seguimento sensato, " +
  `responda sugestao null com um motivo de ate ${LIMITE_PROMPT.motivo} caracteres.\n` +
  `2. titulo: verbo no infinitivo, ate ${LIMITE_PROMPT.titulo} caracteres, sem nome do ` +
  "cliente e sem [cliente]/[cpf] (ex.: 'Acompanhar implantacao do beneficio').\n" +
  `3. descricao: UMA frase de ate ${LIMITE_PROMPT.descricao} caracteres com o que fazer; ` +
  "nao repita o titulo; diga 'o cliente', nunca [cliente].\n" +
  "4. tipo: interna | prazo | pericia | pos_protocolo | contato_cliente.\n" +
  "5. prioridade: 1 urgente, 2 alta, 3 normal, 4 baixa.\n" +
  "6. prazo_dias_uteis: inteiro de 1 a 30 a partir de hoje.\n" +
  "7. mesmo_processo: true se for do mesmo processo da concluida.\n\n" +
  "Responda SO o JSON, sem markdown e sem texto fora dele, num destes formatos:\n" +
  '{"sugestao":{"titulo":"...","descricao":"...","tipo":"...","prioridade":3,' +
  '"prazo_dias_uteis":5,"mesmo_processo":true}}\n' +
  '{"sugestao":null,"motivo":"..."}';

const TZ = "America/Sao_Paulo";
// Criados uma vez por isolate: Intl.DateTimeFormat é caro e o contexto formata
// dezenas de datas por chamada.
const FMT_CHAVE = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const FMT_DIA_MES = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });

const pad = (n: number) => String(n).padStart(2, "0");

// "aaaa-mm-dd" de hoje em Brasília.
const hojeBR = () => FMT_CHAVE.format(new Date());

const dataBR = (iso: string | null) => (iso ? FMT_DIA_MES.format(new Date(iso)) : "sem data");

// `hoje` + N dias úteis (sáb/dom não contam; feriado não entra), às 09:00 de
// Brasília (-03:00, sem horário de verão desde 2019).
function vencimentoDiasUteis(hoje: string, n: number): string {
  const [y, m, d] = hoje.split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d));
  let restantes = n;
  while (restantes > 0) {
    dia.setUTCDate(dia.getUTCDate() + 1);
    if (dia.getUTCDay() !== 0 && dia.getUTCDay() !== 6) restantes--;
  }
  const chave = `${dia.getUTCFullYear()}-${pad(dia.getUTCMonth() + 1)}-${pad(dia.getUTCDate())}`;
  return new Date(`${chave}T09:00:00-03:00`).toISOString();
}

const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

// Máscara de todo texto que vai pra IA. "Analisar CNIS - Maria da Silva" →
// "Analisar CNIS"; o nome no meio de um andamento vira "[cliente]"; CPF vira
// "[cpf]". As regex saem uma vez por chamada, não uma por linha do contexto.
function criarMascara(cliente: string | null): (texto: unknown) => string {
  const nome = cliente?.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sufixo = nome ? new RegExp(`\\s*-\\s*${nome}\\s*$`, "i") : null;
  const noMeio = nome ? new RegExp(nome, "gi") : null;
  return (texto) => {
    let t = texto == null ? "" : String(texto);
    if (sufixo && noMeio) t = t.replace(sufixo, "").replace(noMeio, "[cliente]");
    return t.replace(CPF_RE, "[cpf]");
  };
}

// A IA às vezes ecoa os marcadores mesmo instruída a não usar.
const semMarcadores = (t: string) =>
  t.replace(/\s*\[cpf\]/gi, "").replace(/\[cliente\]/gi, "o cliente").trim();

// Texto da IA pronto para a tela. Se passar bem do que o prompt pediu, corta em
// fim de palavra (nunca no meio) e avisa no log: é sinal de que o prompt precisa
// de ajuste, não um caminho normal.
function aparar(valor: unknown, campo: keyof typeof LIMITE_CORTE): string {
  if (typeof valor !== "string") return "";
  const t = semMarcadores(valor);
  const max = LIMITE_CORTE[campo];
  if (t.length <= max) return t;
  console.warn(`[sugerir-proxima-tarefa] ${campo} veio com ${t.length} caracteres (prompt pede ${LIMITE_PROMPT[campo]})`);
  const base = t.slice(0, max - 1);
  const espaco = base.lastIndexOf(" ");
  return (espaco > max * 0.6 ? base.slice(0, espaco) : base).replace(/[\s,;:.-]+$/, "") + "…";
}

function semSugestao(motivo: string) {
  return jsonResponse({ sugestao: null, motivo });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);

  // Checagem no topo: antes ela vinha depois das variáveis de ambiente e do corpo, então a função respondia (400/500, e até 200) sem saber quem chamou. `exigirUsuario` também confere `ativo`, que faltava aqui.
  const quem = await exigirUsuario(req, { tipo: "interno" });
  if (quem instanceof Response) return quem;
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: "secrets ausentes" }, 500);

  let tarefaId = "";
  try {
    tarefaId = String((await req.json())?.tarefa_id ?? "");
  } catch {
    return jsonResponse({ error: "body invalido" }, 400);
  }
  if (!UUID_RE.test(tarefaId)) return jsonResponse({ error: "tarefa_id invalido" }, 400);

  const admin = quem.admin;


  // A chave não depende da tarefa: as duas leituras saem juntas, e sem chave a
  // função responde antes de ler o contexto do caso (o staging não tem chave).
  const [resTarefa, resChave] = await Promise.all([
    admin
      .from("tarefas")
      .select("id, titulo, descricao, tipo, caso_id, responsavel_id, processo_admin_id, processo_judicial_id, metadata")
      .eq("id", tarefaId)
      .maybeSingle(),
    admin
      .from("ia_integracoes")
      .select("provider, modelo, api_key_cipher, api_key_iv")
      .eq("compartilhada", true)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle(),
  ]);
  if (resTarefa.error) return jsonResponse({ error: "falha ao ler a tarefa" }, 500);
  const tarefa = resTarefa.data;
  if (!tarefa) return jsonResponse({ error: "tarefa nao encontrada" }, 404);
  if (!tarefa.caso_id) return semSugestao("A tarefa não tem caso ligado.");
  if (resChave.error) return semSugestao("Não consegui carregar a IA do escritório.");
  const chave = resChave.data;
  if (!chave) return semSugestao("A IA do escritório não está configurada.");

  // Responsável: a escada do caso, preferindo quem cuidava da concluída. Não
  // depende da IA, então roda junto com o contexto. Falha aqui não derruba a
  // sugestão — o formulário cai no "Definir automaticamente".
  const responsavel = (async (): Promise<{ id: string | null; nome: string | null }> => {
    try {
      const { data: id, error } = await admin.rpc("responsavel_tarefa_caso", {
        p_caso_id: tarefa.caso_id,
        p_preferido: tarefa.responsavel_id,
      });
      if (error) console.warn("[sugerir-proxima-tarefa] responsavel_tarefa_caso:", error.message);
      if (error || typeof id !== "string") return { id: null, nome: null };
      const { data: u, error: errU } = await admin.from("usuarios").select("nome").eq("id", id).maybeSingle();
      if (errU) console.warn("[sugerir-proxima-tarefa] nome do responsavel:", errU.message);
      return { id, nome: u?.nome ?? null };
    } catch (err) {
      console.warn("[sugerir-proxima-tarefa] responsavel:", err);
      return { id: null, nome: null };
    }
  })();

  const [caso, abertas, feitas, andamentos, resp] = await Promise.all([
    admin.from("casos").select("tipo_beneficio, fase, status, clientes(nome)").eq("id", tarefa.caso_id).maybeSingle(),
    admin.from("tarefas").select("titulo, due_at").eq("caso_id", tarefa.caso_id)
      .eq("status", "a_fazer").neq("id", tarefa.id).order("due_at", { ascending: true }).limit(15),
    admin.from("tarefas").select("titulo, completed_at").eq("caso_id", tarefa.caso_id)
      .eq("status", "feito").neq("id", tarefa.id).order("completed_at", { ascending: false }).limit(6),
    admin.from("andamentos").select("titulo, descricao, data_evento").eq("caso_id", tarefa.caso_id)
      .order("data_evento", { ascending: false }).limit(10),
    responsavel,
  ]);
  for (const r of [caso, abertas, feitas, andamentos]) {
    // Contexto que falhou não pode virar "caso sem nada" e gerar sugestão errada.
    if (r.error) return semSugestao("Não consegui ler o contexto do caso.");
  }
  const cliente = (caso.data as { clientes?: { nome?: string } | null } | null)?.clientes?.nome ?? null;
  const mascarar = criarMascara(cliente);
  const hoje = hojeBR();

  const meta = (tarefa.metadata ?? {}) as { template_aplicado?: string };
  const listaAbertas = abertas.data ?? [];
  const contexto = [
    `Hoje: ${hoje}.`,
    `Caso: beneficio "${caso.data?.tipo_beneficio ?? "?"}", fase "${caso.data?.fase ?? "?"}", status "${caso.data?.status ?? "?"}".`,
    `Tarefa concluida agora: "${mascarar(tarefa.titulo)}" (tipo ${tarefa.tipo}` +
      `${meta.template_aplicado ? `, template ${meta.template_aplicado}` : ""}` +
      `${tarefa.processo_judicial_id ? ", processo judicial" : tarefa.processo_admin_id ? ", processo administrativo" : ""}).`,
    // Mascara ANTES de cortar: o corte no meio do nome deixaria um pedaço dele.
    tarefa.descricao ? `Descricao da concluida: ${mascarar(tarefa.descricao).slice(0, 500)}` : "",
    "Tarefas ABERTAS no caso:",
    ...listaAbertas.map((t) => `- ${mascarar(t.titulo)} (vence ${dataBR(t.due_at)})`),
    listaAbertas.length === 0 ? "- nenhuma" : "",
    "Tarefas concluidas recentes:",
    ...(feitas.data ?? []).map((t) => `- ${mascarar(t.titulo)} (${dataBR(t.completed_at)})`),
    "Andamentos recentes:",
    ...(andamentos.data ?? []).map((a) =>
      `- ${dataBR(a.data_evento)}: ${mascarar(a.titulo)}${a.descricao ? " — " + mascarar(a.descricao).slice(0, 200) : ""}`
    ),
  ].filter(Boolean).join("\n");

  let bruto: Record<string, unknown> | null = null;
  try {
    const apiKey = await decryptSecret(chave.api_key_cipher, chave.api_key_iv);
    const res = await chatWith(chave.provider, apiKey, chave.modelo, {
      system: SYSTEM,
      maxTokens: MAX_TOKENS_SAIDA,
      tools: [],
      messages: [{ role: "user", content: contexto.slice(0, 12_000) }],
      signal: AbortSignal.timeout(IA_TIMEOUT_MS),
    });
    // Gasto por chamada, para acompanhar nos logs da função (#330).
    console.log(`[sugerir-proxima-tarefa] tokens entrada=${res.usage.input} saida=${res.usage.output}`);
    bruto = extrairJson(res.text || "");
  } catch (err) {
    console.warn("[sugerir-proxima-tarefa] IA falhou:", err);
    const estourou = err instanceof DOMException && err.name === "TimeoutError";
    return semSugestao(estourou ? "A IA não respondeu a tempo." : "A IA falhou ao sugerir a próxima tarefa.");
  }
  if (!bruto) return semSugestao("A IA não devolveu uma sugestão válida.");

  const s = bruto.sugestao as Record<string, unknown> | null;
  const titulo = aparar(s?.titulo, "titulo");
  if (!s || !titulo) {
    return semSugestao(aparar(bruto.motivo, "motivo") || "A IA não viu próximo passo para este caso.");
  }

  const tipo = TIPOS.includes(s.tipo as typeof TIPOS[number]) ? (s.tipo as string) : "interna";
  const prioridade = [1, 2, 3, 4].includes(Number(s.prioridade)) ? Number(s.prioridade) : 3;
  const dias = Math.min(30, Math.max(1, Math.round(Number(s.prazo_dias_uteis) || 3)));
  const mesmoProcesso = s.mesmo_processo !== false;

  return jsonResponse({
    sugestao: {
      titulo: cliente ? `${titulo} - ${cliente}` : titulo,
      descricao: aparar(s.descricao, "descricao") || null,
      tipo,
      prioridade,
      due_at: vencimentoDiasUteis(hoje, dias),
      responsavel_id: resp.id,
      responsavel_nome: resp.nome,
      processo_admin_id: mesmoProcesso ? tarefa.processo_admin_id : null,
      processo_judicial_id: mesmoProcesso ? tarefa.processo_judicial_id : null,
    },
    // Com sugestão a tela não mostra motivo, e o prompt nem o pede.
    motivo: null,
  });
});

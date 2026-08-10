// supabase/functions/ia-triagem-andamentos/index.ts
//
// Fase 4 do planning/PROCESSOS_GLOBAL.md: IA nas movimentações.
//
// Pega andamentos automáticos recentes (origem datajud/djen) ainda sem análise
// e, em UMA chamada ao modelo (batch), gera pra cada um:
//   - resumo em linguagem simples (pro parceiro/cliente entender);
//   - relevância: rotina | atencao | urgente;
//   - sugestão de tarefa (ou null) com tipo, prazo em dias e motivo.
//
// Resultado gravado em andamentos.metadata (ia_resumo, ia_relevancia,
// ia_processado_em). Tarefa sugerida vira registro em `tarefas` com
// origem='ia' e origem_ref='ia:<andamento_id>' — o índice único
// uq_tarefas_origem_ref garante que reprocessar não duplica.
//
// Provider/modelo/chave: mesma infra do assistente (tabela ia_integracoes,
// por usuário interno, chave decriptada via _shared/crypto). A saída
// estruturada usa tool-use (funciona em Anthropic e OpenAI via chatWith).
//
// Chamada (botão "Analisar com IA" do front, ou cron após os syncs):
//   supabase.functions.invoke("ia-triagem-andamentos", {
//     body: { limite: 20, dry_run: false, usuario_id: "<uuid p/ cron>" }
//   })
//   - com JWT de usuário interno, usuario_id é ignorado (usa o da sessão)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

import { chatWith, type ToolDef } from "../_shared/ia-providers.ts";
import { decryptSecret } from "../_shared/crypto.ts";
import { carregarIntegracao } from "../_shared/ia-integracao.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const LIMITE_DEFAULT = 20;
const MAX_LIMITE = 40;
// Só tria movimentação recente. Protege contra backfill histórico (DataJud
// 90 dias): item antigo não vira resumo nem tarefa — ação já foi tomada ou
// prescreveu; triagem retroativa só geraria ruído.
const DIAS_JANELA_DEFAULT = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT =
  "Você é assistente de um escritório de advocacia previdenciária brasileiro " +
  "(clientes segurados do INSS; ações contra o INSS na Justiça Federal e ações cíveis). " +
  "Você recebe movimentações processuais brutas (DataJud/CNJ) e publicações do DJEN e faz a triagem de cada uma.\n\n" +
  "Para CADA item, produza:\n" +
  "1. resumo: 1 a 2 frases em linguagem simples, sem juridiquês, explicando o que aconteceu " +
  "e o que significa pro andamento do caso do cliente. Escreva pro cliente leigo entender.\n" +
  "2. relevancia: 'rotina' (ato ordinatório, remessa, conclusão, juntada trivial — nada a fazer), " +
  "'atencao' (decisão, despacho, publicação que merece leitura, perícia marcada), " +
  "'urgente' (intimação com prazo correndo, sentença, decisão que exige manifestação).\n" +
  "3. tarefa: null quando não há ação concreta pro escritório. Quando houver, sugira UMA tarefa: " +
  "titulo curto e acionável (ex.: 'Analisar sentença e avaliar recurso'), " +
  "tipo ('prazo' quando há prazo processual correndo, 'interna' pra análise/petição sem prazo formal, " +
  "'contato_cliente' quando é preciso avisar ou pedir algo ao cliente), " +
  "dias_prazo (prazo FATAL em dias corridos CONTADOS DA DATA do item — campo 'data' —, não de hoje; " +
  "prazos processuais comuns: 15 dias úteis ≈ 21 corridos pra recurso/contestação/cumprimento de " +
  "determinação; 5 úteis ≈ 7 corridos pra manifestação simples; se o texto disser o prazo, use ele) " +
  "e motivo (1 frase).\n\n" +
  "Movimentações de mero expediente NÃO viram tarefa. Na dúvida entre 'atencao' e 'urgente', use 'urgente'. " +
  "Responda SOMENTE chamando a ferramenta registrar_triagem com todos os itens recebidos.";

const TRIAGEM_TOOL: ToolDef = {
  name: "registrar_triagem",
  description: "Registra a triagem de todas as movimentações analisadas.",
  schema: {
    type: "object",
    properties: {
      itens: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "id do andamento, ecoado do input" },
            resumo: { type: "string" },
            relevancia: { type: "string", enum: ["rotina", "atencao", "urgente"] },
            tarefa: {
              type: ["object", "null"],
              properties: {
                titulo: { type: "string" },
                tipo: { type: "string", enum: ["prazo", "interna", "contato_cliente"] },
                dias_prazo: { type: "integer" },
                motivo: { type: "string" },
              },
              required: ["titulo", "tipo", "dias_prazo", "motivo"],
            },
          },
          required: ["id", "resumo", "relevancia", "tarefa"],
        },
      },
    },
    required: ["itens"],
  },
};

interface TriagemItem {
  id: string;
  resumo: string;
  relevancia: "rotina" | "atencao" | "urgente";
  tarefa: {
    titulo: string;
    tipo: "prazo" | "interna" | "contato_cliente";
    dias_prazo: number;
    motivo: string;
  } | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let limite = LIMITE_DEFAULT;
  let dias = DIAS_JANELA_DEFAULT;
  let dryRun = false;
  let usuarioId: string | null = null;
  let casosFiltro: string[] | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.limite === "number" && body.limite > 0) {
      limite = Math.min(body.limite, MAX_LIMITE);
    }
    if (typeof body.dias === "number" && body.dias > 0) dias = body.dias;
    if (body.dry_run === true) dryRun = true;
    if (body.usuario_id) usuarioId = String(body.usuario_id);
    // Escopo opcional: só triar andamentos destes casos (demo controlada,
    // sem tocar em outros clientes). Sem o filtro, roda em todos (cron).
    if (Array.isArray(body.casos) && body.casos.length > 0) {
      casosFiltro = body.casos.map((c: unknown) => String(c));
    }
  } catch (err) {
    return jsonResponse({ error: "body invalido", detail: String(err) }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // --- Quem é o usuário (JWT do front tem prioridade; cron manda usuario_id) --
  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (jwt && jwt.split(".").length === 3) {
    const { data: u } = await admin.auth.getUser(jwt);
    if (u?.user?.id) usuarioId = u.user.id;
  }
  if (!usuarioId) {
    return jsonResponse({ error: "usuario_id obrigatorio (ou JWT valido)" }, 401);
  }
  const { data: perfil } = await admin
    .from("usuarios")
    .select("tipo")
    .eq("id", usuarioId)
    .maybeSingle();
  if (perfil?.tipo !== "interno") {
    return jsonResponse({ error: "apenas usuario interno" }, 403);
  }

  // --- Integração de IA do usuário (mesma do assistente) --------------------
  // Chave própria; sem ela, cai na compartilhada do escritório (se houver).
  const resIntegracao = await carregarIntegracao(admin, usuarioId);
  if (!resIntegracao.ok) {
    return jsonResponse(
      { error: resIntegracao.error, code: resIntegracao.code },
      resIntegracao.status,
    );
  }
  const integ = resIntegracao.integ;

  // --- Andamentos pendentes de triagem --------------------------------------
  let pendQ = admin
    .from("andamentos")
    .select(
      "id, caso_id, origem, titulo, descricao, data_evento, metadata, " +
        "processo_judicial_id, processo_admin_id, " +
        "casos:caso_id(tipo_beneficio, clientes:cliente_id(nome))",
    )
    .in("origem", ["datajud", "djen"])
    .is("metadata->>ia_resumo", null)
    .gte("data_evento", new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10));
  if (casosFiltro) pendQ = pendQ.in("caso_id", casosFiltro);
  const { data: pendentes, error: pendErr } = await pendQ
    .order("created_at", { ascending: false })
    .limit(limite);
  if (pendErr) {
    return jsonResponse({ error: "andamentos: " + pendErr.message }, 500);
  }
  if (!pendentes || pendentes.length === 0) {
    return jsonResponse({ processados: 0, tarefas_criadas: 0, motivo: "nada pendente" });
  }

  // --- Monta o input e chama o modelo (uma chamada, batch) ------------------
  const linhas = pendentes.map((a) => {
    const m = (a.metadata as Record<string, unknown> | null) || {};
    const caso = a.casos as
      | { tipo_beneficio?: string | null; clientes?: { nome?: string | null } | null }
      | null;
    return {
      id: a.id as string,
      fonte: a.origem === "djen" ? "publicação DJEN" : "movimentação DataJud",
      cliente: caso?.clientes?.nome ?? "?",
      beneficio: caso?.tipo_beneficio ?? "?",
      processo: (m.numero_processo as string | null) ?? null,
      tribunal: (m.tribunal as string | null) ?? (m.sigla_tribunal as string | null),
      data: a.data_evento,
      titulo: a.titulo,
      // Publicações DJEN têm teor longo; 1500 chars bastam pra triagem.
      descricao: (a.descricao as string | null)?.slice(0, 1500) ?? null,
    };
  });

  let apiKey: string;
  try {
    apiKey = await decryptSecret(integ.api_key_cipher, integ.api_key_iv);
  } catch {
    return jsonResponse({ error: "falha ao decriptar a chave de IA" }, 500);
  }

  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  let itens: TriagemItem[];
  try {
    const res = await chatWith(integ.provider, apiKey, integ.modelo, {
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Hoje é ${hoje}. Faça a triagem destes ${linhas.length} itens:\n\n` +
            JSON.stringify(linhas, null, 1),
        },
      ],
      tools: [TRIAGEM_TOOL],
      maxTokens: 8000,
    });
    const call = res.toolCalls.find((t) => t.name === "registrar_triagem");
    if (!call) throw new Error("modelo nao chamou registrar_triagem");
    itens = (call.args.itens as TriagemItem[]) || [];
  } catch (err) {
    return jsonResponse({ error: "ia: " + String(err).slice(0, 300) }, 502);
  }

  if (dryRun) {
    return jsonResponse({ dry_run: true, pendentes: pendentes.length, triagem: itens });
  }

  // --- Aplica: metadata do andamento + tarefa sugerida ----------------------
  const porId = new Map(pendentes.map((a) => [a.id as string, a]));
  let processados = 0;
  let tarefasCriadas = 0;
  const erros: string[] = [];

  for (const item of itens) {
    const and = porId.get(item.id);
    if (!and || !item.resumo) continue;

    const metaAtual = (and.metadata as Record<string, unknown> | null) || {};
    const { error: upErr } = await admin
      .from("andamentos")
      .update({
        metadata: {
          ...metaAtual,
          ia_resumo: item.resumo,
          ia_relevancia: item.relevancia || "rotina",
          ia_processado_em: new Date().toISOString(),
        },
      })
      .eq("id", item.id);
    if (upErr) {
      erros.push(`metadata ${item.id}: ${upErr.message}`);
      continue;
    }
    processados++;

    if (!item.tarefa || !item.tarefa.titulo) continue;

    // Regra do escritório (Naira, 2026-07-29):
    //   1. tarefa de CIÊNCIA vence 1 dia após a publicação/movimentação —
    //      primeiro conhecimento do advogado;
    //   2. quando há prazo processual, a tarefa do prazo vence no FATAL - 1.
    // Datas no passado (item antigo/backfill) sobem pra HOJE — melhor uma
    // tarefa vencendo hoje do que empurrar a ciência pra depois.
    const pubMs = and.data_evento
      ? new Date(String(and.data_evento)).getTime()
      : Date.now();
    const hojeMs = Date.now();
    const diaISO = (ms: number) =>
      new Date(Math.max(ms, hojeMs)).toISOString().slice(0, 10);

    const base = {
      caso_id: and.caso_id,
      processo_judicial_id: and.processo_judicial_id,
      processo_admin_id: and.processo_admin_id,
      status: "a_fazer",
      origem: "ia",
      metadata: { andamento_id: item.id, ia_relevancia: item.relevancia },
      created_by: usuarioId,
    };
    const inserts: Array<Record<string, unknown>> = [];

    const temPrazoFatal = item.tarefa.tipo === "prazo";
    inserts.push({
      ...base,
      tipo: temPrazoFatal ? "interna" : item.tarefa.tipo || "interna",
      prioridade: item.relevancia === "urgente" ? 1 : 2,
      titulo: temPrazoFatal ? `Ciência: ${item.tarefa.titulo}` : item.tarefa.titulo,
      descricao:
        `${item.tarefa.motivo}\n\nSugerida pela IA a partir de: ` +
        `${and.titulo || "movimentação"} (${String(and.data_evento || "").slice(0, 10)}).`,
      due_at: diaISO(pubMs + 86400000) + "T17:00:00-03:00",
      origem_ref: `ia:${item.id}:ciencia`,
    });

    if (temPrazoFatal) {
      const dias = Math.max(1, Math.min(item.tarefa.dias_prazo || 7, 90));
      const fatalMs = pubMs + dias * 86400000;
      const fatalISO = new Date(fatalMs).toISOString().slice(0, 10);
      inserts.push({
        ...base,
        tipo: "prazo",
        prioridade: 1,
        titulo: item.tarefa.titulo,
        descricao:
          `${item.tarefa.motivo}\n\nPrazo fatal estimado: ${fatalISO} ` +
          `(vencimento antecipado em 1 dia). Sugerida pela IA a partir de: ` +
          `${and.titulo || "movimentação"} (${String(and.data_evento || "").slice(0, 10)}).`,
        due_at: diaISO(fatalMs - 86400000) + "T17:00:00-03:00",
        origem_ref: `ia:${item.id}:fatal`,
      });
    }

    for (const ins of inserts) {
      const { error: tarErr } = await admin.from("tarefas").insert(ins);
      if (tarErr) {
        // 23505 = já existe tarefa pra esse andamento (reprocessamento) — ok.
        if (!tarErr.message.includes("duplicate") && !tarErr.message.includes("23505")) {
          erros.push(`tarefa ${item.id}: ${tarErr.message}`);
        }
      } else {
        tarefasCriadas++;
      }
    }
  }

  return jsonResponse({
    pendentes: pendentes.length,
    processados,
    tarefas_criadas: tarefasCriadas,
    modelo: `${integ.provider}/${integ.modelo}`,
    erros: erros.slice(0, 10),
  });
});

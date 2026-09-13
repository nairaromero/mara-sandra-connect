// =============================================================================
// Edge Function: ler-audiencia-publicacao
//
// Chamada pelo gatilho trg_audiencia_publicacao_ler (pg_net) quando entra um
// andamento de tribunal (DJEN/DataJud) que fala em audiência designada.
//
// Lê a publicação com a IA DO ESCRITÓRIO (chave compartilhada em
// ia_integracoes — decisão da Naira, 2026-09-13) e entrega a leitura pra
// public.aplicar_audiencia_da_publicacao, que faz tudo no banco numa transação:
// evento na agenda + tarefas do template + aviso ao parceiro completo, ou a
// tarefa "Conferir audiência" quando não há data.
//
// Body: { andamento_id: uuid }
//
// Sem JWT (pg_net não manda): a função só aceita andamento que o próprio
// gatilho aceitaria (de tribunal, recente, com audiência no texto) e ainda não
// lido — chamar de fora não cria nada que a publicação real não criaria, e
// cada andamento gasta no máximo UMA leitura.
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
const MAX_TEXTO = 15_000;
const JANELA_MS = 30 * 86_400_000;

// Provedor pendurado não pode segurar a leitura: estourou, vira "conferir".
const IA_TIMEOUT_MS = 45_000;
function comTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout da IA (45s)")), IA_TIMEOUT_MS)
    ),
  ]);
}

const SYSTEM =
  "Voce le publicacoes e movimentacoes processuais brasileiras (DJEN, DataJud) " +
  "para um escritorio de advocacia previdenciaria e extrai a AUDIENCIA designada.\n\n" +
  "REGRAS:\n" +
  "1. designacao = true SOMENTE se o texto designa, redesigna, marca ou intima " +
  "para uma audiencia com data a acontecer. designacao = false para: termo/ata " +
  "de audiencia que ja aconteceu, cancelamento, dispensa ou desnecessidade de " +
  "audiencia, pedido de designacao, 'data a ser marcada/designada oportunamente'.\n" +
  "2. Em redesignacao, use a NOVA data. Nunca use a data do despacho, da " +
  "publicacao, da disponibilizacao ou de prazos.\n" +
  "3. data em AAAA-MM-DD; hora em HH:MM 24h ('16 horas' = 16:00; '14h00min' = " +
  "14:00). Sem hora escrita no texto = null. Nunca deduza nem invente.\n" +
  "4. local = sala, vara, CEJUSC ou forma (ex.: 'Sala virtual - CEJUSC', " +
  "'Videoconferencia (Microsoft Teams)'); link_sala = URL de acesso, se houver.\n" +
  "5. tipo_audiencia = ex.: 'Conciliacao (art. 334 CPC)', 'Instrucao e julgamento'.\n" +
  "6. motivo = uma frase curta explicando a decisao (ex.: 'termo de audiencia " +
  "ja realizada', 'data a ser marcada pelo CEJUSC').\n\n" +
  "RESPONDA APENAS com JSON neste formato exato:\n" +
  '{"designacao": true|false, "data": "AAAA-MM-DD"|null, "hora": "HH:MM"|null, ' +
  '"local": string|null, "link_sala": string|null, "tipo_audiencia": string|null, ' +
  '"motivo": string}';

interface Leitura {
  designacao: boolean;
  data: string | null;
  hora: string | null;
  local: string | null;
  link_sala: string | null;
  tipo_audiencia: string | null;
  motivo: string | null;
  erro?: string;
}

const texto = (v: unknown, max = 300): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

// Só passa adiante o que tem forma de data/hora de verdade.
function normalizar(bruto: Record<string, unknown>): Leitura {
  const data = texto(bruto.data, 10);
  const hora = texto(bruto.hora, 5);
  return {
    designacao: bruto.designacao === true,
    data: data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null,
    hora: hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora) ? hora : null,
    local: texto(bruto.local),
    link_sala: texto(bruto.link_sala, 500),
    tipo_audiencia: texto(bruto.tipo_audiencia, 120),
    motivo: texto(bruto.motivo, 200),
  };
}

function falha(erro: string): Leitura {
  return {
    designacao: false, data: null, hora: null, local: null, link_sala: null,
    tipo_audiencia: null, motivo: null, erro: erro.slice(0, 160),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "secrets ausentes na funcao" }, 500);
  }

  let andamentoId = "";
  try {
    andamentoId = String((await req.json())?.andamento_id ?? "");
  } catch {
    return jsonResponse({ error: "body invalido" }, 400);
  }
  if (!UUID_RE.test(andamentoId)) return jsonResponse({ error: "andamento_id invalido" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: and, error: errAnd } = await admin
    .from("andamentos")
    .select("id, caso_id, origem, titulo, descricao, data_evento, metadata")
    .eq("id", andamentoId)
    .maybeSingle();
  if (errAnd) {
    console.error("[ler-audiencia-publicacao] andamento:", errAnd.message);
    return jsonResponse({ error: "falha ao ler o andamento" }, 500);
  }
  if (!and) return jsonResponse({ error: "andamento nao encontrado" }, 404);

  // Mesmas condições do gatilho — chamada de fora não amplia nada.
  const meta = (and.metadata ?? {}) as Record<string, unknown>;
  const fonte = `${and.titulo ?? ""}\n${and.descricao ?? ""}`;
  if (meta.audiencia_leitura) return jsonResponse({ status: "ja_processada" });
  const recente = !and.data_evento ||
    Date.now() - new Date(and.data_evento).getTime() <= JANELA_MS;
  if (
    !and.caso_id || !["djen", "datajud"].includes(and.origem) || meta.tipo_aviso ||
    !recente || !/audi[eê]nci/i.test(fonte) ||
    !/(marcad|agendad|designad|redesignad|pautad|\bdesign[oa]\b)/i.test(fonte)
  ) {
    return jsonResponse({ status: "fora_do_escopo" });
  }

  let leitura: Leitura;
  const { data: chave, error: errChave } = await admin
    .from("ia_integracoes")
    .select("provider, modelo, api_key_cipher, api_key_iv")
    .eq("compartilhada", true)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();
  if (errChave) {
    // Erro de consulta NÃO é "sem chave": registra como falha de leitura.
    console.error("[ler-audiencia-publicacao] chave:", errChave.message);
    leitura = falha("não consegui carregar a IA do escritório");
  } else if (!chave) {
    leitura = falha("IA do escritório não configurada");
  } else {
    try {
      const apiKey = await decryptSecret(chave.api_key_cipher, chave.api_key_iv);
      const publicadoEm = and.data_evento
        ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(
          new Date(and.data_evento),
        )
        : "desconhecida";
      const res = await comTimeout(chatWith(chave.provider, apiKey, chave.modelo, {
        system: SYSTEM,
        maxTokens: 500,
        tools: [],
        attachments: [],
        messages: [{
          role: "user",
          content:
            `Data da publicacao: ${publicadoEm}. Fonte: ${and.origem}.\n` +
            "Extraia a audiencia do texto abaixo. Responda apenas com o JSON.\n\n" +
            fonte.slice(0, MAX_TEXTO),
        }],
      }));
      const bruto = extrairJson(res.text || "");
      leitura = bruto ? normalizar(bruto) : falha("a IA não devolveu uma leitura válida");
    } catch (err) {
      console.warn("[ler-audiencia-publicacao] IA falhou:", err);
      leitura = falha(err instanceof Error ? err.message : "erro na IA");
    }
  }

  const { data: resultado, error: errAplicar } = await admin.rpc(
    "aplicar_audiencia_da_publicacao",
    { p_andamento_id: andamentoId, p_leitura: leitura },
  );
  if (errAplicar) {
    console.error("[ler-audiencia-publicacao] aplicar:", errAplicar.message);
    return jsonResponse({ error: "falha ao aplicar a leitura" }, 500);
  }
  console.log("[ler-audiencia-publicacao]", andamentoId, JSON.stringify(resultado));
  return jsonResponse(resultado);
});

// supabase/functions/listar-processos-legalmail/index.ts
//
// Lista os processos que existem no Legalmail mas ainda NAO estao no sistema,
// pra equipe importar um a um. Espelha o `listar-clientes-ti`, que faz o mesmo
// com o Tramitacao Inteligente.
//
// NAO GRAVA NADA. So le do Legalmail e cruza com o banco. Quem cria cliente/caso
// e a tela, depois da conferencia — mesma divisao do dialog "Importar do TI".
//
// POR QUE /lawsuit/search E NAO /lawsuit/all:
// O /all e gratuito mas devolve um registro MAGRO — `poloativo_nome` vem vazio
// em todos. Foi isso que quebrou o `check-legalmail-nome` desde maio: ele
// comparava nomes contra um campo sempre vazio e retornava 0 pra tudo, sem erro.
// O /search e cobrado, mas devolve `polo_ativo` na propria listagem. Sao ~17
// requests pro acervo inteiro, contra 810 chamadas ao /detail. A cobranca nao
// pesa: so 2xx cobra, GET identico nao recobra (janela de 5 min neste endpoint),
// e o consumo do workspace era R$ 0,15 em 30 dias com saldo de R$ 572.
//
// CPF: o Legalmail NAO devolve documento do polo ativo em lugar nenhum util
// (/lawsuit/detail so tem nome; /party tem documento mas so ~23% preenchido e
// quase tudo sem nome; /pleading/requesters exige id de peticao). Entao o
// casamento com `clientes` e por NOME, e por isso cada item vem com `match`
// dizendo o que a tela deve fazer — nunca vincular sozinho:
//   - "cliente_existe": 1 cliente com nome igual -> propor, pessoa confirma
//   - "ambiguo":        2+ clientes com nome igual -> pessoa escolhe
//   - "cliente_novo":   nenhum -> criar cliente novo
//   - "sem_nome":       Legalmail nao mandou nome -> escolher cliente a mao
//
// Body: { limite_novos?: number, so_resumo?: boolean }
// Resp: { total_legalmail, ja_no_sistema, novos, resumo_match, risco_homonimo,
//         processos: [...] }
//
// Secrets: LEGALMAIL_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const LM_BASE = "https://app.legalmail.com.br";
const LM_TOKEN = Deno.env.get("LEGALMAIL_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Rate limit do Legalmail: 30 req/min, com bloqueio progressivo (10min -> 30min
// -> ... -> 7 dias) se violar. Nao vale economizar aqui.
const PAGE = 50;
const PAUSA_MS = 2100;
const MAX_PAGINAS = 60;

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

const soDigitos = (s: string) => String(s || "").replace(/\D/g, "");

// Mesma normalizacao dos outros pontos que comparam nome.
function normNome(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface ProcessoLM {
  idprocessos?: number | string;
  numero_processo?: string;
  polo_ativo?: string;
  polo_passivo?: string;
  nome_classe?: string;
  assunto?: string;
  tribunal?: string;
  orgao_julgador?: string;
  grau?: string;
  advogado_responsavel?: string;
  valor_causa?: number | string | null;
  data_distribuicao?: string | null;
  data_cadastro?: string | null;
  etiquetas?: Array<string>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "metodo nao permitido" }, 405);
  if (!LM_TOKEN) return jsonResponse({ error: "LEGALMAIL_TOKEN nao configurado" }, 500);
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  // ---------------------------------------------------------------------------
  // 1) So interno
  // ---------------------------------------------------------------------------
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "sem authorization header" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userResp, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userResp.user) return jsonResponse({ error: "jwt invalido" }, 401);

  const { data: perfil } = await admin
    .from("usuarios").select("tipo").eq("id", userResp.user.id).maybeSingle();
  if ((perfil as { tipo?: string } | null)?.tipo !== "interno") {
    return jsonResponse({ error: "apenas usuarios internos" }, 403);
  }

  let limiteNovos = 800;
  let soResumo = false;
  try {
    const body = await req.json();
    if (body?.so_resumo === true) soResumo = true;
    if (Number.isFinite(Number(body?.limite_novos))) {
      limiteNovos = Math.max(1, Math.min(2000, Number(body.limite_novos)));
    }
  } catch { /* body vazio e valido */ }

  // ---------------------------------------------------------------------------
  // 2) Estado atual do banco
  // ---------------------------------------------------------------------------
  const { data: procsDb, error: procsErr } = await admin
    .from("processos_judiciais").select("numero_proc_normalizado, legalmail_id");
  if (procsErr) {
    return jsonResponse({ error: "erro ao ler processos", detail: procsErr.message }, 500);
  }
  const numerosDb = new Set<string>();
  const lmIdsDb = new Set<string>();
  for (const p of (procsDb || []) as Array<Record<string, unknown>>) {
    if (p.numero_proc_normalizado) numerosDb.add(String(p.numero_proc_normalizado));
    if (p.legalmail_id) lmIdsDb.add(String(p.legalmail_id));
  }

  const { data: clientesDb, error: cliErr } = await admin
    .from("clientes").select("id, nome, cpf");
  if (cliErr) {
    return jsonResponse({ error: "erro ao ler clientes", detail: cliErr.message }, 500);
  }
  // nome normalizado -> clientes com aquele nome. Lista com 2+ ja e homonimo
  // DENTRO da nossa propria base.
  const porNome = new Map<string, Array<{ id: string; cpf: string | null }>>();
  for (
    const c of (clientesDb || []) as Array<
      { id: string; nome: string | null; cpf: string | null }
    >
  ) {
    const k = normNome(c.nome || "");
    if (!k) continue;
    const arr = porNome.get(k);
    if (arr) arr.push({ id: c.id, cpf: c.cpf });
    else porNome.set(k, [{ id: c.id, cpf: c.cpf }]);
  }
  const homonimosNaBase = [...porNome.values()].filter((v) => v.length > 1).length;

  // ---------------------------------------------------------------------------
  // 3) Pagina o Legalmail via /lawsuit/search (traz polo_ativo na listagem)
  // ---------------------------------------------------------------------------
  const novos: Array<Record<string, unknown>> = [];
  const nomesNovos = new Map<string, number>(); // nome normalizado -> nº de processos
  let totalLegalmail = 0;
  let jaNoSistema = 0;
  let semNome = 0;
  let offset = 0;
  let paginas = 0;
  let totalDeclarado: number | null = null;

  while (paginas < MAX_PAGINAS) {
    let resp: Response;
    try {
      resp = await fetch(
        `${LM_BASE}/api/v1/lawsuit/search?api_key=${LM_TOKEN}&offset=${offset}&limit=${PAGE}`,
        { headers: { Accept: "application/json" } },
      );
    } catch (err) {
      return jsonResponse({ error: "erro de rede no legalmail", detail: String(err) }, 502);
    }
    if (resp.status === 429) {
      return jsonResponse({ error: "rate limit do Legalmail", offset_alcancado: offset }, 429);
    }
    if (resp.status === 402) {
      return jsonResponse(
        { error: "saldo de creditos insuficiente no Legalmail", offset_alcancado: offset },
        402,
      );
    }
    if (!resp.ok) {
      return jsonResponse(
        {
          error: "legalmail_api_error",
          status: resp.status,
          detail: (await resp.text()).slice(0, 200),
        },
        502,
      );
    }

    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      return jsonResponse({ error: "resposta nao-json do legalmail" }, 502);
    }
    const o = (data ?? {}) as {
      total?: number;
      lawsuits?: Array<ProcessoLM>;
      message?: string;
    };
    if (!Array.isArray(o.lawsuits)) {
      return jsonResponse(
        {
          error: "legalmail_resposta_inesperada",
          detail: o.message || JSON.stringify(data).slice(0, 200),
        },
        502,
      );
    }
    if (totalDeclarado === null && Number.isFinite(Number(o.total))) {
      totalDeclarado = Number(o.total);
    }

    const lista = o.lawsuits;
    paginas++;
    totalLegalmail += lista.length;

    for (const p of lista) {
      const numero = soDigitos(p.numero_processo || "");
      const lmId = String(p.idprocessos ?? "");
      if ((numero && numerosDb.has(numero)) || (lmId && lmIdsDb.has(lmId))) {
        jaNoSistema++;
        continue;
      }

      const nomeRaw = (p.polo_ativo || "").trim();
      if (!nomeRaw) semNome++;
      const chave = normNome(nomeRaw);
      if (chave) nomesNovos.set(chave, (nomesNovos.get(chave) ?? 0) + 1);

      const achados = chave ? porNome.get(chave) : undefined;
      const match = !chave
        ? "sem_nome"
        : !achados
        ? "cliente_novo"
        : achados.length === 1
        ? "cliente_existe"
        : "ambiguo";

      if (soResumo) {
        novos.push({ match });
      } else if (novos.length < limiteNovos) {
        novos.push({
          legalmail_id: lmId,
          numero_processo: p.numero_processo ?? null,
          polo_ativo: nomeRaw || null,
          polo_passivo: p.polo_passivo ?? null,
          tribunal: p.tribunal ?? null,
          orgao_julgador: p.orgao_julgador ?? null,
          assunto: p.assunto ?? null,
          nome_classe: p.nome_classe ?? null,
          advogado_responsavel: p.advogado_responsavel ?? null,
          valor_causa: p.valor_causa ?? null,
          data_distribuicao: p.data_distribuicao ?? null,
          etiquetas: p.etiquetas ?? null,
          match,
          cliente_id: achados && achados.length === 1 ? achados[0].id : null,
          clientes_possiveis: achados && achados.length > 1 ? achados.map((a) => a.id) : null,
        });
      }
    }

    if (lista.length < PAGE) break;
    offset += PAGE;
    await new Promise((r) => setTimeout(r, PAUSA_MS));
  }

  const contar = (m: string) => novos.filter((n) => n.match === m).length;

  // Quantos NOMES distintos (nao processos) caem em cada situacao — e o numero
  // que dimensiona o trabalho manual, ja que um cliente costuma ter varios
  // processos.
  let nomesSemCliente = 0;
  let nomesAmbiguos = 0;
  let nomesQueCasam = 0;
  for (const chave of nomesNovos.keys()) {
    const a = porNome.get(chave);
    if (!a) nomesSemCliente++;
    else if (a.length === 1) nomesQueCasam++;
    else nomesAmbiguos++;
  }

  return jsonResponse({
    total_legalmail: totalLegalmail,
    total_declarado_api: totalDeclarado,
    ja_no_sistema: jaNoSistema,
    novos: totalLegalmail - jaNoSistema,
    paginas_lidas: paginas,
    sem_polo_ativo: semNome,
    resumo_match: {
      cliente_existe: contar("cliente_existe"),
      cliente_novo: contar("cliente_novo"),
      ambiguo: contar("ambiguo"),
      sem_nome: contar("sem_nome"),
    },
    // O tamanho real do problema de homonimo.
    risco_homonimo: {
      nomes_distintos_no_legalmail: nomesNovos.size,
      nomes_que_casam_com_1_cliente: nomesQueCasam,
      nomes_ambiguos_2_ou_mais_clientes: nomesAmbiguos,
      nomes_sem_cliente_correspondente: nomesSemCliente,
      homonimos_ja_existentes_na_nossa_base: homonimosNaBase,
      total_clientes_na_base: (clientesDb || []).length,
    },
    truncado: !soResumo && novos.length >= limiteNovos,
    processos: soResumo ? [] : novos,
  });
});

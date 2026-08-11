// supabase/functions/check-legalmail-nome/index.ts
//
// Edge function que busca processos no Legalmail por NOME (fuzzy).
// Como a API do Legalmail nao retorna CPF do polo ativo, fazemos match
// por nome do cliente.
//
// Chamada do frontend:
//   const { data } = await supabase.functions.invoke("check-legalmail-nome", {
//     body: { nome: "ROSANA APARECIDA TOTH" }
//   });
//
// Resposta:
//   {
//     processos_similares: [
//       { numero_processo, poloativo_nome, tribunal, juizo, processo_tema, idprocessos }
//     ]
//   }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const BASE = "https://app.legalmail.com.br";
const TOKEN = Deno.env.get("LEGALMAIL_TOKEN");

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

// Normaliza nome: maiusculas, sem acentos, espaco unico
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Calcula similaridade simples baseada em tokens (palavras) compartilhados
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const tokensA = new Set(na.split(" ").filter((t) => t.length >= 3));
  const tokensB = new Set(nb.split(" ").filter((t) => t.length >= 3));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  return intersection / Math.max(tokensA.size, tokensB.size);
}

interface Processo {
  idprocessos: string;
  numero_processo: string;
  poloativo_nome: string;
  tribunal: string | null;
  juizo: string | null;
  processo_tema: string | null;
  inbox_atual: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!TOKEN) return jsonResponse({ error: "LEGALMAIL_TOKEN nao configurado" }, 500);

  let nome: string;
  try {
    const body = await req.json();
    nome = body.nome;
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  if (!nome || nome.length < 4) {
    return jsonResponse({ error: "nome obrigatorio (min 4 chars)" }, 400);
  }

  // Busca no servidor pelo polo ativo, em UMA requisicao.
  //
  // Antes isto paginava /lawsuit/all inteiro (17 requests) e comparava nomes
  // localmente. So que o /all devolve registro MAGRO: `poloativo_nome` vem
  // vazio em TODOS. Resultado: similaridade 0 pra tudo, "nenhum processo
  // encontrado" sempre, sem erro nenhum. Ficou assim de maio ate agosto/2026 —
  // ninguem percebeu porque a resposta era 200 com lista vazia.
  //
  // O /lawsuit/search devolve `polo_ativo` preenchido E aceita filtrar por ele
  // no servidor. E cobrado, mas 1 request no lugar de 17, e GET identico nao
  // recobra dentro de 5 min.
  const similares: Array<{ score: number; proc: Processo }> = [];
  let paginas = 0;

  let resp: Response;
  try {
    resp = await fetch(
      `${BASE}/api/v1/lawsuit/search?api_key=${TOKEN}` +
        `&polo_ativo=${encodeURIComponent(nome)}&limit=50&offset=0`,
      { headers: { Accept: "application/json" } },
    );
  } catch (err) {
    return jsonResponse({ error: "erro de rede", detail: String(err) }, 502);
  }
  if (resp.status === 429) {
    return jsonResponse({ error: "rate limit do Legalmail" }, 429);
  }
  if (resp.status === 402) {
    return jsonResponse({ error: "saldo de creditos insuficiente no Legalmail" }, 402);
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
  const envelope = (data ?? {}) as {
    lawsuits?: Array<Record<string, unknown>>;
    message?: string;
  };
  if (!Array.isArray(envelope.lawsuits)) {
    return jsonResponse(
      {
        error: "legalmail_resposta_inesperada",
        detail: envelope.message || JSON.stringify(data).slice(0, 200),
      },
      502,
    );
  }
  paginas = 1;

  // O filtro do Legalmail e "contem", entao ainda pontuamos localmente pra
  // ordenar e cortar quem so casou por acaso (um sobrenome comum, por exemplo).
  for (const raw of envelope.lawsuits) {
    const x = raw as Record<string, unknown>;
    const proc: Processo = {
      idprocessos: String(x.idprocessos ?? ""),
      numero_processo: String(x.numero_processo ?? ""),
      poloativo_nome: String(x.polo_ativo ?? ""),
      tribunal: (x.tribunal as string) ?? null,
      juizo: (x.orgao_julgador as string) ?? null,
      processo_tema: (x.assunto as string) ?? null,
      inbox_atual: null,
    };
    const score = similarity(nome, proc.poloativo_nome);
    if (score >= 0.5) similares.push({ score, proc });
  }

  // Ordena por score desc
  similares.sort((a, b) => b.score - a.score);

  return jsonResponse({
    processos_similares: similares.slice(0, 10).map((s) => ({
      score: s.score,
      idprocessos: s.proc.idprocessos,
      numero_processo: s.proc.numero_processo,
      poloativo_nome: s.proc.poloativo_nome,
      tribunal: s.proc.tribunal,
      juizo: s.proc.juizo,
      processo_tema: s.proc.processo_tema,
      inbox_atual: s.proc.inbox_atual,
    })),
    total_requisicoes: paginas,
  });
});

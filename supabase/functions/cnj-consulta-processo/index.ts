// supabase/functions/cnj-consulta-processo/index.ts
//
// Proxy pra API pública DataJud do CNJ. Recebe o número CNJ, detecta a
// sigla do tribunal e consulta o endpoint apropriado pra obter
// orgaoJulgador (vara) + codigoMunicipioIBGE (mapa pra comarca).
//
// Usado pelo dialog "Novo processo judicial" pra preencher Comarca/Vara
// automaticamente quando a Naira cola o número.
//
// IMPORTANTE — geo-block: api-publica.datajud.cnj.jus.br pode ter
// restrição de IP brasileiro (como Comunica API). A function suporta o
// header `x-region: sa-east-1` que o invoke do front pode passar pra
// forçar São Paulo.
//
// Auth da DataJud: APIKey pública (documentada pelo CNJ pra uso aberto).
// Não precisa de auth do nosso lado — verify_jwt=false no deploy.
//
// Chamada (POST):
//   { "numero": "0805123-45.2024.4.03.6100" }
//
// Resposta:
//   {
//     "encontrado": true,
//     "tribunal": "TRF3",
//     "comarca": "São Paulo",
//     "vara": "1ª Vara Federal Cível",
//     "classe": "Procedimento Comum Cível",
//     "raw": { ... }                     // só pra debug
//   }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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

// Chave pública documentada pelo CNJ para uso aberto (rotaciona às vezes;
// se quebrar, conferir em wiki.pje.jus.br/wiki/index.php/REST_API_DataJud).
const DATAJUD_API_KEY =
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

// Mapeamento UF → endpoint da TJ correspondente.
const TJ_ENDPOINT: Record<string, string> = {
  AC: "api_publica_tjac", AL: "api_publica_tjal", AM: "api_publica_tjam",
  AP: "api_publica_tjap", BA: "api_publica_tjba", CE: "api_publica_tjce",
  DF: "api_publica_tjdft", ES: "api_publica_tjes", GO: "api_publica_tjgo",
  MA: "api_publica_tjma", MG: "api_publica_tjmg", MS: "api_publica_tjms",
  MT: "api_publica_tjmt", PA: "api_publica_tjpa", PB: "api_publica_tjpb",
  PE: "api_publica_tjpe", PI: "api_publica_tjpi", PR: "api_publica_tjpr",
  RJ: "api_publica_tjrj", RN: "api_publica_tjrn", RO: "api_publica_tjro",
  RR: "api_publica_tjrr", RS: "api_publica_tjrs", SC: "api_publica_tjsc",
  SE: "api_publica_tjse", SP: "api_publica_tjsp", TO: "api_publica_tjto",
};

// Mapping oficial CNJ (Resolução 65/2008). NÃO é ordem alfabética estrita.
const TJ_UF: Record<string, string> = {
  "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA",
  "06": "CE", "07": "DF", "08": "ES", "09": "GO", "10": "MA",
  "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB",
  "16": "PR", "17": "PE", "18": "PI", "19": "RJ", "20": "RN",
  "21": "RS", "22": "RO", "23": "RR", "24": "SC", "25": "SE",
  "26": "SP", "27": "TO",
};

/**
 * Determina o endpoint da DataJud pelo segmento (J) e tribunal (TR) do
 * número CNJ. Retorna null se não souber.
 */
function endpointPara(numeroDigitos: string): { endpoint: string; tribunal: string } | null {
  if (numeroDigitos.length !== 20) return null;
  const j = numeroDigitos.slice(13, 14);
  const tr = numeroDigitos.slice(14, 16);

  if (j === "8") {
    const uf = TJ_UF[tr];
    if (uf && TJ_ENDPOINT[uf]) {
      return { endpoint: TJ_ENDPOINT[uf], tribunal: `TJ${uf}` };
    }
  } else if (j === "4") {
    // TRF1..TRF6
    const n = Number(tr);
    if (n >= 1 && n <= 6) {
      return { endpoint: `api_publica_trf${n}`, tribunal: `TRF${n}` };
    }
  } else if (j === "5") {
    const n = Number(tr);
    if (n >= 1 && n <= 24) {
      return { endpoint: `api_publica_trt${n}`, tribunal: `TRT${n}` };
    }
  }
  // outros segmentos: pula
  return null;
}

interface DataJudHit {
  numeroProcesso?: string;
  classe?: { codigo?: number; nome?: string };
  orgaoJulgador?: {
    codigo?: number;
    nome?: string;
    codigoMunicipioIBGE?: number;
  };
  tribunal?: string;
  grau?: string;
}

async function consultarMunicipio(codigoIBGE: number): Promise<string | null> {
  try {
    const r = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${codigoIBGE}`,
    );
    if (!r.ok) return null;
    const j = await r.json() as { nome?: string };
    return j.nome ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let numero = "";
  try {
    const body = await req.json();
    numero = (body?.numero ?? "").toString();
  } catch {
    return jsonResponse({ error: "body inválido" }, 400);
  }

  const digitos = numero.replace(/\D/g, "");
  if (digitos.length !== 20) {
    return jsonResponse({ encontrado: false, motivo: "número CNJ inválido" });
  }

  const cfg = endpointPara(digitos);
  if (!cfg) {
    return jsonResponse({ encontrado: false, motivo: "tribunal não suportado" });
  }

  // POST na DataJud.
  let hit: DataJudHit | null = null;
  try {
    const url = `https://api-publica.datajud.cnj.jus.br/${cfg.endpoint}/_search`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `APIKey ${DATAJUD_API_KEY}`,
      },
      body: JSON.stringify({
        query: { match: { numeroProcesso: digitos } },
        size: 1,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return jsonResponse({
        encontrado: false,
        motivo: `DataJud retornou ${resp.status}`,
        detalhe: txt.slice(0, 200),
      });
    }
    const j = await resp.json() as { hits?: { hits?: Array<{ _source: DataJudHit }> } };
    hit = j.hits?.hits?.[0]?._source ?? null;
  } catch (e) {
    return jsonResponse({
      encontrado: false,
      motivo: "erro ao consultar DataJud",
      detalhe: String(e).slice(0, 200),
    });
  }

  if (!hit) {
    return jsonResponse({
      encontrado: false,
      motivo: "processo não encontrado",
      tribunal: cfg.tribunal,
    });
  }

  // Mapeia municipio IBGE → nome da cidade (comarca).
  let comarca: string | null = null;
  const codIBGE = hit.orgaoJulgador?.codigoMunicipioIBGE;
  if (codIBGE) {
    comarca = await consultarMunicipio(codIBGE);
  }

  const varaNome = hit.orgaoJulgador?.nome ?? null;

  // Quando o DataJud não traz codigoMunicipioIBGE (acontece bastante em
  // TJSP), tentamos extrair a comarca do PRÓPRIO NOME DA VARA. Padrões
  // comuns:
  //   "01 CUMULATIVA DE ANDRADINA"           → "Andradina"
  //   "1ª Vara Cível de São Paulo"           → "São Paulo"
  //   "3ª Vara do Trabalho de Campinas"      → "Campinas"
  //   "Vara Única de Itu - SP"               → "Itu"
  if (!comarca && varaNome) {
    comarca = extrairComarcaDaVara(varaNome);
  }

  return jsonResponse({
    encontrado: true,
    tribunal: cfg.tribunal,
    comarca,
    vara: varaNome,
    classe: hit.classe?.nome ?? null,
    grau: hit.grau ?? null,
  });
});

function tituloCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((parte) => {
      if (/^\s+$/.test(parte)) return parte;
      // Mantém preposições minúsculas no meio (de, da, do, dos, das).
      if (["de", "da", "do", "dos", "das", "e"].includes(parte)) return parte;
      return parte.charAt(0).toUpperCase() + parte.slice(1);
    })
    .join("")
    .replace(/^\w/, (c) => c.toUpperCase()); // primeira letra sempre maiúscula
}

function extrairComarcaDaVara(vara: string): string | null {
  // Remove " - UF" no fim, ex: "Vara Única de Itu - SP" → "Vara Única de Itu"
  const limpa = vara.replace(/\s*-\s*[A-Z]{2}\s*$/i, "").trim();

  // Pega tudo após o ÚLTIMO " de " (case-insensitive).
  const m = limpa.match(/\bde\s+([^\s].*)$/i);
  if (m && m[1]) {
    const candidato = m[1].trim();
    // Filtros sanity: se ficou muito curto ou contém números, pula.
    if (candidato.length < 2) return null;
    if (/^\d/.test(candidato)) return null;
    return tituloCase(candidato);
  }
  return null;
}

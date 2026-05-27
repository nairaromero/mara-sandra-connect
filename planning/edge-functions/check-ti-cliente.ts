// supabase/functions/check-ti-cliente/index.ts
//
// Edge function que recebe CPF e responde se ja existe cliente
// com esse CPF no Tramitacao Inteligente.
//
// Chamada do frontend:
//   const { data } = await supabase.functions.invoke("check-ti-cliente", {
//     body: { cpf: "12345678900" }
//   });
//
// Resposta:
//   { existe: true, customer: {...} }  // se achou
//   { existe: false, customer: null }  // se nao achou
//   { error: "..." }                   // erro

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TI_BASE_URL = "https://planilha.tramitacaointeligente.com.br/api/v1";
const TI_TOKEN = Deno.env.get("TI_TOKEN");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeCPF(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }

  if (!TI_TOKEN) {
    return jsonResponse({ error: "TI_TOKEN nao configurado" }, 500);
  }

  let cpf: string;
  try {
    const body = await req.json();
    cpf = body.cpf;
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  if (!cpf) {
    return jsonResponse({ error: "cpf obrigatorio" }, 400);
  }

  const cpfNorm = normalizeCPF(cpf);
  if (cpfNorm.length !== 11) {
    return jsonResponse({ error: "cpf deve ter 11 digitos" }, 400);
  }

  const headers = {
    Authorization: `Bearer ${TI_TOKEN}`,
    "Content-Type": "application/json",
  };

  let page = 1;
  const perPage = 100;

  while (true) {
    let resp: Response;
    try {
      resp = await fetch(
        `${TI_BASE_URL}/clientes?page=${page}&per_page=${perPage}`,
        { headers },
      );
    } catch (err) {
      return jsonResponse(
        { error: "erro de rede ao chamar TI", detail: String(err) },
        502,
      );
    }

    if (!resp.ok) {
      const text = await resp.text();
      return jsonResponse(
        { error: "ti_api_error", status: resp.status, detail: text.slice(0, 200) },
        502,
      );
    }

    const data = await resp.json();
    const customers: Array<Record<string, unknown>> =
      data.customers || data.clientes || [];

    for (const c of customers) {
      if (normalizeCPF(String(c.cpf_cnpj || "")) === cpfNorm) {
        return jsonResponse({ existe: true, customer: c });
      }
    }

    const pag = data.pagination || {};
    const totalPages = pag.pages || 1;
    if (page >= totalPages || customers.length < perPage) {
      break;
    }
    page++;

    // Safeguard contra loop infinito
    if (page > 50) {
      return jsonResponse(
        { error: "paginacao excedeu limite seguro", page },
        500,
      );
    }
  }

  return jsonResponse({ existe: false, customer: null });
});

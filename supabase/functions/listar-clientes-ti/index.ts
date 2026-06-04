// supabase/functions/listar-clientes-ti/index.ts
//
// Lista os clientes que existem no Tramitacao Inteligente (TI) mas ainda NAO
// foram cadastrados no app (comparando por CPF normalizado). Usado pelo dialog
// "Importar do TI" na tela de Clientes.
//
// Nao grava nada. A criacao dos clientes/casos selecionados e feita no frontend
// (RLS permite interno inserir).
//
// Body: {} (nenhum parametro)
// Response: { clientes: [...], total_ti, ja_cadastrados }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const TI_BASE_URL = "https://planilha.tramitacaointeligente.com.br/api/v1";
const TI_TOKEN = Deno.env.get("TI_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeCPF(cpf: string): string {
  return String(cpf || "").replace(/\D/g, "");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface TITag {
  id: number;
  name: string;
  color: string;
}
interface TICustomer {
  id: number;
  name: string;
  cpf_cnpj: string;
  email: string | null;
  phone_mobile: string | null;
  birthdate: string | null;
  tags: Array<TITag>;
  [k: string]: unknown;
}

const headersTI = {
  Authorization: `Bearer ${TI_TOKEN}`,
  "Content-Type": "application/json",
};

async function buscarTodosClientesTI(): Promise<Array<TICustomer>> {
  const all: Array<TICustomer> = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const resp = await fetch(
      `${TI_BASE_URL}/clientes?page=${page}&per_page=${perPage}`,
      { headers: headersTI },
    );
    if (!resp.ok) {
      throw new Error(`TI /clientes ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    const customers: Array<TICustomer> = data.customers || data.clientes || [];
    all.push(...customers);
    const totalPages = (data.pagination || {}).pages || 1;
    if (page >= totalPages || customers.length < perPage) break;
    page++;
    if (page > 50) throw new Error("paginacao de clientes excedeu limite");
  }
  return all;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "metodo nao permitido" }, 405);
  }
  if (!TI_TOKEN) return jsonResponse({ error: "TI_TOKEN nao configurado" }, 500);
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let tiCustomers: Array<TICustomer>;
  try {
    tiCustomers = await buscarTodosClientesTI();
  } catch (err) {
    return jsonResponse(
      { error: "erro ao listar clientes do TI", detail: String(err) },
      502,
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: locais, error } = await supabase.from("clientes").select("cpf");
  if (error) {
    return jsonResponse({ error: "erro listar clientes locais", detail: error.message }, 500);
  }
  const cpfsLocais = new Set(
    (locais || []).map((c) => normalizeCPF(String(c.cpf || ""))),
  );

  let jaCadastrados = 0;
  const novos: Array<Record<string, unknown>> = [];
  for (const c of tiCustomers) {
    const cpfNorm = normalizeCPF(String(c.cpf_cnpj || ""));
    if (cpfNorm.length !== 11) continue;
    if (cpfsLocais.has(cpfNorm)) {
      jaCadastrados++;
      continue;
    }
    novos.push({
      ti_customer_id: c.id,
      nome: c.name || "",
      cpf: cpfNorm,
      email: c.email || null,
      telefone: c.phone_mobile || null,
      data_nascimento: c.birthdate || null,
      tags: c.tags || [],
    });
  }
  novos.sort((a, b) =>
    String(a.nome).localeCompare(String(b.nome), "pt-BR")
  );

  return jsonResponse({
    clientes: novos,
    total_ti: tiCustomers.length,
    ja_cadastrados: jaCadastrados,
  });
});

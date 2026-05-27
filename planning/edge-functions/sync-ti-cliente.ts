// supabase/functions/sync-ti-cliente/index.ts
//
// Edge function que sincroniza um cliente local com dados do TI.
// Dado um CPF, busca no TI e atualiza:
//   - clientes.tags (jsonb)
//   - clientes.ti_customer_id
//   - clientes.email, telefone, etc. (se vazios localmente)
//
// Chamada do frontend:
//   const { data } = await supabase.functions.invoke("sync-ti-cliente", {
//     body: { cpf: "08339975803" }
//   });

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
  return cpf.replace(/\D/g, "");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface TICustomer {
  id: number;
  name: string;
  cpf_cnpj: string;
  email: string | null;
  phone_mobile: string | null;
  birthdate: string | null;
  tags: Array<{ id: number; name: string; color: string }>;
  [k: string]: unknown;
}

async function buscarNoTI(cpfNorm: string): Promise<TICustomer | null> {
  const headers = {
    Authorization: `Bearer ${TI_TOKEN}`,
    "Content-Type": "application/json",
  };
  let page = 1;
  const perPage = 100;
  while (true) {
    const resp = await fetch(
      `${TI_BASE_URL}/clientes?page=${page}&per_page=${perPage}`,
      { headers },
    );
    if (!resp.ok) {
      throw new Error(`TI API ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    const customers: Array<TICustomer> = data.customers || data.clientes || [];
    for (const c of customers) {
      if (normalizeCPF(String(c.cpf_cnpj || "")) === cpfNorm) {
        return c;
      }
    }
    const pag = data.pagination || {};
    const totalPages = pag.pages || 1;
    if (page >= totalPages || customers.length < perPage) {
      break;
    }
    page++;
    if (page > 50) {
      throw new Error("paginacao excedeu limite seguro");
    }
  }
  return null;
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

  let cpf: string;
  try {
    const body = await req.json();
    cpf = body.cpf;
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  if (!cpf) return jsonResponse({ error: "cpf obrigatorio" }, 400);
  const cpfNorm = normalizeCPF(cpf);
  if (cpfNorm.length !== 11) {
    return jsonResponse({ error: "cpf deve ter 11 digitos" }, 400);
  }

  let customer: TICustomer | null;
  try {
    customer = await buscarNoTI(cpfNorm);
  } catch (err) {
    return jsonResponse({ error: "erro ao consultar TI", detail: String(err) }, 502);
  }

  if (!customer) {
    return jsonResponse({ achou_no_ti: false, atualizado: false });
  }

  // Conectar Supabase com service role para bypassar RLS
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Buscar cliente local
  console.log("vou consultar cliente local com cpf:", cpfNorm);
  const { data: clienteLocal, error: selErr } = await supabase
    .from("clientes")
    .select("id, nome, email, telefone, data_nascimento, tags, ti_customer_id")
    .eq("cpf", cpfNorm)
    .maybeSingle();

  console.log("resultado select:", { clienteLocal, selErr });

  if (selErr) {
    return jsonResponse({
      error: "erro select cliente",
      message: selErr.message,
      code: selErr.code,
      details: selErr.details,
      hint: selErr.hint,
      full: JSON.stringify(selErr),
    }, 500);
  }

  if (!clienteLocal) {
    return jsonResponse({
      achou_no_ti: true,
      atualizado: false,
      motivo: "cliente nao existe no Mara Sandra (cadastre primeiro)",
      customer_ti: customer,
    });
  }

  // Preparar UPDATE: sempre atualiza tags + ti_customer_id;
  // demais campos so se locais estiverem vazios.
  const update: Record<string, unknown> = {
    tags: customer.tags || [],
    ti_customer_id: customer.id,
  };
  if (!clienteLocal.email && customer.email) update.email = customer.email;
  if (!clienteLocal.telefone && customer.phone_mobile) {
    update.telefone = customer.phone_mobile;
  }
  if (!clienteLocal.data_nascimento && customer.birthdate) {
    update.data_nascimento = customer.birthdate;
  }

  const { error: upErr } = await supabase
    .from("clientes")
    .update(update)
    .eq("id", clienteLocal.id);

  if (upErr) {
    return jsonResponse({ error: "erro update cliente", detail: upErr.message }, 500);
  }

  return jsonResponse({
    achou_no_ti: true,
    atualizado: true,
    cliente_id: clienteLocal.id,
    tags_aplicadas: customer.tags?.length || 0,
    ti_customer_id: customer.id,
  });
});

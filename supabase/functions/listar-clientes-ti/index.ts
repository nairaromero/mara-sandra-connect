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
import { escopado, exigirUsuario, fetchT } from "../_shared/auth.ts";
import { baseLegalmail, baseTI, integracaoDoEscritorio, semIntegracao } from "../_shared/integracoes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-escritorio-id",
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

type CredencialTI = { base: string; token: string };
const headersTI = (ti: CredencialTI) => ({ Authorization: `Bearer ${ti.token}`, "Content-Type": "application/json" });

async function buscarTodosClientesTI(ti: CredencialTI): Promise<Array<TICustomer>> {
  const all: Array<TICustomer> = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const resp = await fetchT(
      `${ti.base}/clientes?page=${page}&per_page=${perPage}`,
      { headers: headersTI(ti) },
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
  // Sem esta linha, qualquer pessoa com a chave publicável do site (que está
  // no bundle) recebia a base inteira do Tramitação: nome, CPF, e-mail,
  // telefone e data de nascimento.
  const quem = await exigirUsuario(req, { tipo: "interno", permissao: "casos:ler" });
  if (quem instanceof Response) return quem;

  const integ = await integracaoDoEscritorio(quem.admin, quem.perfil.escritorio_id, "ti");
  if (!integ) return semIntegracao("ti", corsHeaders);
  const ti: CredencialTI = { base: baseTI(integ.config), token: integ.segredo };
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "supabase env vars ausentes" }, 500);
  }

  let tiCustomers: Array<TICustomer>;
  try {
    tiCustomers = await buscarTodosClientesTI(ti);
  } catch (err) {
    return jsonResponse(
      { error: "erro ao listar clientes do TI", detail: String(err) },
      502,
    );
  }

  // Service role SEMPRE escopado ao escritório (CLAUDE.md): sem isso a lista
  // marcava como "já cadastrado" o CPF de OUTRO escritório e escondia o cliente
  // daqui — achado de 24/09, com um cliente do escritório padrão sumindo um
  // nome da lista do Canário.
  const supabase = escopado(createClient(SUPABASE_URL, SERVICE_ROLE), quem.perfil.escritorio_id);
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

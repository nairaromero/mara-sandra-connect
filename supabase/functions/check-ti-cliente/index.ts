// supabase/functions/sync-ti-cliente/index.ts
//
// Edge function que sincroniza um cliente local com dados do TI.
// Dado um CPF (e opcionalmente caso_id), busca no TI e:
//
//   1. Atualiza dados do cliente em `clientes`:
//      - clientes.tags (jsonb)
//      - clientes.ti_customer_id
//      - clientes.email, telefone, data_nascimento (so se vazios localmente)
//
//   2. Se caso_id for fornecido, importa as notas do cliente como andamentos:
//      - Busca GET /notas?customer_id=<ti_customer_id> (filtro server-side validado)
//      - Para cada nota, faz dedup via metadata->>'ti_nota_id'
//      - INSERT em andamentos com origem='tramitacao', visivel_parceiro=false
//      - processo_admin_id / processo_judicial_id ficam NULL (vinculo manual no app)
//
// Chamada do frontend:
//   const { data } = await supabase.functions.invoke("sync-ti-cliente", {
//     body: {
//       cpf: "08339975803",
//       caso_id: "<uuid>",
//       usuario_id: "<uuid do usuario interno disparando o sync>"
//     }
//   });
//
// O usuario_id e usado como `criado_por` nos andamentos importados,
// para que as RLS policies permitam UPDATE/DELETE posterior pelo proprio usuario.
//
// Response:
//   {
//     achou_no_ti: boolean,
//     atualizado: boolean,
//     cliente_id?: uuid,
//     tags_aplicadas?: number,
//     notas_importadas?: number,     // novas notas inseridas como andamentos
//     notas_ja_existentes?: number,  // notas que ja estavam (dedup)
//     ti_customer_id?: number,
//     motivo?: string,               // se nao atualizou
//   }

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

interface TINotaUser {
  id?: string;
  uuid?: string;
  name?: string;
  email?: string;
}

interface TINotaCustomer {
  id: number;
  name?: string;
  cpf_cnpj?: string;
}

interface TINota {
  id: number;
  uuid?: string;
  content: string;
  created_at: string;
  updated_at?: string;
  user?: TINotaUser;
  customer?: TINotaCustomer;
}

interface TIPagination {
  count?: number;
  page?: number;
  pages?: number;
  items?: number;
  prev?: number | null;
  next?: number | null;
}

const headersTI = {
  Authorization: `Bearer ${TI_TOKEN}`,
  "Content-Type": "application/json",
};

async function buscarClienteNoTI(cpfNorm: string): Promise<TICustomer | null> {
  let page = 1;
  const perPage = 100;
  while (true) {
    const resp = await fetch(
      `${TI_BASE_URL}/clientes?page=${page}&per_page=${perPage}`,
      { headers: headersTI },
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
    const pag = (data.pagination || {}) as TIPagination;
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

// Busca notas do TI filtrando por customer_id (server-side).
// Endpoint validado: GET /notas?customer_id=<id> aceita filtro nativo.
// Pagina via per_page=100 para suportar clientes com muitas notas.
async function buscarNotasNoTI(tiCustomerId: number): Promise<Array<TINota>> {
  const notas: Array<TINota> = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url =
      `${TI_BASE_URL}/notas?customer_id=${tiCustomerId}` +
      `&page=${page}&per_page=${perPage}`;
    const resp = await fetch(url, { headers: headersTI });
    if (!resp.ok) {
      throw new Error(`TI /notas ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    const batch: Array<TINota> = data.notes || data.notas || [];
    notas.push(...batch);
    const pag = (data.pagination || {}) as TIPagination;
    const totalPages = pag.pages || 1;
    if (page >= totalPages || batch.length < perPage) {
      break;
    }
    page++;
    if (page > 20) {
      // 20 paginas * 100 = 2000 notas por cliente. Mais que isso e suspeito.
      throw new Error("paginacao de notas excedeu limite seguro");
    }
  }
  return notas;
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
  let casoId: string | null = null;
  let usuarioId: string | null = null;
  try {
    const body = await req.json();
    cpf = body.cpf;
    if (body.caso_id) {
      casoId = String(body.caso_id);
    }
    if (body.usuario_id) {
      usuarioId = String(body.usuario_id);
    }
  } catch {
    return jsonResponse({ error: "body json invalido" }, 400);
  }

  if (!cpf) return jsonResponse({ error: "cpf obrigatorio" }, 400);
  const cpfNorm = normalizeCPF(cpf);
  if (cpfNorm.length !== 11) {
    return jsonResponse({ error: "cpf deve ter 11 digitos" }, 400);
  }

  // ---- Passo 1: buscar cliente no TI ----
  let customer: TICustomer | null;
  try {
    customer = await buscarClienteNoTI(cpfNorm);
  } catch (err) {
    return jsonResponse(
      { error: "erro ao consultar TI", detail: String(err) },
      502,
    );
  }

  if (!customer) {
    return jsonResponse({ achou_no_ti: false, atualizado: false });
  }

  // ---- Passo 2: conectar Supabase + buscar cliente local ----
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  console.log("vou consultar cliente local com cpf:", cpfNorm);
  const { data: clienteLocal, error: selErr } = await supabase
    .from("clientes")
    .select("id, nome, email, telefone, data_nascimento, tags, ti_customer_id")
    .eq("cpf", cpfNorm)
    .maybeSingle();

  console.log("resultado select:", { clienteLocal, selErr });

  if (selErr) {
    return jsonResponse(
      {
        error: "erro select cliente",
        message: selErr.message,
        code: selErr.code,
        details: selErr.details,
        hint: selErr.hint,
        full: JSON.stringify(selErr),
      },
      500,
    );
  }

  if (!clienteLocal) {
    return jsonResponse({
      achou_no_ti: true,
      atualizado: false,
      motivo: "cliente nao existe no Mara Sandra (cadastre primeiro)",
      customer_ti: customer,
    });
  }

  // ---- Passo 3: UPDATE do cliente (tags + ti_customer_id sempre; resto so se vazio) ----
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
    return jsonResponse(
      { error: "erro update cliente", detail: upErr.message },
      500,
    );
  }

  // ---- Passo 4: se caso_id fornecido, importar notas como andamentos ----
  let notasImportadas = 0;
  let notasJaExistentes = 0;

  if (casoId) {
    let notas: Array<TINota>;
    try {
      notas = await buscarNotasNoTI(customer.id);
    } catch (err) {
      return jsonResponse(
        {
          error: "cliente atualizado mas falha ao buscar notas",
          detail: String(err),
          cliente_id: clienteLocal.id,
          tags_aplicadas: customer.tags?.length || 0,
          ti_customer_id: customer.id,
        },
        502,
      );
    }

    // Auto-vinculo: notas do TI sao administrativas por natureza (operacao do INSS).
    // Regra:
    //   1) Se ha processo admin no caso: vincula ao mais antigo
    //   2) Senao: deixa NULL. As notas vao aparecer na sub-secao "Sem processo"
    //      dentro do card Andamentos Administrativos no frontend, e o interno
    //      pode transferir em batch para um processo admin assim que cadastrar um.
    let autoProcessoAdminId: string | null = null;
    {
      const { data: admins, error: adminErr } = await supabase
        .from("processos_admin")
        .select("id")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true });
      if (adminErr) console.error("erro listar processos_admin", adminErr);
      if (admins && admins.length > 0) {
        autoProcessoAdminId = admins[0].id;
      }
    }

    for (const nota of notas) {
      const tiNotaIdStr = String(nota.id);

      // Dedup: ja existe andamento com esse ti_nota_id?
      const { data: existente, error: dedupErr } = await supabase
        .from("andamentos")
        .select("id, criado_por, processo_admin_id, processo_judicial_id")
        .eq("origem", "tramitacao")
        .eq("metadata->>ti_nota_id", tiNotaIdStr)
        .maybeSingle();

      if (dedupErr) {
        console.error("erro dedup nota", nota.id, dedupErr);
        continue;
      }
      if (existente) {
        // Backfill 1: se andamento antigo foi importado sem criado_por
        // (versao anterior da edge function), seta agora para o usuario
        // que esta disparando o sync. Permite que RLS deixe ele editar.
        if (!existente.criado_por && usuarioId) {
          const { error: bfErr } = await supabase
            .from("andamentos")
            .update({ criado_por: usuarioId })
            .eq("id", existente.id)
            .is("criado_por", null);
          if (bfErr) {
            console.error("erro backfill criado_por", existente.id, bfErr);
          }
        }
        // Backfill 2: se foi importado sem vinculo a processo (versao anterior
        // nao auto-vinculava em todos os cenarios) e o caso tem processo admin,
        // agora vincula ao admin mais antigo. Se nao ha processo admin, deixa
        // sem vinculo (o interno transfere via sub-secao "Sem processo" no UI).
        if (
          !existente.processo_admin_id &&
          !existente.processo_judicial_id &&
          autoProcessoAdminId
        ) {
          const { error: bfProcErr } = await supabase
            .from("andamentos")
            .update({ processo_admin_id: autoProcessoAdminId })
            .eq("id", existente.id)
            .is("processo_admin_id", null)
            .is("processo_judicial_id", null);
          if (bfProcErr) {
            console.error(
              "erro backfill processo admin",
              existente.id,
              bfProcErr,
            );
          }
        }
        notasJaExistentes++;
        continue;
      }

      const content = nota.content || "";
      const titulo = content.length > 100 ? content.slice(0, 100) : content;

      const insertObj = {
        caso_id: casoId,
        origem: "tramitacao",
        titulo: titulo || null,
        descricao: content || null,
        data_evento: nota.created_at,
        criado_por: usuarioId,
        visivel_parceiro: false,
        processo_admin_id: autoProcessoAdminId,
        processo_judicial_id: null,
        metadata: {
          ti_nota_id: tiNotaIdStr,
          ti_nota_uuid: nota.uuid || null,
          ti_user_email: nota.user?.email || null,
          ti_user_name: nota.user?.name || null,
        },
      };

      const { error: insErr } = await supabase
        .from("andamentos")
        .insert(insertObj);

      if (insErr) {
        console.error("erro insert andamento da nota", nota.id, insErr);
        continue;
      }
      notasImportadas++;
    }
  }

  return jsonResponse({
    achou_no_ti: true,
    atualizado: true,
    cliente_id: clienteLocal.id,
    tags_aplicadas: customer.tags?.length || 0,
    ti_customer_id: customer.id,
    notas_importadas: notasImportadas,
    notas_ja_existentes: notasJaExistentes,
  });
});
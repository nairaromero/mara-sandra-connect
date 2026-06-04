// supabase/functions/sync-ti-todos/index.ts
//
// Sync GLOBAL com o Tramitacao Inteligente (TI), pensado para rodar 1x (botao
// "Sincronizar tudo") ou agendado (pg_cron). Em vez de sincronizar caso a caso:
//
//   1. Busca TODOS os clientes do TI uma unica vez (mapa por CPF).
//   2. Para cada cliente local que existe no TI:
//        - atualiza tags / ti_customer_id / contatos (se vazios);
//        - se as tags mudaram -> notificacao 'tags';
//        - importa as notas como andamentos no caso mais recente do cliente
//          (dedup por ti_nota_id; auto-vinculo ao processo pelo numero no texto);
//        - se houver andamentos novos -> notificacao 'andamento'.
//   3. Clientes que existem no TI mas NAO no app -> notificacao 'cliente_ti'
//      (dedup por CPF enquanto nao lida).
//
// Escreve em `notificacoes` via service role (bypassa RLS).
//
// Body: { usuario_id?: string }  (usado como criado_por dos andamentos novos)
// Response: resumo agregado.

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

// Extrai do texto sequencias que parecem numero de processo/protocolo (>= 8
// digitos). Match e sempre por igualdade exata com um numero ja cadastrado.
function extrairNumerosProcesso(texto: string): Array<string> {
  const tokens = texto.match(/\d[\d.\-/]{4,}\d/g) || [];
  const out = new Set<string>();
  for (const t of tokens) {
    const d = t.replace(/\D/g, "");
    if (d.length >= 8) out.add(d);
  }
  return [...out];
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
interface TINota {
  id: number;
  uuid?: string;
  content: string;
  created_at: string;
  user?: { name?: string; email?: string };
}
interface TIPagination {
  pages?: number;
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
    const pag = (data.pagination || {}) as TIPagination;
    const totalPages = pag.pages || 1;
    if (page >= totalPages || customers.length < perPage) break;
    page++;
    if (page > 50) throw new Error("paginacao de clientes excedeu limite");
  }
  return all;
}

async function buscarNotasNoTI(tiCustomerId: number): Promise<Array<TINota>> {
  const notas: Array<TINota> = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = `${TI_BASE_URL}/notas?customer_id=${tiCustomerId}` +
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
    if (page >= totalPages || batch.length < perPage) break;
    page++;
    if (page > 20) throw new Error("paginacao de notas excedeu limite");
  }
  return notas;
}

// deno-lint-ignore no-explicit-any
function tagsKey(tags: any): string {
  if (!Array.isArray(tags)) return "";
  return tags
    .map((t) => String(t?.id ?? t?.name ?? ""))
    .filter(Boolean)
    .sort()
    .join(",");
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

  let usuarioId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && body.usuario_id) usuarioId = String(body.usuario_id);
  } catch {
    // body opcional
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ---- TI: todos os clientes (1 chamada paginada) ----
  let tiCustomers: Array<TICustomer>;
  try {
    tiCustomers = await buscarTodosClientesTI();
  } catch (err) {
    return jsonResponse(
      { error: "erro ao listar clientes do TI", detail: String(err) },
      502,
    );
  }
  const tiPorCpf = new Map<string, TICustomer>();
  for (const c of tiCustomers) {
    const k = normalizeCPF(String(c.cpf_cnpj || ""));
    if (k.length === 11) tiPorCpf.set(k, c);
  }

  // ---- Locais: clientes + casos ----
  const { data: clientesLocais, error: clErr } = await supabase
    .from("clientes")
    .select("id, cpf, nome, email, telefone, data_nascimento, tags, ti_customer_id");
  if (clErr) {
    return jsonResponse({ error: "erro listar clientes", detail: clErr.message }, 500);
  }
  const cpfsLocais = new Set(
    (clientesLocais || []).map((c) => normalizeCPF(String(c.cpf || ""))),
  );

  const { data: casosLocais, error: casoErr } = await supabase
    .from("casos")
    .select("id, cliente_id, created_at")
    .order("created_at", { ascending: false });
  if (casoErr) {
    return jsonResponse({ error: "erro listar casos", detail: casoErr.message }, 500);
  }
  // caso mais recente por cliente (primeiro de cada cliente na ordem desc)
  const casoPorCliente = new Map<string, string>();
  for (const ca of casosLocais || []) {
    if (!casoPorCliente.has(ca.cliente_id)) {
      casoPorCliente.set(ca.cliente_id, ca.id);
    }
  }

  let clientesSincronizados = 0;
  let andamentosNovos = 0;
  let tagsAlteradas = 0;
  let clientesTiNovos = 0;
  const erros: Array<{ contexto: string; detalhe: string }> = [];

  async function notificar(n: {
    tipo: string;
    titulo: string;
    descricao?: string | null;
    caso_id?: string | null;
    cliente_id?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { error } = await supabase.from("notificacoes").insert({
      tipo: n.tipo,
      titulo: n.titulo,
      descricao: n.descricao ?? null,
      caso_id: n.caso_id ?? null,
      cliente_id: n.cliente_id ?? null,
      metadata: n.metadata ?? null,
    });
    // 23505 = dedup (ex.: cliente_ti com mesmo CPF nao lido). Ignora.
    if (error && error.code !== "23505") {
      console.error("erro insert notificacao", n.tipo, error);
    }
  }

  // ---- Sync por cliente local que existe no TI ----
  for (const cl of clientesLocais || []) {
    const cpfNorm = normalizeCPF(String(cl.cpf || ""));
    const customer = tiPorCpf.get(cpfNorm);
    if (!customer) continue;
    clientesSincronizados++;

    // Update do cliente (tags/ti_customer_id sempre; contatos so se vazios).
    const tagsAntes = tagsKey(cl.tags);
    const tagsDepois = tagsKey(customer.tags || []);
    const update: Record<string, unknown> = {
      tags: customer.tags || [],
      ti_customer_id: customer.id,
    };
    if (!cl.email && customer.email) update.email = customer.email;
    if (!cl.telefone && customer.phone_mobile) {
      update.telefone = customer.phone_mobile;
    }
    if (!cl.data_nascimento && customer.birthdate) {
      update.data_nascimento = customer.birthdate;
    }
    const { error: upErr } = await supabase
      .from("clientes")
      .update(update)
      .eq("id", cl.id);
    if (upErr) {
      erros.push({ contexto: `update cliente ${cl.id}`, detalhe: upErr.message });
      continue;
    }
    if (tagsAntes !== tagsDepois) {
      tagsAlteradas++;
      await notificar({
        tipo: "tags",
        titulo: `Tags atualizadas: ${cl.nome || "cliente"}`,
        descricao: `As tags do cliente mudaram no TI.`,
        cliente_id: cl.id,
        caso_id: casoPorCliente.get(cl.id) || null,
        metadata: { cpf: cpfNorm },
      });
    }

    // Importar notas no caso mais recente do cliente.
    const casoId = casoPorCliente.get(cl.id);
    if (!casoId) continue;

    let notas: Array<TINota>;
    try {
      notas = await buscarNotasNoTI(customer.id);
    } catch (err) {
      erros.push({ contexto: `notas cliente ${cl.id}`, detalhe: String(err) });
      continue;
    }

    // Mapas numero_normalizado -> id (do caso) para auto-vinculo.
    const adminPorNumero = new Map<string, string>();
    const judPorNumero = new Map<string, string>();
    let autoProcessoAdminId: string | null = null;
    {
      const { data: admins } = await supabase
        .from("processos_admin")
        .select("id, numero_req_normalizado")
        .eq("caso_id", casoId)
        .order("created_at", { ascending: true });
      if (admins && admins.length > 0) {
        autoProcessoAdminId = admins[0].id;
        for (const a of admins) {
          const n = (a as { numero_req_normalizado?: string | null })
            .numero_req_normalizado;
          if (n) adminPorNumero.set(n, a.id);
        }
      }
      const { data: juds } = await supabase
        .from("processos_judiciais")
        .select("id, numero_proc_normalizado")
        .eq("caso_id", casoId);
      for (const j of juds || []) {
        const n = (j as { numero_proc_normalizado?: string | null })
          .numero_proc_normalizado;
        if (n) judPorNumero.set(n, j.id);
      }
    }
    function resolver(texto: string): { adminId: string | null; judId: string | null } {
      const nums = extrairNumerosProcesso(texto);
      for (const n of nums) {
        const j = judPorNumero.get(n);
        if (j) return { adminId: null, judId: j };
      }
      for (const n of nums) {
        const a = adminPorNumero.get(n);
        if (a) return { adminId: a, judId: null };
      }
      return { adminId: null, judId: null };
    }

    let novosNoCliente = 0;
    for (const nota of notas) {
      const tiNotaIdStr = String(nota.id);
      const r = resolver(nota.content || "");
      const vincAdminId = r.judId ? null : (r.adminId ?? autoProcessoAdminId);
      const vincJudId = r.judId;

      const { data: existente } = await supabase
        .from("andamentos")
        .select("id, processo_admin_id, processo_judicial_id")
        .eq("origem", "tramitacao")
        .eq("metadata->>ti_nota_id", tiNotaIdStr)
        .maybeSingle();
      if (existente) {
        // Backfill: religa nota ja importada que ficou sem processo (notas
        // antigas, importadas antes do auto-vinculo, ou antes do processo
        // existir). So mexe se ainda nao tem vinculo.
        if (
          !existente.processo_admin_id &&
          !existente.processo_judicial_id &&
          (vincJudId || vincAdminId)
        ) {
          const { error: bfErr } = await supabase
            .from("andamentos")
            .update(
              vincJudId
                ? { processo_judicial_id: vincJudId }
                : { processo_admin_id: vincAdminId },
            )
            .eq("id", existente.id)
            .is("processo_admin_id", null)
            .is("processo_judicial_id", null);
          if (bfErr) console.error("erro backfill processo", existente.id, bfErr);
        }
        continue;
      }

      const content = nota.content || "";
      const titulo = content.length > 100 ? content.slice(0, 100) : content;

      const { error: insErr } = await supabase.from("andamentos").insert({
        caso_id: casoId,
        origem: "tramitacao",
        titulo: titulo || null,
        descricao: content || null,
        data_evento: nota.created_at,
        criado_por: usuarioId,
        visivel_parceiro: false,
        processo_admin_id: vincAdminId,
        processo_judicial_id: vincJudId,
        metadata: {
          ti_nota_id: tiNotaIdStr,
          ti_nota_uuid: nota.uuid || null,
          ti_user_email: nota.user?.email || null,
          ti_user_name: nota.user?.name || null,
        },
      });
      if (insErr) {
        erros.push({ contexto: `insert nota ${nota.id}`, detalhe: insErr.message });
        continue;
      }
      novosNoCliente++;
    }
    if (novosNoCliente > 0) {
      andamentosNovos += novosNoCliente;
      await notificar({
        tipo: "andamento",
        titulo: `${novosNoCliente} novo${novosNoCliente === 1 ? "" : "s"}` +
          ` andamento${novosNoCliente === 1 ? "" : "s"}: ${cl.nome || "cliente"}`,
        descricao: `Importado${novosNoCliente === 1 ? "" : "s"} do TI.`,
        cliente_id: cl.id,
        caso_id: casoId,
        metadata: { cpf: cpfNorm, qtd: novosNoCliente },
      });
    }
  }

  // ---- Novos clientes no TI (existem la, nao aqui) ----
  for (const customer of tiCustomers) {
    const cpfNorm = normalizeCPF(String(customer.cpf_cnpj || ""));
    if (cpfNorm.length !== 11) continue;
    if (cpfsLocais.has(cpfNorm)) continue;
    // dedup garantido pelo indice unico parcial; conta so se inseriu.
    const { error } = await supabase.from("notificacoes").insert({
      tipo: "cliente_ti",
      titulo: `Novo cliente no TI: ${customer.name || "(sem nome)"}`,
      descricao: `CPF ${cpfNorm}. Existe no Tramitacao Inteligente mas ainda` +
        ` nao foi cadastrado no app.`,
      metadata: {
        cpf: cpfNorm,
        ti_customer_id: customer.id,
        nome: customer.name,
      },
    });
    if (!error) {
      clientesTiNovos++;
    } else if (error.code !== "23505") {
      erros.push({ contexto: `notif cliente_ti ${cpfNorm}`, detalhe: error.message });
    }
  }

  return jsonResponse({
    ok: true,
    clientes_sincronizados: clientesSincronizados,
    andamentos_novos: andamentosNovos,
    tags_alteradas: tagsAlteradas,
    clientes_ti_novos: clientesTiNovos,
    erros,
  });
});

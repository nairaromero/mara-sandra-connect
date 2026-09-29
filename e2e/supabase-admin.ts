// Cliente admin (service role — BYPASSA RLS; só roda em Node) + helpers de
// seed/cleanup. Convenção de segurança contra o banco único de produção:
// TODO dado criado pelos testes leva o marcador [E2E] no nome do cliente, e o
// cleanup remove tudo que estiver pendurado nesses clientes, em ordem de FK.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

export function adminClient(): SupabaseClient {
  return createClient(ENV.supabaseUrl, ENV.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const MARCADOR = "[E2E]";

/**
 * O escritório das contas `e2e+` (o padrão do sistema). Com o RBAC multi-tenant
 * o service role enxerga TODOS os escritórios: fixture que pega "um caso
 * qualquer" tem que pegar um do escritório de quem vai abrir a tela, senão a
 * tela responde "caso não encontrado". Nulo em banco sem as migrations do RBAC
 * (lá só existe um escritório e o filtro não faz falta).
 */
export async function escritorioE2E(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).maybeSingle();
  if (error) return null;
  return (data?.id as string | undefined) ?? null;
}

// CPF sintético válido (dígitos verificadores corretos) — clientes.cpf é NOT NULL.
export function cpfValido(): string {
  const n: number[] = [];
  for (let i = 0; i < 9; i++) n.push(Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += base[i] * (base.length + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join("");
}

export interface SeedCasoResult {
  clienteId: string;
  casoId: string;
}

// Cria cliente [E2E] + caso. parceiroId opcional vincula ao parceiro de teste.
export async function seedClienteCaso(
  admin: SupabaseClient,
  opts: { sufixo: string; parceiroId?: string | null },
): Promise<SeedCasoResult> {
  const { data: cliente, error: cliErr } = await admin
    .from("clientes")
    .insert({ nome: `${MARCADOR} ${opts.sufixo}`, cpf: cpfValido() })
    .select("id")
    .single();
  if (cliErr) throw new Error(`seed cliente: ${cliErr.message}`);

  const { data: caso, error: casoErr } = await admin
    .from("casos")
    .insert({
      cliente_id: cliente.id,
      tipo_beneficio: "Salário-maternidade",
      fase: "analise",
      parceiro_id: opts.parceiroId ?? null,
    })
    .select("id")
    .single();
  if (casoErr) throw new Error(`seed caso: ${casoErr.message}`);
  return { clienteId: cliente.id, casoId: caso.id };
}

export async function seedSolicitacao(
  admin: SupabaseClient,
  casoId: string,
  tipo = "comprovante_residencia",
  opts: { origem?: string; prazoAt?: string | null; solicitadoPor?: string | null } = {},
): Promise<string> {
  const { data, error } = await admin
    .from("solicitacoes_documento")
    .insert({
      caso_id: casoId,
      tipo,
      descricao: `${MARCADOR} solicitação de teste`,
      status: "pendente",
      origem: opts.origem ?? "externa",
      prazo_at: opts.prazoAt ?? null,
      // Quem da equipe pediu. Omitido = nulo, como o robô do e-mail INSS grava.
      ...(opts.solicitadoPor !== undefined ? { solicitado_por: opts.solicitadoPor } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed solicitação: ${error.message}`);
  return data.id;
}

/**
 * Instante em que a suíte começou (carga deste módulo). Tudo que os testes
 * criam nasce DEPOIS disto — é o que deixa varrer o rastro sem tocar no que já
 * estava lá.
 */
const INICIO_DA_SUITE = new Date().toISOString();

/** Projeto de PRODUÇÃO. A varredura por autor nunca pode rodar contra ele. */
const REF_PRODUCAO = "llugytkdsfsrciavhrfw";

/**
 * O rastro que o cleanup por cliente NÃO alcança.
 *
 * A convenção é que todo dado de teste pendura num cliente `[E2E]`. Ela falha
 * quando a tela cria algo num caso que o teste não semeou — a tarefa nasce de
 * um template e leva o nome do CLIENTE REAL ("Analise de Indeferimento -
 * Cliente 001327"), sem marcador nenhum. Encontrei cinco dessas no staging em
 * 29/09, além de um relógio aberto por uma delas; é o que a Naira veria ao
 * validar.
 *
 * Segurança, porque isto apaga em caso de cliente real:
 *  - só em caso que RECEBEU escrita de conta de teste (`created_by`) DEPOIS do
 *    início da suíte — não varre caso que a suíte nem tocou;
 *  - a janela de tempo exclui o que já existia e o que vier depois;
 *  - recusa rodar contra o projeto de produção, com erro alto.
 */
export async function varrerRastroEmCasosEmprestados(admin: SupabaseClient): Promise<number> {
  if (ENV.supabaseUrl.includes(REF_PRODUCAO)) {
    throw new Error("varredura por autor NUNCA roda contra produção — alvo: " + ENV.supabaseUrl);
  }
  const { data: contas, error: eC } = await admin
    .from("usuarios")
    .select("id")
    .or("email.like.e2e+%,email.like.canario+%");
  if (eC) throw new Error(`contas de teste: ${eC.message}`);
  const contaIds = (contas ?? []).map((c) => c.id as string);
  if (contaIds.length === 0) return 0;

  // 1. casos que receberam escrita de conta de teste nesta rodada
  const casos = new Set<string>();
  for (const tabela of ["tarefas", "agenda_eventos", "relogios_prazo"]) {
    const { data, error } = await admin
      .from(tabela)
      .select("caso_id")
      .in("created_by", contaIds)
      .gte("created_at", INICIO_DA_SUITE);
    if (error) throw new Error(`rastro em ${tabela}: ${error.message}`);
    for (const l of data ?? []) if (l.caso_id) casos.add(l.caso_id as string);
  }
  if (casos.size === 0) return 0;

  // 2. desses, fica só o que NÃO é de cliente [E2E] (o cleanup normal já pega)
  const ids = [...casos];
  const { data: doTeste, error: eT } = await admin
    .from("casos")
    .select("id, cliente:cliente_id(nome)")
    .in("id", ids);
  if (eT) throw new Error(`casos do rastro: ${eT.message}`);
  const emprestados = (doTeste ?? [])
    .filter((c) => !String((c.cliente as { nome?: string } | null)?.nome ?? "").startsWith(MARCADOR))
    .map((c) => c.id as string);
  if (emprestados.length === 0) return 0;

  // 3. some SÓ com o que tem autor de teste. A primeira versão apagava tudo
  //    que nascesse na janela naquele caso — e a sabotagem provou o excesso:
  //    ela levou junto uma linha de OUTRA pessoa, criada no mesmo minuto. Num
  //    caso de cliente real isso seria apagar trabalho de gente. As três
  //    tabelas abaixo são as que têm `created_by`, e foram as três que
  //    vazaram de verdade no staging.
  let apagados = 0;
  const tarefasApagadas: Array<string> = [];
  for (const tabela of ["tarefas", "agenda_eventos", "relogios_prazo"]) {
    const { data: alvo, error: eA } = await admin
      .from(tabela)
      .select("id")
      .in("caso_id", emprestados)
      .in("created_by", contaIds)
      .gte("created_at", INICIO_DA_SUITE);
    if (eA) {
      console.warn(`varredura ${tabela}: ${eA.message}`);
      continue;
    }
    const ids = (alvo ?? []).map((l) => l.id as string);
    if (ids.length === 0) continue;

    // dependentes primeiro, presos ao id — não ao caso, senão volta o excesso
    if (tabela === "tarefas") {
      await admin.from("pedidos_prorrogacao").delete().in("tarefa_id", ids);
      tarefasApagadas.push(...ids);
    }
    const { error: eD } = await admin.from(tabela).delete().in("id", ids);
    if (eD) {
      console.warn(`varredura ${tabela}: ${eD.message}`);
      continue;
    }
    apagados += ids.length;
  }
  // o gatilho AFTER DELETE em tarefas escreve aqui; é rastro do próprio cleanup
  if (tarefasApagadas.length > 0) {
    await admin.from("tarefas_excluidas").delete().in("tarefa_id", tarefasApagadas);
  }
  if (apagados > 0) {
    // alto de propósito: é sintoma de spec escrevendo em caso que não semeou
    console.warn(
      `[cleanup] ${apagados} linha(s) de teste em ${emprestados.length} caso(s) de cliente REAL. ` +
        "Alguma spec criou dado num caso que não semeou — ver e2e/supabase-admin.ts.",
    );
  }
  return apagados;
}

// Remove TUDO que os testes criaram: filhos primeiro (FKs), depois caso e
// cliente. Inclui o que o app/triggers criaram durante o teste (documentos,
// tarefa de análise, notificações, andamentos).
export async function cleanupE2E(admin: SupabaseClient): Promise<void> {
  const { data: clientes } = await admin
    .from("clientes")
    .select("id")
    .like("nome", `${MARCADOR}%`);
  // A varredura roda MESMO sem cliente [E2E]: o rastro em caso emprestado
  // existe independentemente de a spec ter semeado cliente próprio.
  if (!clientes || clientes.length === 0) {
    await varrerRastroEmCasosEmprestados(admin);
    return;
  }
  const clienteIds = clientes.map((c) => c.id);

  const { data: casos } = await admin
    .from("casos")
    .select("id")
    .in("cliente_id", clienteIds);
  const casoIds = (casos ?? []).map((c) => c.id);

  if (casoIds.length > 0) {
    // Storage: objetos ficam em <caso_id>/<arquivo>.
    const { data: docs } = await admin
      .from("documentos")
      .select("storage_path")
      .in("caso_id", casoIds);
    const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean);
    if (paths.length > 0) {
      await admin.storage.from("documentos").remove(paths);
    }
    // comentarios fica de fora: service_role tem acesso revogado por design
    // (migration_grants_tabelas_sem_service_role) e o FK caso_id é ON DELETE
    // CASCADE — o delete do caso limpa junto.
    for (const tabela of [
      "documentos",
      "solicitacoes_documento",
      "tarefas",
      // log de exclusões (trigger AFTER DELETE em tarefas) — limpar depois
      // de tarefas, senão o próprio cleanup deixa rastro [E2E] no log.
      "tarefas_excluidas",
      "notificacoes",
      "andamentos",
      "agenda_eventos",
    ]) {
      const { error } = await admin.from(tabela).delete().in("caso_id", casoIds);
      if (error) console.warn(`cleanup ${tabela}: ${error.message}`);
    }
    await admin.from("casos").delete().in("id", casoIds);
  }
  await admin.from("clientes").delete().in("id", clienteIds);
  await varrerRastroEmCasosEmprestados(admin);
}


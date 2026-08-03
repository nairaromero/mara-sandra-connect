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
): Promise<string> {
  const { data, error } = await admin
    .from("solicitacoes_documento")
    .insert({
      caso_id: casoId,
      tipo,
      descricao: `${MARCADOR} solicitação de teste`,
      status: "pendente",
      origem: "externa",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed solicitação: ${error.message}`);
  return data.id;
}

// Remove TUDO que os testes criaram: filhos primeiro (FKs), depois caso e
// cliente. Inclui o que o app/triggers criaram durante o teste (documentos,
// tarefa de análise, notificações, andamentos).
export async function cleanupE2E(admin: SupabaseClient): Promise<void> {
  const { data: clientes } = await admin
    .from("clientes")
    .select("id")
    .like("nome", `${MARCADOR}%`);
  if (!clientes || clientes.length === 0) return;
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
}

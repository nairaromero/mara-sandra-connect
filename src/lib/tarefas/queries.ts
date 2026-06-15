// Queries de tarefas (camada fina sobre supabase-js).

import { supabase } from "@/lib/supabase";
import type {
  ProcessoDoCasoOpcao,
  TarefaComJoins,
  TarefaRow,
  TarefaStatus,
  TarefaTemplateRow,
  TarefaTipo,
} from "./types";

const SELECT_COM_JOINS = `
  id, caso_id, processo_admin_id, processo_judicial_id, responsavel_id, tipo,
  status, prioridade, titulo, descricao, due_at, origem, origem_ref, lembretes,
  gcal_event_id, metadata, created_by, created_at, updated_at, completed_at,
  responsavel:usuarios!tarefas_responsavel_id_fkey(id, nome),
  caso:casos(id, cliente:clientes(id, nome))
`;

export interface ListarTarefasFiltro {
  status?: TarefaStatus[];
  responsavel_id?: string | null;
  tipo?: TarefaTipo[];
  caso_id?: string;
  busca?: string;
  apenas_minhas_hoje?: { usuario_id: string };
}

export async function listarTarefas(
  filtro: ListarTarefasFiltro = {},
): Promise<TarefaComJoins[]> {
  let q = supabase
    .from("tarefas")
    .select(SELECT_COM_JOINS)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("prioridade", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(500);

  if (filtro.status && filtro.status.length > 0) {
    q = q.in("status", filtro.status);
  }
  if (filtro.responsavel_id !== undefined) {
    if (filtro.responsavel_id === null) q = q.is("responsavel_id", null);
    else q = q.eq("responsavel_id", filtro.responsavel_id);
  }
  if (filtro.tipo && filtro.tipo.length > 0) {
    q = q.in("tipo", filtro.tipo);
  }
  if (filtro.caso_id) {
    q = q.eq("caso_id", filtro.caso_id);
  }
  if (filtro.busca) {
    const padrao = `%${filtro.busca.replace(/[%_]/g, " ")}%`;
    q = q.or(`titulo.ilike.${padrao},descricao.ilike.${padrao}`);
  }
  if (filtro.apenas_minhas_hoje) {
    const amanhaInicio = new Date();
    amanhaInicio.setHours(0, 0, 0, 0);
    amanhaInicio.setDate(amanhaInicio.getDate() + 1);
    q = q
      .eq("responsavel_id", filtro.apenas_minhas_hoje.usuario_id)
      .in("status", ["a_fazer", "fazendo"])
      .lt("due_at", amanhaInicio.toISOString());
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as TarefaComJoins[]) ?? [];
}

export async function listarTemplates(): Promise<TarefaTemplateRow[]> {
  const { data, error } = await supabase
    .from("tarefa_templates")
    .select("id, nome, gatilho, descricao, itens, ativo")
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return (data as TarefaTemplateRow[]) ?? [];
}

export interface CriarTarefaInput {
  caso_id: string | null;
  processo_admin_id?: string | null;
  processo_judicial_id?: string | null;
  responsavel_id: string | null;
  tipo: TarefaTipo;
  prioridade: number;
  titulo: string;
  descricao: string | null;
  due_at: string | null;
}

export async function criarTarefa(input: CriarTarefaInput): Promise<TarefaRow> {
  const { data, error } = await supabase
    .from("tarefas")
    .insert({
      ...input,
      origem: "manual",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as TarefaRow;
}

export interface AtualizarTarefaInput {
  id: string;
  patch: Partial<Pick<
    TarefaRow,
    | "titulo"
    | "descricao"
    | "due_at"
    | "status"
    | "prioridade"
    | "tipo"
    | "responsavel_id"
    | "caso_id"
    | "processo_admin_id"
    | "processo_judicial_id"
  >>;
}

export async function atualizarTarefa(input: AtualizarTarefaInput): Promise<TarefaRow> {
  const { data, error } = await supabase
    .from("tarefas")
    .update(input.patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as TarefaRow;
}

export async function excluirTarefa(id: string): Promise<void> {
  const { error } = await supabase.from("tarefas").delete().eq("id", id);
  if (error) throw error;
}

export async function aplicarTemplate(args: {
  caso_id: string;
  template: string;
  responsavel_id?: string | null;
}): Promise<string[]> {
  const { data, error } = await supabase.rpc("aplicar_template", {
    p_caso_id: args.caso_id,
    p_template: args.template,
    p_responsavel: args.responsavel_id ?? null,
  });
  if (error) throw error;
  return (data as string[]) ?? [];
}

export async function listarInternosAtivos(): Promise<
  Array<{ id: string; nome: string | null; email: string | null }>
> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome, email")
    .eq("tipo", "interno")
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listarProcessosDoCaso(
  casoId: string,
): Promise<ProcessoDoCasoOpcao[]> {
  const [admins, judiciais] = await Promise.all([
    supabase
      .from("processos_admin")
      .select("id, numero_requerimento, tipo_beneficio, etapa_tipo")
      .eq("caso_id", casoId)
      .order("created_at", { ascending: false }),
    supabase
      .from("processos_judiciais")
      .select("id, numero_processo")
      .eq("caso_id", casoId)
      .order("created_at", { ascending: false }),
  ]);
  const out: ProcessoDoCasoOpcao[] = [];
  for (const a of admins.data ?? []) {
    const partes = [
      "Admin",
      a.numero_requerimento ?? "sem nº",
      a.etapa_tipo ?? null,
    ].filter(Boolean);
    out.push({
      id: a.id as string,
      natureza: "admin",
      rotulo: partes.join(" · "),
    });
  }
  for (const j of judiciais.data ?? []) {
    out.push({
      id: j.id as string,
      natureza: "judicial",
      rotulo: `Judicial · ${j.numero_processo ?? "sem nº"}`,
    });
  }
  return out;
}

export async function listarCasosResumo(): Promise<
  Array<{ id: string; cliente_nome: string | null }>
> {
  const { data, error } = await supabase
    .from("casos")
    .select("id, cliente:clientes(id, nome)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cliente_nome: (c as any).cliente?.nome ?? null,
  }));
}

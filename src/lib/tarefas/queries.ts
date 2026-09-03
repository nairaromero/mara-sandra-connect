// Queries de tarefas (camada fina sobre supabase-js).

import { supabase } from "@/lib/supabase";
import { buscarPaginado } from "@/lib/supabase-paginado";
import type {
  ProcessoDoCasoOpcao,
  TarefaComJoins,
  TarefaExcluidaRow,
  TarefaRow,
  TarefaStatus,
  TarefaTemplateRow,
  TarefaTipo,
} from "./types";

const SELECT_COM_JOINS = `
  id, caso_id, processo_admin_id, processo_judicial_id, responsavel_id, tipo,
  status, prioridade, titulo, descricao, due_at, origem, origem_ref, lembretes,
  gcal_event_id, metadata, created_by, created_at, updated_at, completed_at,
  status_alterado_por, status_alterado_em,
  responsavel:usuarios!tarefas_responsavel_id_fkey(id, nome),
  criador:usuarios!tarefas_created_by_fkey(id, nome),
  status_autor:usuarios!tarefas_status_alterado_por_fkey(id, nome),
  caso:casos(id, parceiro_id, cliente:clientes(id, nome)),
  processo_admin:processo_admin_id(id, numero_requerimento),
  processo_judicial:processo_judicial_id(id, numero_processo)
`;

export interface ListarTarefasFiltro {
  status?: TarefaStatus[];
  responsavel_id?: string | null;
  tipo?: TarefaTipo[];
  caso_id?: string;
  busca?: string;
  apenas_minhas_hoje?: { usuario_id: string };
}

/** Aplica os filtros de `ListarTarefasFiltro` numa query de `tarefas`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aplicarFiltros<Q extends { in: any; eq: any; is: any; or: any; lt: any }>(
  q: Q,
  filtro: ListarTarefasFiltro,
): Q {
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
  return q;
}

export async function listarTarefas(filtro: ListarTarefasFiltro = {}): Promise<TarefaComJoins[]> {
  // Pagina ate o fim: um `.limit()` fixo aqui cortava a lista pelo prazo mais
  // distante — as tarefas de daqui a um mes sumiam da tela sem aviso nenhum.
  const linhas = await buscarPaginado((inicio, fim) => {
    const q = supabase
      .from("tarefas")
      .select(SELECT_COM_JOINS)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("prioridade", { ascending: true })
      .order("created_at", { ascending: false })
      // Desempate estavel: sem isso paginacao repete/pula linhas.
      .order("id", { ascending: true })
      .range(inicio, fim);
    return aplicarFiltros(q, filtro);
  });
  return linhas as unknown as TarefaComJoins[];
}

/**
 * Conta tarefas no banco sem trazer as linhas (`head`). Serve pros contadores
 * de aba que precisam do numero antes de a lista ser carregada.
 */
export async function contarTarefas(filtro: ListarTarefasFiltro = {}): Promise<number> {
  const q = supabase.from("tarefas").select("id", { count: "exact", head: true });
  const { count, error } = await aplicarFiltros(q, filtro);
  if (error) throw error;
  return count ?? 0;
}

export async function listarTemplates(): Promise<TarefaTemplateRow[]> {
  // UI mostra só templates não-ocultos. Os ocultos (fallbacks de revisão,
  // classificações sem-match, etc) continuam acessíveis pra edge function
  // INSS via service_role.
  const { data, error } = await supabase
    .from("tarefa_templates")
    .select("id, nome, rotulo, gatilho, descricao, itens, ativo, oculto_na_ui")
    .eq("ativo", true)
    .eq("oculto_na_ui", false)
    .order("rotulo", { ascending: true });
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
  metadata?: Record<string, unknown>;
}

export async function criarTarefa(input: CriarTarefaInput): Promise<TarefaRow> {
  const { data, error } = await supabase
    .from("tarefas")
    .insert({
      ...input,
      origem: "manual",
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as TarefaRow;
}

export interface AtualizarTarefaInput {
  id: string;
  patch: Partial<
    Pick<
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
    >
  >;
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

/**
 * Exclui a tarefa registrando o MOTIVO (popup de conclusão). O RPC carimba o
 * motivo no metadata e deleta na mesma transação; o trigger de log grava em
 * tarefas_excluidas.motivo — ver migration_tarefa_exclusao_motivo.sql.
 */
export async function excluirTarefaComMotivo(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("excluir_tarefa_com_motivo", {
    p_id: id,
    p_motivo: motivo,
  });
  if (error) throw error;
}

/**
 * Log de tarefas excluídas (quem/quando). Por caso ou geral (últimas N).
 * `caso_id` não tem FK (o caso pode já ter sumido), então o cliente vem
 * numa 2ª consulta em vez de embed.
 */
export async function listarTarefasExcluidas(args: {
  caso_id?: string;
  limite?: number;
}): Promise<TarefaExcluidaRow[]> {
  let q = supabase
    .from("tarefas_excluidas")
    .select(
      `id, tarefa_id, caso_id, titulo, status, tipo, due_at, responsavel_id,
       created_by, created_at, excluida_por, excluida_em,
       excluidor:usuarios!tarefas_excluidas_excluida_por_fkey(id, nome),
       responsavel:usuarios!tarefas_excluidas_responsavel_id_fkey(id, nome)`,
    )
    .order("excluida_em", { ascending: false });
  if (args.caso_id) q = q.eq("caso_id", args.caso_id);
  q = q.limit(args.limite ?? 50);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data || []) as unknown as TarefaExcluidaRow[];

  const casoIds = Array.from(new Set(rows.map((r) => r.caso_id).filter(Boolean))) as string[];
  if (casoIds.length > 0 && !args.caso_id) {
    const { data: casos } = await supabase
      .from("casos")
      .select("id, cliente:clientes(id, nome)")
      .in("id", casoIds);
    const porId = new Map<string, TarefaExcluidaRow["caso"]>();
    for (const c of (casos || []) as unknown as NonNullable<TarefaExcluidaRow["caso"]>[]) {
      porId.set(c.id, c);
    }
    for (const r of rows) r.caso = r.caso_id ? (porId.get(r.caso_id) ?? null) : null;
  }
  return rows;
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

export interface ContextoCasoParaTemplate {
  cliente_nome: string;
  cliente_cpf: string;
  protocolo: string;
  servico: string;
  numero_processo_judicial: string;
  // Pro aviso automático ao parceiro (perícia/audiência): sem parceiro no
  // caso, não há a quem avisar.
  parceiro_id: string | null;
  tipo_beneficio: string;
}

/**
 * Carrega dados do caso (cliente + processo opcional) para popular
 * placeholders de template ({nome_cliente}, {protocolo}, {cpf}, etc.)
 * quando o template é aplicado manualmente pela UI.
 */
export async function obterContextoCaso(
  casoId: string,
  processoToken: string, // "" | "admin:<id>" | "judicial:<id>"
): Promise<ContextoCasoParaTemplate> {
  const ctx: ContextoCasoParaTemplate = {
    cliente_nome: "",
    cliente_cpf: "",
    protocolo: "",
    servico: "",
    numero_processo_judicial: "",
    parceiro_id: null,
    tipo_beneficio: "",
  };

  const { data: caso } = await supabase
    .from("casos")
    .select("cliente_id, parceiro_id, tipo_beneficio")
    .eq("id", casoId)
    .maybeSingle();
  ctx.parceiro_id = (caso?.parceiro_id as string | null) ?? null;
  ctx.tipo_beneficio = (caso?.tipo_beneficio as string | null) ?? "";
  if (caso?.cliente_id) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("nome, cpf")
      .eq("id", caso.cliente_id)
      .maybeSingle();
    if (cliente) {
      ctx.cliente_nome = (cliente.nome as string) ?? "";
      ctx.cliente_cpf = (cliente.cpf as string) ?? "";
    }
  }

  if (processoToken.startsWith("admin:")) {
    const id = processoToken.slice(6);
    const { data } = await supabase
      .from("processos_admin")
      .select("numero_requerimento, tipo_beneficio")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      ctx.protocolo = (data.numero_requerimento as string) ?? "";
      ctx.servico = (data.tipo_beneficio as string) ?? "";
    }
  } else if (processoToken.startsWith("judicial:")) {
    const id = processoToken.slice(9);
    const { data } = await supabase
      .from("processos_judiciais")
      .select("numero_processo")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      ctx.numero_processo_judicial = (data.numero_processo as string) ?? "";
      ctx.protocolo = ctx.numero_processo_judicial;
    }
  }
  return ctx;
}

export async function listarProcessosDoCaso(casoId: string): Promise<ProcessoDoCasoOpcao[]> {
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
    const partes = ["Admin", a.numero_requerimento ?? "sem nº", a.etapa_tipo ?? null].filter(
      Boolean,
    );
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
  // 380 casos hoje contra um teto de 500: o seletor ia comecar a esconder caso
  // calado. Pagina igual as tarefas.
  const data = await buscarPaginado((inicio, fim) =>
    supabase
      .from("casos")
      .select("id, cliente:clientes(id, nome)")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(inicio, fim),
  );
  return (data ?? []).map((c) => ({
    id: c.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cliente_nome: (c as any).cliente?.nome ?? null,
  }));
}

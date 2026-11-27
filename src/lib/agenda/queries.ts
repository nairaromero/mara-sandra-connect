// Queries da agenda (CRUD de eventos + listagens).

import { lerLista } from "@/lib/leitura";
import {
  eventoDaPericia,
  prazoAposRemarcar,
  tarefaEhDoEvento,
  type AncoraDaTarefa,
} from "@/lib/agenda/helpers";
import { supabase } from "@/lib/supabase";
import { comoLocalBR, deLocalBR } from "@/lib/fuso";
import type {
  AgendaEventoComJoins,
  AgendaEventoRow,
  AgendaTipo,
} from "./types";

/**
 * Evento do MESMO caso e tipo no MESMO DIA (calendário de Brasília) — pega
 * agendamento duplicado antes de criar outro (a Naira criou duas perícias
 * idênticas testando e nada avisou).
 */
export async function buscarEventoMesmoDia(
  casoId: string,
  tipo: AgendaTipo,
  startIso: string,
): Promise<{ id: string; start_at: string } | null> {
  const inicio = comoLocalBR(new Date(startIso));
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 1);
  const { data, error } = await supabase
    .from("agenda_eventos")
    .select("id, start_at")
    .eq("caso_id", casoId)
    .eq("tipo", tipo)
    .gte("start_at", deLocalBR(inicio).toISOString())
    .lt("start_at", deLocalBR(fim).toISOString())
    .limit(1);
  // Falha na consulta NÃO pode virar "não tem duplicado" — o guard sumiria
  // calado (review #8). Estoura e o salvar aborta com erro visível.
  if (error) throw error;
  return (data?.[0] as { id: string; start_at: string } | undefined) ?? null;
}

// ATENCAO: esta e uma lista de colunas do PostgREST, nao SQL — nada de
// comentario aqui dentro. E coluna nova na tabela precisa ser adicionada aqui,
// senao a tela nunca ve o valor. Foi o que aconteceu com concluido_em: o
// update gravava certo, a lista voltava sem o campo, e "Concluir" parecia nao
// fazer nada.
const SELECT_COM_JOINS = `
  id, caso_id, processo_admin_id, processo_judicial_id, responsavel_id,
  tipo, titulo, descricao, start_at, end_at, local, participantes, metadata,
  gcal_event_id, gcal_calendar_id, gcal_synced_at,
  created_by, created_at, updated_at,
  concluido_em, concluido_por,
  responsavel:usuarios!agenda_eventos_responsavel_id_fkey(id, nome),
  caso:casos(id, cliente:clientes(id, nome))
`;

export interface ListarAgendaFiltro {
  tipo?: AgendaTipo[];
  caso_id?: string;
  responsavel_id?: string | null;
  desde?: string;       // ISO — só eventos com end_at >= desde
  ate?: string;         // ISO — só eventos com start_at <= ate
  apenas_futuros?: boolean;
}

export async function listarAgenda(
  filtro: ListarAgendaFiltro = {},
): Promise<AgendaEventoComJoins[]> {
  let q = supabase
    .from("agenda_eventos")
    .select(SELECT_COM_JOINS)
    .order("start_at", { ascending: true })
    .limit(500);

  if (filtro.tipo && filtro.tipo.length > 0) {
    q = q.in("tipo", filtro.tipo);
  }
  if (filtro.caso_id) q = q.eq("caso_id", filtro.caso_id);
  if (filtro.responsavel_id !== undefined) {
    if (filtro.responsavel_id === null) q = q.is("responsavel_id", null);
    else q = q.eq("responsavel_id", filtro.responsavel_id);
  }
  if (filtro.desde) q = q.gte("end_at", filtro.desde);
  if (filtro.ate) q = q.lte("start_at", filtro.ate);
  if (filtro.apenas_futuros) {
    q = q.gte("end_at", new Date().toISOString());
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as AgendaEventoComJoins[]) ?? [];
}

export interface CriarEventoInput {
  caso_id: string | null;
  processo_admin_id?: string | null;
  processo_judicial_id?: string | null;
  responsavel_id: string | null;
  tipo: AgendaTipo;
  titulo: string;
  descricao: string | null;
  start_at: string;
  end_at: string;
  local: string | null;
  // aviso_direto=true: a UI enviou o aviso ao parceiro na hora; o trigger do
  // banco não cria a tarefa "Enviar aviso ao parceiro".
  metadata?: Record<string, unknown>;
}

export async function criarEvento(input: CriarEventoInput): Promise<AgendaEventoRow> {
  const { data, error } = await supabase
    .from("agenda_eventos")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as AgendaEventoRow;
}

export interface AtualizarEventoInput {
  id: string;
  patch: Partial<Pick<
    AgendaEventoRow,
    | "tipo"
    | "titulo"
    | "descricao"
    | "start_at"
    | "end_at"
    | "local"
    | "caso_id"
    | "processo_admin_id"
    | "processo_judicial_id"
    | "responsavel_id"
  >>;
}

export async function atualizarEvento(input: AtualizarEventoInput): Promise<AgendaEventoRow> {
  const { data, error } = await supabase
    .from("agenda_eventos")
    .update(input.patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as AgendaEventoRow;
}

export async function excluirEvento(id: string): Promise<void> {
  const { error } = await supabase.from("agenda_eventos").delete().eq("id", id);
  if (error) throw error;
}

/** Dá o evento por realizado (ou reabre). Não apaga nem move: grava quem e quando. */
export async function marcarConclusaoEvento(
  id: string,
  concluir: boolean,
  usuarioId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("agenda_eventos")
    .update({
      concluido_em: concluir ? new Date().toISOString() : null,
      concluido_por: concluir ? usuarioId : null,
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Perícia se conclui pela TAREFA dela (#332): quando a equipe responde se o
 * cliente compareceu, o agendamento daquela perícia está encerrado e sai dos
 * ativos do caso. Acha o evento pelo processo da tarefa e pela data que a
 * tarefa guarda (`pericia_em`); sem data que case, só conclui se houver UMA
 * perícia aberta naquele processo — com duas, não chuta.
 * Devolve se concluiu algum.
 */
export async function concluirPericiaDaTarefa(input: {
  casoId: string;
  processoAdminId: string | null;
  processoJudicialId: string | null;
  /** A tarefa de comparecimento que está sendo respondida. */
  tarefaId: string;
  periciaEm: string | null;
  /** O evento que a tarefa aponta (`metadata.evento_id`), quando ela guarda. */
  eventoId?: string | null;
}): Promise<boolean> {
  let q = supabase
    .from("agenda_eventos")
    .select("id, start_at")
    .eq("caso_id", input.casoId)
    .eq("tipo", "pericia")
    .is("concluido_em", null);
  q = input.processoAdminId
    ? q.eq("processo_admin_id", input.processoAdminId)
    : q.is("processo_admin_id", null);
  q = input.processoJudicialId
    ? q.eq("processo_judicial_id", input.processoJudicialId)
    : q.is("processo_judicial_id", null);
  const abertas = await lerLista<{ id: string; start_at: string }>(
    q,
    "perícias abertas na agenda deste processo",
  );
  const alvo = eventoDaPericia(abertas, input.periciaEm, input.eventoId);
  if (!alvo) return false;
  // Pela função do banco, não por update direto: a perícia pode estar no nome
  // de outra pessoa, e quem tem alcance "atribuídos" não a alteraria — o banco
  // recusa em silêncio. Encerrar a perícia é consequência de responder a tarefa.
  const { data, error } = await supabase.rpc("concluir_pericia_da_tarefa", {
    p_tarefa_id: input.tarefaId,
    p_evento_id: alvo.id,
  });
  if (error) throw error;
  return data === true;
}

/**
 * O compromisso foi REMARCADO: as tarefas abertas que o acompanham vão junto.
 * Cada uma passa a guardar a data nova (`pericia_em`) e o evento (`evento_id`)
 * — é isso que deixa o "Compareceu" achar a perícia certa depois — e o prazo
 * das ancoradas na agenda é refeito pela mesma conta da criação.
 * Tarefa antiga, sem o offset gravado, busca o offset no item do template.
 * Devolve quantas tarefas tiveram o PRAZO alterado.
 */
export async function reancorarTarefasDoEvento(input: {
  eventoId: string;
  casoId: string;
  startAntes: string;
  startDepois: string;
}): Promise<number> {
  if (new Date(input.startAntes).getTime() === new Date(input.startDepois).getTime()) return 0;

  type Linha = { id: string; due_at: string | null; metadata: Record<string, unknown> | null };
  const abertas = await lerLista<Linha>(
    supabase
      .from("tarefas")
      .select("id, due_at, metadata")
      .eq("caso_id", input.casoId)
      .in("status", ["a_fazer", "fazendo"])
      .not("metadata->>pericia_em", "is", null),
    "tarefas abertas ancoradas neste compromisso",
  );
  const doEvento = abertas.filter((t) =>
    tarefaEhDoEvento((t.metadata ?? {}) as AncoraDaTarefa, input.eventoId, input.startAntes),
  );
  if (doEvento.length === 0) return 0;

  // Offset de tarefa antiga: no item do template de onde ela veio.
  const nomes = [
    ...new Set(
      doEvento
        .filter((t) => typeof (t.metadata as AncoraDaTarefa)?.ancora_offset_dias !== "number")
        .map((t) => (t.metadata as { template_aplicado?: string })?.template_aplicado)
        .filter((n): n is string => !!n),
    ),
  ];
  type Item = { destino?: string; offset_dias?: number; meta?: Record<string, unknown> };
  const itensDe = new Map<string, Item[]>();
  if (nomes.length > 0) {
    const tpls = await lerLista<{ nome: string; itens: Item[] }>(
      supabase.from("tarefa_templates").select("nome, itens").in("nome", nomes),
      "templates das tarefas ancoradas",
    );
    for (const t of tpls) itensDe.set(t.nome, t.itens ?? []);
  }
  const offsetDe = (meta: Record<string, unknown>): number | undefined => {
    if (typeof meta.ancora_offset_dias === "number") return meta.ancora_offset_dias;
    const itens = itensDe.get(String(meta.template_aplicado ?? "")) ?? [];
    const porIndice =
      typeof meta.template_item_index === "number" ? itens[meta.template_item_index] : undefined;
    // Sem índice (tarefa criada pela agenda): o item que tem a mesma marca.
    const item =
      porIndice ??
      itens.find((i) => Object.entries(i.meta ?? {}).some(([k, v]) => v === true && meta[k] === true));
    return item?.offset_dias;
  };

  let mudaram = 0;
  for (const t of doEvento) {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const novoPrazo = prazoAposRemarcar(
      meta as AncoraDaTarefa,
      t.due_at,
      offsetDe(meta),
      input.startDepois,
    );
    // Pela função do banco: a tarefa pode ser de outra pessoa (mesma razão de
    // concluirPericiaDaTarefa). Ela grava a data nova do compromisso e o evento.
    const { error } = await supabase.rpc("reancorar_tarefa_do_evento", {
      p_evento_id: input.eventoId,
      p_tarefa_id: t.id,
      p_due_at: novoPrazo ?? null,
    });
    if (error) throw error;
    if (novoPrazo) mudaram++;
  }
  return mudaram;
}

// Queries da agenda (CRUD de eventos + listagens).

import { lerLista } from "@/lib/leitura";
import { eventoDaPericia } from "@/lib/agenda/helpers";
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
  periciaEm: string | null;
  usuarioId: string | null;
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
  const alvo = eventoDaPericia(abertas, input.periciaEm);
  if (!alvo) return false;
  await marcarConclusaoEvento(alvo.id, true, input.usuarioId);
  return true;
}

// Relógio de prazos do caso (#397) — ver planning/sql-migrations/migration_relogio_prazos.sql.
//
// O banco é quem trava (gatilho em `tarefas`); aqui ficam as MESMAS regras para
// a tela avisar antes de salvar e traduzir a recusa do banco.

import { supabase } from "@/lib/supabase";
import { chaveDiaBR, dataBR, hojeChaveBR } from "@/lib/fuso";

export type RelogioTipo = "judicial" | "recurso";
export type RelogioEtapa = "analise" | "montagem" | "revisao" | "protocolo" | "recurso";

export interface RelogioPrazo {
  id: string;
  caso_id: string;
  processo_admin_id: string | null;
  tipo: RelogioTipo;
  origem_em: string; // "YYYY-MM-DD"
  origem_estimada: boolean;
  etapas: Partial<Record<RelogioEtapa, string>>;
  planejado_em: string;
  limite_em: string;
  liberado_ate: string | null;
  status: "aberto" | "concluido" | "encerrado";
}

export const ETAPA_LABEL: Record<RelogioEtapa, string> = {
  analise: "Análise do indeferimento",
  montagem: "Montagem da inicial",
  revisao: "Revisão da inicial",
  protocolo: "Protocolo judicial",
  recurso: "Recurso ordinário",
};

const ORDEM: RelogioEtapa[] = ["analise", "montagem", "revisao", "protocolo", "recurso"];

export function relogioDaTarefa(metadata: unknown): { id: string; etapa: RelogioEtapa } | null {
  const m = (metadata ?? {}) as { relogio_id?: string; relogio_etapa?: RelogioEtapa };
  return m.relogio_id && m.relogio_etapa ? { id: m.relogio_id, etapa: m.relogio_etapa } : null;
}

export async function buscarRelogio(id: string): Promise<RelogioPrazo | null> {
  const { data, error } = await supabase
    .from("relogios_prazo")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as RelogioPrazo | null) ?? null;
}

export async function buscarRelogioDoCaso(casoId: string): Promise<RelogioPrazo | null> {
  const { data, error } = await supabase
    .from("relogios_prazo")
    .select("*")
    .eq("caso_id", casoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as RelogioPrazo | null) ?? null;
}

/** Dias entre dois dias de calendário "YYYY-MM-DD" (b − a). */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function somarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Datas do relógio judicial a partir do indeferimento (espelha public.relogio_etapas). */
export function relogioEtapasPrevistas(origem: string) {
  return {
    analise: somarDias(origem, 10),
    montagem: somarDias(origem, 20),
    revisao: somarDias(origem, 25),
    protocolo: somarDias(origem, 30),
    limite: somarDias(origem, 40),
  };
}

/** Sábado/domingo recuam para a sexta (espelha private.recua_fim_de_semana). */
export function recuaFimDeSemana(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 6 ? somarDias(dia, -1) : dow === 0 ? somarDias(dia, -2) : dia;
}

/** Até onde a pessoa (não admin) pode levar a data sem pedir à Mara. */
export function tetoSemPedido(r: RelogioPrazo): string {
  return r.liberado_ate && r.liberado_ate > r.planejado_em ? r.liberado_ate : r.planejado_em;
}

export type VeredictoAdiamento =
  | { tipo: "livre" }
  | { tipo: "justificar"; tiraDaProxima: { etapa: RelogioEtapa; dias: number } | null }
  | { tipo: "so_ate_amanha"; amanha: string }
  | { tipo: "pedir_mara"; teto: string };

/**
 * O que acontece se a data desta tarefa for de `dueAtual` para `dueNovo`.
 * Espelha private.tg_tarefa_relogio_trava (admin passa por tudo lá; aqui a
 * tela ainda pede justificativa ao admin, como sempre pediu).
 */
export function avaliarAdiamento(
  r: RelogioPrazo,
  etapa: RelogioEtapa,
  dueAtual: string | null,
  dueNovo: string | null,
  ehAdmin: boolean,
): VeredictoAdiamento {
  if (!dueAtual || !dueNovo || r.status !== "aberto") return { tipo: "livre" };
  if (new Date(dueNovo).getTime() <= new Date(dueAtual).getTime()) return { tipo: "livre" };

  const novo = chaveDiaBR(dueNovo);
  const hoje = hojeChaveBR();
  if (!ehAdmin) {
    const teto = tetoSemPedido(r);
    if (novo > teto) return { tipo: "pedir_mara", teto };
    const amanha = somarDias(hoje, 1);
    if (novo > somarDias(r.planejado_em, -3) && novo <= r.planejado_em && novo > amanha) {
      return { tipo: "so_ate_amanha", amanha };
    }
  }

  // Quantos dias a etapa seguinte perde: a data dela não anda.
  const i = ORDEM.indexOf(etapa);
  const proxima = ORDEM.slice(i + 1).find((e) => r.etapas[e]);
  let tira: { etapa: RelogioEtapa; dias: number } | null = null;
  const minhaData = r.etapas[etapa];
  if (proxima && minhaData && novo > minhaData) {
    tira = { etapa: proxima, dias: diasEntre(minhaData, novo) };
  }
  return { tipo: "justificar", tiraDaProxima: tira };
}

/** Recusa do banco (MSC01/02/03) → mensagem para a pessoa. */
export function mensagemTrava(err: unknown): string | null {
  const e = err as { code?: string; message?: string } | null;
  if (!e?.code || !["MSC01", "MSC02", "MSC03"].includes(e.code)) return null;
  return e.message ?? "Prazo travado.";
}

export function diaDoCaso(r: RelogioPrazo): number {
  return diasEntre(r.origem_em, hojeChaveBR());
}

export function limiteDias(r: RelogioPrazo): number {
  return diasEntre(r.origem_em, r.limite_em);
}

export function resumoRelogio(r: RelogioPrazo): string {
  return `Caso no dia ${diaDoCaso(r)} de ${limiteDias(r)} · prazo ${dataBR(r.planejado_em)}` +
    ` · limite ${dataBR(r.limite_em)}`;
}

export async function pedirProrrogacao(tarefaId: string, ate: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("pedir_prorrogacao", {
    p_tarefa: tarefaId,
    p_ate: ate,
    p_motivo: motivo,
  });
  if (error) throw error;
}

export async function decidirProrrogacao(
  pedidoId: string,
  aprovar: boolean,
  observacao: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("decidir_prorrogacao", {
    p_pedido: pedidoId,
    p_aprovar: aprovar,
    p_observacao: observacao,
  });
  if (error) throw error;
}

export interface LinhaRadar {
  relogio_id: string;
  caso_id: string;
  cliente_nome: string | null;
  tipo: RelogioTipo;
  origem_em: string;
  origem_estimada: boolean;
  planejado_em: string;
  limite_em: string;
  liberado_ate: string | null;
  dia_atual: number;
  tarefa_id: string | null;
  tarefa_titulo: string | null;
  etapa: RelogioEtapa | null;
  responsavel_nome: string | null;
  vence_em: string | null;
  dias_previstos: number | null;
  dias_disponiveis: number | null;
  sinal: "ok" | "espremida" | "reta_final" | "atrasada" | "sem_tarefa";
  pedidos_pendentes: number;
}

export async function listarRadar(): Promise<LinhaRadar[]> {
  const { data, error } = await supabase.rpc("radar_prazos");
  if (error) throw error;
  return (data ?? []) as LinhaRadar[];
}

export interface PedidoProrrogacao {
  id: string;
  caso_id: string;
  tarefa_id: string;
  relogio_id: string;
  ate: string;
  motivo: string;
  due_anterior: string | null;
  created_at: string;
  solicitante: { nome: string | null } | null;
  tarefa: { titulo: string } | null;
  relogio: { limite_em: string; planejado_em: string } | null;
}

export async function listarPedidosPendentes(): Promise<PedidoProrrogacao[]> {
  const { data, error } = await supabase
    .from("pedidos_prorrogacao")
    .select(
      "id, caso_id, tarefa_id, relogio_id, ate, motivo, due_anterior, created_at," +
        " solicitante:solicitante_id(nome), tarefa:tarefa_id(titulo)," +
        " relogio:relogio_id(limite_em, planejado_em)",
    )
    .eq("status", "pendente")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as PedidoProrrogacao[];
}

// Helpers de cálculo de datas pra agenda + templates de agenda.
//
// Toda aritmética roda no calendário de Brasília (comoLocalBR/deLocalBR):
// "sexta às 09:00" tem que ser 09:00 no Brasil mesmo quando quem agenda está
// na Europa. Ver src/lib/fuso.ts.

import { comoLocalBR, deLocalBR } from "@/lib/fuso";

/**
 * Calcula a sexta-feira anterior a uma data. Se a data já é sexta, retorna
 * a sexta da semana anterior (7 dias antes). Hora padronizada às 09:00 de Brasília
 * (lembrete da semana, não precisa de horário exato).
 */
export function sextaAnterior(d: Date): Date {
  const result = comoLocalBR(d);
  result.setHours(9, 0, 0, 0);
  const dow = result.getDay(); // 0=dom, 1=seg ... 5=sex, 6=sáb
  let diff: number;
  if (dow === 5) diff = 7;            // sexta → sexta anterior
  else if (dow === 6) diff = 1;       // sáb → sex (1 dia antes)
  else if (dow === 0) diff = 2;       // dom → sex (2)
  else diff = dow + 2;                // seg→3, ter→4, qua→5, qui→6
  result.setDate(result.getDate() - diff);
  return deLocalBR(result);
}

/**
 * Empurra uma data que caiu em sábado ou domingo para a segunda seguinte,
 * mantendo o horário.
 *
 * Existe porque tarefa relativa à agenda escorregava pro fim de semana: a
 * perícia numa sexta gerava "Confirmar comparecimento" (perícia + 1 dia) num
 * sábado, dia em que ninguém do escritório trabalha — a tarefa já nascia
 * fadada a virar atraso na segunda.
 */
export function proximoDiaUtil(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay(); // 0=dom, 6=sáb
  if (dow === 6) r.setDate(r.getDate() + 2);
  else if (dow === 0) r.setDate(r.getDate() + 1);
  return r;
}

/**
 * Fatal de prazo processual em dias ÚTEIS (CPC art. 224): exclui o dia da
 * publicação, conta a partir do dia útil seguinte; o N-ésimo dia útil é o
 * fatal. Feriados NÃO são descontados — quem aplica confere o resultado
 * (ficar aquém do fatal real é o erro seguro; passar dele, nunca).
 * Datas como "aaaa-mm-dd" — aritmética de calendário puro, sem fuso.
 */
export function fatalPorDiasUteis(
  publicadoEm: string,
  diasUteis: number,
): string | null {
  const [y, m, d] = publicadoEm.split("-").map(Number);
  if (!y || !m || !d || !Number.isInteger(diasUteis) || diasUteis <= 0) return null;
  const data = new Date(y, m - 1, d);
  let restantes = diasUteis;
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    const dow = data.getDay(); // 0=dom, 6=sáb
    if (dow !== 0 && dow !== 6) restantes--;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
}

/**
 * Due de tarefa ancorada no PRAZO FATAL informado no form (ex.: template
 * Exigência Judicial): fatal + offset_dias (offset -1 = regra da casa,
 * vencer um dia antes do fatal), às 09:00 de Brasília. Se cair em fim de
 * semana, RECUA pra sexta — o par do proximoDiaUtil empurra pra frente,
 * o que aqui seria perder o prazo.
 */
export function dueAtDoPrazoFatal(
  fatalDia: string, // "aaaa-mm-dd" (input type=date)
  offsetDias: number | undefined,
): string | null {
  const [y, m, d] = fatalDia.split("-").map(Number);
  if (!y || !m || !d) return null;
  const local = comoLocalBR(new Date());
  local.setFullYear(y, m - 1, d);
  local.setHours(9, 0, 0, 0);
  local.setDate(local.getDate() + (offsetDias ?? 0));
  const dow = local.getDay(); // 0=dom, 6=sáb
  if (dow === 6) local.setDate(local.getDate() - 1);
  else if (dow === 0) local.setDate(local.getDate() - 2);
  return deLocalBR(local).toISOString();
}

/**
 * Prazo mostrado ao PARCEIRO ("enviar até") a partir do fatal digitado no
 * form: fatal − 3 dias (regra da casa, Naira 2026-08-31 — o fatal real nunca
 * chega ao parceiro), no FIM do dia de Brasília ("até o dia X" inclui o X).
 * Caindo em fim de semana, RECUA pra sexta — empurrar pra frente comeria a
 * folga que o −3 existe pra garantir.
 */
export function prazoParceiroDoFatal(fatalDia: string): string | null {
  const [y, m, d] = fatalDia.split("-").map(Number);
  if (!y || !m || !d) return null;
  const local = comoLocalBR(new Date());
  local.setFullYear(y, m - 1, d);
  local.setHours(23, 59, 59, 0);
  local.setDate(local.getDate() - 3);
  const dow = local.getDay(); // 0=dom, 6=sáb
  if (dow === 6) local.setDate(local.getDate() - 1);
  else if (dow === 0) local.setDate(local.getDate() - 2);
  return deLocalBR(local).toISOString();
}

/**
 * Calcula due_at de uma tarefa-extra em template misto, dado o
 * start do agenda_evento e a configuração do item.
 */
export function calcularDueAtRelativo(
  ancora: "agenda" | "sexta_antes_agenda" | "hoje",
  agendaStartAt: Date | null,
  offsetDias: number | undefined,
): string | null {
  if (ancora === "agenda") {
    if (!agendaStartAt) return null;
    // Nunca vencer no fim de semana — ver proximoDiaUtil.
    return proximoDiaUtil(
      new Date(agendaStartAt.getTime() + (offsetDias ?? 0) * 86400_000),
    ).toISOString();
  }
  if (ancora === "sexta_antes_agenda") {
    if (!agendaStartAt) return null;
    const sexta = sextaAnterior(agendaStartAt);
    sexta.setDate(sexta.getDate() + (offsetDias ?? 0));
    return sexta.toISOString();
  }
  // "hoje" — fallback: hoje + offset
  if (typeof offsetDias !== "number") return null;
  return new Date(Date.now() + offsetDias * 86400_000).toISOString();
}

/** Qual evento é o da perícia que a tarefa acompanha: o que a tarefa aponta
 *  (`evento_id`); senão o da mesma data; sem data que case, o único aberto.
 *  Com mais de um e nenhum na data, nenhum. */
export function eventoDaPericia<E extends { id?: string; start_at: string }>(
  abertas: E[],
  periciaEm: string | null,
  eventoId?: string | null,
): E | null {
  if (eventoId) {
    const apontado = abertas.find((e) => e.id === eventoId);
    if (apontado) return apontado;
  }
  if (periciaEm) {
    const alvo = new Date(periciaEm).getTime();
    const mesma = abertas.find((e) => new Date(e.start_at).getTime() === alvo);
    if (mesma) return mesma;
  }
  return abertas.length === 1 ? abertas[0] : null;
}

/** Evento que ainda está por acontecer: nem dado por realizado, nem já passado.
 *  É o que a aba Atividades do caso mostra em "Ativos". */
export function eventoAtivo(
  e: { end_at: string; concluido_em: string | null },
  agora: number,
): boolean {
  return !e.concluido_em && new Date(e.end_at).getTime() >= agora;
}

/** O que a tarefa guarda sobre o compromisso que a ancorou. */
export interface AncoraDaTarefa {
  evento_id?: string;
  pericia_em?: string;
  ancora_prazo?: string;
  ancora_offset_dias?: number;
  checagens?: unknown[];
}

/** A tarefa acompanha ESTE evento? Pelo `evento_id`; tarefa antiga (sem ele),
 *  pela data que guardou — a do evento ANTES de ser remarcado. */
export function tarefaEhDoEvento(
  meta: AncoraDaTarefa,
  eventoId: string,
  startAntes: string,
): boolean {
  if (meta.evento_id) return meta.evento_id === eventoId;
  if (!meta.pericia_em) return false;
  return new Date(meta.pericia_em).getTime() === new Date(startAntes).getTime();
}

/**
 * Prazo da tarefa depois que o compromisso foi remarcado: a MESMA conta da
 * criação (`calcularDueAtRelativo`), com a data nova. Devolve `undefined`
 * quando o prazo não deve mudar: tarefa que não é ancorada na agenda, sem
 * offset conhecido, sem prazo, ou conferência que já entrou no ciclo de
 * "ainda sem resultado" (o prazo dela passou a ser o da próxima conferência).
 */
export function prazoAposRemarcar(
  meta: AncoraDaTarefa,
  dueAtual: string | null,
  offsetDias: number | undefined,
  startDepois: string,
): string | undefined {
  const ancora = meta.ancora_prazo;
  if (ancora !== "agenda" && ancora !== "sexta_antes_agenda") return undefined;
  if (!dueAtual || typeof offsetDias !== "number") return undefined;
  if ((meta.checagens?.length ?? 0) > 0) return undefined;
  return calcularDueAtRelativo(ancora, new Date(startDepois), offsetDias) ?? undefined;
}

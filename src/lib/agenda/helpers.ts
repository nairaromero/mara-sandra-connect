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

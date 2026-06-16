// Helpers de cálculo de datas pra agenda + templates de agenda.

/**
 * Calcula a sexta-feira anterior a uma data. Se a data já é sexta, retorna
 * a sexta da semana anterior (7 dias antes). Hora padronizada às 09:00 local
 * (lembrete da semana, não precisa de horário exato).
 */
export function sextaAnterior(d: Date): Date {
  const result = new Date(d);
  result.setHours(9, 0, 0, 0);
  const dow = result.getDay(); // 0=dom, 1=seg ... 5=sex, 6=sáb
  let diff: number;
  if (dow === 5) diff = 7;            // sexta → sexta anterior
  else if (dow === 6) diff = 1;       // sáb → sex (1 dia antes)
  else if (dow === 0) diff = 2;       // dom → sex (2)
  else diff = dow + 2;                // seg→3, ter→4, qua→5, qui→6
  result.setDate(result.getDate() - diff);
  return result;
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
    return new Date(
      agendaStartAt.getTime() + (offsetDias ?? 0) * 86400_000,
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

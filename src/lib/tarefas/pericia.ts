// Perícia do INSS × perícia JUDICIAL — a única decisão de "qual das duas é".
//
// No administrativo o resultado da perícia É o desfecho: deferido abre a
// corrente do Concedido, indeferido a do Indeferido. No judicial não: o perito
// junta um LAUDO, favorável ou não, e o processo segue até a sentença. Até
// 25/11/2026 a tarefa "Conferir laudo da perícia judicial" mostrava os botões
// do INSS, e "Saiu — deferido" lançava benefício concedido num processo que
// só tinha um laudo juntado (caso que a Mara apontou).
//
// O SQL repete esta regra num lugar só: `private.eh_pericia_judicial`
// (migration_pericia_judicial_laudo.sql). A régua
// `e2e/unit/pericia-judicial.test.ts` confere os dois.

export type LaudoPericia = "favoravel" | "parcial" | "desfavoravel";

export const TEMPLATE_PERICIA_JUDICIAL = "pericia_judicial";
export const TEMPLATE_PERICIA_INSS = "pericia_parceiro";
/** Corrente que nasce quando o laudo judicial sai. */
export const TEMPLATE_LAUDO_JUDICIAL = "laudo_pericia_judicial";

interface TarefaDePericia {
  processo_judicial_id?: string | null;
  metadata?: unknown;
}

/**
 * A perícia desta tarefa é judicial?
 *  1. marca explícita (`metadata.pericia_judicial`) ou template judicial → sim;
 *  2. template do INSS → não, mesmo presa a um processo judicial (a escolha de
 *     quem aplicou o template vale mais que o vínculo);
 *  3. sem template (tarefa aberta pelo "compareceu"): vale o vínculo — perícia
 *     dentro de processo judicial é judicial.
 */
export function ehPericiaJudicial(tarefa: TarefaDePericia): boolean {
  const meta = (tarefa.metadata ?? {}) as {
    pericia_judicial?: boolean;
    template_aplicado?: string;
  };
  if (meta.pericia_judicial === true) return true;
  if (meta.template_aplicado === TEMPLATE_PERICIA_JUDICIAL) return true;
  if (meta.template_aplicado === TEMPLATE_PERICIA_INSS) return false;
  return !!tarefa.processo_judicial_id;
}

export const ROTULO_LAUDO: Record<LaudoPericia, string> = {
  favoravel: "FAVORÁVEL",
  parcial: "PARCIALMENTE FAVORÁVEL",
  desfavoravel: "DESFAVORÁVEL",
};

/** O andamento que conta o laudo ao parceiro — nunca fala em deferimento. */
export function andamentoDoLaudo(laudo: LaudoPericia, dataBR: string) {
  const como =
    laudo === "favoravel"
      ? "é favorável ao cliente"
      : laudo === "parcial"
        ? "é parcialmente favorável ao cliente"
        : "não é favorável ao cliente";
  return {
    titulo: `Laudo da perícia judicial juntado — ${ROTULO_LAUDO[laudo]} (${dataBR})`,
    descricao:
      `O laudo da perícia judicial foi juntado aos autos e ${como}. ` +
      "O laudo não é a decisão: vamos analisar e nos manifestar, e o processo segue até a sentença.",
  };
}

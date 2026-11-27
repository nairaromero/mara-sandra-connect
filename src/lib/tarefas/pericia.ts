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
// (migration_pericia_judicial_vale_processo.sql). A régua
// `e2e/unit/pericia-judicial.test.ts` confere os dois.

export type LaudoPericia = "favoravel" | "parcial" | "desfavoravel";

export const TEMPLATE_PERICIA_JUDICIAL = "pericia_judicial";
/** Corrente que nasce quando o laudo judicial sai. */
export const TEMPLATE_LAUDO_JUDICIAL = "laudo_pericia_judicial";

interface TarefaDePericia {
  processo_judicial_id?: string | null;
  metadata?: unknown;
}

/**
 * A perícia desta tarefa é judicial? O ciclo nasce do PROCESSO a que a tarefa
 * está ligada (Naira, 27/11/2026): perícia dentro de processo judicial é
 * judicial, qualquer que seja o template escolhido. Em agosto houve perícia
 * judicial lançada com o template do INSS, e era o template que estava errado.
 *  1. ligada a processo judicial → sim;
 *  2. sem processo judicial: só se veio do template judicial ou traz a marca
 *     explícita (`metadata.pericia_judicial`).
 */
export function ehPericiaJudicial(tarefa: TarefaDePericia): boolean {
  const meta = (tarefa.metadata ?? {}) as {
    pericia_judicial?: boolean;
    template_aplicado?: string;
  };
  return periciaEhJudicial({
    emProcessoJudicial: !!tarefa.processo_judicial_id,
    template: meta.template_aplicado,
    marca: meta.pericia_judicial === true,
  });
}

/**
 * A mesma regra para quem ainda não tem a tarefa: os formulários de tarefa e
 * de agenda, que sabem só o processo escolhido e o template selecionado.
 */
export function periciaEhJudicial(p: {
  emProcessoJudicial: boolean;
  template?: string | null;
  marca?: boolean;
}): boolean {
  return p.emProcessoJudicial || p.marca === true || p.template === TEMPLATE_PERICIA_JUDICIAL;
}

/**
 * Marca da tarefa que É a análise de um laudo judicial — venha do botão
 * (template `laudo_pericia_judicial`) ou da publicação do tribunal (gatilho
 * `tg_publicacao_acionavel_cria_tarefa`). Uma análise por laudo: quem vai abrir
 * outra olha esta marca antes.
 */
export const META_ANALISE_LAUDO = "analise_laudo_pericia";
/** Posta pelo gatilho da publicação na conferência aberta: "o laudo foi publicado". */
export const META_LAUDO_PUBLICADO_EM = "laudo_publicado_em";

const ROTULO_LAUDO: Record<LaudoPericia, string> = {
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

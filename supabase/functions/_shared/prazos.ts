// Contagem de prazo — a conta que a tela e as functions dividem.
// Módulo PURO (sem Deno, sem banco): a tela importa por `@shared/prazos`.
//
// Regra do escritório (Naira, 27/11/2026), para prazo judicial e administrativo:
//  - a publicação ou o andamento do INSS chega num dia; o prazo começa a contar
//    no PRÓXIMO DIA ÚTIL. Veio na sexta (ou no sábado), o dia 1 é a segunda;
//  - o sistema trabalha com o fatal menos 1;
//  - prazo que termina em sábado ou domingo volta para a sexta.
//
// Exemplo: andamento na sexta 13/11, 10 dias. Dia 1 = segunda 16/11; fatal
// (dia 10) = quarta 25/11; prazo no sistema = terça 24/11.
//
// O SQL repete em `private.base_da_contagem` e `private.recua_fim_de_semana`.
// Dias como "aaaa-mm-dd": aritmética de calendário puro, sem fuso.
// Feriado não entra — o sistema não tem calendário de feriados.

function utc(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function somarDias(dia: string, n: number): string {
  const d = utc(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sábado/domingo recuam para a sexta (espelha private.recua_fim_de_semana). */
export function recuaFimDeSemana(dia: string): string {
  const dow = utc(dia).getUTCDay();
  return dow === 6 ? somarDias(dia, -1) : dow === 0 ? somarDias(dia, -2) : dia;
}

/**
 * A véspera do dia 1 da contagem: `baseDaContagem(evento) + N` é o N-ésimo dia
 * do prazo (o fatal de um prazo de N dias corridos).
 * O dia 1 é o próximo dia útil depois do evento — então evento de segunda a
 * quinta (e de domingo) conta da própria data; de sexta, a base é o domingo;
 * de sábado, também.
 */
export function baseDaContagem(evento: string): string {
  const dow = utc(evento).getUTCDay();
  return dow === 5 ? somarDias(evento, 2) : dow === 6 ? somarDias(evento, 1) : evento;
}

/** Fatal de um prazo de `dias` corridos contado do próximo dia útil após o evento. */
export function fatalEmDiasCorridos(evento: string, dias: number): string {
  return somarDias(baseDaContagem(evento), dias);
}

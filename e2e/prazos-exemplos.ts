// Exemplos da regra "prazo não cai em fim de semana", divididos entre a régua
// da tela (bun) e a prova no banco (Playwright): a mesma tabela para os dois
// lados é o que mostra que o espelho TS e a função SQL dizem igual.

/** Sexta, 27/11/2026, 15:00 em Brasília. */
export const AGORA_DOS_EXEMPLOS = "2026-11-27T15:00:00-03:00";

export const EXEMPLOS_PRAZO: Array<{
  caso: string;
  prazo: string;
  travado: boolean;
  esperado: string;
}> = [
  {
    caso: "sábado 9h, e a sexta 9h já passou: segunda",
    prazo: "2026-11-28T09:00:00-03:00",
    travado: false,
    esperado: "2026-11-30T09:00:00-03:00",
  },
  {
    caso: "sábado fim do dia: sexta fim do dia",
    prazo: "2026-11-28T23:59:00-03:00",
    travado: false,
    esperado: "2026-11-27T23:59:00-03:00",
  },
  {
    caso: "domingo, prazo travado: sexta, mesmo já passada",
    prazo: "2026-11-29T09:00:00-03:00",
    travado: true,
    esperado: "2026-11-27T09:00:00-03:00",
  },
  {
    caso: "sábado da semana que vem: sexta",
    prazo: "2026-12-05T09:00:00-03:00",
    travado: false,
    esperado: "2026-12-04T09:00:00-03:00",
  },
  {
    caso: "domingo da semana que vem: sexta",
    prazo: "2026-12-06T09:00:00-03:00",
    travado: false,
    esperado: "2026-12-04T09:00:00-03:00",
  },
  {
    caso: "dia útil fica como está",
    prazo: "2026-12-02T09:00:00-03:00",
    travado: false,
    esperado: "2026-12-02T09:00:00-03:00",
  },
  {
    caso: "sábado 23:30 em Brasília (já domingo em UTC): sexta 23:30",
    prazo: "2026-11-29T02:30:00Z",
    travado: false,
    esperado: "2026-11-28T02:30:00Z",
  },
];

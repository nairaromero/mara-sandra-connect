// Datas exibidas no calendário de Brasília, seja qual for o fuso do navegador
// (bug de 2026-09-21: em Madri o "Enviar até" caía um dia depois). Rodar:
//   bun test e2e/unit/fuso-datas.test.ts
// O teste força um fuso fora do Brasil; vale rodar também com TZ=Asia/Tokyo etc.
// (fora de src/ porque o tsc do app não conhece bun:test; a Playwright só lê e2e/tests)
import { beforeAll, describe, expect, test } from "bun:test";
import { dataBR, dataHoraBR, diaDoEventoBR, horaDoEventoBR } from "../../src/lib/fuso";

beforeAll(() => {
  process.env.TZ ||= "Europe/Madrid";
});

// "Enviar até" de uma solicitação: fim do dia 09/10 em Brasília.
const PRAZO = "2026-10-10T02:59:59.999+00:00";

describe("dataBR / dataHoraBR", () => {
  test("timestamp sai no dia de Brasília, não no do navegador", () => {
    expect(dataBR(PRAZO)).toBe("09/10/2026");
    expect(dataBR(new Date(PRAZO))).toBe("09/10/2026");
    expect(dataHoraBR(PRAZO)).toBe("09/10/2026 23:59");
  });

  test("coluna date (YYYY-MM-DD) sai como está, sem cair na véspera", () => {
    expect(dataBR("2026-10-09")).toBe("09/10/2026");
  });
});

describe("andamentos.data_evento", () => {
  test("meia-noite UTC (DJEN/Legalmail gravam só a data) é data pura", () => {
    expect(diaDoEventoBR("2026-09-10T00:00:00+00:00")).toBe("2026-09-10");
    expect(horaDoEventoBR("2026-09-10T00:00:00+00:00")).toBeNull();
    expect(diaDoEventoBR("2026-09-10")).toBe("2026-09-10");
  });

  test("instante de verdade é lido em Brasília", () => {
    expect(diaDoEventoBR("2026-09-10T02:30:00+00:00")).toBe("2026-09-09");
    expect(horaDoEventoBR("2026-09-10T02:30:00+00:00")).toBe("23:30");
    expect(diaDoEventoBR("2026-09-10T15:00:00+00:00")).toBe("2026-09-10");
    expect(horaDoEventoBR("2026-09-10T15:00:00+00:00")).toBe("12:00");
  });
});

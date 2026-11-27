// A perícia sai dos ativos do caso quando a equipe responde o comparecimento
// (Naira, 27/11/2026). Rodar: bun test e2e/unit/agenda-evento-ativo.test.ts
import { describe, expect, test } from "bun:test";
import { eventoAtivo, eventoDaPericia } from "../../src/lib/agenda/helpers";

const AGORA = Date.parse("2026-11-27T15:00:00Z");
const futuro = "2026-12-10T15:32:00Z";
const passado = "2026-11-20T15:00:00Z";

describe("eventoAtivo", () => {
  test("futuro e aberto é ativo", () => {
    expect(eventoAtivo({ end_at: futuro, concluido_em: null }, AGORA)).toBe(true);
  });
  test("futuro mas dado por realizado não é", () => {
    expect(eventoAtivo({ end_at: futuro, concluido_em: "2026-11-27T14:00:00Z" }, AGORA)).toBe(false);
  });
  test("passado não é, concluído ou não", () => {
    expect(eventoAtivo({ end_at: passado, concluido_em: null }, AGORA)).toBe(false);
  });
});

describe("eventoDaPericia", () => {
  const a = { id: "a", start_at: "2026-12-10T14:32:00.000Z" };
  const b = { id: "b", start_at: "2027-01-15T13:00:00.000Z" };
  test("casa pela data que a tarefa guarda, mesmo escrita em outro formato", () => {
    expect(eventoDaPericia([a, b], "2026-12-10T14:32:00+00:00")).toBe(a);
  });
  test("sem data que case: a única aberta", () => {
    expect(eventoDaPericia([b], null)).toBe(b);
    expect(eventoDaPericia([b], "2026-01-01T00:00:00Z")).toBe(b);
  });
  test("duas abertas e nenhuma na data: não chuta", () => {
    expect(eventoDaPericia([a, b], null)).toBeNull();
    expect(eventoDaPericia([a, b], "2026-01-01T00:00:00Z")).toBeNull();
  });
  test("nenhuma aberta", () => {
    expect(eventoDaPericia([], futuro)).toBeNull();
  });
});

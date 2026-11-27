// A perícia sai dos ativos do caso quando a equipe responde o comparecimento
// (Naira, 27/11/2026). Rodar: bun test e2e/unit/agenda-evento-ativo.test.ts
import { describe, expect, test } from "bun:test";
import {
  eventoAtivo,
  eventoDaPericia,
  prazoAposRemarcar,
  tarefaEhDoEvento,
} from "../../src/lib/agenda/helpers";

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

// Perícia remarcada (Naira, 27/11/2026): as tarefas vão junto, e o "Compareceu"
// continua achando a perícia certa.
describe("eventoDaPericia com o evento apontado pela tarefa", () => {
  const a = { id: "a", start_at: "2026-12-25T14:32:00.000Z" }; // remarcada
  const b = { id: "b", start_at: "2027-01-15T13:00:00.000Z" };
  test("acha pelo evento_id mesmo com a data da tarefa defasada e outra perícia aberta", () => {
    expect(eventoDaPericia([a, b], "2026-12-04T14:32:00.000Z", "a")).toBe(a);
  });
  test("sem evento_id e com a data defasada, duas abertas: não chuta (o bug de antes)", () => {
    expect(eventoDaPericia([a, b], "2026-12-04T14:32:00.000Z")).toBeNull();
  });
});

describe("tarefaEhDoEvento", () => {
  const antes = "2026-12-04T17:24:00+00:00";
  test("pelo evento_id, quando a tarefa guarda", () => {
    expect(tarefaEhDoEvento({ evento_id: "x", pericia_em: "2020-01-01T00:00:00Z" }, "x", antes)).toBe(true);
    expect(tarefaEhDoEvento({ evento_id: "y", pericia_em: antes }, "x", antes)).toBe(false);
  });
  test("tarefa antiga: pela data do evento antes de remarcar, em qualquer formato", () => {
    expect(tarefaEhDoEvento({ pericia_em: "2026-12-04T17:24:00.000Z" }, "x", antes)).toBe(true);
    expect(tarefaEhDoEvento({ pericia_em: "2026-12-04T17:23:00.000Z" }, "x", antes)).toBe(false);
    expect(tarefaEhDoEvento({}, "x", antes)).toBe(false);
  });
});

describe("prazoAposRemarcar", () => {
  const due = "2026-12-07T17:24:00.000Z";
  const nova = "2026-12-09T17:24:00.000Z"; // quarta
  test("ancorada na agenda: data nova + offset", () => {
    expect(prazoAposRemarcar({ ancora_prazo: "agenda" }, due, 1, nova)).toBe("2026-12-10T17:24:00.000Z");
  });
  test("não mexe: sem âncora na agenda, sem offset, sem prazo, ou conferência já em ciclo", () => {
    expect(prazoAposRemarcar({ ancora_prazo: "hoje" }, due, 1, nova)).toBeUndefined();
    expect(prazoAposRemarcar({ ancora_prazo: "agenda" }, due, undefined, nova)).toBeUndefined();
    expect(prazoAposRemarcar({ ancora_prazo: "agenda" }, null, 1, nova)).toBeUndefined();
    expect(
      prazoAposRemarcar({ ancora_prazo: "agenda", checagens: ["2026-12-01"] }, due, 10, nova),
    ).toBeUndefined();
  });
});

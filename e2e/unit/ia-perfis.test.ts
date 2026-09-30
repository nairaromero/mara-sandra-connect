// Adaptador de IA: perfil por modelo, teto com raciocínio, blocos devolvidos
// intactos e corte legível (#451, #328). O provedor é simulado trocando o fetch:
// o teste confere o corpo que SAI e o que o adaptador faz com a resposta. Rodar:
//   bun test e2e/unit/ia-perfis.test.ts
// (fora de src/ porque o tsc do app não conhece bun:test; a Playwright só lê e2e/tests)
import { afterEach, describe, expect, test } from "bun:test";
import {
  chatWith,
  IaRespostaCortada,
  modeloAposentado,
  perfilDoModelo,
  planoDaChamada,
  PROVIDERS,
} from "../../supabase/functions/_shared/ia-providers";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Troca o fetch: guarda os corpos enviados e devolve `resposta`. */
function provedor(resposta: Record<string, unknown>) {
  const enviados: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    enviados.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(resposta), { status: 200 });
  }) as typeof fetch;
  return enviados;
}

const RESP_ANTHROPIC = {
  content: [{ type: "text", text: "{\"ok\":true}" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5 },
};
const opts = (extra: Record<string, unknown> = {}) => ({
  system: "s",
  messages: [{ role: "user" as const, content: "oi" }],
  tools: [],
  ...extra,
});

describe("perfil por modelo", () => {
  test("o mais específico ganha e versão datada cai na família", () => {
    expect(perfilDoModelo("anthropic", "claude-opus-5-5").raciocinio).toBe("sempre");
    expect(perfilDoModelo("anthropic", "claude-opus-5").raciocinio).toBe("ligado");
    expect(perfilDoModelo("anthropic", "claude-opus-5-20260724").raciocinio).toBe("ligado");
    expect(perfilDoModelo("anthropic", "claude-sonnet-5-5").desligar).toEqual({ type: "between_tools" });
    expect(perfilDoModelo("anthropic", "claude-haiku-4-5-20251001").raciocinio).toBe("desligado");
    expect(perfilDoModelo("openai", "gpt-4.1-mini").raciocinio).toBe("nenhum");
  });

  test("modelo desconhecido é tratado como quem raciocina sempre", () => {
    expect(perfilDoModelo("anthropic", "claude-novo-9").raciocinio).toBe("sempre");
    expect(perfilDoModelo("anthropic", "claude-novo-9").desligar).toBeUndefined();
  });

  test("a lista da tela sai dos perfis e não tem modelo aposentado", () => {
    expect(PROVIDERS.anthropic.models).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"]);
    for (const [prov, info] of Object.entries(PROVIDERS)) {
      for (const m of info.models) expect(modeloAposentado(prov, m)).toBeNull();
    }
    expect(modeloAposentado("anthropic", "claude-opus-4-1")).toContain("05/08/2026");
  });
});

describe("plano da chamada", () => {
  test("resposta curta num modelo que desliga: desliga e mantém o teto pedido", () => {
    const p = planoDaChamada(perfilDoModelo("anthropic", "claude-sonnet-5-5"), "curta", 200);
    expect(p).toEqual({ teto: 200, thinking: { type: "between_tools" } });
  });

  test("modelo que não desliga: teto com folga e esforço baixo na curta", () => {
    const p = planoDaChamada(perfilDoModelo("anthropic", "claude-opus-5-5"), "curta", 200);
    expect(p.teto).toBe(4000);
    expect(p.esforco).toBe("low");
    expect(p.thinking).toBeUndefined();
  });

  test("longa: teto com folga, sem mexer no raciocínio", () => {
    const p = planoDaChamada(perfilDoModelo("anthropic", "claude-sonnet-5-5"), "longa", 8000);
    expect(p).toEqual({ teto: 16000, esforco: undefined });
  });

  test("modelo sem raciocínio: nada muda", () => {
    expect(planoDaChamada(perfilDoModelo("openai", "gpt-4.1"), "curta", 200)).toEqual({ teto: 200 });
    expect(planoDaChamada(perfilDoModelo("anthropic", "claude-haiku-4-5"), "longa", 8000)).toEqual({ teto: 8000 });
  });
});

describe("chatWith", () => {
  test("Anthropic: corpo sai com o plano do perfil", async () => {
    const enviados = provedor(RESP_ANTHROPIC);
    const r = await chatWith("anthropic", "k", "claude-sonnet-5-5", opts({ maxTokens: 200 }));
    expect(enviados[0].max_tokens).toBe(200);
    expect(enviados[0].thinking).toEqual({ type: "between_tools" });
    expect(enviados[0].output_config).toBeUndefined();
    expect(r.parada).toBe("end_turn");
    expect(r.cortada).toBe(false);
  });

  test("Anthropic sem raciocínio: corpo igual ao de antes", async () => {
    const enviados = provedor(RESP_ANTHROPIC);
    await chatWith("anthropic", "k", "claude-haiku-4-5", opts({ maxTokens: 700 }));
    expect(enviados[0].max_tokens).toBe(700);
    expect("thinking" in enviados[0]).toBe(false);
    expect("output_config" in enviados[0]).toBe(false);
  });

  test("blocos de raciocínio voltam intactos na rodada de ferramenta", async () => {
    const blocos = [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "tool_use", id: "t1", name: "buscar", input: { q: "x" } },
    ];
    provedor({ content: blocos, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
    const r1 = await chatWith("anthropic", "k", "claude-opus-5-5", opts());
    expect(r1.bruto).toEqual(blocos);

    const enviados = provedor(RESP_ANTHROPIC);
    await chatWith("anthropic", "k", "claude-opus-5-5", opts({
      messages: [
        { role: "user", content: "oi" },
        { role: "assistant", content: r1.text, toolCalls: r1.toolCalls, bruto: r1.bruto },
        { role: "tool", toolCallId: "t1", name: "buscar", content: "{}" },
      ],
    }));
    const msgs = enviados[0].messages as Array<{ role: string; content: unknown }>;
    expect(msgs[1]).toEqual({ role: "assistant", content: blocos });
  });

  test("corte sem nada aproveitável vira erro legível", async () => {
    provedor({ content: [{ type: "thinking", thinking: "", signature: "s" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 200 } });
    await expect(chatWith("anthropic", "k", "claude-opus-5-5", opts())).rejects.toBeInstanceOf(IaRespostaCortada);
  });

  test("corte com texto segue, marcado como cortado", async () => {
    provedor({ content: [{ type: "text", text: "meio" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 200 } });
    const r = await chatWith("anthropic", "k", "claude-haiku-4-5", opts());
    expect(r.cortada).toBe(true);
    expect(r.text).toBe("meio");
  });

  test("OpenAI: gpt-4.1 continua com max_tokens; modelo que raciocina usa max_completion_tokens", async () => {
    const resp = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    let enviados = provedor(resp);
    await chatWith("openai", "k", "gpt-4.1", opts({ maxTokens: 900 }));
    expect(enviados[0].max_tokens).toBe(900);
    expect("max_completion_tokens" in enviados[0]).toBe(false);

    enviados = provedor(resp);
    await chatWith("openai", "k", "gpt-5.6-luna", opts({ maxTokens: 900 }));
    expect(enviados[0].max_completion_tokens).toBe(4000);
    expect("max_tokens" in enviados[0]).toBe(false);
  });

  test("OpenAI: finish_reason length sem conteúdo vira erro legível", async () => {
    provedor({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 900 } });
    await expect(chatWith("openai", "k", "gpt-4.1", opts())).rejects.toBeInstanceOf(IaRespostaCortada);
  });

  test("modelo aposentado é recusado antes de chamar o provedor", async () => {
    const enviados = provedor(RESP_ANTHROPIC);
    await expect(chatWith("anthropic", "k", "claude-opus-4-1", opts())).rejects.toThrow("aposentado");
    expect(enviados.length).toBe(0);
  });
});

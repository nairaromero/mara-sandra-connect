// Adaptador de IA: perfil por modelo, teto com raciocínio, blocos devolvidos
// intactos e corte legível (#451, #328). O provedor é simulado trocando o fetch:
// o teste confere o corpo que SAI e o que o adaptador faz com a resposta. Rodar:
//   bun test e2e/unit/ia-perfis.test.ts
// (fora de src/ porque o tsc do app não conhece bun:test; a Playwright só lê e2e/tests)
import { afterEach, describe, expect, test } from "bun:test";
import { esforcoDaTarefa, lerEsforcos } from "../../supabase/functions/_shared/ia-esforco";
import {
  chatWith,
  classeDoErro,
  IaRespostaCortada,
  listarModelos,
  mensagemDoErro,
  type LinhaUso,
  modeloAposentado,
  perfilDoModelo,
  planoDaChamada,
  ESFORCO_POR_TAREFA,
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

  test("a tarefa escolhe o esforço: análise em high mesmo no Opus 5.5 (padrão medium)", () => {
    const p = planoDaChamada(perfilDoModelo("anthropic", "claude-opus-5-5"), "longa", 8000, "ia-analise");
    expect(p).toEqual({ teto: 16000, esforco: "high" });
  });

  test("tarefa medium com resposta curta: pensa um pouco, não desliga", () => {
    const p = planoDaChamada(perfilDoModelo("anthropic", "claude-sonnet-5-5"), "curta", 700, "extrair-agendamento-pericia");
    expect(p).toEqual({ teto: 4000, esforco: "medium" });
  });

  test("tarefa low com resposta curta num modelo que desliga: desliga o raciocínio", () => {
    const p = planoDaChamada(perfilDoModelo("anthropic", "claude-sonnet-5-5"), "curta", 20, "integracoes-escritorio:testar");
    expect(p).toEqual({ teto: 20, thinking: { type: "between_tools" } });
    // No Opus 5.5 não há como desligar: vai low.
    expect(planoDaChamada(perfilDoModelo("anthropic", "claude-opus-5-5"), "curta", 20, "integracoes-escritorio:testar").esforco).toBe("low");
  });

  test("identificar documentos pensa: no mínimo medium, em qualquer modelo que recebe esforço", () => {
    // Pedido da Naira (27/10): precisão alta na identificação.
    expect(["medium", "high"]).toContain(ESFORCO_POR_TAREFA["identificar-documentos"]);
    for (const modelo of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
      const p = planoDaChamada(perfilDoModelo("anthropic", modelo), "curta", 400, "identificar-documentos");
      expect(p.thinking, modelo).toBeUndefined();
      expect(p.esforco, modelo).toBe("medium");
      expect(p.teto, modelo).toBeGreaterThanOrEqual(4000);
    }
  });

  test("modelo que não recebe esforço (Haiku 4.5, OpenAI) ignora a tarefa", () => {
    expect(planoDaChamada(perfilDoModelo("anthropic", "claude-haiku-4-5"), "longa", 8000, "ia-analise")).toEqual({ teto: 8000 });
    expect(planoDaChamada(perfilDoModelo("openai", "gpt-4.1"), "longa", 8000, "ia-analise")).toEqual({ teto: 8000 });
  });

  test("o escritório troca o esforço de uma tarefa; as outras seguem o padrão", () => {
    const doEscritorio = lerEsforcos({ "ia-analise": "medium" });
    expect(planoDaChamada(perfilDoModelo("anthropic", "claude-opus-5-5"), "longa", 8000, "ia-analise", doEscritorio).esforco).toBe("medium");
    expect(planoDaChamada(perfilDoModelo("anthropic", "claude-opus-5-5"), "longa", 8000, "ia-triagem-andamentos", doEscritorio).esforco).toBe("high");
  });

  test("escritório que baixa uma tarefa para low em resposta curta, no Sonnet 5.5: desliga o raciocínio", () => {
    const doEscritorio = lerEsforcos({ "identificar-documentos": "low" });
    const p = planoDaChamada(perfilDoModelo("anthropic", "claude-sonnet-5-5"), "curta", 400, "identificar-documentos", doEscritorio);
    expect(p).toEqual({ teto: 400, thinking: { type: "between_tools" } });
  });

  test("lerEsforcos não confia no que vem do banco/tela", () => {
    expect(lerEsforcos({
      "ia-analise": "medium",          // vale
      "ia-triagem-andamentos": "high", // igual ao padrão: não grava
      "tarefa-inventada": "low",       // tarefa desconhecida
      "ia-assistant": "max",           // nível fora dos aceitos
      "sugerir-proxima-tarefa": 3,     // tipo errado
    })).toEqual({ "ia-analise": "medium" });
    expect(lerEsforcos(null)).toEqual({});
    expect(lerEsforcos(["low"])).toEqual({});
    expect(esforcoDaTarefa("ia-analise", {})).toBe(ESFORCO_POR_TAREFA["ia-analise"]);
  });

  test("chatWith usa o esforço que vem com a credencial do escritório e grava no registro", async () => {
    const enviados = provedor(RESP_ANTHROPIC);
    const linhas: LinhaUso[] = [];
    await chatWith(
      "anthropic",
      { chave: "k", esforcos: { "ia-analise": "low" } },
      "claude-opus-5-5",
      opts({ maxTokens: 8000, registro: { tarefa: "ia-analise", gravar: async (l) => { linhas.push(l); } } }),
    );
    expect(enviados[0].output_config).toEqual({ effort: "low" });
    expect(linhas[0].esforco).toBe("low");
  });

  test("a tabela só usa níveis que os modelos atuais aceitam", () => {
    for (const [tarefa, nivel] of Object.entries(ESFORCO_POR_TAREFA)) {
      expect(["low", "medium", "high"], tarefa).toContain(nivel);
    }
  });

  test("modelo sem raciocínio: nada muda", () => {
    expect(planoDaChamada(perfilDoModelo("openai", "gpt-4.1"), "curta", 200)).toEqual({ teto: 200 });
    expect(planoDaChamada(perfilDoModelo("anthropic", "claude-haiku-4-5"), "longa", 8000)).toEqual({ teto: 8000 });
  });
});

describe("chatWith", () => {
  test("Anthropic: corpo sai com o plano do perfil", async () => {
    const enviados = provedor(RESP_ANTHROPIC);
    const r = await chatWith("anthropic", { chave: "k" }, "claude-sonnet-5-5", opts({ maxTokens: 200 }));
    expect(enviados[0].max_tokens).toBe(200);
    expect(enviados[0].thinking).toEqual({ type: "between_tools" });
    expect(enviados[0].output_config).toBeUndefined();
    expect(r.parada).toBe("end_turn");
    expect(r.cortada).toBe(false);
  });

  test("Anthropic sem raciocínio: corpo igual ao de antes", async () => {
    const enviados = provedor(RESP_ANTHROPIC);
    await chatWith("anthropic", { chave: "k" }, "claude-haiku-4-5", opts({ maxTokens: 700 }));
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
    const r1 = await chatWith("anthropic", { chave: "k" }, "claude-opus-5-5", opts());
    expect(r1.bruto).toEqual(blocos);

    const enviados = provedor(RESP_ANTHROPIC);
    await chatWith("anthropic", { chave: "k" }, "claude-opus-5-5", opts({
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
    await expect(chatWith("anthropic", { chave: "k" }, "claude-opus-5-5", opts())).rejects.toBeInstanceOf(IaRespostaCortada);
  });

  test("corte com texto segue, marcado como cortado", async () => {
    provedor({ content: [{ type: "text", text: "meio" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 200 } });
    const r = await chatWith("anthropic", { chave: "k" }, "claude-haiku-4-5", opts());
    expect(r.cortada).toBe(true);
    expect(r.text).toBe("meio");
  });

  test("OpenAI: gpt-4.1 continua com max_tokens; modelo que raciocina usa max_completion_tokens", async () => {
    const resp = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    let enviados = provedor(resp);
    await chatWith("openai", { chave: "k" }, "gpt-4.1", opts({ maxTokens: 900 }));
    expect(enviados[0].max_tokens).toBe(900);
    expect("max_completion_tokens" in enviados[0]).toBe(false);

    enviados = provedor(resp);
    await chatWith("openai", { chave: "k" }, "gpt-5.6-luna", opts({ maxTokens: 900 }));
    expect(enviados[0].max_completion_tokens).toBe(4000);
    expect("max_tokens" in enviados[0]).toBe(false);
  });

  test("OpenAI: finish_reason length sem conteúdo vira erro legível", async () => {
    provedor({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 900 } });
    await expect(chatWith("openai", { chave: "k" }, "gpt-4.1", opts())).rejects.toBeInstanceOf(IaRespostaCortada);
  });

  test("modelo aposentado é recusado antes de chamar o provedor", async () => {
    const enviados = provedor(RESP_ANTHROPIC);
    await expect(chatWith("anthropic", { chave: "k" }, "claude-opus-4-1", opts())).rejects.toThrow("aposentado");
    expect(enviados.length).toBe(0);
  });

  test("registro de uso: uma linha por chamada, com tokens e sem conteúdo", async () => {
    provedor({ ...RESP_ANTHROPIC, usage: { input_tokens: 12, output_tokens: 7, output_tokens_details: { thinking_tokens: 3 } } });
    const linhas: LinhaUso[] = [];
    await chatWith("anthropic", { chave: "k" }, "claude-sonnet-5-5", opts({ registro: { tarefa: "ia-analise", gravar: async (l) => { linhas.push(l); } } }));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      provider: "anthropic", modelo: "claude-sonnet-5-5",
      tokens_entrada: 12, tokens_saida: 7, tokens_raciocinio: 3,
      esforco: "high",
      parada: "end_turn", cortada: false, erro: null,
    });
    // Só números, nomes e a classe da falha: nenhum campo carrega texto da conversa.
    expect(Object.keys(linhas[0]).sort()).toEqual([
      "cortada", "duracao_ms", "erro", "esforco", "modelo", "parada", "provider",
      "tokens_entrada", "tokens_raciocinio", "tokens_saida",
    ]);
  });

  test("registro de uso: corte e erro HTTP viram classe, nunca o texto do provedor", async () => {
    const linhas: LinhaUso[] = [];
    const registro = { tarefa: "ia-assistant" as const, gravar: async (l: LinhaUso) => { linhas.push(l); } };
    provedor({ content: [], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 4000 } });
    await expect(chatWith("anthropic", { chave: "k" }, "claude-opus-5-5", opts({ registro }))).rejects.toBeInstanceOf(IaRespostaCortada);
    expect(linhas[0]).toMatchObject({ erro: "cortada", cortada: true, tokens_saida: 4000 });

    globalThis.fetch = (async () => new Response("segredo do cliente no eco", { status: 400 })) as unknown as typeof fetch;
    await expect(chatWith("anthropic", { chave: "k" }, "claude-haiku-4-5", opts({ registro }))).rejects.toThrow("anthropic 400");
    expect(linhas[1].erro).toBe("http_400");
    expect(JSON.stringify(linhas[1])).not.toContain("segredo do cliente");
    expect(classeDoErro(new DOMException("t", "TimeoutError"))).toBe("timeout");
  });

  test("registro que falha não derruba a chamada", async () => {
    provedor(RESP_ANTHROPIC);
    const r = await chatWith("anthropic", { chave: "k" }, "claude-haiku-4-5", opts({
      registro: { tarefa: "ia-assistant", gravar: async () => { throw new Error("banco fora"); } },
    }));
    expect(r.text).toBe("{\"ok\":true}");
  });

  test("mensagem do erro para a tela: frase em português, sem o texto cru do provedor", () => {
    const cru = new Error('anthropic 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_x"}');
    const m = mensagemDoErro(cru);
    expect(m).toContain("recusou a chave");
    expect(m).not.toContain("x-api-key");
    expect(m).not.toContain("req_");
    expect(mensagemDoErro(new Error("openai 404: model not found"))).toContain("não reconhece este modelo");
    expect(mensagemDoErro(new Error("openai 429: rate limit"))).toContain("limitou as chamadas");
    expect(mensagemDoErro(new Error("anthropic 529: overloaded"))).toContain("com problema agora");
    expect(mensagemDoErro(new DOMException("t", "TimeoutError"))).toContain("não respondeu a tempo");
    expect(mensagemDoErro(new Error("o modelo claude-opus-4-1 foi aposentado pelo provedor em 05/08/2026."))).toContain("05/08/2026");
    expect(mensagemDoErro(new Error("qualquer outra coisa"))).toBe("Não consegui falar com o provedor de IA.");
    // Falha que não veio do provedor: vale a frase de quem chamou.
    expect(mensagemDoErro(new Error("modelo nao chamou registrar_triagem"), "A IA não devolveu a triagem.")).toBe(
      "A IA não devolveu a triagem.",
    );
    // …mas a do provedor continua com a frase do túnel.
    expect(mensagemDoErro(new Error("openai 401: x"), "padrão")).toContain("recusou a chave");
  });

  test("workspace: o cabeçalho anthropic-workspace-id vai só quando há workspace", async () => {
    const pedidos: Array<Record<string, string>> = [];
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      pedidos.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify(RESP_ANTHROPIC), { status: 200 });
    }) as typeof fetch;
    await chatWith("anthropic", { chave: "k", workspaceId: "wrkspc_01abc" }, "claude-haiku-4-5", opts());
    await chatWith("anthropic", { chave: "k" }, "claude-haiku-4-5", opts());
    expect(pedidos[0]["anthropic-workspace-id"]).toBe("wrkspc_01abc");
    expect("anthropic-workspace-id" in pedidos[1]).toBe(false);
  });

  test("chave sem workspace: a frase diz o que fazer, e o 400 genérico não culpa o modelo", () => {
    const ws = new Error('anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header"}}');
    expect(mensagemDoErro(ws)).toContain("workspace");
    expect(mensagemDoErro(ws)).not.toContain("modelo");
    expect(mensagemDoErro(new Error("anthropic 400: {\"message\":\"max_tokens: too large\"}"))).not.toContain("modelo");
    expect(mensagemDoErro(new Error("anthropic 400: {\"message\":\"model: claude-x not found\"}"))).toContain("não reconhece este modelo");
  });

  test("listarModelos: Anthropic esconde aposentados e marca descontinuado, PDF e recomendado", async () => {
    let url = "";
    globalThis.fetch = (async (u: string) => {
      url = String(u);
      return new Response(JSON.stringify({ data: [
        { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", lifecycle: "active", capabilities: { pdf_input: { supported: true } }, retires_at: null },
        { id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5", lifecycle: "deprecated", capabilities: null, retires_at: "2026-11-30T00:00:00Z" },
        { id: "claude-opus-4-1-20250805", display_name: "Claude Opus 4.1", lifecycle: "retired", capabilities: null, retires_at: null },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const m = await listarModelos("anthropic", { chave: "k" });
    expect(url).toContain("/v1/models");
    expect(m.map((x) => x.id)).toEqual(["claude-sonnet-5-5", "claude-sonnet-4-5-20250929"]);
    expect(m[0]).toMatchObject({ situacao: "ativo", lePdf: true, recomendado: true });
    expect(m[1]).toMatchObject({ situacao: "descontinuado", saiEm: "2026-11-30T00:00:00Z", recomendado: false });
  });

  test("listarModelos: OpenAI fica só com modelos de conversa", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [
      { id: "gpt-4.1" }, { id: "text-embedding-3-small" }, { id: "gpt-4o-audio-preview" }, { id: "o3" }, { id: "dall-e-3" }, { id: "gpt-4o-mini-tts" },
    ] }), { status: 200 })) as unknown as typeof fetch;
    const m = await listarModelos("openai", { chave: "k" });
    expect(m.map((x) => x.id)).toEqual(["gpt-4.1", "o3"]);
  });

  test("listarModelos: falha sai no formato do chatWith (a mensagemDoErro traduz)", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(listarModelos("anthropic", { chave: "k" })).rejects.toThrow("anthropic 401");
  });
});

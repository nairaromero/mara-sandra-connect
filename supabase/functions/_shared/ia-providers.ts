// Adapter multiprovider (gap #9: endpoints FIXOS, usuario nao informa base_url).
//
// Normaliza tool-use entre Anthropic (Messages API) e OpenAI (Chat Completions),
// expondo uma unica interface `chatWith`. O resto do agente (loop, whitelist,
// confirmacao, auditoria) e agnostico de provider.

export type ToolDef = {
  name: string;
  description: string;
  schema: Record<string, unknown>; // JSON Schema dos argumentos
};

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

// Mensagem normalizada (interna ao agente).
export type NormMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ChatResult = {
  text: string;
  toolCalls: ToolCall[];
  usage: { input: number; output: number };
};

// Endpoints e modelos sugeridos. base_url FIXO. `models` sao sugestoes p/ a UI
// (datalist) — o backend nao trava o modelo, mas o provider rejeita se invalido.
export const PROVIDERS: Record<
  string,
  { label: string; endpoint: string; models: string[] }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    endpoint: "https://api.anthropic.com/v1/messages",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  },
  openai: {
    label: "OpenAI (GPT)",
    endpoint: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  },
};

const MAX_TOKENS = 1536;

export type ChatOpts = {
  system: string;
  messages: NormMsg[];
  tools: ToolDef[];
  maxTokens?: number; // teto de saida; default MAX_TOKENS (chat). Analise usa mais.
};

export async function chatWith(
  provider: string,
  apiKey: string,
  modelo: string,
  opts: ChatOpts,
): Promise<ChatResult> {
  if (provider === "anthropic") return anthropicChat(apiKey, modelo, opts);
  if (provider === "openai") return openaiChat(apiKey, modelo, opts);
  throw new Error("provider nao suportado: " + provider);
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
async function anthropicChat(
  apiKey: string,
  modelo: string,
  opts: ChatOpts,
): Promise<ChatResult> {
  // Agrupa resultados de tool consecutivos num unico turno 'user' (exigencia da API).
  const msgs: Array<Record<string, unknown>> = [];
  let pendingToolResults: Array<Record<string, unknown>> = [];

  const flushTools = () => {
    if (pendingToolResults.length) {
      msgs.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of opts.messages) {
    if (m.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      });
      continue;
    }
    flushTools();
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content });
    } else {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      }
      msgs.push({ role: "assistant", content: blocks });
    }
  }
  flushTools();

  const body = {
    model: modelo,
    max_tokens: opts.maxTokens ?? MAX_TOKENS,
    system: opts.system,
    messages: msgs,
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    })),
  };

  const resp = await fetch(PROVIDERS.anthropic.endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error("anthropic " + resp.status + ": " + txt.slice(0, 300));
  }
  const data = await resp.json();
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text") text += block.text;
    if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
    }
  }
  return {
    text,
    toolCalls,
    usage: {
      input: data.usage?.input_tokens ?? 0,
      output: data.usage?.output_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
async function openaiChat(
  apiKey: string,
  modelo: string,
  opts: ChatOpts,
): Promise<ChatResult> {
  const msgs: Array<Record<string, unknown>> = [
    { role: "system", content: opts.system },
  ];
  for (const m of opts.messages) {
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content });
    } else if (m.role === "tool") {
      msgs.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else {
      const tcs = (m.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }));
      const out: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (tcs.length) out.tool_calls = tcs;
      msgs.push(out);
    }
  }

  const body = {
    model: modelo,
    max_tokens: opts.maxTokens ?? MAX_TOKENS,
    messages: msgs,
    tools: opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.schema },
    })),
  };

  const resp = await fetch(PROVIDERS.openai.endpoint, {
    method: "POST",
    headers: {
      "authorization": "Bearer " + apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error("openai " + resp.status + ": " + txt.slice(0, 300));
  }
  const data = await resp.json();
  const choice = data.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = [];
  for (const tc of choice.tool_calls ?? []) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(tc.function?.arguments ?? "{}");
    } catch {
      parsed = {};
    }
    toolCalls.push({ id: tc.id, name: tc.function?.name ?? "", args: parsed });
  }
  return {
    text: choice.content ?? "",
    toolCalls,
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    },
  };
}

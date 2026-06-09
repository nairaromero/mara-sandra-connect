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

// Anexo binario (PDF/imagem) enviado junto da ultima mensagem 'user'. Usado pela
// ia-analise p/ mandar PDFs escaneados direto ao provider (OCR nativo do modelo),
// ja que o extrator de texto nao le imagem. base64 SEM o prefixo "data:".
export type Attachment = {
  kind: "pdf" | "image";
  mediaType: string; // application/pdf, image/png, image/jpeg...
  base64: string;
  name?: string;
};

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
  attachments?: Attachment[]; // anexados a ULTIMA mensagem 'user' (PDF/imagem).
};

// Blocos de anexo por provider. Anthropic le PDF/imagem nativamente (document/
// image); OpenAI usa 'file' (file_data data URL) p/ PDF e 'image_url' p/ imagem.
function anthropicAttBlock(att: Attachment): Record<string, unknown> {
  if (att.kind === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: att.mediaType, data: att.base64 },
      ...(att.name ? { title: att.name } : {}),
    };
  }
  return {
    type: "image",
    source: { type: "base64", media_type: att.mediaType, data: att.base64 },
  };
}

function openaiAttPart(att: Attachment): Record<string, unknown> {
  const dataUrl = "data:" + att.mediaType + ";base64," + att.base64;
  if (att.kind === "pdf") {
    return { type: "file", file: { filename: att.name ?? "documento.pdf", file_data: dataUrl } };
  }
  return { type: "image_url", image_url: { url: dataUrl } };
}

// Anexa os blocos a ULTIMA mensagem 'user' de `msgs`, convertendo o content de
// string p/ array quando preciso. blockOf monta o bloco no formato do provider.
function appendAttachments(
  msgs: Array<Record<string, unknown>>,
  attachments: Attachment[] | undefined,
  blockOf: (att: Attachment) => Record<string, unknown>,
): void {
  if (!attachments?.length) return;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== "user") continue;
    const cur = msgs[i].content;
    const blocks: Array<unknown> = typeof cur === "string"
      ? [{ type: "text", text: cur }]
      : Array.isArray(cur)
      ? [...cur]
      : [];
    for (const att of attachments) blocks.push(blockOf(att));
    msgs[i].content = blocks;
    return;
  }
}

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
  appendAttachments(msgs, opts.attachments, anthropicAttBlock);

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
  appendAttachments(msgs, opts.attachments, openaiAttPart);

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

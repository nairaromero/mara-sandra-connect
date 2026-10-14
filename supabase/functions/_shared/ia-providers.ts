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

// Mensagem normalizada (interna ao agente). `bruto` guarda o conteudo da
// resposta do provider como veio (Anthropic: blocos, inclusive os de raciocinio)
// para ser devolvido INTACTO na rodada seguinte de ferramentas: nos modelos que
// raciocinam, a API recusa o turno do assistente sem os blocos de raciocinio.
export type NormMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; bruto?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ChatResult = {
  text: string;
  toolCalls: ToolCall[];
  /** `raciocinio`: parte da saida gasta no rascunho do modelo (quando o provider informa). */
  usage: { input: number; output: number; raciocinio?: number };
  /** Motivo da parada, como o provider devolveu (end_turn, max_tokens, stop, length...). */
  parada: string | null;
  /** O teto de tokens acabou antes do fim: o texto pode estar incompleto. */
  cortada: boolean;
  /** Conteudo cru da resposta, para devolver no proximo turno (ver NormMsg). */
  bruto?: unknown;
};

// ---------------------------------------------------------------------------
// Perfil por modelo — UMA fonte de verdade para o que cada modelo aceita.
//
// Nos modelos que raciocinam, o raciocinio conta dentro do teto de saida
// (Anthropic `max_tokens`, OpenAI `max_completion_tokens`): com teto baixo o
// modelo pensa, o teto acaba e a resposta sai cortada ou vazia (#328). Por isso
// a funcao nao escolhe numero: diz o tamanho da resposta (curta ou longa) e o
// perfil traduz em raciocinio, esforco e teto.
//
// Fontes (conferidas em 01/10/2026):
//   https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
//   https://platform.claude.com/docs/en/about-claude/model-deprecations
//   https://developers.openai.com/api/docs/deprecations
// Modelo novo: acrescentar aqui (a lista da tela sai daqui).
// ---------------------------------------------------------------------------

/** sempre: nao desliga · ligado: pensa por padrao e desliga · desligado: so pensa se pedir · nenhum: nao raciocina */
export type Raciocinio = "sempre" | "ligado" | "desligado" | "nenhum";

export type PerfilModelo = {
  provider: "anthropic" | "openai";
  /** id do modelo, ou prefixo da familia (casa com o id e com versoes datadas: `<prefixo>-2026...`). */
  prefixo: string;
  raciocinio: Raciocinio;
  /** Anthropic: `thinking` que desliga o raciocinio antecipado, quando o modelo aceita. */
  desligar?: Record<string, unknown>;
  /** Anthropic: aceita `output_config.effort` (modo adaptativo). */
  esforco?: boolean;
  /** Aparece na lista sugerida da tela. */
  sugerido?: boolean;
  /** Data (AAAA-MM-DD) em que o provider aposentou o modelo: chamadas falham. */
  aposentadoEm?: string;
};

// Ordem importa: o mais especifico antes (claude-opus-5-5 antes de claude-opus-5).
export const PERFIS: PerfilModelo[] = [
  // Anthropic — Fable/Mythos nao entram na lista sugerida: nao estao disponiveis
  // com retencao zero sem autorizacao expressa da Anthropic (dado de saude).
  { provider: "anthropic", prefixo: "claude-fable-5-1", raciocinio: "sempre", esforco: true },
  { provider: "anthropic", prefixo: "claude-fable-5", raciocinio: "sempre", esforco: true },
  { provider: "anthropic", prefixo: "claude-mythos", raciocinio: "sempre", esforco: true },
  { provider: "anthropic", prefixo: "claude-opus-5-5", raciocinio: "sempre", esforco: true, sugerido: true },
  { provider: "anthropic", prefixo: "claude-opus-5", raciocinio: "ligado", esforco: true, desligar: { type: "disabled" } },
  { provider: "anthropic", prefixo: "claude-opus-4-8", raciocinio: "desligado", esforco: true },
  { provider: "anthropic", prefixo: "claude-opus-4-7", raciocinio: "desligado", esforco: true },
  { provider: "anthropic", prefixo: "claude-opus-4-6", raciocinio: "desligado" },
  { provider: "anthropic", prefixo: "claude-opus-4-5", raciocinio: "desligado" },
  { provider: "anthropic", prefixo: "claude-opus-4-1", raciocinio: "desligado", aposentadoEm: "2026-08-05" },
  { provider: "anthropic", prefixo: "claude-opus-4", raciocinio: "desligado", aposentadoEm: "2026-06-15" },
  { provider: "anthropic", prefixo: "claude-sonnet-5-5", raciocinio: "ligado", esforco: true, desligar: { type: "between_tools" }, sugerido: true },
  { provider: "anthropic", prefixo: "claude-sonnet-5", raciocinio: "ligado", esforco: true, desligar: { type: "disabled" } },
  { provider: "anthropic", prefixo: "claude-sonnet-4-6", raciocinio: "desligado" },
  // Sai do ar em 30/11/2026 (substituto oficial: claude-sonnet-5-5).
  { provider: "anthropic", prefixo: "claude-sonnet-4-5", raciocinio: "desligado" },
  { provider: "anthropic", prefixo: "claude-sonnet-4", raciocinio: "desligado", aposentadoEm: "2026-06-15" },
  { provider: "anthropic", prefixo: "claude-haiku-4-5", raciocinio: "desligado", sugerido: true },
  // OpenAI — gpt-4.1 e gpt-4o sem data de desligamento publicada (01/10/2026).
  { provider: "openai", prefixo: "gpt-4.1-nano", raciocinio: "nenhum" },
  { provider: "openai", prefixo: "gpt-4.1-mini", raciocinio: "nenhum", sugerido: true },
  { provider: "openai", prefixo: "gpt-4.1", raciocinio: "nenhum", sugerido: true },
  { provider: "openai", prefixo: "gpt-4o-mini", raciocinio: "nenhum", sugerido: true },
  { provider: "openai", prefixo: "gpt-4o", raciocinio: "nenhum", sugerido: true },
  { provider: "openai", prefixo: "gpt-5", raciocinio: "sempre" },
  { provider: "openai", prefixo: "o1", raciocinio: "sempre" },
  { provider: "openai", prefixo: "o3", raciocinio: "sempre" },
  { provider: "openai", prefixo: "o4", raciocinio: "sempre" },
];

/**
 * Perfil do modelo. Modelo fora da tabela: trata como "raciocina sempre"
 * (sem desligar e com teto folgado) — e o lado seguro para modelo novo, que
 * quase sempre raciocina e recusa parametro que nao conhece.
 */
export function perfilDoModelo(provider: string, modelo: string): PerfilModelo {
  const m = modelo.trim().toLowerCase();
  const achado = PERFIS.find(
    (p) => p.provider === provider && (m === p.prefixo || m.startsWith(p.prefixo + "-")),
  );
  return achado ?? {
    provider: provider === "openai" ? "openai" : "anthropic",
    prefixo: m,
    raciocinio: "sempre",
  };
}

/** Motivo legivel quando o modelo ja foi aposentado pelo provider; null se nao. */
export function modeloAposentado(provider: string, modelo: string): string | null {
  const p = perfilDoModelo(provider, modelo);
  if (!p.aposentadoEm) return null;
  const [a, mes, d] = p.aposentadoEm.split("-");
  return `o modelo ${modelo} foi aposentado pelo provedor em ${d}/${mes}/${a}. Escolha outro modelo na Integração de IA.`;
}

/** Tamanho da resposta que a funcao espera. */
export type TamanhoResposta = "curta" | "longa";

// Teto minimo quando o modelo raciocina: sobra espaco para o rascunho E a resposta.
const PISO_RACIOCINIO: Record<TamanhoResposta, number> = { curta: 4000, longa: 16000 };

/** O que vai na requisicao: teto, raciocinio e esforco — derivados do perfil. */
export function planoDaChamada(
  perfil: PerfilModelo,
  tamanho: TamanhoResposta,
  pedido: number,
): { teto: number; thinking?: Record<string, unknown>; esforco?: "low" } {
  if (perfil.raciocinio === "nenhum" || perfil.raciocinio === "desligado") {
    return { teto: pedido };
  }
  // Resposta curta num modelo que deixa desligar: desliga (mais rapido e barato).
  if (tamanho === "curta" && perfil.desligar) {
    return { teto: pedido, thinking: perfil.desligar };
  }
  // Nao desliga (ou resposta longa): teto com folga; na curta, pede pouco esforco.
  return {
    teto: Math.max(pedido, PISO_RACIOCINIO[tamanho]),
    esforco: tamanho === "curta" && perfil.esforco ? "low" : undefined,
  };
}

/** A resposta foi cortada pelo teto e nao sobrou nada aproveitavel. */
export class IaRespostaCortada extends Error {
  constructor(provider: string, modelo: string) {
    super(
      `a resposta da IA (${provider} ${modelo}) foi cortada pelo limite de tokens antes de terminar`,
    );
    this.name = "IaRespostaCortada";
  }
}

// Endpoints fixos. `models` (lista sugerida da tela) sai dos PERFIS.
export const PROVIDERS: Record<
  string,
  { label: string; endpoint: string; models: string[] }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    endpoint: "https://api.anthropic.com/v1/messages",
    models: PERFIS.filter((p) => p.provider === "anthropic" && p.sugerido).map((p) => p.prefixo),
  },
  openai: {
    label: "OpenAI (GPT)",
    endpoint: "https://api.openai.com/v1/chat/completions",
    models: PERFIS.filter((p) => p.provider === "openai" && p.sugerido).map((p) => p.prefixo),
  },
};

const MAX_TOKENS = 1536;

export type ChatOpts = {
  system: string;
  messages: NormMsg[];
  tools: ToolDef[];
  maxTokens?: number; // teto pedido pela funcao; default MAX_TOKENS (chat). O perfil pode subir.
  /**
   * Tamanho da resposta esperada. Sem ele, vale "curta" ate 2000 tokens pedidos
   * e "longa" acima — que e o que os tetos de cada funcao ja diziam.
   */
  tamanho?: TamanhoResposta;
  attachments?: Attachment[]; // anexados a ULTIMA mensagem 'user' (PDF/imagem).
  // Aborta o fetch do provider (ex.: AbortSignal.timeout). Diferente de um
  // Promise.race, a requisicao para de verdade — nao fica pendurada gastando token.
  signal?: AbortSignal;
  /**
   * Registro de uso (tabela ia_uso). Toda chamada passa um — monte com
   * `registroDeUso` (_shared/ia-integracao.ts). A regua
   * e2e/unit/ia-registro-de-uso.test.ts acusa chamada sem registro.
   */
  registro?: RegistroUso;
};

/** Uma linha de uso — sem conteudo: so numeros, nomes e a classe da falha. */
export type LinhaUso = {
  provider: string;
  modelo: string;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_raciocinio: number | null;
  parada: string | null;
  cortada: boolean;
  erro: string | null;
  duracao_ms: number;
};

export type RegistroUso = { gravar: (linha: LinhaUso) => Promise<void> };

/** Classe da falha para o registro (nunca o texto do provider, que pode ecoar conteudo). */
export function classeDoErro(e: unknown): string {
  if (e instanceof IaRespostaCortada) return "cortada";
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) return "timeout";
  const m = String((e as Error)?.message ?? e);
  const http = m.match(/^(anthropic|openai) (\d{3}):/);
  if (http) return "http_" + http[2];
  if (m.includes("aposentado")) return "modelo_aposentado";
  return "outro";
}

async function registrar(reg: RegistroUso | undefined, linha: LinhaUso): Promise<void> {
  if (!reg) return;
  try {
    await reg.gravar(linha);
  } catch (e) {
    // O registro nunca derruba a chamada: perder a linha e ruim, travar a IA e pior.
    console.warn("[ia] registro de uso falhou:", String((e as Error)?.message ?? e));
  }
}

function tamanhoDe(opts: ChatOpts, pedido: number): TamanhoResposta {
  return opts.tamanho ?? (pedido <= 2000 ? "curta" : "longa");
}

/**
 * Fecha o resultado: corte sem nada aproveitavel vira erro legivel; corte com
 * texto ou ferramenta segue, mas fica no log (antes passava calado).
 */
function fecharResultado(provider: string, modelo: string, r: ChatResult): ChatResult {
  if (r.cortada) {
    if (!r.text.trim() && !r.toolCalls.length) throw new IaRespostaCortada(provider, modelo);
    console.warn(
      `[ia] resposta cortada pelo teto (${provider} ${modelo}, parada=${r.parada}, saida=${r.usage.output})`,
    );
  }
  return r;
}

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
  const inicio = Date.now();
  let r: ChatResult | null = null;
  try {
    const aposentado = modeloAposentado(provider, modelo);
    if (aposentado) throw new Error(aposentado);
    if (provider === "anthropic") r = await anthropicChat(apiKey, modelo, opts);
    else if (provider === "openai") r = await openaiChat(apiKey, modelo, opts);
    else throw new Error("provider nao suportado: " + provider);
    const fechado = fecharResultado(provider, modelo, r);
    await registrar(opts.registro, {
      provider, modelo,
      tokens_entrada: r.usage.input, tokens_saida: r.usage.output,
      tokens_raciocinio: r.usage.raciocinio ?? null,
      parada: r.parada, cortada: r.cortada, erro: null,
      duracao_ms: Date.now() - inicio,
    });
    return fechado;
  } catch (e) {
    // Corte sem conteudo chega aqui com `r` preenchido: os tokens gastos contam.
    await registrar(opts.registro, {
      provider, modelo,
      tokens_entrada: r?.usage.input ?? 0, tokens_saida: r?.usage.output ?? 0,
      tokens_raciocinio: r?.usage.raciocinio ?? null,
      parada: r?.parada ?? null, cortada: r?.cortada ?? false, erro: classeDoErro(e),
      duracao_ms: Date.now() - inicio,
    });
    throw e;
  }
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
    } else if (Array.isArray(m.bruto)) {
      // Devolve o turno exatamente como veio (inclui blocos de raciocinio).
      msgs.push({ role: "assistant", content: m.bruto });
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

  const pedido = opts.maxTokens ?? MAX_TOKENS;
  const plano = planoDaChamada(perfilDoModelo("anthropic", modelo), tamanhoDe(opts, pedido), pedido);
  const body: Record<string, unknown> = {
    model: modelo,
    max_tokens: plano.teto,
    system: opts.system,
    messages: msgs,
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    })),
  };
  if (plano.thinking) body.thinking = plano.thinking;
  if (plano.esforco) body.output_config = { effort: plano.esforco };

  const resp = await fetch(PROVIDERS.anthropic.endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    // Timeout mesmo quando o chamador não passa `signal`: 6 dos 9 chamadores
    // não passavam, e uma chamada de LLM pendurada segurava a function até o
    // gateway derrubar em 150s.
    signal: opts.signal ?? AbortSignal.timeout(90_000),
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
  const parada = typeof data.stop_reason === "string" ? data.stop_reason : null;
  return {
    text,
    toolCalls,
    usage: {
      input: data.usage?.input_tokens ?? 0,
      output: data.usage?.output_tokens ?? 0,
      raciocinio: data.usage?.output_tokens_details?.thinking_tokens,
    },
    parada,
    cortada: parada === "max_tokens",
    bruto: Array.isArray(data.content) ? data.content : undefined,
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

  const pedido = opts.maxTokens ?? MAX_TOKENS;
  const perfil = perfilDoModelo("openai", modelo);
  const plano = planoDaChamada(perfil, tamanhoDe(opts, pedido), pedido);
  // Modelos que raciocinam recusam `max_tokens`: o teto (raciocinio incluso)
  // vai em `max_completion_tokens`.
  const campoTeto = perfil.raciocinio === "nenhum" ? "max_tokens" : "max_completion_tokens";
  const body = {
    model: modelo,
    [campoTeto]: plano.teto,
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
    // Timeout mesmo quando o chamador não passa `signal`: 6 dos 9 chamadores
    // não passavam, e uma chamada de LLM pendurada segurava a function até o
    // gateway derrubar em 150s.
    signal: opts.signal ?? AbortSignal.timeout(90_000),
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
  const parada = typeof data.choices?.[0]?.finish_reason === "string"
    ? data.choices[0].finish_reason
    : null;
  return {
    text: choice.content ?? "",
    toolCalls,
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      raciocinio: data.usage?.completion_tokens_details?.reasoning_tokens,
    },
    parada,
    cortada: parada === "length",
  };
}

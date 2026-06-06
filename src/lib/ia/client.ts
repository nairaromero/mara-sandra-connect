// Wrappers tipados das edge functions do plugin de IA.
// supabase.functions.invoke ja anexa o JWT da sessao automaticamente.

import { supabase } from "@/lib/supabase";

export type IaProviderInfo = { label: string; models: string[] };

// Lista estatica de provedores (espelha PROVIDERS do backend). Usada como
// fallback para o dropdown nao depender de uma chamada de rede.
export const IA_PROVIDERS: Record<string, IaProviderInfo> = {
  anthropic: {
    label: "Anthropic (Claude)",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  },
  openai: {
    label: "OpenAI (GPT)",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  },
};

export type IaConfigStatus = {
  configurado: boolean;
  provider: string | null;
  modelo: string | null;
  ativo: boolean;
  hint: string | null;
  providers_suportados: Record<string, IaProviderInfo>;
};

export type IaChatMessage = { role: "user" | "assistant"; content: string };

// Acao de escrita proposta, aguardando confirmacao do usuario (assinada no servidor).
export type IaPendente = {
  ferramenta: string;
  args: Record<string, unknown>;
  preview: string;
  sig: string;
};

export type IaChatResposta = {
  text: string;
  pendentes?: IaPendente[];
  usage: { input: number; output: number };
  tools_usadas: string[];
};

export type FnError = { message: string; code?: string; status?: number };

type FnResult<T> = { data?: T; error?: FnError };

// Chama uma edge function e normaliza o erro (lendo o corpo JSON quando houver).
async function callFn<T>(name: string, body: Record<string, unknown>): Promise<FnResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message || "Falha na funcao";
    let code: string | undefined;
    let status: number | undefined;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string; code?: string };
        if (j?.error) message = j.error;
        if (j?.code) code = j.code;
        status = ctx.status;
      } catch {
        // corpo nao-json: mantem a mensagem padrao
      }
    }
    return { error: { message, code, status } };
  }
  return { data: data as T };
}

export type IaSalvarInput = {
  provider: string;
  modelo: string;
  api_key: string;
  ativo?: boolean;
};

export type IaTestarInput = {
  provider: string;
  modelo: string;
  api_key?: string;
};

export const iaConfig = {
  status: () => callFn<IaConfigStatus>("ia-config", { action: "status" }),
  salvar: (p: IaSalvarInput) =>
    callFn<{ ok: boolean; ativo: boolean; hint: string }>("ia-config", {
      action: "salvar",
      ...p,
    }),
  testar: (p: IaTestarInput) => callFn<{ ok: boolean }>("ia-config", { action: "testar", ...p }),
  ativar: (ativo: boolean) =>
    callFn<{ ok: boolean; ativo: boolean }>("ia-config", { action: "ativar", ativo }),
};

export type IaContexto = { caso_id?: string };

export const iaAssistant = {
  chat: (messages: IaChatMessage[], contexto?: IaContexto) =>
    callFn<IaChatResposta>("ia-assistant", { messages, contexto }),
  confirmar: (p: IaPendente) =>
    callFn<{ ok: boolean; resultado?: unknown; error?: string }>("ia-assistant", {
      action: "confirm",
      ferramenta: p.ferramenta,
      args: p.args,
      sig: p.sig,
    }),
};

// --- Superficie B (Claude/ChatGPT externos) ---

// URL do servidor MCP (espelha o projeto Supabase usado pelo app).
export const IA_MCP_URL = "https://llugytkdsfsrciavhrfw.supabase.co/functions/v1/ia-mcp";

export type IaToken = {
  id: string;
  nome: string;
  prefixo: string;
  escopo: "leitura" | "completo";
  expira_em: string | null;
  ultimo_uso: string | null;
  revogado_em: string | null;
  criado_em: string;
};

export type IaTokenCriarInput = {
  nome: string;
  escopo?: "leitura" | "completo";
  dias?: number;
};

export const iaTokens = {
  listar: () => callFn<{ tokens: IaToken[] }>("ia-config", { action: "token_listar" }),
  criar: (p: IaTokenCriarInput) =>
    callFn<{ ok: boolean; token: string; prefixo: string }>("ia-config", {
      action: "token_criar",
      ...p,
    }),
  revogar: (id: string) => callFn<{ ok: boolean }>("ia-config", { action: "token_revogar", id }),
};

// Wrappers tipados das edge functions do plugin de IA.
// supabase.functions.invoke ja anexa o JWT da sessao automaticamente.

import { supabase, SUPABASE_URL } from "@/lib/supabase";

export type IaProviderInfo = { label: string; models: string[] };

// A lista de provedores e modelos sugeridos vem SÓ do servidor
// (`providers_suportados` do status, montada a partir dos perfis de modelo em
// supabase/functions/_shared/ia-providers.ts). Não manter cópia aqui: a cópia
// antiga ficou vencida junto com a original (#451).

export type IaConfigStatus = {
  /**
   * A IA está disponível para esta pessoa: o escritório ativo tem chave de IA
   * ligada (#451). É isto que decide se a tela mostra o assistente.
   */
  disponivel: boolean;
  /** Por que não está: "nao_configurado" | "desativado". */
  motivo: string | null;
  provider: string | null;
  modelo: string | null;
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
    let message = error.message || "Falha na função";
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



// A chave de IA é do escritório (Configurações › Integrações, function
// integracoes-escritorio). Aqui só o status, para a tela saber se mostra a IA.
export const iaConfig = {
  status: () => callFn<IaConfigStatus>("ia-config", { action: "status" }),
};

export type IaContexto = { caso_id?: string };

export type IaAnaliseResposta = {
  ok: boolean;
  analise_id?: string;
  versao?: number;
  veredito?: string;
  beneficio_recomendado?: string;
};

export const iaAnalise = {
  gerar: (caso_id: string) => callFn<IaAnaliseResposta>("ia-analise", { caso_id }),
};

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
// Deriva do projeto do ambiente (produção ou staging) — ver src/lib/supabase.ts.
export const IA_MCP_URL = `${SUPABASE_URL}/functions/v1/ia-mcp`;

export type IaToken = {
  id: string;
  nome: string;
  prefixo: string;
  escopo: "leitura" | "completo";
  expira_em: string | null;
  ultimo_uso: string | null;
  revogado_em: string | null;
  criado_em: string;
  /** de quem e o token (o MCP roda como essa pessoa) */
  usuario_id: string;
  /** quem emitiu (#385); igual ao dono quando emitido para si */
  emitido_por: string | null;
  dono?: { nome: string | null; email: string | null } | null;
};

export type IaTokenCriarInput = {
  nome: string;
  escopo?: "leitura" | "completo";
  dias?: number;
  /** para quem emitir (#385); omitido = para mim */
  usuario_id?: string;
};

export type IaTokenPessoa = {
  usuario_id: string;
  nome: string | null;
  email: string | null;
  papel_nome: string | null;
  tipo_acesso: string | null;
};

export const iaTokens = {
  listar: () => callFn<{ tokens: IaToken[] }>("ia-config", { action: "token_listar" }),
  criar: (p: IaTokenCriarInput) =>
    callFn<{ ok: boolean; token: string; prefixo: string }>("ia-config", {
      action: "token_criar",
      ...p,
    }),
  revogar: (id: string) => callFn<{ ok: boolean }>("ia-config", { action: "token_revogar", id }),
  /** pessoas ativas do escritório, para escolher a quem emitir (só quem concede) */
  pessoas: () => callFn<{ pessoas: IaTokenPessoa[] }>("ia-config", { action: "token_membros" }),
};

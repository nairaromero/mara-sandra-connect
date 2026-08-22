import { createClient } from "@supabase/supabase-js";

// Cliente Supabase do escritório Mara Sandra Advocacia.
//
// URL/chave vêm do ambiente de BUILD (Vite inline): produção usa o projeto
// llugytkdsfsrciavhrfw; staging/previews/local podem apontar pro projeto de
// staging via VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (vars de
// build no Cloudflare Workers, .env.local no dev). Sem as vars, o fallback
// é PRODUÇÃO — build antigo continua funcionando igual.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://llugytkdsfsrciavhrfw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_R2hBmLNlLdBN-EEAUSjpPw_P6Lb72N1";

// Sessao morta no servidor (issue #184).
//
// O supabase-js so descobre que a sessao acabou quando ELE tenta renovar o
// token — e ele decide isso pelo relogio local (expires_at vs Date.now()).
// O PostgREST decide pelo `exp` do JWT. Quando os dois discordam (relogio do
// aparelho atrasado, token revogado por fora, refresh "preservado" pelo
// auth-js), o app fica mandando um JWT que o servidor recusa: toda query
// volta 401, os 7 pollings de 60s repetem o 401 pra sempre e ninguem
// redireciona pro login — porque nenhum dos 7 lugares le `error`.
//
// Aqui e o unico ponto por onde TODA chamada passa (rest, functions, storage),
// entao e aqui que se reage:
//   - 401 do PostgREST (/rest/v1) e sempre problema de JWT -> encerra a sessao
//     local. O AuthProvider ve SIGNED_OUT e o layout autenticado manda pro
//     /login.
//   - 401 de edge function (/functions/v1) pode ter outro motivo (token de MCP,
//     webhook sem assinatura) -> confirma com getUser() antes de deslogar.
//   - /auth/v1 fica de fora: o proprio auth-js trata, e reagir aqui viraria loop.
//
// scope "local": o /auth/v1/logout com token vencido tambem falharia, e o que
// importa e limpar o estado deste browser.
let encerrando = false;
async function encerrarSessaoMorta(confirmar: boolean) {
  if (encerrando) return;
  encerrando = true;
  try {
    if (confirmar) {
      const { error } = await supabase.auth.getUser();
      if (!error) return;
    }
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    encerrando = false;
  }
}

const fetchComSessao: typeof fetch = async (input, init) => {
  const resp = await fetch(input, init);
  if (resp.status === 401 && typeof window !== "undefined") {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/rest/v1/") || url.includes("/storage/v1/")) {
      void encerrarSessaoMorta(false);
    } else if (url.includes("/functions/v1/")) {
      void encerrarSessaoMorta(true);
    }
  }
  return resp;
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { fetch: fetchComSessao },
});

export type UsuarioTipo = "interno" | "parceiro";

export interface UsuarioRow {
  id: string;
  nome: string | null;
  email: string | null;
  tipo: UsuarioTipo;
  // Admin do escritório (só Naira e Mara). Libera Equipe interna, Webhooks,
  // Auditoria e integrações em Configurações. Só vale com tipo=interno.
  eh_admin?: boolean | null;
  avatar_url?: string | null;
  onboarded_em?: string | null;
  aceitou_termos_em?: string | null;
  termos_versao?: string | null;
}

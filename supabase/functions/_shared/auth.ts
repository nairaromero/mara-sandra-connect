// Quem pode chamar uma edge function.
//
// Antes deste módulo, 12 funções repetiam o mesmo preâmbulo de JWT (e nenhuma
// das 12 conferia `usuarios.ativo`, então pessoa desligada com token ainda
// válido passava — a mesma falha que o ac2f486 corrigiu na RLS), e 15 não
// checavam nada: como o gateway é deployado com `--no-verify-jwt` e a chave
// publicável está no bundle do site, qualquer pessoa na internet chamava.
//
// Dois tipos de chamador, porque são coisas diferentes:
//   * PESSOA  — tem sessão; `exigirUsuario` valida o JWT, carrega o perfil e
//     confere papel. Devolve também um client com RLS (a sessão da pessoa) —
//     use ele para ler dado, e deixe o service role só para o que precisa
//     atravessar RLS de propósito (auditoria, segredo, fila).
//   * SISTEMA — cron, trigger (pg_net) e n8n; não tem sessão. `exigirSistema`
//     exige assinatura HMAC com carimbo de tempo, ou a chave de service role.
//
// O segredo da assinatura vive no Vault do banco (lado SQL) e em
// MSC_SYSTEM_SECRET (lado function). Nunca literal em migration.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders, jsonResponse } from "./cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SYSTEM_SECRET = Deno.env.get("MSC_SYSTEM_SECRET") ?? "";

/** Janela aceita para o carimbo de tempo da assinatura de sistema. */
const JANELA_MS = 5 * 60_000;

export interface PerfilUsuario {
  id: string;
  nome: string | null;
  email: string | null;
  /** Modo de acesso NO ESCRITÓRIO ATIVO (vem do vínculo, não de `usuarios.tipo`). */
  tipo: "interno" | "parceiro";
  /** Admin do escritório ativo. */
  eh_admin: boolean;
  ativo: boolean;
  /** RBAC multi-tenant: o escritório desta chamada. Nulo só em banco sem as migrations. */
  escritorio_id: string | null;
  /** admin, advogado, assistente, financeiro, parceiro — ou "suporte". */
  papel: string | null;
  permissoes: string[];
}

export interface ChamadorPessoa {
  tipo: "pessoa";
  uid: string;
  perfil: PerfilUsuario;
  /** Client com a sessão da pessoa: RLS vale. Prefira este. */
  rls: SupabaseClient;
  /** Client de service role: ignora RLS. Só onde for deliberado. */
  admin: SupabaseClient;
}

export interface ChamadorSistema {
  tipo: "sistema";
  job: string;
  admin: SupabaseClient;
}

export function clienteAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resposta padrão de pré-voo; toda function continua tratando OPTIONS. */
export function respostaOptions(): Response {
  return new Response("ok", { headers: corsHeaders });
}

function comparaConstante(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let dif = 0;
  for (let i = 0; i < ab.length; i++) dif |= ab[i] ^ bb[i];
  return dif === 0;
}

async function hmacHex(chave: string, dados: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(chave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dados));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Chamador é uma PESSOA com sessão válida.
 *
 * `opts.tipo` exige o modo de acesso; `opts.admin` exige eh_admin. Em todos os
 * casos a pessoa precisa estar ATIVA — é o que faltava nas 12 cópias antigas.
 *
 * Devolve `Response` (401/403) quando recusa: o chamador faz
 * `if (quem instanceof Response) return quem;`.
 */
export async function exigirUsuario(
  req: Request,
  opts: { tipo?: "interno" | "parceiro"; admin?: boolean; permissao?: string } = {},
): Promise<ChamadorPessoa | Response> {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt.split(".").length !== 3) {
    return jsonResponse({ error: "não autenticado" }, 401);
  }

  const admin = clienteAdmin();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user?.id) {
    // Cobre também a chave publicável do site: ela é um JWT, mas não é sessão
    // de ninguém — `getUser` devolve erro e a porta fecha aqui.
    return jsonResponse({ error: "não autenticado" }, 401);
  }
  const uid = data.user.id;

  const { data: perfil, error: erroPerfil } = await admin
    .from("usuarios")
    .select("id, nome, email, tipo, eh_admin, ativo, desligado_em")
    .eq("id", uid)
    .maybeSingle();

  // Falha de leitura NÃO é "não tem perfil": tratar as duas do mesmo jeito
  // transformaria um soluço do banco em "usuário sem cadastro", que é a
  // mensagem errada e esconde o incidente (padrão da checagem de regressão).
  if (erroPerfil) {
    console.error("falha ao ler o perfil de", uid, erroPerfil.message);
    return jsonResponse({ error: "falha ao verificar o usuário" }, 503);
  }
  if (!perfil) return jsonResponse({ error: "usuário sem perfil no sistema" }, 403);

  // O client da pessoa leva o MESMO escritório que o navegador mandou: é por
  // esse header que o banco sabe em que escritório ela está (e confere o
  // vínculo — forjar não abre nada).
  const escritorioHeader = req.headers.get("x-escritorio-id") ?? "";
  const rls = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(escritorioHeader ? { "x-escritorio-id": escritorioHeader } : {}),
      },
    },
  });

  // Papel e status vêm do VÍNCULO no escritório ativo. Zero linhas = sem
  // escritório (sem vínculo, desligada, ou escritório suspenso).
  const { data: ctx, error: erroCtx } = await rls.rpc("meu_contexto");
  let efetivo: PerfilUsuario;
  if (erroCtx) {
    // Banco sem as migrations do RBAC (function publicada antes do banco):
    // vale a regra antiga, pelas colunas de `usuarios`. Qualquer OUTRA falha é
    // incidente, não "sem permissão".
    const semRbac = erroCtx.code === "PGRST202" || /meu_contexto/.test(erroCtx.message ?? "");
    if (!semRbac) {
      console.error("falha ao ler o contexto de", uid, erroCtx.message);
      return jsonResponse({ error: "falha ao verificar o usuário" }, 503);
    }
    if (perfil.ativo === false || perfil.desligado_em) {
      return jsonResponse({ error: "usuário desligado" }, 403);
    }
    efetivo = { ...(perfil as PerfilUsuario), escritorio_id: null, papel: null, permissoes: [] };
  } else {
    const c = (Array.isArray(ctx) ? ctx[0] : ctx) as
      | { escritorio_id: string; papel: string; tipo_acesso: "interno" | "parceiro"; permissoes: string[] }
      | undefined;
    if (!c?.escritorio_id) {
      return jsonResponse({ error: "sem acesso a um escritório ativo" }, 403);
    }
    efetivo = {
      id: perfil.id,
      nome: perfil.nome,
      email: perfil.email,
      ativo: true,
      tipo: c.tipo_acesso,
      eh_admin: c.papel === "admin",
      escritorio_id: c.escritorio_id,
      papel: c.papel,
      permissoes: c.permissoes ?? [],
    };
    if (opts.permissao && !efetivo.permissoes.includes(opts.permissao)) {
      return jsonResponse({ error: "sem permissão para esta ação" }, 403);
    }
  }

  if (opts.tipo && efetivo.tipo !== opts.tipo) {
    return jsonResponse({ error: `apenas usuário ${opts.tipo}` }, 403);
  }
  if (opts.admin && efetivo.eh_admin !== true) {
    return jsonResponse({ error: "apenas administradores" }, 403);
  }

  return { tipo: "pessoa", uid, perfil: efetivo, rls, admin };
}

/**
 * O recurso que veio no corpo é de quem está chamando?
 *
 * As functions leem e gravam com service role, que ignora RLS — então um `id`
 * de outro escritório (ou de um caso que o parceiro não alcança) passaria
 * direto. Aqui a pergunta é feita COM A SESSÃO DA PESSOA: se a RLS dela não
 * mostra a linha, a resposta é 404, igual a um id que não existe.
 */
export async function exigirRecurso(
  quem: ChamadorPessoa | ChamadorSistema,
  tabela: string,
  id: string | null | undefined,
): Promise<Response | null> {
  if (quem.tipo === "sistema" || !id) return null;
  const { data, error } = await quem.rls.from(tabela).select("id").eq("id", id).maybeSingle();
  if (error) {
    console.error(`exigirRecurso ${tabela}`, error.message);
    return jsonResponse({ error: "falha ao verificar o acesso ao registro" }, 503);
  }
  if (!data) return jsonResponse({ error: "registro não encontrado" }, 404);
  return null;
}


/**
 * A credencial apresentada tem poder de service role?
 *
 * Comparar com `SUPABASE_SERVICE_ROLE_KEY` não basta: o Supabase passou a ter
 * dois formatos de chave (o JWT legado e `sb_secret_…`), e o valor injetado na
 * function pode não ser byte a byte o que o n8n ou outra function manda —
 * conferido no staging em 2026-09-20, onde a comparação recusava uma chave
 * legítima. Então, quando a chave se diz service_role, a gente PROVA: só ela
 * lista usuários pela Admin API.
 */
async function ehChaveDeServico(bearer: string): Promise<boolean> {
  if (SERVICE_ROLE && comparaConstante(bearer, SERVICE_ROLE)) return true;

  // Chave nova (`sb_secret_…`) não é JWT; JWT de pessoa tem role diferente.
  let pareceServico = bearer.startsWith("sb_secret_");
  if (!pareceServico && bearer.split(".").length === 3) {
    try {
      const corpo = JSON.parse(
        atob(bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      pareceServico = corpo?.role === "service_role";
    } catch {
      pareceServico = false;
    }
  }
  if (!pareceServico) return false;

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Chamador é o SISTEMA: cron, trigger via pg_net ou n8n.
 *
 * Aceita duas credenciais:
 *   1. `x-msc-assinatura: <ts>.<hmac>` — hmac de `<job>.<ts>` com
 *      MSC_SYSTEM_SECRET. O carimbo vale por 5 minutos, então header capturado
 *      não serve depois, e a assinatura é por job, então a credencial de um
 *      cron não abre a porta de outra função.
 *
 *      O corpo NÃO entra na assinatura de propósito: o pg_net serializa o
 *      jsonb por conta dele, e amarrar a assinatura a um texto que o banco e a
 *      function precisam gerar byte a byte igual é o tipo de acoplamento que
 *      quebra calado meses depois. O que fecha a porta aqui é a credencial.
 *   2. `Authorization: Bearer <chave de service role>` — o que o n8n e a
 *      chamada entre functions já usam hoje. Fica aceito de propósito: é
 *      segredo de servidor, e trocar o n8n é outro PR. A chave é validada pelo
 *      poder dela, não por comparação de string (ver ehChaveDeServico).
 *
 */
export async function exigirSistema(
  req: Request,
  job: string,
): Promise<ChamadorSistema | Response> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer && await ehChaveDeServico(bearer)) {
    return { tipo: "sistema", job, admin: clienteAdmin() };
  }

  const assinatura = req.headers.get("x-msc-assinatura") ?? "";
  const [tsTexto, hmacRecebido] = assinatura.split(".");
  const ts = Number(tsTexto);
  if (!tsTexto || !hmacRecebido || !Number.isFinite(ts)) {
    return jsonResponse({ error: "chamada de sistema sem assinatura" }, 401);
  }
  if (Math.abs(Date.now() - ts * 1000) > JANELA_MS) {
    return jsonResponse({ error: "assinatura fora da janela de tempo" }, 401);
  }
  if (!SYSTEM_SECRET) {
    console.error(`[${job}] MSC_SYSTEM_SECRET ausente no ambiente da function`);
    return jsonResponse({ error: "function sem segredo de sistema configurado" }, 503);
  }
  const esperado = await hmacHex(SYSTEM_SECRET, `${job}.${tsTexto}`);
  if (!comparaConstante(esperado, hmacRecebido)) {
    return jsonResponse({ error: "assinatura inválida" }, 401);
  }
  return { tipo: "sistema", job, admin: clienteAdmin() };
}

/** Pessoa OU sistema — para function que o front e o cron chamam. */
export async function exigirUsuarioOuSistema(
  req: Request,
  job: string,
  opts: { tipo?: "interno" | "parceiro"; admin?: boolean } = {},
): Promise<ChamadorPessoa | ChamadorSistema | Response> {
  const sistema = await exigirSistema(req, job);
  if (!(sistema instanceof Response)) return sistema;

  // Quem apresentou credencial de sistema é julgado como sistema: devolver
  // "não autenticado" aqui esconderia assinatura vencida ou segredo ausente
  // atrás de uma mensagem que não tem nada a ver.
  if (req.headers.get("x-msc-assinatura")) return sistema;

  return await exigirUsuario(req, opts);
}

/**
 * O escritório das rotinas de SISTEMA (v1).
 *
 * As integrações ainda são de um escritório só — uma caixa Gmail do INSS, as
 * OABs do DJEN, um WhatsApp —, e ele é o marcado `padrao_sistema`. Toda rotina
 * que lê com service role filtra por ele: sem isso, o resumo do dia juntaria
 * os casos de todos os escritórios e mandaria para a equipe de um só.
 *
 * Devolve `null` em banco sem as migrations do RBAC (rotina segue como antes);
 * falha de leitura LANÇA — "não sei qual é o escritório" não pode virar "todos".
 */
export async function escritorioDoSistema(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /escritorios/.test(error.message ?? "")) return null;
    throw new Error(`escritório do sistema: ${error.message}`);
  }
  return (data?.id as string | undefined) ?? null;
}

/** Tabelas sem `escritorio_id`: identidade e configuração do sistema. */
const TABELAS_GLOBAIS = new Set([
  "usuarios", "aceites_termos", "usuario_gmail_oauth", "app_config", "webhook_config",
  "escritorios", "permissoes", "papeis", "papel_permissoes", "plataforma_staff",
]);

/**
 * Client de service role PRESO a um escritório.
 *
 * Service role ignora RLS. Numa rotina grande (o processador de e-mails do INSS
 * tem 1.200 linhas e acha cliente por nome e por CPF), lembrar do filtro em
 * cada consulta é o tipo de disciplina que falha em silêncio — e o erro é
 * casar o e-mail de um escritório com o cliente de outro. Aqui todo
 * `select`/`update`/`delete` em tabela de domínio já sai com
 * `escritorio_id = <id>`. `insert`/`upsert` não precisam: o gatilho de herança
 * decide pelo pai, ou cai no escritório do sistema.
 *
 * Sem id (banco sem as migrations do RBAC) devolve o próprio client.
 */
export function escopado(sb: SupabaseClient, escritorioId: string | null): SupabaseClient {
  if (!escritorioId) return sb;
  return new Proxy(sb, {
    get(alvo, prop, receptor) {
      if (prop !== "from") {
        const v = Reflect.get(alvo, prop, receptor);
        return typeof v === "function" ? v.bind(alvo) : v;
      }
      return (tabela: string) => {
        const qb = alvo.from(tabela);
        if (TABELAS_GLOBAIS.has(tabela)) return qb;
        return new Proxy(qb, {
          get(q, metodo, r) {
            const v = Reflect.get(q, metodo, r);
            if (typeof v !== "function") return v;
            // insert/upsert: a linha nasce no escritório do escopo. Sem isto o
            // gatilho aa_herdar_escritorio, sem pai e sem sessão de pessoa,
            // cairia no escritório padrão (linha de outro escritório no lugar errado).
            if (metodo === "insert" || metodo === "upsert") {
              // deno-lint-ignore no-explicit-any
              return (linhas: any, ...resto: any[]) => {
                // deno-lint-ignore no-explicit-any
                const marcar = (l: any) => (l && typeof l === "object" && l.escritorio_id == null ? { ...l, escritorio_id: escritorioId } : l);
                const marcadas = Array.isArray(linhas) ? linhas.map(marcar) : marcar(linhas);
                // deno-lint-ignore no-explicit-any
                return (v as any).apply(q, [marcadas, ...resto]);
              };
            }
            if (metodo !== "select" && metodo !== "update" && metodo !== "delete") return v.bind(q);
            // deno-lint-ignore no-explicit-any
            return (...args: any[]) => (v as any).apply(q, args).eq("escritorio_id", escritorioId);
          },
        });
      };
    },
  }) as SupabaseClient;
}

/** A sessão da pessoa não abriu: a chamada tem que falhar, não degradar. */
export class SessaoIndisponivel extends Error {}

export interface SessaoDePessoa {
  /** Client com a sessão da pessoa: RLS e Storage valem como no app. */
  client: SupabaseClient;
  /** Revoga a sessão (best-effort). Chamar ao fim do request. */
  encerrar: () => Promise<void>;
}

/**
 * Abre uma sessão de verdade em nome de `uid`, para quem autentica a pessoa por
 * outro meio que não o login — hoje, o token pessoal do ia-mcp (#374).
 *
 * Antes o ia-mcp cunhava um JWT HS256 com SUPABASE_JWT_SECRET. O Supabase não
 * injeta mais esse segredo (os projetos assinam com ES256), e o código caía
 * calado para service role. Aqui: a Admin API gera um link mágico (NÃO envia
 * e-mail) e o token dele é trocado na hora por uma sessão — o access token sai
 * assinado pela chave atual do projeto, com o `sub` da pessoa, e a RLS vale.
 *
 * Efeitos, conferidos no local em 2026-09-21: cria uma linha em auth.sessions
 * (removida por `encerrar`), atualiza `last_sign_in_at` (o app não usa) e não
 * dispara e-mail nem o gatilho de senha. O access token continua válido até
 * expirar (1h), mas nunca sai da function.
 *
 * Qualquer falha vira `SessaoIndisponivel`: sem sessão, nada roda.
 */
export async function abrirSessaoDe(uid: string, escritorioId?: string | null): Promise<SessaoDePessoa> {
  const comTempo: typeof fetch = (entrada, init) => fetchT(entrada, { ...init, timeoutMs: 15_000 });
  const opcoes = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: comTempo } };
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, opcoes);

  const { data: u, error: erroUser } = await admin.auth.admin.getUserById(uid);
  const email = u?.user?.email;
  if (erroUser || !email) {
    throw new SessaoIndisponivel(`usuário ${uid} sem e-mail no Auth: ${erroUser?.message ?? "vazio"}`);
  }

  // O e-mail vem do próprio usuário do Auth, nunca de fora: com um e-mail que
  // não existe, o generateLink de magiclink CRIARIA um usuário (conferido no
  // código do GoTrue, admin/generate_link — que também não envia e-mail nenhum).
  const { data: link, error: erroLink } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hash = link?.properties?.hashed_token;
  if (erroLink || !hash) {
    throw new SessaoIndisponivel(`link de sessão não gerado: ${erroLink?.message ?? "sem token"}`);
  }

  const anon = createClient(SUPABASE_URL, ANON, opcoes);
  const { data: v, error: erroVerif } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  const jwt = v?.session?.access_token;
  if (erroVerif || !jwt || v?.user?.id !== uid) {
    throw new SessaoIndisponivel(`sessão não aberta: ${erroVerif?.message ?? "usuário diferente"}`);
  }

  // Prazo maior que o do Auth: ferramenta como ler_documentos_caso baixa PDFs.
  const dadosComTempo: typeof fetch = (entrada, init) => fetchT(entrada, { ...init, timeoutMs: 30_000 });
  // `escritorioId`: o escritório em que a sessão trabalha (RBAC multi-tenant) —
  // vai no mesmo header que o navegador manda, e o banco confere o vínculo.
  const client = createClient(SUPABASE_URL, ANON, {
    ...opcoes,
    global: {
      fetch: dadosComTempo,
      headers: { Authorization: `Bearer ${jwt}`, ...(escritorioId ? { "x-escritorio-id": escritorioId } : {}) },
    },
  });
  return {
    client,
    encerrar: async () => {
      const { error } = await admin.auth.admin.signOut(jwt, "local");
      if (error) console.error("não consegui encerrar a sessão de", uid, error.message);
    },
  };
}

/**
 * `fetch` com timeout. Sem isso, uma API externa pendurada segura a function
 * até o gateway derrubar em 150s — e a fila do cron atrás dela.
 */
export function fetchT(
  entrada: string | URL | Request,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, signal, ...resto } = init;
  const doTempo = AbortSignal.timeout(timeoutMs);
  return fetch(entrada, {
    ...resto,
    signal: signal ? AbortSignal.any([signal, doTempo]) : doTempo,
  });
}

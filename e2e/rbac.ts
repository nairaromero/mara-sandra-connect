// Túnel único das specs de RBAC: sessão de um papel, id de uma conta, os
// escritórios do seed, e a leitura da trilha.
//
// Por que existe: 23 specs faziam `createClient + signInWithPassword` à mão e
// 21 pontos montavam o header `x-escritorio-id` copiado. Cada cópia é uma
// chance de esquecer o header (e aí a spec testa "sem escritório ativo" sem
// saber), de não checar o erro do login (e aí uma conta quebrada vira
// "0 linhas", que é o que a RLS devolve quando recusa — falso verde), ou de
// escrever o e-mail da conta errado.
//
// Aqui cada uma dessas coisas tem UM lugar:
//
//   · `clienteComo` / `sessaoComo` — login com erro CHECADO e header sempre
//     que há escritório. Login que falha estoura na hora, com o e-mail no
//     texto, em vez de virar teste verde por engano;
//   · `contaDoCanario` — o e-mail de cada papel do seed, para ninguém digitar
//     `canario+advogada@` e passar meia hora atrás do erro;
//   · `escritorioCanario` / `escritorioPadrao` — os dois ids, com a mensagem
//     que manda rodar `bun run local:rbac` quando faltam;
//   · `ultimaLinhaDaTrilha` — a leitura da `auditoria` que as specs de trilha
//     precisam, com erro de query distinguido de "não tem linha".
//
// Usar isto em spec nova. As antigas vão migrando quando alguém passar por elas.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";
import { adminClient } from "./supabase-admin";

export const DOMINIO = "marasandraconnect.com";

/** Os papéis com conta no seed do Canário (scripts/seed-local-rbac.mjs). */
export type PapelCanario = "admin" | "advogado" | "assistente" | "financeiro" | "parceiro";

/** O e-mail da conta de um papel no Canário. */
export const contaDoCanario = (papel: PapelCanario) => `canario+${papel}@${DOMINIO}`;

/** A conta sintética do escritório padrão (as do `e2e+…`). */
export const contaPadrao = (quem: "admin" | "interno" | "parceiro") => `e2e+${quem}@${DOMINIO}`;

/** A conta de staff do QG (as do `qg+…`, criadas pelo mesmo seed). */
export const contaDoQg = (quem: "dono" | "dono2" | "suporte" | "leitura") => `qg+${quem}@${DOMINIO}`;

const admin = adminClient();

async function escritorioPor(campo: "slug" | "padrao", valor: string | boolean): Promise<string> {
  const q = admin.from("escritorios").select("id");
  const { data, error } = campo === "slug"
    ? await q.eq("slug", valor as string).maybeSingle()
    : await q.eq("padrao_sistema", valor as boolean).maybeSingle();
  if (error) throw new Error(`buscar escritório (${campo}=${valor}): ${error.message}`);
  if (!data) throw new Error(`escritório ${campo}=${valor} ausente — rode \`bun run local:rbac\``);
  return data.id as string;
}

/** O escritório de teste criado pelo seed (o "escritório 2" das specs). */
export const escritorioCanario = () => escritorioPor("slug", "canario");
/** O escritório padrão do sistema (Mara Vian, os dados de sempre). */
export const escritorioPadrao = () => escritorioPor("padrao", true);

/**
 * Client com a sessão de uma pessoa e o escritório ativo no header.
 *
 * Erro de login ESTOURA: sem isto, uma conta que não loga devolve um client
 * anônimo, todas as leituras voltam vazias e a spec fica verde afirmando que a
 * RLS escondeu o que, na verdade, ninguém pediu.
 */
export async function clienteComo(email: string, escritorio?: string | null): Promise<SupabaseClient> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorio ? { headers: { "x-escritorio-id": escritorio } } : {},
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return sb;
}

export interface SessaoDeTeste {
  sb: SupabaseClient;
  session: Session;
  jwt: string;
  id: string;
}

/** Igual ao `clienteComo`, quando a spec também precisa do JWT ou do id. */
export async function sessaoComo(email: string, escritorio?: string | null): Promise<SessaoDeTeste> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorio ? { headers: { "x-escritorio-id": escritorio } } : {},
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message ?? "sem sessão"}`);
  return { sb, session: data.session, jwt: data.session.access_token, id: data.user!.id };
}

/** O id da conta de um e-mail. Estoura se a conta não existe. */
export async function idDe(email: string): Promise<string> {
  const { data, error } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
  if (error) throw new Error(`buscar ${email}: ${error.message}`);
  if (!data) throw new Error(`conta ${email} ausente — rode \`bun run local:rbac\``);
  return data.id as string;
}

/** Atalho: o id da conta de um papel do Canário. */
export const idDoCanario = (papel: PapelCanario) => idDe(contaDoCanario(papel));

export interface LinhaDaTrilha {
  acao: string;
  recurso: string | null;
  recurso_id: string | null;
  detalhes: Record<string, unknown>;
}

/**
 * A última linha da trilha de um escritório para uma ação — ou null se não há.
 *
 * Erro de query estoura em vez de virar null: "não consegui ler" não pode
 * passar por "não aconteceu", que é o engano que esta suíte já cometeu.
 */
export async function ultimaLinhaDaTrilha(
  escritorio: string, acao: string,
): Promise<LinhaDaTrilha | null> {
  const { data, error } = await admin
    .from("auditoria")
    .select("acao, recurso, recurso_id, detalhes, created_at")
    .eq("escritorio_id", escritorio)
    .eq("acao", acao)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ler a trilha (${acao}): ${error.message}`);
  return (data as LinhaDaTrilha | null) ?? null;
}

export interface RespostaFuncao {
  status: number;
  json: Record<string, unknown> | null;
  texto: string;
}

/**
 * Chama uma edge function com a sessão de uma pessoa.
 *
 * O trio `apikey` + `Authorization` + `x-escritorio-id` estava copiado em cada
 * spec que fala com function. Esquecer o terceiro faz a function responder
 * "sem escritório" e o teste vira outra coisa sem avisar; esquecer o `apikey`
 * dá 401 antes de chegar ao código. Aqui os três vêm juntos, sempre.
 */
export async function chamarFuncao(
  nome: string, jwt: string, escritorio: string | null, corpo: unknown = {},
): Promise<RespostaFuncao> {
  const r = await fetch(`${ENV.supabaseUrl}/functions/v1/${nome}`, {
    method: "POST",
    headers: {
      apikey: ENV.anonKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(escritorio ? { "x-escritorio-id": escritorio } : {}),
    },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(texto) as Record<string, unknown>; } catch { json = null; }
  return { status: r.status, json, texto };
}

/** Atalho: uma sessão que já chama function, como as specs usam. */
export async function chamadorComo(
  email: string, escritorio?: string | null,
): Promise<(nome: string, corpo?: unknown) => Promise<RespostaFuncao>> {
  const { jwt } = await sessaoComo(email, escritorio);
  return (nome, corpo = {}) => chamarFuncao(nome, jwt, escritorio ?? null, corpo);
}

/**
 * Tenta uma escrita e responde só duas coisas: passou, ou a RLS recusou
 * (42501). Qualquer outro erro estoura.
 *
 * É o que separa "não pode" de "payload errado". Sem isso, uma coluna
 * renomeada faz toda tentativa falhar e o teste lê isso como "recusado" —
 * verde para quem devia ser barrado.
 */
export async function escreveu(
  sb: SupabaseClient, tabela: string, linha: Record<string, unknown>, rotulo: string,
): Promise<boolean> {
  const r = await sb.from(tabela).insert(linha).select();
  if (r.error && r.error.code !== "42501") {
    throw new Error(`${rotulo}: erro que não é permissão (${r.error.code}) — ${r.error.message}`);
  }
  return (r.data ?? []).length > 0;
}

// E2E: chave de IA POR ESCRITÓRIO (#451 parte 2, migration_ia_chave_escritorio).
//
// Antes a chave era de uma pessoa e o escritório "tinha IA" quando alguém a
// marcava como compartilhada. Agora é do escritório: cadastrada por quem
// gerencia integrações (integracoes-escritorio, tipo "ia", cifrada e
// auditada), e é ela que decide se a equipe vê a IA (ia-config status).
// O uso fica em ia_uso, que só quem gerencia integrações lê, e só no
// próprio escritório.
//
// Só no banco local com o seed do RBAC (Canário). Nenhuma chamada sai para
// um provedor de IA: o teste nunca usa "testar" com chave de verdade.

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import { limpezaLocal, ultimaLinhaDaTrilha } from "../rbac";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const FN = `${ENV.supabaseUrl}/functions/v1`;

async function sessao(email: string, escritorio: string) {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-escritorio-id": escritorio } },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, jwt: data.session.access_token };
}
async function fn(nome: string, jwt: string, escritorio: string, body: Record<string, unknown>) {
  const r = await fetch(`${FN}/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: ENV.anonKey, "content-type": "application/json", "x-escritorio-id": escritorio },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  return { status: r.status, json, texto };
}

let ESC1: string;
let ESC2: string;
const CHAVE_TESTE = "sk-teste-local-canario-0000";

async function limpar() {
  const { error } = await admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).eq("tipo", "ia");
  if (error) throw new Error(`limpeza de escritorio_integracoes: ${error.message}`);
  const { error: e2 } = await admin.from("ia_uso").delete().eq("escritorio_id", ESC2).like("funcao", "e2e:%");
  if (e2) throw new Error(`limpeza de ia_uso: ${e2.message}`);
}

test.describe.serial("IA: chave do escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: canario } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!canario, "escritório canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    const { data: e1, error } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).single();
    if (error) throw new Error(error.message);
    ESC1 = e1!.id;
    await limpar();
  });
  test.afterAll(limpezaLocal(async () => {
    if (ESC2) await limpar();
  }));

  test("sem chave do escritório, a equipe não tem IA — e quem não gerencia integrações não cadastra", async () => {
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const st = await fn("ia-config", adv.jwt, ESC2, { action: "status" });
    expect(st.status, st.texto).toBe(200);
    expect(st.json.disponivel).toBe(false);
    expect(st.json.motivo).toBe("nao_configurado");

    const tentou = await fn("integracoes-escritorio", adv.jwt, ESC2, {
      action: "salvar", tipo: "ia", config: { provider: "anthropic", modelo: "claude-sonnet-5-5" }, segredo: CHAVE_TESTE,
    });
    expect(tentou.status, "advogado não gerencia integrações").toBe(403);
  });

  test("admin cadastra: modelo aposentado é recusado; a chave é cifrada, nunca volta e a troca vai para a trilha", async () => {
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const aposentado = await fn("integracoes-escritorio", adm.jwt, ESC2, {
      action: "salvar", tipo: "ia", config: { provider: "anthropic", modelo: "claude-opus-4-1" }, segredo: CHAVE_TESTE,
    });
    expect(aposentado.status).toBe(400);
    expect(String(aposentado.json.error)).toContain("aposentado");

    const salvo = await fn("integracoes-escritorio", adm.jwt, ESC2, {
      action: "salvar", tipo: "ia", config: { provider: "anthropic", modelo: "claude-sonnet-5-5" }, segredo: CHAVE_TESTE, ativo: true,
    });
    expect(salvo.status, salvo.texto).toBe(200);
    expect(salvo.texto).not.toContain(CHAVE_TESTE);
    const st = await fn("integracoes-escritorio", adm.jwt, ESC2, { action: "status", tipo: "ia" });
    expect(st.texto).not.toContain(CHAVE_TESTE);
    expect((st.json.config as Record<string, unknown>).modelo).toBe("claude-sonnet-5-5");
    expect((st.json.providers as Record<string, { models: string[] }>).anthropic.models).toContain("claude-sonnet-5-5");

    const { data: linha, error } = await admin
      .from("escritorio_integracoes").select("segredo_cipher").eq("escritorio_id", ESC2).eq("tipo", "ia").single();
    if (error) throw new Error(error.message);
    expect(linha.segredo_cipher).toBeTruthy();
    expect(linha.segredo_cipher).not.toContain(CHAVE_TESTE);

    const trilha = await ultimaLinhaDaTrilha(ESC2, "integracao.salvar");
    expect(trilha?.recurso_id).toBe("ia");
    expect(trilha?.detalhes.depois).toEqual({ provider: "anthropic", modelo: "claude-sonnet-5-5", ativo: true });
  });

  test("com a chave ligada a equipe tem IA; desligada, não — e a antiga chave pessoal responde 410", async () => {
    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const ligada = await fn("ia-config", adv.jwt, ESC2, { action: "status" });
    expect(ligada.json.disponivel).toBe(true);
    expect(ligada.json.modelo).toBe("claude-sonnet-5-5");

    const legado = await fn("ia-config", adv.jwt, ESC2, { action: "salvar", provider: "anthropic", modelo: "claude-sonnet-5-5", api_key: CHAVE_TESTE });
    expect(legado.status).toBe(410);
    expect(legado.json.code).toBe("chave_do_escritorio");

    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const desl = await fn("integracoes-escritorio", adm.jwt, ESC2, {
      action: "salvar", tipo: "ia", config: { provider: "anthropic", modelo: "claude-sonnet-5-5" }, ativo: false,
    });
    expect(desl.status, desl.texto).toBe(200);
    const desligada = await fn("ia-config", adv.jwt, ESC2, { action: "status" });
    expect(desligada.json.disponivel).toBe(false);
    expect(desligada.json.motivo).toBe("desativado");
  });

  test("ia_uso: só quem gerencia integrações lê, e só no próprio escritório", async () => {
    const { error } = await admin.from("ia_uso").insert({
      escritorio_id: ESC2, funcao: "e2e:ia-chave-escritorio", provider: "anthropic", modelo: "claude-sonnet-5-5",
      origem_chave: "escritorio", tokens_entrada: 10, tokens_saida: 5, duracao_ms: 1,
    });
    if (error) throw new Error(error.message);

    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const { data: doAdmin, error: eA } = await adm.sb.from("ia_uso").select("funcao").like("funcao", "e2e:%");
    if (eA) throw new Error(eA.message);
    expect(doAdmin?.length).toBe(1);

    const adv = await sessao(`canario+advogado@${DOM}`, ESC2);
    const { data: doAdv, error: eV } = await adv.sb.from("ia_uso").select("funcao").like("funcao", "e2e:%");
    if (eV) throw new Error(eV.message);
    expect(doAdv, "advogado não gerencia integrações").toEqual([]);

    const outro = await sessao(`e2e+admin@${DOM}`, ESC1);
    const { data: doOutro, error: eO } = await outro.sb.from("ia_uso").select("funcao").like("funcao", "e2e:%");
    if (eO) throw new Error(eO.message);
    expect(doOutro, "admin de outro escritório não vê o uso do Canário").toEqual([]);

    const { error: eIns } = await adm.sb.from("ia_uso").insert({
      escritorio_id: ESC2, funcao: "e2e:tentativa", provider: "x", modelo: "y", origem_chave: "escritorio", duracao_ms: 1,
    });
    expect(eIns, "ninguém escreve em ia_uso pela API: só o adaptador (service role)").not.toBeNull();
  });
});

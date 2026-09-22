// E2E: integrações POR ESCRITÓRIO (migration_rbac_09).
//
// WhatsApp: o admin do Canário salva a instância do Evolution pela function
// integracoes-escritorio — a chave da API vai cifrada e NUNCA volta (nem por
// PostgREST: as colunas de segredo são negadas ao authenticated); advogado e
// admin de outro escritório não veem nem gravam; o webhook de entrada resolve
// o escritório pela instância e exige o token DELE, e a mensagem/fila nascem
// no Canário. Gmail do INSS: status por escritório, só para quem gerencia
// integrações. Só roda no banco local com o seed. Limpa o que criou.

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const FN = `${ENV.supabaseUrl}/functions/v1`;
const INSTANCE = "canario-e2e";
const CHAVE = "chave-secreta-e2e-nao-pode-vazar";
const TELEFONE = "5511999990000";
const MSG_ID = "E2E-WA-MSG-1";

async function como(email: string, escritorio: string): Promise<{ sb: SupabaseClient; jwt: string }> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-escritorio-id": escritorio } },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, jwt: data.session.access_token };
}

async function fn(jwt: string, escritorio: string, body: Record<string, unknown>) {
  const r = await fetch(`${FN}/integracoes-escritorio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: ENV.anonKey, "content-type": "application/json", "x-escritorio-id": escritorio },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* corpo não-JSON */ }
  return { status: r.status, json, texto };
}

let ESC1: string;
let ESC2: string;

async function limpar() {
  await admin.from("escritorio_integracoes").delete().eq("tipo", "whatsapp").eq("escritorio_id", ESC2);
  await admin.from("whatsapp_mensagens").delete().eq("evolution_message_id", MSG_ID);
  await admin.from("whatsapp_outbox").delete().eq("telefone", TELEFONE);
}

test.describe.serial("integrações por escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    const { data: escs, error } = await admin.from("escritorios").select("id, slug, padrao_sistema");
    test.skip(!!error, "migrations do RBAC não aplicadas");
    ESC1 = escs!.find((e) => e.padrao_sistema)!.id;
    const canario = escs!.find((e) => e.slug === "canario");
    test.skip(!canario, "canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    await limpar();
  });
  test.afterAll(async () => {
    if (ESC2) await limpar();
  });

  test("WhatsApp: admin salva (segredo cifrado, nunca volta); outros não veem", async () => {
    const cAdmin = await como(`canario+admin@${DOM}`, ESC2);

    const salvo = await fn(cAdmin.jwt, ESC2, {
      action: "salvar", tipo: "whatsapp",
      config: { base_url: "https://evo.invalid/", instance: INSTANCE, numero: "55 11 99999-0000", api_key: "nao-deve-entrar-na-config" },
      segredo: CHAVE,
    });
    // sem IA_MASTER_KEY em supabase/functions/.env a function não cifra nada:
    // pula (não é falha do produto) — o guia diz como criar a chave local
    test.skip(salvo.status === 500 && /IA_MASTER_KEY/.test(String(salvo.json.error ?? "")), "IA_MASTER_KEY ausente nas functions locais");
    expect(salvo.status, salvo.texto).toBe(200);
    const cfg = salvo.json.config as Record<string, unknown>;
    expect(cfg.instance).toBe(INSTANCE);
    expect(cfg.api_key, "segredo não entra na config").toBeUndefined();
    expect(salvo.json.segredo_definido_em).toBeTruthy();
    expect(JSON.stringify(salvo.json)).not.toContain(CHAVE);

    // no banco: cifrado
    const { data: linha } = await admin
      .from("escritorio_integracoes").select("segredo_cipher, segredo_iv, config, ativo").eq("escritorio_id", ESC2).eq("tipo", "whatsapp").single();
    expect(linha?.segredo_cipher).toBeTruthy();
    expect(linha?.segredo_cipher).not.toBe(CHAVE);
    expect(linha?.ativo).toBe(true);

    // PostgREST como admin: config sim, segredo NÃO (coluna negada)
    const vis = await cAdmin.sb.from("escritorio_integracoes").select("escritorio_id, tipo, ativo, config, segredo_definido_em");
    expect(vis.error).toBeNull();
    expect(vis.data).toHaveLength(1);
    const seg = await cAdmin.sb.from("escritorio_integracoes").select("segredo_cipher");
    expect(seg.error, "coluna de segredo negada ao authenticated").toBeTruthy();

    // token de entrada e status
    const tok = await fn(cAdmin.jwt, ESC2, { action: "gerar_token", tipo: "whatsapp" });
    expect(tok.status).toBe(200);
    const inbound = (tok.json.config as Record<string, string>).inbound_token;
    expect(inbound).toMatch(/^[0-9a-f]{48}$/);
    const st = await fn(cAdmin.jwt, ESC2, { action: "status", tipo: "whatsapp" });
    expect((st.json.config as Record<string, string>).inbound_token).toBe(inbound);

    // testar: Evolution inalcançável -> ok:false com erro, sem quebrar
    const teste = await fn(cAdmin.jwt, ESC2, { action: "testar", tipo: "whatsapp" });
    expect(teste.status).toBe(200);
    expect(teste.json.ok).toBe(false);

    // advogado do Canário: não vê, não grava
    const adv = await como(`canario+advogado@${DOM}`, ESC2);
    expect((await adv.sb.from("escritorio_integracoes").select("escritorio_id, tipo, config")).data ?? []).toHaveLength(0);
    expect((await fn(adv.jwt, ESC2, { action: "salvar", tipo: "whatsapp", config: { instance: "x" } })).status).toBe(403);

    // admin do escritório 1: nada do Canário
    const a1 = await como(`e2e+admin@${DOM}`, ESC1);
    expect((await a1.sb.from("escritorio_integracoes").select("escritorio_id, tipo, config")).data ?? []).toHaveLength(0);
    // ...e forjar o header do Canário também não abre
    const forjado = await como(`e2e+admin@${DOM}`, ESC2);
    expect((await forjado.sb.from("escritorio_integracoes").select("escritorio_id, tipo, config")).data ?? []).toHaveLength(0);
  });

  test("webhook de entrada: escritório pela instância, token dele, linhas no Canário", async () => {
    const { data: linha } = await admin
      .from("escritorio_integracoes").select("config").eq("escritorio_id", ESC2).eq("tipo", "whatsapp").single();
    const token = (linha?.config as { inbound_token?: string })?.inbound_token;
    expect(token).toBeTruthy();

    const corpo = {
      event: "messages.upsert", instance: INSTANCE,
      data: { key: { remoteJid: `${TELEFONE}@s.whatsapp.net`, fromMe: false, id: MSG_ID }, message: { conversation: "oi" }, messageType: "conversation" },
    };
    const post = (t: string, b: unknown) =>
      fetch(`${FN}/whatsapp-inbound?token=${t}`, { method: "POST", headers: { "content-type": "application/json", apikey: ENV.anonKey }, body: JSON.stringify(b) });

    expect((await post("token-errado", corpo)).status).toBe(401);
    expect((await post(token!, { ...corpo, instance: "instancia-inexistente" })).status).toBe(401);

    const r = await post(token!, corpo);
    expect(r.status).toBe(200);

    const { data: msg } = await admin.from("whatsapp_mensagens").select("escritorio_id, direcao, telefone").eq("evolution_message_id", MSG_ID).maybeSingle();
    expect(msg?.escritorio_id, "mensagem nasce no escritório da instância").toBe(ESC2);
    // número desconhecido: a resposta "não reconhecemos" entra na fila DO Canário
    const { data: fila } = await admin.from("whatsapp_outbox").select("escritorio_id, tipo").eq("telefone", TELEFONE);
    expect(fila?.length ?? 0).toBeGreaterThan(0);
    for (const f of fila ?? []) expect(f.escritorio_id).toBe(ESC2);

    // repetir a mesma mensagem: dedupe (sem segunda linha)
    expect((await post(token!, corpo)).status).toBe(200);
    const { count } = await admin.from("whatsapp_mensagens").select("id", { count: "exact", head: true }).eq("evolution_message_id", MSG_ID);
    expect(count).toBe(1);
  });

  test("Gmail do INSS: status por escritório, só para quem gerencia integrações", async () => {
    const cAdmin = await como(`canario+admin@${DOM}`, ESC2);
    const st = await cAdmin.sb.rpc("gmail_inss_status");
    expect(st.error).toBeNull();
    expect(st.data, "Canário sem caixa conectada").toEqual([]);
    const adv = await como(`canario+advogado@${DOM}`, ESC2);
    expect((await adv.sb.rpc("gmail_inss_status")).error?.code).toBe("42501");
  });
});

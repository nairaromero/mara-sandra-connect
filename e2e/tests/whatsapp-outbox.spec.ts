// E2E: saída de WhatsApp por escritório, sem n8n (migration_rbac_14 +
// function whatsapp-outbox-enviar, chamada pelo pg_cron com a assinatura
// `cron:whatsapp-outbox`).
//
// A fila `whatsapp_outbox` é drenada pela function: para cada linha ela lê a
// instância e a chave (cifrada) do ESCRITÓRIO da linha e faz o POST no
// Evolution (aqui, simulado em :8787). Escritório sem integração: a linha
// falha com erro claro e entra no backoff — nunca sai pela instância de outro.
// Só no banco local com o seed e o mock; usa o MSC_SYSTEM_SECRET do .env local.

import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";

const admin = adminClient();
const DOM = "marasandraconnect.com";
const FN = `${ENV.supabaseUrl}/functions/v1`;
const MOCK = "http://localhost:8787";
const MOCK_DOCKER = "http://host.docker.internal:8787";
const TEL = "5511999990000";
const MARCA = "[E2E outbox]";

function segredoLocal(): string | null {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), "supabase/functions/.env"), "utf8");
    return (txt.match(/^MSC_SYSTEM_SECRET=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, "") ?? null;
  } catch { return null; }
}
async function sessao(email: string, escritorio: string) {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "x-escritorio-id": escritorio } } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { sb, jwt: data.session.access_token };
}
async function comoSistema(job: string, body: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const hmac = createHmac("sha256", segredoLocal()!).update(`${job}.${ts}`).digest("hex");
  const r = await fetch(`${FN}/whatsapp-outbox-enviar`, { method: "POST", headers: { "content-type": "application/json", "x-msc-assinatura": `${ts}.${hmac}` }, body: JSON.stringify(body) });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  return { status: r.status, json, texto };
}

let ESC1: string;
let ESC2: string;
async function limpar() {
  await admin.from("whatsapp_outbox").delete().like("texto", `${MARCA}%`);
  await admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).eq("tipo", "whatsapp");
  await fetch(`${MOCK}/_reset`, { method: "POST" }).catch(() => null);
}

test.describe.serial("saída de WhatsApp por escritório (sem n8n)", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local || !segredoLocal(), "só no local, com MSC_SYSTEM_SECRET no supabase/functions/.env");
    const { data: canario } = await admin.from("escritorios").select("id").eq("slug", "canario").maybeSingle();
    test.skip(!canario, "escritório canário ausente — rode `bun run local:rbac`");
    ESC2 = canario!.id;
    const { data: e1 } = await admin.from("escritorios").select("id").eq("padrao_sistema", true).single();
    ESC1 = e1!.id;
    const vivo = await fetch(`${MOCK}/_health`).then((r) => r.ok).catch(() => false);
    test.skip(!vivo, "mock dos provedores (:8787) fora do ar");
    await limpar();
  });
  test.afterAll(async () => { if (ESC2) await limpar(); });

  test("a fila sai pela instância DO escritório; escritório sem integração falha com erro claro; assinatura errada → 401", async () => {
    // Canário configura o Evolution (simulado) pela function de integrações
    const adm = await sessao(`canario+admin@${DOM}`, ESC2);
    const salvar = await fetch(`${FN}/integracoes-escritorio`, { method: "POST", headers: { Authorization: `Bearer ${adm.jwt}`, apikey: ENV.anonKey, "content-type": "application/json", "x-escritorio-id": ESC2 }, body: JSON.stringify({ action: "salvar", tipo: "whatsapp", config: { base_url: `${MOCK_DOCKER}/evolution`, instance: "canario" }, segredo: "chave-evolution-canario" }) });
    expect(salvar.status).toBe(200);
    // duas mensagens na fila: uma do Canário, uma do escritório 1 (sem integração no local)
    expect((await adm.sb.rpc("whatsapp_enqueue_text", { p_telefone: TEL, p_tipo: "aviso", p_texto: `${MARCA} olá, Gilda — do Canário` })).error).toBeNull();
    const e2e = await sessao(`e2e+admin@${DOM}`, ESC1);
    expect((await e2e.sb.rpc("whatsapp_enqueue_text", { p_telefone: TEL, p_tipo: "aviso", p_texto: `${MARCA} do escritório 1` })).error).toBeNull();
    const { data: antes } = await admin.from("whatsapp_outbox").select("id, escritorio_id, status").like("texto", `${MARCA}%`);
    expect(antes?.map((l) => l.escritorio_id).sort()).toEqual([ESC1, ESC2].sort());

    // assinatura errada → 401 e nada sai
    const ruim = await (async () => { const ts = Math.floor(Date.now() / 1000).toString(); const r = await fetch(`${FN}/whatsapp-outbox-enviar`, { method: "POST", headers: { "content-type": "application/json", "x-msc-assinatura": `${ts}.deadbeef` }, body: "{}" }); return r.status; })();
    expect(ruim).toBe(401);

    // o "cron": drena a fila
    const r = await comoSistema("cron:whatsapp-outbox", { limite: 20 });
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    expect(r.json.enviadas).toBe(1);
    expect(r.json.falhas).toBe(1);
    const porEsc = r.json.por_escritorio as Record<string, { enviadas: number; falhas: number; origem?: string; erro?: string }>;
    expect(porEsc[ESC2]).toMatchObject({ enviadas: 1, falhas: 0, origem: "escritorio" });
    expect(porEsc[ESC1].falhas).toBe(1);
    expect(porEsc[ESC1].erro).toMatch(/não configurada/);

    // no banco: Canário enviado (201 do Evolution), escritório 1 em backoff com o erro
    const { data: depois } = await admin.from("whatsapp_outbox").select("escritorio_id, status, http_status, erro, tentativas").like("texto", `${MARCA}%`);
    const canario = depois!.find((l) => l.escritorio_id === ESC2)!;
    const esc1 = depois!.find((l) => l.escritorio_id === ESC1)!;
    expect(canario).toMatchObject({ status: "enviado", http_status: 201 });
    expect(esc1.status).toBe("pendente");
    expect(esc1.tentativas).toBe(1);
    expect(esc1.erro).toMatch(/não configurada/);

    // o Evolution simulado recebeu SÓ a do Canário, na instância dele, para o número certo
    const enviadas = (await (await fetch(`${MOCK}/evolution/_enviadas`)).json()) as Array<{ instance: string; number: string; text: string }>;
    const minhas = enviadas.filter((m) => m.text.startsWith(MARCA));
    expect(minhas).toHaveLength(1);
    expect(minhas[0]).toMatchObject({ instance: "canario", number: TEL });
    expect(minhas[0].text).toContain("do Canário");
  });
});

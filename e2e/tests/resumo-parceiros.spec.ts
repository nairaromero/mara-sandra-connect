// E2E: resumo periódico para parceiros (function `resumo-parceiros`).
//
// O que esta spec prova, no escritório Canário:
//   - parceiro não chama a function (só quem tem parceiros:gerenciar);
//   - a escolha do parceiro vale por cima do padrão do escritório;
//   - a prévia traz o andamento VISÍVEL ao parceiro, o requerimento protocolado e
//     o processo ajuizado da semana — e não traz o andamento interno;
//   - a rodada do cron (assinatura de sistema) manda UM e-mail por parceiro e dia:
//     rodar de novo não repete;
//   - escritório não mexe em parceiro de outro escritório.
//
// Só no banco local (`bun run local:copiar && bun run local:rbac`).
import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import {
  chamadorComo,
  chamarComoSistema,
  contaDoCanario,
  contaPadrao,
  escritorioCanario,
  escritorioPadrao,
  idDoCanario,
  limpezaLocal,
} from "../rbac";

const admin = adminClient();
const MARCA = `[E2E resumo ${Date.now()}]`;

let ESC: string;
let ESC_PADRAO: string;
let PARCEIRO: string;
let CASO: string;
let configAntes: Record<string, unknown> | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.skip(!ENV.local, "só no banco local");
  ESC = await escritorioCanario();
  ESC_PADRAO = await escritorioPadrao();
  PARCEIRO = await idDoCanario("parceiro");
  const caso = await admin.from("casos").select("id").eq("parceiro_id", PARCEIRO).limit(1).maybeSingle();
  if (caso.error || !caso.data) throw new Error(`caso do parceiro do Canário: ${caso.error?.message ?? "nenhum — rode local:rbac"}`);
  CASO = caso.data.id as string;

  const cfg = await admin.from("resumo_parceiros_config").select("*").eq("escritorio_id", ESC).maybeSingle();
  if (cfg.error) throw new Error(cfg.error.message);
  configAntes = cfg.data;

  const agora = new Date();
  const hoje = new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const ins = [
    await admin.from("andamentos").insert({
      caso_id: CASO, origem: "interno", titulo: `${MARCA} visível`, visivel_parceiro: true, data_evento: agora.toISOString(),
    }),
    await admin.from("andamentos").insert({
      caso_id: CASO, origem: "interno", titulo: `${MARCA} interno`, visivel_parceiro: false, data_evento: agora.toISOString(),
    }),
    await admin.from("processos_admin").insert({
      caso_id: CASO, numero_requerimento: `E2E${Date.now()}`, data_protocolo: hoje, tipo_beneficio: `${MARCA} benefício`,
    }),
    await admin.from("processos_judiciais").insert({
      caso_id: CASO, numero_processo: `E2E-${Date.now()}`, vara: `${MARCA} vara`, data_distribuicao: hoje,
    }),
  ];
  for (const r of ins) if (r.error) throw new Error(`plantar: ${r.error.message}`);
  // um envio anterior de hoje (de outra rodada) faria a rodada abaixo pular
  await admin.from("resumo_parceiros_envios").delete().eq("parceiro_id", PARCEIRO);
});

test.afterAll(limpezaLocal(async () => {
  if (!ESC) return;
  await admin.from("andamentos").delete().like("titulo", `${MARCA}%`);
  await admin.from("processos_admin").delete().like("tipo_beneficio", `${MARCA}%`);
  await admin.from("processos_judiciais").delete().like("vara", `${MARCA}%`);
  await admin.from("resumo_parceiros_envios").delete().eq("parceiro_id", PARCEIRO);
  await admin.from("resumo_parceiros_preferencia").delete().eq("escritorio_id", ESC);
  if (configAntes) await admin.from("resumo_parceiros_config").upsert(configAntes);
  else await admin.from("resumo_parceiros_config").delete().eq("escritorio_id", ESC);
}));

test("parceiro não chama a function", async () => {
  const chamar = await chamadorComo(contaDoCanario("parceiro"), ESC);
  const r = await chamar("resumo-parceiros", { acao: "estado" });
  expect(r.status, r.texto).toBe(403);
});

test("a escolha do parceiro vale por cima do padrão do escritório", async () => {
  const chamar = await chamadorComo(contaDoCanario("admin"), ESC);
  const salvar = await chamar("resumo-parceiros", {
    acao: "salvar_config",
    config: { ativo: true, dia_semana: 5, hora: 20, padrao_parceiros: false, secoes: ["andamentos", "requerimentos", "judiciais", "lixo"] },
  });
  expect(salvar.status, salvar.texto).toBe(200);
  expect((salvar.json!.config as { secoes: string[] }).secoes).toEqual(["andamentos", "requerimentos", "judiciais"]);

  const lerParceiro = async () => {
    const r = await chamar("resumo-parceiros", { acao: "estado" });
    expect(r.status, r.texto).toBe(200);
    return (r.json!.parceiros as Array<{ id: string; modo: string; recebe: boolean }>).find((p) => p.id === PARCEIRO)!;
  };
  expect(await lerParceiro()).toMatchObject({ modo: "padrao", recebe: false });

  const def = await chamar("resumo-parceiros", { acao: "definir_parceiro", parceiro_id: PARCEIRO, modo: "sempre" });
  expect(def.status, def.texto).toBe(200);
  expect(await lerParceiro()).toMatchObject({ modo: "sempre", recebe: true });
});

test("a prévia traz o que o parceiro vê e esconde o andamento interno", async () => {
  const chamar = await chamadorComo(contaDoCanario("admin"), ESC);
  const r = await chamar("resumo-parceiros", { acao: "previa", parceiro_id: PARCEIRO });
  expect(r.status, r.texto).toBe(200);
  const html = String(r.json!.html);
  expect(html).toContain(`${MARCA} visível`);
  expect(html).not.toContain(`${MARCA} interno`);
  expect(html).toContain(`${MARCA} benefício`);
  expect(html).toContain(`${MARCA} vara`);
});

test("o cron manda um e-mail por parceiro e dia", async () => {
  const rodar = () => chamarComoSistema("resumo-parceiros", "cron:resumo-parceiros", { acao: "rodar", forcar: true });
  const r1 = await rodar();
  expect(r1.status, r1.texto).toBe(200);
  const envios = async () => {
    const r = await admin.from("resumo_parceiros_envios").select("status, itens").eq("parceiro_id", PARCEIRO);
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const depois1 = await envios();
  expect(depois1).toHaveLength(1);
  expect(depois1[0].status).toBe("enviado");
  expect(depois1[0].itens).toBeGreaterThanOrEqual(3);

  const r2 = await rodar();
  expect(r2.status, r2.texto).toBe(200);
  expect(await envios()).toHaveLength(1);

  // sem `forcar`, fora do dia/hora configurados não manda (a config é sexta 20h;
  // se a suíte rodar exatamente nesse horário, a trava do dia segura do mesmo jeito)
  const r3 = await chamarComoSistema("resumo-parceiros", "cron:resumo-parceiros", { acao: "rodar" });
  expect(r3.status, r3.texto).toBe(200);
  expect(await envios()).toHaveLength(1);
});

test("escritório não mexe em parceiro de outro escritório", async () => {
  const doPadrao = await admin.from("usuarios").select("id").eq("email", contaPadrao("parceiro")).single();
  if (doPadrao.error) throw new Error(doPadrao.error.message);
  const chamar = await chamadorComo(contaDoCanario("admin"), ESC);
  const r = await chamar("resumo-parceiros", { acao: "definir_parceiro", parceiro_id: doPadrao.data.id, modo: "sempre" });
  expect(r.status, r.texto).toBe(404);
  const pref = await admin.from("resumo_parceiros_preferencia").select("parceiro_id").eq("parceiro_id", doPadrao.data.id).eq("escritorio_id", ESC_PADRAO);
  expect(pref.error).toBeNull();
  expect(pref.data).toHaveLength(0);
});

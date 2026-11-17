// E2E do #514 / PR #515: etiquetas com UMA fonte de verdade
// (etiquetas + clientes_etiquetas).
//
// Antes, as rotinas de perícia escreviam no JSON legado `clientes.tags` e o
// gatilho espelhador apagava os vínculos que não estavam no JSON — agendar ou
// concluir perícia sumia com as etiquetas que a equipe marcou pela tela.
//
// Aqui, num cliente descartável do Canário:
//   * agendar perícia troca AGUARDANDO_AGENDAMENTO por PERICIA_AGENDADA_* e
//     mantém as outras etiquetas;
//   * a rotina diária troca PERICIA_AGENDADA_* por AGUARDANDO_RESULTADO quando
//     a última perícia já passou — e NÃO troca quando há perícia nova marcada
//     (achado 1 da revisão do PR: "alguma perícia passou" ≠ "a última passou");
//   * escrever no JSON `clientes.tags` não mexe mais em vínculo nenhum.
//
// Só no banco local: a rotina age sobre todos os clientes do banco.

import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient, cpfValido } from "../supabase-admin";
import { escritorioCanario, limpezaLocal } from "../rbac";

const admin = adminClient();
const MARCA = "[E2E etiquetas]";
const DIA = 24 * 3600 * 1000;
let ESC: string;
const clientes: string[] = [];

async function etiqueta(nome: string): Promise<string> {
  const { data: ja } = await admin.from("etiquetas").select("id").eq("escritorio_id", ESC).eq("nome", nome).maybeSingle();
  if (ja) return ja.id;
  const { data, error } = await admin.from("etiquetas").insert({ escritorio_id: ESC, nome, cor: "#e3d0e5" }).select("id").single();
  if (error) throw new Error(`etiqueta ${nome}: ${error.message}`);
  return data.id;
}

/** Cliente + caso, já com as etiquetas pedidas (como se a equipe tivesse marcado pela tela). */
async function clienteComCaso(sufixo: string, etiquetas: string[]) {
  const { data: cli, error } = await admin.from("clientes")
    .insert({ escritorio_id: ESC, nome: `${MARCA} ${sufixo}`, cpf: cpfValido() }).select("id").single();
  if (error) throw new Error(`cliente: ${error.message}`);
  clientes.push(cli.id);
  const { data: caso, error: eCaso } = await admin.from("casos")
    .insert({ escritorio_id: ESC, cliente_id: cli.id, tipo_beneficio: "Outro", fase: "analise" }).select("id").single();
  if (eCaso) throw new Error(`caso: ${eCaso.message}`);
  for (const nome of etiquetas) {
    const { error: eV } = await admin.from("clientes_etiquetas").insert({ cliente_id: cli.id, etiqueta_id: await etiqueta(nome) });
    if (eV) throw new Error(`vínculo ${nome}: ${eV.message}`);
  }
  return { cliente: cli.id as string, caso: caso.id as string };
}

async function pericia(caso: string, emDias: number, titulo = "Perícia médica INSS") {
  const ini = Date.now() + emDias * DIA;
  const { error } = await admin.from("agenda_eventos").insert({
    escritorio_id: ESC, caso_id: caso, tipo: "pericia", titulo,
    start_at: new Date(ini).toISOString(), end_at: new Date(ini + 3600 * 1000).toISOString(),
  });
  if (error) throw new Error(`perícia: ${error.message}`);
}

async function nomes(cliente: string): Promise<string[]> {
  const { data, error } = await admin.from("clientes_etiquetas").select("etiquetas(nome)").eq("cliente_id", cliente);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r.etiquetas as unknown as { nome: string }).nome).sort();
}

async function rotina() {
  const { error } = await admin.rpc("trocar_etiqueta_pos_pericia");
  if (error) throw new Error(`rotina: ${error.message}`);
}

test.describe.serial("etiquetas: fonte única (#514)", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    ESC = await escritorioCanario();
  });
  test.afterAll(limpezaLocal(async () => {
    for (const id of clientes) {
      const { data: casos } = await admin.from("casos").select("id").eq("cliente_id", id);
      for (const c of casos ?? []) {
        await admin.from("tarefas").delete().eq("caso_id", c.id);
        await admin.from("agenda_eventos").delete().eq("caso_id", c.id);
        await admin.from("casos").delete().eq("id", c.id);
      }
      await admin.from("clientes").delete().eq("id", id);
    }
  }));

  test("agendar perícia troca a etiqueta de espera e mantém as que a equipe marcou", async () => {
    const { cliente, caso } = await clienteComCaso("agenda", ["STATUS:ATIVO", "AGUARDANDO_AGENDAMENTO_DE_PERICIA"]);
    await pericia(caso, 20);
    expect(await nomes(cliente)).toEqual(["PERICIA_AGENDADA_INSS", "STATUS:ATIVO"]);
  });

  test("perícia passou e não há outra marcada: a rotina troca para AGUARDANDO_RESULTADO", async () => {
    const { cliente, caso } = await clienteComCaso("passou", ["STATUS:ATIVO"]);
    await pericia(caso, -5);
    expect(await nomes(cliente)).toContain("PERICIA_AGENDADA_INSS");
    await rotina();
    expect(await nomes(cliente)).toEqual(["AGUARDANDO_RESULTADO_DE_PERICIA", "STATUS:ATIVO"]);
  });

  test("perícia passou mas há uma NOVA marcada: a rotina não mexe", async () => {
    const { cliente, caso } = await clienteComCaso("nova-marcada", ["STATUS:ATIVO"]);
    await pericia(caso, -10, "Perícia médica INSS (1ª)");
    await pericia(caso, 15, "Perícia médica INSS (nova)");
    await rotina();
    expect(await nomes(cliente)).toEqual(["PERICIA_AGENDADA_INSS", "STATUS:ATIVO"]);
  });

  test("a nova perícia pode estar noutro caso do mesmo cliente", async () => {
    const a = await clienteComCaso("dois-casos", ["STATUS:ATIVO"]);
    const { data: caso2, error } = await admin.from("casos")
      .insert({ escritorio_id: ESC, cliente_id: a.cliente, tipo_beneficio: "Outro", fase: "analise" }).select("id").single();
    if (error) throw new Error(error.message);
    await pericia(a.caso, -10);
    await pericia(caso2.id, 15);
    await rotina();
    expect(await nomes(a.cliente)).toEqual(["PERICIA_AGENDADA_INSS", "STATUS:ATIVO"]);
  });

  test("escrever no JSON clientes.tags não mexe em vínculo nenhum", async () => {
    const { cliente } = await clienteComCaso("json", ["STATUS:ATIVO", "PARCERIA_X"]);
    const { error } = await admin.from("clientes").update({ tags: [{ id: 1, name: "OUTRA" }] }).eq("id", cliente);
    expect(error).toBeNull();
    expect(await nomes(cliente)).toEqual(["PARCERIA_X", "STATUS:ATIVO"]);
    const { error: e2 } = await admin.from("clientes").update({ tags: [] }).eq("id", cliente);
    expect(e2).toBeNull();
    expect(await nomes(cliente)).toEqual(["PARCERIA_X", "STATUS:ATIVO"]);
  });
});

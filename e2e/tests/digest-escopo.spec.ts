// E2E: o resumo do dia só vê o escritório de quem pediu.
//
// Por que esta spec existe: o `digest-diario` MANDA E-MAIL. Ele lê andamentos,
// publicações e tarefas com service role, que ignora RLS, e até 27/09 o
// isolamento vinha de um `doEscritorio(q)` local, aplicado À MÃO em cada
// consulta. Três consultas, três chances de esquecer — e esquecer significa
// dado de um escritório na caixa de entrada de outro.
//
// A function passou a usar o túnel `escopado` (_shared/auth.ts), que filtra por
// construção. Este teste é a prova: planta a mesma novidade nos DOIS
// escritórios e exige que o resumo do Canário mostre só a dele.
//
// Se alguém acrescentar uma quarta consulta sem escopo, é aqui que aparece.
//
// Só no banco local (`bun run local:rbac`).
import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import { chamadorComo, contaDoCanario, contaPadrao, escritorioCanario, escritorioPadrao } from "../rbac";

const admin = adminClient();
const AQUI = "[E2E digest CANARIO]";
const LA = "[E2E digest OUTRO]";

let ESC: string;
let ESC1: string;

/** Um caso de cada escritório, para pendurar as novidades. */
async function casoDe(escritorio: string): Promise<string> {
  const { data, error } = await admin.from("casos").select("id").eq("escritorio_id", escritorio).limit(1).maybeSingle();
  if (error) throw new Error(`caso de ${escritorio}: ${error.message}`);
  if (!data) throw new Error(`escritório ${escritorio} sem caso — rode \`bun run local:rbac\``);
  return data.id as string;
}

/** Planta uma novidade de cada tipo num caso, com o marcador no título. */
async function plantar(escritorio: string, marca: string) {
  const casoId = await casoDe(escritorio);
  const agora = new Date().toISOString();
  const hoje = new Date().toISOString().slice(0, 10);

  const { error: eAnd } = await admin.from("andamentos").insert({
    caso_id: casoId, escritorio_id: escritorio, origem: "datajud",
    titulo: `${marca} movimentação`, descricao: "plantada pelo teste", data_evento: agora,
  });
  if (eAnd) throw new Error(`andamento (${marca}): ${eAnd.message}`);

  const { error: eTar } = await admin.from("tarefas").insert({
    caso_id: casoId, escritorio_id: escritorio, tipo: "interna", status: "a_fazer",
    titulo: `${marca} tarefa`, due_at: `${hoje}T12:00:00-03:00`,
  });
  if (eTar) throw new Error(`tarefa (${marca}): ${eTar.message}`);

  const { error: ePub } = await admin.from("publicacoes_dje").insert({
    escritorio_id: escritorio, djen_id: `e2e-digest-${marca.replace(/\W/g, "")}-${Date.now()}`,
    caso_id: casoId, numero_processo: "0000000-00.2026.8.26.0000",
    texto: `${marca} publicação`,
  });
  if (ePub) throw new Error(`publicação (${marca}): ${ePub.message}`);
}

async function limpar() {
  for (const marca of [AQUI, LA]) {
    await admin.from("andamentos").delete().like("titulo", `${marca}%`);
    await admin.from("tarefas").delete().like("titulo", `${marca}%`);
    await admin.from("publicacoes_dje").delete().like("texto", `${marca}%`);
  }
  await admin.from("tarefas_excluidas").delete().like("titulo", `${AQUI}%`);
  await admin.from("andamentos_excluidos").delete().like("titulo", `${AQUI}%`);
  await admin.from("andamentos_excluidos").delete().like("titulo", `${LA}%`);
}

test.describe.serial("resumo do dia: escopo do escritório", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    ESC = await escritorioCanario();
    ESC1 = await escritorioPadrao();
    await limpar();
    await plantar(ESC, AQUI);
    await plantar(ESC1, LA);
  });

  test.afterAll(limpar);

  test("o resumo do Canário mostra o do Canário e nada do outro escritório", async () => {
    const chamar = await chamadorComo(contaDoCanario("admin"), ESC);
    const r = await chamar("digest-diario", { dry_run: true, horas: 24 });
    expect(r.status, r.texto.slice(0, 200)).toBe(200);

    const html = String(r.json?.html ?? "");
    expect(html.length, "o dry_run devolve o HTML do e-mail").toBeGreaterThan(0);

    // o que é do Canário aparece
    expect(html, "a movimentação do Canário entra no resumo").toContain(`${AQUI} movimentação`);
    expect(html, "a tarefa do Canário entra no resumo").toContain(`${AQUI} tarefa`);

    // o que é do outro escritório NÃO aparece — é isto que o túnel garante
    expect(html, "movimentação de outro escritório no e-mail").not.toContain(`${LA} movimentação`);
    expect(html, "tarefa de outro escritório no e-mail").not.toContain(`${LA} tarefa`);
    expect(html, "publicação de outro escritório no e-mail").not.toContain(`${LA} publicação`);
    expect(html, "nenhum marcador do outro escritório").not.toContain(LA);
  });

  test("o resumo do outro escritório é o espelho: só o dele", async () => {
    const chamar = await chamadorComo(contaPadrao("admin"), ESC1);
    const r = await chamar("digest-diario", { dry_run: true, horas: 24 });
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    const html = String(r.json?.html ?? "");
    expect(html, "a movimentação do escritório 1 entra").toContain(`${LA} movimentação`);
    expect(html, "nada do Canário aqui").not.toContain(AQUI);
  });
});

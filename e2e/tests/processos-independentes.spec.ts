// E2E: cada processo é um mundo à parte (#397, Mara 25/09).
//
// "O requerimento 1 não pode atrapalhar as tarefas do requerimento 2, nem os
// requerimentos o processo judicial." Mesmo caso, dois requerimentos:
//   1. o parceiro entrega o documento da exigência do 1 → fecha só o
//      "Aguardando documentos" do 1 (e o do robô do e-mail INSS também fecha);
//   2. cumprir a exigência do 1 → fecha só o FATAL do 1;
//   3. a montagem da inicial aberta no 1 não impede ajuizar o 2.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { cursorVisivel } from "../cursor";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirTarefaNoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });
test.describe.configure({ mode: "serial" });

const admin = adminClient();
let casoId: string;
let nomeCliente: string;
let internoId: string;
let req1: string;
let req2: string;

async function tarefa(titulo: string, extra: Record<string, unknown>) {
  const { data, error } = await admin
    .from("tarefas")
    .insert({ caso_id: casoId, tipo: "interna", titulo, responsavel_id: internoId, ...extra })
    .select("id")
    .single();
  if (error) throw new Error(`seed ${titulo}: ${error.message}`);
  return data.id as string;
}

async function status(id: string) {
  const { data } = await admin.from("tarefas").select("status").eq("id", id).single();
  return data!.status as string;
}

test.beforeAll(async () => {
  const sufixo = `Processos ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
  const { data: eu } = await admin.from("usuarios").select("id").eq("email", ENV.internoEmail).single();
  internoId = eu!.id as string;
  const { data: procs, error } = await admin
    .from("processos_admin")
    .insert([
      { caso_id: casoId, numero_requerimento: "1111111111" },
      { caso_id: casoId, numero_requerimento: "2222222222" },
    ])
    .select("id, numero_requerimento");
  if (error) throw new Error(error.message);
  req1 = procs!.find((p) => p.numero_requerimento === "1111111111")!.id as string;
  req2 = procs!.find((p) => p.numero_requerimento === "2222222222")!.id as string;
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test.beforeEach(async ({ page }) => {
  await cursorVisivel(page);
});

test("documento entregue fecha só o Aguardando do mesmo requerimento", async () => {
  // Como o robô do e-mail INSS grava: metadata.template (não template_aplicado).
  const ag1 = await tarefa(`Aguardando documentos do parceiro (exigência INSS) - ${nomeCliente} R1`, {
    processo_admin_id: req1,
    metadata: { template: "exigencia", aguardando_exigencia: true },
  });
  const ag2 = await tarefa(`Aguardando documentos do parceiro (exigência INSS) - ${nomeCliente} R2`, {
    processo_admin_id: req2,
    metadata: { template: "exigencia", aguardando_exigencia: true },
  });
  const { data: sol, error } = await admin
    .from("solicitacoes_documento")
    .insert({
      caso_id: casoId,
      processo_admin_id: req1,
      tipo: "outro",
      descricao: "[E2E] documento da exigência do requerimento 1",
      status: "pendente",
      origem: "template:exigencia",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: errAt } = await admin
    .from("solicitacoes_documento")
    .update({ status: "atendido" })
    .eq("id", sol.id);
  expect(errAt).toBeNull();

  expect(await status(ag1)).toBe("feito");
  expect(await status(ag2)).toBe("a_fazer");
  // O andamento "Documento entregue" fica no requerimento 1, não em Gerais.
  const { data: and } = await admin
    .from("andamentos")
    .select("processo_admin_id")
    .eq("caso_id", casoId)
    .like("titulo", "Documento entregue pelo Parceiro%")
    .single();
  expect(and!.processo_admin_id).toBe(req1);
});

test("cumprir a exigência do requerimento 1 fecha só o FATAL dele", async ({ page }) => {
  const fatal1 = await tarefa(`FATAL - CUMPRIMENTO DE EXIGENCIA INSS - ${nomeCliente} R1`, {
    processo_admin_id: req1,
    metadata: { template: "exigencia", prazo_fatal: true },
  });
  const fatal2 = await tarefa(`FATAL - CUMPRIMENTO DE EXIGENCIA INSS - ${nomeCliente} R2`, {
    processo_admin_id: req2,
    metadata: { template: "exigencia", prazo_fatal: true },
  });
  // A tarefa de cumprimento do 1 nasceu da entrega do documento (teste acima).
  const { data: cumprir } = await admin
    .from("tarefas")
    .select("titulo")
    .eq("caso_id", casoId)
    .eq("processo_admin_id", req1)
    .like("titulo", "Cumprir Exigência INSS%")
    .single();

  await abrirTarefaNoCaso(page, casoId, cumprir!.titulo as string);
  await page.getByRole("dialog").getByRole("button", { name: "Marcar" }).click();
  await expect(page.getByText(/Exigência cumprida\. Acompanhamento processual criado/)).toBeVisible();

  await expect.poll(() => status(fatal1)).toBe("feito");
  expect(await status(fatal2)).toBe("a_fazer");
});

test("montagem aberta no requerimento 1 não impede ajuizar o requerimento 2", async ({ page }) => {
  await tarefa(`Montagem da inicial - ${nomeCliente} R1`, {
    processo_admin_id: req1,
    metadata: { template_aplicado: "montagem_inicial", montagem_inicial: true, etapa: "montagem" },
  });
  const tituloAnalise = `Analise de Indeferimento - ${nomeCliente} R2`;
  await tarefa(tituloAnalise, {
    processo_admin_id: req2,
    metadata: { template: "indeferido", analise_indeferimento: true },
  });

  await abrirTarefaNoCaso(page, casoId, tituloAnalise);
  await page.getByRole("dialog").getByRole("button", { name: "Ajuizar (montagem de inicial)" }).click();
  await expect(page.getByText("Vamos ajuizar — corrente de montagem da inicial aberta.")).toBeVisible();

  const { data: montagens } = await admin
    .from("tarefas")
    .select("processo_admin_id")
    .eq("caso_id", casoId)
    .eq("status", "a_fazer")
    .like("titulo", "Montagem da inicial%");
  expect(montagens!.map((m) => m.processo_admin_id).sort()).toEqual([req1, req2].sort());
});

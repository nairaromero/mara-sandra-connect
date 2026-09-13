// E2E: tarefa sem dono e caso sem parceiro (Naira, 2026-09-03).
//
//  1. Caso indicado por parceiro: o trigger cria "Cliente novo - Analisar"
//     já com dono (a Mara) — antes nascia órfã quando o próprio parceiro
//     cadastrava.
//  2. Perícia/audiência em caso SEM parceiro: nasce "Avisar o cliente"
//     (antes não nascia tarefa nenhuma — ninguém lembrava de avisar).
//  3. Pelo formulário, quem o interno escolhe na tela manda por cima do dono
//     padrão.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, cpfValido, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();

async function maraId(): Promise<string> {
  const { data, error } = await admin.rpc("responsavel_padrao_analise");
  if (error) throw new Error(`responsavel_padrao_analise: ${error.message}`);
  if (!data) throw new Error("responsavel_padrao_analise devolveu vazio");
  return data as string;
}

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("caso do parceiro: análise nasce com dono padrão", async () => {
  const { data: parceira } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  const { casoId } = await seedClienteCaso(admin, {
    sufixo: `Dono Analise ${Date.now()}`,
    parceiroId: parceira!.id,
  });

  const { data: tarefas } = await admin
    .from("tarefas")
    .select("id, responsavel_id, metadata")
    .eq("caso_id", casoId);
  const analise = (tarefas ?? []).find(
    (t) => (t.metadata as { etapa?: string })?.etapa === "analise_inicial_parceiro",
  );
  expect(analise).toBeTruthy();
  expect(analise!.responsavel_id).toBe(await maraId());
});

test("perícia em caso sem parceiro vira tarefa de avisar o cliente", async () => {
  const { casoId } = await seedClienteCaso(admin, { sufixo: `Avisar Cliente ${Date.now()}` });

  const start = new Date(Date.now() + 10 * 86400_000).toISOString();
  const { error } = await admin.from("agenda_eventos").insert({
    tipo: "pericia",
    titulo: "Perícia INSS",
    start_at: start,
    end_at: new Date(Date.parse(start) + 3600_000).toISOString(),
    caso_id: casoId,
    local: "Agência do INSS",
  });
  if (error) throw new Error(`seed evento: ${error.message}`);

  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, descricao, responsavel_id, tipo, metadata")
    .eq("caso_id", casoId);
  const aviso = (tarefas ?? []).find((t) => String(t.titulo).startsWith("Avisar o cliente"));
  expect(aviso).toBeTruthy();
  expect(aviso!.tipo).toBe("contato_cliente");
  expect(aviso!.responsavel_id).not.toBeNull();
  // Texto de referência entra sem a linha de confirmação (essa é pro parceiro).
  expect(String(aviso!.descricao)).toContain("PERÍCIA INSS AGENDADA");
  expect(String(aviso!.descricao)).not.toContain("Favor confirmar");
  // E nenhuma tarefa de "Enviar aviso ao parceiro" foi criada.
  expect((tarefas ?? []).some((t) => String(t.titulo).startsWith("Enviar aviso"))).toBe(false);
});

test("responsável escolhido no formulário manda por cima do dono padrão", async ({ page }) => {
  const nome = `[E2E] Form Parceiro ${Date.now()}`;
  await page.goto("/casos/novo");

  await page.getByLabel("Nome completo *").fill(nome);
  await page.getByPlaceholder("000.000.000-00").fill(cpfValido());
  await page.getByLabel("Data de nascimento *").fill("1988-03-12");
  await page.getByLabel("Telefone *").fill("65999990001");
  await page.getByLabel("Tipo de benefício *").click();
  await page.getByRole("option").first().click();

  // Escolhe o parceiro indicador (o caso passa a nascer pelo trigger).
  // Regex pra casar com ou sem o asterisco de obrigatório, e não pegar o
  // checkbox "(sem parceiro indicador)".
  await page.getByLabel(/^Parceiro indicador\s*\*?$/).click();
  await page.getByRole("option").first().click();

  // E quem recebe a tarefa: o próprio usuário do teste.
  await page.getByLabel("Quem recebe a tarefa de novo cliente").click();
  const escolhido = page.getByRole("option").filter({ hasText: "[E2E] Interno" }).first();
  await escolhido.click();

  await page.getByRole("button", { name: "Cadastrar caso" }).click();
  await expect(page).not.toHaveURL(/casos\/novo/, { timeout: 20000 });

  const { data: cliente } = await admin
    .from("clientes")
    .select("id, casos(id)")
    .eq("nome", nome)
    .single();
  const casoId = (cliente!.casos as Array<{ id: string }>)[0].id;

  const { data: interno } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();

  const { data: tarefas } = await admin
    .from("tarefas")
    .select("responsavel_id, metadata")
    .eq("caso_id", casoId);
  const analise = (tarefas ?? []).find((t) =>
    String((t.metadata as { etapa?: string })?.etapa ?? "").startsWith("analise_inicial"),
  );
  expect(analise).toBeTruthy();
  expect(analise!.responsavel_id).toBe(interno!.id);
  expect(analise!.responsavel_id).not.toBe(await maraId());
});

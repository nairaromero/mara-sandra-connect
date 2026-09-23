// E2E: datas no calendário de Brasília mesmo com o navegador em outro fuso.
//
// Bug reproduzido em 2026-09-21 no staging, de uma máquina em Madri: uma
// solicitação com prazo_at = 23:59:59 de Brasília (o "enviar até" do parceiro)
// aparecia como "Enviar até <dia seguinte>" na tela do caso — o kanban do
// parceiro e o texto da IA mostravam o dia certo. Com o navegador em
// America/Sao_Paulo o badge já saía certo, por isso o teste fixa Madri.
//
// Cobre:
//  - badge "Enviar até" da tela do caso (aba Documentos) e da /documentos;
//  - linha do tempo de andamentos: andamento só com a data (importação de
//    planilha/DJEN gravam meia-noite UTC) não cai na véspera nem ganha hora;
//    andamento com hora de verdade sai no dia e na hora de Brasília.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso, seedSolicitacao } from "../supabase-admin";

// Madri está à frente de Brasília (+4h/+5h): 23:59 em Brasília já é o dia
// seguinte lá — exatamente o cenário do bug.
test.use({ storageState: STORAGE_INTERNO, timezoneId: "Europe/Madrid" });

const admin = adminClient();

const pad = (n: number) => String(n).padStart(2, "0");

// Dia de calendário em Brasília daqui a `dias` dias. Brasília é UTC−3 fixo
// desde 2019 (sem horário de verão); calculado aqui sem passar por src/lib/fuso.
function diaBR(dias: number): { iso: string; br: string } {
  const d = new Date(Date.now() - 3 * 3600_000 + dias * 86400_000);
  const [a, m, dd] = [d.getUTCFullYear(), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())];
  return { iso: `${a}-${m}-${dd}`, br: `${dd}/${m}/${a}` };
}

const prazo = diaBR(10);
const diaSeguinteAoPrazo = diaBR(11);
const diaSoData = diaBR(-5);
const diaComHora = diaBR(-3);

let casoId: string;
let nomeCliente: string;
let andSoDataId: string;
let andComHoraId: string;

test.beforeAll(async () => {
  const { data: interno } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  if (!interno) throw new Error(`interno de teste não encontrado: ${ENV.internoEmail}`);

  const sufixo = `Fuso Brasilia ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));

  // Fim do dia em Brasília, com o offset explícito: 02:59:59Z do dia seguinte.
  // solicitado_por = interno: a /documentos abre filtrada em "pedidos por mim".
  await seedSolicitacao(admin, casoId, "cnis", {
    prazoAt: `${prazo.iso}T23:59:59-03:00`,
    solicitadoPor: interno.id as string,
  });

  const { data: ands, error } = await admin
    .from("andamentos")
    .insert([
      {
        caso_id: casoId,
        origem: "interno",
        titulo: `${nomeCliente} andamento só com data`,
        // Como a importação de planilha grava (importar-clientes-excel-dialog).
        data_evento: `${diaSoData.iso}T00:00:00Z`,
      },
      {
        caso_id: casoId,
        origem: "interno",
        titulo: `${nomeCliente} andamento com hora`,
        data_evento: `${diaComHora.iso}T23:30:00-03:00`,
      },
    ])
    .select("id, titulo");
  if (error) throw new Error(`seed andamentos: ${error.message}`);
  andSoDataId = ands!.find((a) => a.titulo.endsWith("só com data"))!.id;
  andComHoraId = ands!.find((a) => a.titulo.endsWith("com hora"))!.id;
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("tela do caso mostra o 'Enviar até' e os andamentos no dia de Brasília", async ({ page }) => {
  await page.goto(`/casos/${casoId}`);
  // Garante que o cenário é mesmo o do bug (navegador fora do Brasil).
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
    "Europe/Madrid",
  );

  await page.getByRole("tab", { name: /Documentos/ }).click();
  await expect(page.getByText("Documentos solicitados")).toBeVisible();
  await expect(page.getByText(`Enviar até ${prazo.br}`)).toBeVisible();
  await expect(page.getByText(`Enviar até ${diaSeguinteAoPrazo.br}`)).toHaveCount(0);

  await page.getByRole("tab", { name: /Atividades/ }).click();
  const soData = page.locator(`#foco-${andSoDataId}`);
  await expect(soData).toBeVisible({ timeout: 20_000 });
  await expect(soData.getByText(diaSoData.br, { exact: true })).toBeVisible();

  const comHora = page.locator(`#foco-${andComHoraId}`);
  await expect(comHora.getByText(`${diaComHora.br} 23:30`, { exact: true })).toBeVisible();
});

test("/documentos mostra o 'Enviar até' no dia de Brasília", async ({ page }) => {
  await page.goto("/documentos");
  await page.getByPlaceholder("Cliente, tipo de documento, benefício...").fill(nomeCliente);
  await expect(page.getByText(`Enviar até ${prazo.br}`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`Enviar até ${diaSeguinteAoPrazo.br}`)).toHaveCount(0);
});

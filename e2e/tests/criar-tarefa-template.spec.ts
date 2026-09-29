// E2E: criar tarefa via template "Indeferido" (usuário interno).
// Exercita os Selects Radix em portal e valida que TODAS as tarefas do
// template saem com responsável (feature dos selects por item).
// Desde o #397 a data do indeferimento é obrigatória: a Análise nasce com a
// data da etapa no relógio do caso (indeferimento + 10), não com o offset.

import { test, expect } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirNovaTarefaNoCaso } from "../tarefas";
import { diaBR, diaDoInstanteBR, recua } from "../datas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let nomeCliente: string;
let casoConcedidoId: string;
let nomeClienteConcedido: string;

test.beforeAll(async () => {
  const sufixo = `Tarefa Template ${Date.now()}`;
  nomeCliente = `[E2E] ${sufixo}`;
  ({ casoId } = await seedClienteCaso(admin, { sufixo }));
  const sufixoConcedido = `Template Concedido ${Date.now()}`;
  nomeClienteConcedido = `[E2E] ${sufixoConcedido}`;
  ({ casoId: casoConcedidoId } = await seedClienteCaso(admin, { sufixo: sufixoConcedido }));
});

/** Dia útil (seg–sex) n dias depois de `dia` (YYYY-MM-DD) — mesma conta de `public.somar_dias_uteis`. */
function somarDiasUteis(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  for (let i = 0; i < n; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) i++;
  }
  return d.toISOString().slice(0, 10);
}

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("template indeferido cria 2 tarefas, ambas com responsável", async ({ page }) => {
  await abrirNovaTarefaNoCaso(page, casoId);
  await expect(page.getByRole("combobox").filter({ hasText: nomeCliente })).toBeVisible();

  // Select do template.
  await page.getByRole("combobox").filter({ hasText: "Escolha um template" }).click();
  await page.getByRole("option", { name: /Indeferido/ }).click();

  // Prefill assíncrono concluiu quando o bloco de responsáveis por item
  // aparece — e o item extra ("Baixar PA") já vem com executor padrão.
  await expect(
    page.getByText("Responsáveis das outras tarefas do template"),
  ).toBeVisible();
  await expect(page.getByText(/Baixar PA/).first()).toBeVisible();

  // Sem a data do indeferimento o template não sai.
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Informe a data do indeferimento.")).toBeVisible();

  const indeferidoEm = diaBR(-12);
  await page.locator("#t-data-indeferimento").fill(indeferidoEm);
  await page.getByRole("button", { name: "Salvar" }).click();

  // Verificação forte no banco: 2 tarefas, nenhuma sem responsável.
  //
  // Espera o efeito no banco em vez do toast: o toast some sozinho em poucos
  // segundos e a lista re-renderiza pesado depois do save, o que deixava a
  // asserção de UI numa corrida. Também não serve olhar os títulos na tela — o
  // painel mostra um preview dos itens do template ANTES de salvar, então esse
  // texto já está visível mesmo se o save falhar.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("titulo, responsavel_id")
          .eq("caso_id", casoId);
        return data?.length ?? 0;
      },
      { timeout: 15_000, message: "esperando as 2 tarefas do template no banco" },
    )
    .toBe(2);

  const { data: tarefas } = await admin
    .from("tarefas")
    .select("titulo, responsavel_id")
    .eq("caso_id", casoId);
  for (const t of tarefas!) {
    expect(t.responsavel_id, `tarefa sem responsável: ${t.titulo}`).toBeTruthy();
  }

  // Relógio aberto a partir da data informada; a Análise vence no D+10.
  const { data: relogio } = await admin
    .from("relogios_prazo")
    .select("origem_em, origem_estimada, planejado_em, limite_em")
    .eq("caso_id", casoId)
    .single();
  expect(relogio).toMatchObject({
    origem_em: indeferidoEm,
    origem_estimada: false,
    planejado_em: recua(diaBR(-12 + 30)),
    limite_em: recua(diaBR(-12 + 40)),
  });
  const { data: analise } = await admin
    .from("tarefas")
    .select("due_at")
    .eq("caso_id", casoId)
    .like("titulo", "Analise de Indeferimento%")
    .single();
  expect(diaDoInstanteBR(analise!.due_at as string)).toBe(recua(diaBR(-12 + 10)));
});

// O "Concedido" tem uma tarefa cujo prazo sai de um GATILHO do banco
// (`tg_implementacao_due_inicial`, SECURITY INVOKER): ele roda como a pessoa
// logada e chama `implementacao_cadencia`/`somar_dias_uteis`. Quando o revoke
// em massa fechou essas duas, a tela estourava "permission denied for function
// implementacao_cadencia" no meio do template e deixava cópia parcial
// (21/09–29/09 em produção). Este teste é a prova de ponta a ponta; a régua
// estrutural é `private.funcoes_fechadas_no_caminho()` no conferidor.
test("template concedido cria as 3 tarefas e o acompanhamento vence em dias úteis", async ({ page }) => {
  await abrirNovaTarefaNoCaso(page, casoConcedidoId);
  await expect(page.getByRole("combobox").filter({ hasText: nomeClienteConcedido })).toBeVisible();

  await page.getByRole("combobox").filter({ hasText: "Escolha um template" }).click();
  await page.getByRole("option", { name: /Concedido/ }).click();
  await expect(page.getByText("Responsáveis das outras tarefas do template")).toBeVisible();
  await expect(page.getByText(/Acompanhamento de implementação/).first()).toBeVisible();

  await page.getByRole("button", { name: "Salvar" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await admin.from("tarefas").select("id").eq("caso_id", casoConcedidoId);
        return data?.length ?? 0;
      },
      { timeout: 15_000, message: "esperando as 3 tarefas do Concedido no banco" },
    )
    .toBe(3);
  await expect(page.getByText(/permission denied/i)).toHaveCount(0);

  const { data: acomp } = await admin
    .from("tarefas")
    .select("due_at, metadata")
    .eq("caso_id", casoConcedidoId)
    .like("titulo", "Acompanhamento de implementação%")
    .single();
  expect((acomp!.metadata as { acompanhamento_implementacao?: boolean }).acompanhamento_implementacao).toBe(true);
  // Sem processo judicial vinculado → administrativo → 5 dias úteis a partir de hoje.
  expect(diaDoInstanteBR(acomp!.due_at as string)).toBe(somarDiasUteis(diaBR(0), 5));

  const { count: andamentos } = await admin
    .from("andamentos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoConcedidoId)
    .eq("metadata->>template_aplicado", "concedido");
  expect(andamentos).toBe(1);
});

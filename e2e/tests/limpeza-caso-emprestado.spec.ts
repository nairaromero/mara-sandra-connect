// A limpeza alcança o rastro em caso EMPRESTADO — e não passa disso.
//
// A convenção é que todo dado de teste pendura num cliente `[E2E]`. Ela falha
// quando a tela cria algo num caso que o teste não semeou: a tarefa nasce de um
// template e leva o nome do CLIENTE REAL ("Analise de Indeferimento - Cliente
// 001327"), sem marcador nenhum. Em 29/09 havia cinco dessas no staging, mais
// um relógio aberto por uma delas — é o que a Naira via ao validar.
//
// Os dois lados importam, e o de baixo é o que dói: a 1ª versão da varredura
// apagava TUDO que nascesse na janela naquele caso, e levou junto uma linha de
// outra pessoa. Num caso de cliente real, isso é apagar trabalho de gente.
import { test, expect } from "@playwright/test";
import { adminClient, cleanupE2E, escritorioE2E } from "../supabase-admin";
import { ENV } from "../env";

const admin = adminClient();

/** Um caso de cliente que NÃO é de teste — é o cenário que a régua investiga. */
async function casoEmprestado(esc: string) {
  const { data } = await admin
    .from("casos")
    .select("id, cliente:cliente_id(nome)")
    .eq("escritorio_id", esc)
    .limit(30);
  return (data ?? []).find(
    (c) => !String((c.cliente as { nome?: string } | null)?.nome ?? "").startsWith("[E2E]"),
  );
}

test("a varredura pega o rastro de teste e só ele", async () => {
  const esc = await escritorioE2E(admin);
  test.skip(!esc, "banco sem escritório padrão");
  const { data: conta } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.adminEmail)
    .maybeSingle();
  test.skip(!conta, "banco sem a conta e2e+admin");

  const caso = await casoEmprestado(esc!);
  test.skip(!caso, "banco sem caso de cliente real para emprestar");

  const nova = (titulo: string, extra: Record<string, unknown>) =>
    admin
      .from("tarefas")
      .insert({
        caso_id: caso!.id,
        escritorio_id: esc,
        tipo: "interna",
        status: "a_fazer",
        titulo,
        due_at: new Date().toISOString(),
        ...extra,
      })
      .select("id")
      .single();

  // (a) já existia antes desta rodada — a janela de tempo tem que protegê-la
  const { data: antiga } = await nova("[REGUA] antiga", {
    created_by: conta!.id,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  });
  // (b) nasceu agora, mas não é de conta de teste — o autor tem que protegê-la
  const { data: deOutro } = await nova("[REGUA] de outra pessoa", { created_by: null });
  // (c) é o rastro de verdade: conta de teste, agora
  const { data: rastro } = await nova("[REGUA] rastro", { created_by: conta!.id });

  await cleanupE2E(admin);

  const viva = async (id: string) =>
    !!(await admin.from("tarefas").select("id").eq("id", id).maybeSingle()).data;

  expect(await viva(antiga!.id), "linha anterior à rodada não pode ser apagada").toBe(true);
  expect(await viva(deOutro!.id), "linha de outra pessoa não pode ser apagada").toBe(true);
  expect(await viva(rastro!.id), "o rastro de teste tinha que sumir").toBe(false);

  await admin.from("tarefas").delete().in("id", [antiga!.id, deOutro!.id]);
});

// E2E (só local): os alertas de 30/60/90 dias — ouvidoria no INSS, mora
// administrativa, ajuizar — não nascem para perícia JUDICIAL.
//
// Só no banco local: `criar_alertas_escalonamento_pericia` varre o banco
// INTEIRO. No staging abriria alerta em caso espelhado de verdade, que a
// limpeza desta spec não apaga (achado da revisão do PR #555).

import { test, expect } from "@playwright/test";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { ENV } from "../env";
import { limpezaLocal } from "../rbac";

const admin = adminClient();

test.beforeEach(() => {
  test.skip(!ENV.local, "só no banco local: a rotina de escalonamento é global");
});

test.afterAll(limpezaLocal(async () => {
  await cleanupE2E(admin);
}));

test("laudo que demora não vira ouvidoria no INSS", async () => {
  // Perícia de 100 dias atrás nas duas frentes; origem que a rotina olha.
  const antiga = new Date(Date.now() - 100 * 86400_000).toISOString();
  const sufixo = Date.now();
  const { casoId: caso2 } = await seedClienteCaso(admin, { sufixo: `Escalonamento ${sufixo}` });
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: caso2, numero_processo: `E2E-JUD2-${sufixo}` })
    .select("id")
    .single();
  if (jud.error) throw new Error(jud.error.message);
  const base = {
    caso_id: caso2,
    tipo: "contato_cliente",
    status: "a_fazer",
    prioridade: 2,
    origem: "pericia_acompanhamento",
  };
  const { error } = await admin.from("tarefas").insert([
    {
      ...base,
      titulo: `[E2E] laudo judicial antigo ${sufixo}`,
      processo_judicial_id: jud.data.id,
      metadata: { acompanhamento_pericia: true, pericia_judicial: true, pericia_em: antiga },
    },
    {
      ...base,
      titulo: `[E2E] resultado INSS antigo ${sufixo}`,
      metadata: { acompanhamento_pericia: true, pericia_em: antiga },
    },
  ]);
  if (error) throw new Error(error.message);

  const rpc = await admin.rpc("criar_alertas_escalonamento_pericia");
  if (rpc.error) throw new Error(rpc.error.message);

  const { data: alertas, error: e } = await admin
    .from("tarefas")
    .select("titulo, processo_judicial_id, metadata")
    .eq("caso_id", caso2)
    .not("metadata->>escalonamento_pericia", "is", null);
  if (e) throw e;
  // Os três do INSS (30/60/90), nenhum no processo judicial.
  expect(alertas).toHaveLength(3);
  expect(alertas!.every((a) => a.processo_judicial_id === null)).toBe(true);
});

// E2E (só local): a consequência de uma ação permitida alcança a linha ligada,
// mesmo quando ela está no nome de OUTRA pessoa — e só a consequência.
//
// O Assistente tem alcance "atribuídos" em tarefas e na agenda. Antes desta
// correção, responder o comparecimento não encerrava a perícia de outra pessoa
// e remarcar não levava as tarefas de outra pessoa: o banco recusava em
// silêncio (zero linhas, sem erro) e a tela seguia como se tivesse feito.
// Decisão da Naira (27/11/2026): a consequência acompanha.
//
// Pela API, com a sessão do assistente do Canário — a regra é do banco.

import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import { adminClient } from "../supabase-admin";
import { clienteComo, contaDoCanario, escritorioCanario, idDoCanario, limpezaLocal } from "../rbac";

const admin = adminClient();
const DIA = 86400_000;
let ESC: string;
let assistente: string;
let outra: string;
let clienteId: string | null = null;
let casoId: string;
let judId: string;

test.beforeAll(async () => {
  test.skip(!ENV.local, "só no banco local");
  ESC = await escritorioCanario();
  assistente = await idDoCanario("assistente");
  outra = await idDoCanario("advogado");

  const cli = await admin
    .from("clientes")
    .insert({ nome: `[E2E] Escopo perícia ${Date.now()}`, cpf: `998${String(Date.now()).slice(-8)}`, escritorio_id: ESC })
    .select("id")
    .single();
  if (cli.error) throw new Error(cli.error.message);
  clienteId = cli.data.id;
  const caso = await admin
    .from("casos")
    .insert({ cliente_id: clienteId, tipo_beneficio: "Salário-maternidade", fase: "judicial", escritorio_id: ESC })
    .select("id")
    .single();
  if (caso.error) throw new Error(caso.error.message);
  casoId = caso.data.id;
  const jud = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: `E2E-ESC-${Date.now()}`, escritorio_id: ESC })
    .select("id")
    .single();
  if (jud.error) throw new Error(jud.error.message);
  judId = jud.data.id;
});

test.afterAll(limpezaLocal(async () => {
  if (!clienteId) return;
  await admin.from("tarefas").delete().eq("caso_id", casoId);
  await admin.from("tarefas_excluidas").delete().eq("caso_id", casoId);
  await admin.from("agenda_eventos").delete().eq("caso_id", casoId);
  await admin.from("processos_judiciais").delete().eq("caso_id", casoId);
  await admin.from("casos").delete().eq("id", casoId);
  await admin.from("clientes").delete().eq("id", clienteId);
}));

async function pericia(responsavel: string, quando: Date) {
  const { data, error } = await admin
    .from("agenda_eventos")
    .insert({
      caso_id: casoId,
      processo_judicial_id: judId,
      escritorio_id: ESC,
      responsavel_id: responsavel,
      tipo: "pericia",
      titulo: `[E2E] Perícia ${Date.now()}`,
      start_at: quando.toISOString(),
      end_at: new Date(quando.getTime() + 3600_000).toISOString(),
    })
    .select("id, start_at")
    .single();
  if (error) throw new Error(`perícia: ${error.message}`);
  return data as { id: string; start_at: string };
}

async function tarefa(responsavel: string, periciaEm: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      processo_judicial_id: judId,
      escritorio_id: ESC,
      responsavel_id: responsavel,
      tipo: "contato_cliente",
      status: "a_fazer",
      prioridade: 2,
      origem: "manual",
      titulo: `[E2E] Tarefa da perícia ${Date.now()}-${Math.random()}`,
      due_at: new Date(Date.now() + 30 * DIA).toISOString(),
      metadata: { ancora_prazo: "agenda", pericia_em: periciaEm, ...extra },
    })
    .select("id")
    .single();
  if (error) throw new Error(`tarefa: ${error.message}`);
  return data.id as string;
}

const quarta = (min: number) => {
  const d = new Date(Date.now() + min * DIA);
  d.setUTCHours(17, 0, 0, 0);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d;
};

test("o update direto do assistente na perícia de outra pessoa não altera nada (o silêncio de antes)", async () => {
  const ev = await pericia(outra, quarta(14));
  const sb = await clienteComo(contaDoCanario("assistente"), ESC);
  const upd = await sb
    .from("agenda_eventos")
    .update({ concluido_em: new Date().toISOString() })
    .eq("id", ev.id)
    .select("id");
  expect(upd.error).toBeNull();
  expect(upd.data).toHaveLength(0);
});

test("responder o comparecimento da SUA tarefa encerra a perícia, mesmo no nome de outra pessoa", async () => {
  const ev = await pericia(outra, quarta(14));
  const minha = await tarefa(assistente, ev.start_at, { confirmar_comparecimento: true });
  const sb = await clienteComo(contaDoCanario("assistente"), ESC);

  const r = await sb.rpc("concluir_pericia_da_tarefa", { p_tarefa_id: minha, p_evento_id: ev.id });
  expect(r.error).toBeNull();
  expect(r.data).toBe(true);
  const { data } = await admin.from("agenda_eventos").select("concluido_em, concluido_por").eq("id", ev.id).single();
  expect(data!.concluido_em).toBeTruthy();
  expect(data!.concluido_por).toBe(assistente);
});

test("mas não pela tarefa de outra pessoa, nem a perícia de outro processo", async () => {
  const ev = await pericia(outra, quarta(21));
  const deOutra = await tarefa(outra, ev.start_at, { confirmar_comparecimento: true });
  const sb = await clienteComo(contaDoCanario("assistente"), ESC);

  const semPermissao = await sb.rpc("concluir_pericia_da_tarefa", { p_tarefa_id: deOutra, p_evento_id: ev.id });
  expect(semPermissao.error?.code).toBe("42501");

  // Perícia sem processo (não é a desta tarefa): recusada, mesmo com a tarefa sendo dele.
  const solta = await admin
    .from("agenda_eventos")
    .insert({
      caso_id: casoId,
      escritorio_id: ESC,
      responsavel_id: outra,
      tipo: "atendimento",
      titulo: `[E2E] Atendimento ${Date.now()}`,
      start_at: quarta(28).toISOString(),
      end_at: new Date(quarta(28).getTime() + 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (solta.error) throw new Error(solta.error.message);
  const minha = await tarefa(assistente, ev.start_at);
  const outroEvento = await sb.rpc("concluir_pericia_da_tarefa", { p_tarefa_id: minha, p_evento_id: solta.data.id });
  expect(outroEvento.error?.code).toBe("P0001");

  const { data } = await admin.from("agenda_eventos").select("concluido_em").in("id", [ev.id, solta.data.id]);
  expect(data!.every((e) => e.concluido_em === null)).toBe(true);
});

test("remarcar a SUA perícia leva junto a tarefa de outra pessoa; a perícia de outra pessoa, não", async () => {
  const minhaPericia = await pericia(assistente, quarta(35));
  const deOutra = await tarefa(outra, minhaPericia.start_at);
  const sb = await clienteComo(contaDoCanario("assistente"), ESC);
  const novoPrazo = new Date(Date.now() + 50 * DIA);
  novoPrazo.setUTCHours(17, 0, 0, 0);
  while (novoPrazo.getUTCDay() !== 4) novoPrazo.setUTCDate(novoPrazo.getUTCDate() + 1);

  const r = await sb.rpc("reancorar_tarefa_do_evento", {
    p_evento_id: minhaPericia.id,
    p_tarefa_id: deOutra,
    p_due_at: novoPrazo.toISOString(),
  });
  expect(r.error).toBeNull();
  const { data: t } = await admin.from("tarefas").select("due_at, metadata, responsavel_id").eq("id", deOutra).single();
  expect(new Date(t!.due_at).toISOString()).toBe(novoPrazo.toISOString());
  expect(t!.metadata.evento_id).toBe(minhaPericia.id);
  expect(new Date(t!.metadata.pericia_em).toISOString()).toBe(new Date(minhaPericia.start_at).toISOString());
  expect(t!.responsavel_id).toBe(outra); // só o prazo e a âncora mudam

  // Perícia no nome de outra pessoa: o assistente não remarca por ela.
  const alheia = await pericia(outra, quarta(42));
  const tarefaDaAlheia = await tarefa(outra, alheia.start_at);
  const negado = await sb.rpc("reancorar_tarefa_do_evento", {
    p_evento_id: alheia.id,
    p_tarefa_id: tarefaDaAlheia,
    p_due_at: novoPrazo.toISOString(),
  });
  expect(negado.error?.code).toBe("42501");

  // Tarefa que acompanha OUTRO compromisso: recusada.
  const presaAOutro = await tarefa(outra, alheia.start_at, { evento_id: alheia.id });
  const errada = await sb.rpc("reancorar_tarefa_do_evento", {
    p_evento_id: minhaPericia.id,
    p_tarefa_id: presaAOutro,
    p_due_at: null,
  });
  expect(errada.error?.code).toBe("P0001");
});

test("parceiro não chama nenhuma das duas", async () => {
  const ev = await pericia(outra, quarta(49));
  const t = await tarefa(outra, ev.start_at);
  const sb = await clienteComo(contaDoCanario("parceiro"), ESC);
  const a = await sb.rpc("concluir_pericia_da_tarefa", { p_tarefa_id: t, p_evento_id: ev.id });
  const b = await sb.rpc("reancorar_tarefa_do_evento", { p_evento_id: ev.id, p_tarefa_id: t, p_due_at: null });
  expect(a.error).not.toBeNull();
  expect(b.error).not.toBeNull();
});

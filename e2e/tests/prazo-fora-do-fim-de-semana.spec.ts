// E2E: prazo não cai em sábado nem domingo — a regra vale na GRAVAÇÃO.
//
// Naira, 27/11/2026: havia prazo caindo no fim de semana por vários caminhos
// (template, botões de etapa, robôs). O gatilho no banco é o lugar único; esta
// prova grava como o sistema (service role), que é por onde entram os robôs —
// se vale aqui, vale para a tela e para as functions.

import { test, expect } from "@playwright/test";
import { adminClient, cleanupE2E, seedClienteCaso, seedSolicitacao } from "../supabase-admin";
import { diaDoInstanteBR } from "../datas";

const admin = adminClient();
let casoId: string;

/** Sábado e domingo de daqui a ~3 semanas, 09:00 de Brasília, e a sexta deles. */
function fimDeSemanaFuturo() {
  const d = new Date(Date.now() + 21 * 86400_000);
  d.setUTCHours(12, 0, 0, 0); // 09:00 BRT
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  const sabado = new Date(d);
  const domingo = new Date(d.getTime() + 86400_000);
  const sexta = new Date(d.getTime() - 86400_000);
  return { sabado, domingo, sexta };
}

test.beforeAll(async () => {
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Prazo fds ${Date.now()}` }));
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

async function criar(titulo: string, extra: Record<string, unknown>) {
  const { data, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      tipo: "interna",
      status: "a_fazer",
      prioridade: 2,
      origem: "manual",
      titulo: `[E2E] ${titulo} ${Date.now()}`,
      ...extra,
    })
    .select("id, due_at")
    .single();
  if (error) throw new Error(`${titulo}: ${error.message}`);
  return data as { id: string; due_at: string };
}

test("tarefa criada com prazo no sábado ou no domingo fica na sexta, no mesmo horário", async () => {
  const { sabado, domingo, sexta } = fimDeSemanaFuturo();
  const a = await criar("sábado", { due_at: sabado.toISOString() });
  const b = await criar("domingo", { due_at: domingo.toISOString() });
  expect(new Date(a.due_at).toISOString()).toBe(sexta.toISOString());
  expect(new Date(b.due_at).toISOString()).toBe(sexta.toISOString());
});

test("trocar o prazo para um domingo também recua; dia útil não muda", async () => {
  const { domingo, sexta } = fimDeSemanaFuturo();
  const quarta = new Date(sexta.getTime() - 2 * 86400_000);
  const t = await criar("dia útil", { due_at: quarta.toISOString() });
  expect(new Date(t.due_at).toISOString()).toBe(quarta.toISOString());

  const { data, error } = await admin
    .from("tarefas")
    .update({ due_at: domingo.toISOString() })
    .eq("id", t.id)
    .select("due_at")
    .single();
  if (error) throw error;
  expect(new Date(data.due_at).toISOString()).toBe(sexta.toISOString());
});

test("perícia (data do compromisso) e tarefa já feita ficam como estão", async () => {
  const { sabado } = fimDeSemanaFuturo();
  const pericia = await criar("perícia no sábado", { tipo: "pericia", due_at: sabado.toISOString() });
  const feita = await criar("feita", {
    status: "feito",
    completed_at: new Date().toISOString(),
    due_at: sabado.toISOString(),
  });
  expect(new Date(pericia.due_at).toISOString()).toBe(sabado.toISOString());
  expect(new Date(feita.due_at).toISOString()).toBe(sabado.toISOString());
});

test("prazo do parceiro num pedido de documento também sai do fim de semana", async () => {
  const { sabado, sexta } = fimDeSemanaFuturo();
  const id = await seedSolicitacao(admin, casoId, "comprovante_residencia", {
    prazoAt: sabado.toISOString(),
  });
  const { data, error } = await admin
    .from("solicitacoes_documento")
    .select("prazo_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  expect(diaDoInstanteBR(data.prazo_at)).toBe(diaDoInstanteBR(sexta.toISOString()));
});

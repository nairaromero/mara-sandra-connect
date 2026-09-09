// E2E: nenhuma tarefa nasce sem responsável (pedido da Naira, 2026-09-09).
//
// O sintoma que ela viu: parceiro sobe documento pela aba do parceiro e a
// tarefa "Analisar documentos juntados pelo parceiro" caía no balde
// "Sem responsável" — sumia de "Minhas tarefas" de todo mundo. Eram 9 assim
// em produção, todas de gatilho automático.
//
// A rede é o trigger trg_tarefas_set_responsavel (BEFORE INSERT em tarefas),
// que resolve pela escada de public.responsavel_tarefa_caso:
//   quem pediu o documento -> dono do caso -> dono de fato -> padrão.
// Estes testes batem na escada pelo banco, que é onde ela mora — o caminho
// de UI do parceiro já é coberto por parceiro-cumprir-solicitacao.spec.ts.

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

const admin = adminClient();

let parceiroId: string;
let internoId: string;
let outroInternoId: string;

test.beforeAll(async () => {
  const { data: parceira } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceira) throw new Error(`parceiro de teste não encontrado: ${ENV.parceiroEmail}`);
  parceiroId = parceira.id;

  const { data: internos } = await admin
    .from("usuarios")
    .select("id, email")
    .eq("tipo", "interno")
    .eq("ativo", true)
    .order("email", { ascending: true });
  if (!internos || internos.length < 2) {
    throw new Error("precisa de ao menos 2 internos ativos pra testar a escada");
  }
  internoId = internos[0].id;
  outroInternoId = internos[1].id;
});

// Caso recém-criado com parceiro já nasce com a tarefa "Cliente novo -
// Analisar", e _documento_parceiro_cria_tarefa suprime a tarefa de documentos
// por 10 minutos pra não duplicar. O cenário da Naira é o parceiro subindo
// documento num caso que JÁ existe — então limpamos a tarefa de abertura.
async function limparTarefaDeAbertura(casoId: string): Promise<void> {
  const { error } = await admin.from("tarefas").delete().eq("caso_id", casoId);
  if (error) throw new Error(`limpar tarefa de abertura: ${error.message}`);
}

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("documento do parceiro gera tarefa COM dono (o do caso)", async () => {
  const sufixo = `Dono do caso ${Date.now()}`;
  const { casoId } = await seedClienteCaso(admin, { sufixo, parceiroId });

  // Dono explícito do caso — degrau 2 da escada.
  const { error: errDono } = await admin
    .from("casos")
    .update({ responsavel_id: internoId })
    .eq("id", casoId);
  expect(errDono, "definir dono do caso").toBeNull();
  await limparTarefaDeAbertura(casoId);

  // Upload do parceiro: é isto que dispara _documento_parceiro_cria_tarefa.
  const { error: errDoc } = await admin.from("documentos").insert({
    caso_id: casoId,
    tipo: "outro",
    nome_arquivo: "[E2E] anexo-do-parceiro.pdf",
    storage_path: `e2e/${casoId}/anexo.pdf`,
    uploaded_by: parceiroId,
  });
  expect(errDoc, "inserir documento do parceiro").toBeNull();

  const { data: tarefa } = await admin
    .from("tarefas")
    .select("id, titulo, responsavel_id")
    .eq("caso_id", casoId)
    .eq("metadata->>analise_documento_parceiro", "true")
    .maybeSingle();

  expect(tarefa, "tarefa de análise criada pelo trigger").toBeTruthy();
  expect(tarefa!.titulo).toContain("Analisar documentos juntados pelo parceiro");
  // O que quebrou antes: isto vinha null.
  expect(tarefa!.responsavel_id, "tarefa não pode nascer órfã").toBe(internoId);
});

test("caso sem dono nenhum cai no padrão do escritório, não em null", async () => {
  const sufixo = `Sem dono ${Date.now()}`;
  const { casoId } = await seedClienteCaso(admin, { sufixo, parceiroId });
  await limparTarefaDeAbertura(casoId);

  const { error } = await admin.from("documentos").insert({
    caso_id: casoId,
    tipo: "outro",
    nome_arquivo: "[E2E] sem-dono.pdf",
    storage_path: `e2e/${casoId}/sem-dono.pdf`,
    uploaded_by: parceiroId,
  });
  expect(error, "inserir documento do parceiro").toBeNull();

  const { data: tarefa } = await admin
    .from("tarefas")
    .select("responsavel_id")
    .eq("caso_id", casoId)
    .eq("metadata->>analise_documento_parceiro", "true")
    .maybeSingle();

  expect(tarefa, "tarefa de análise criada").toBeTruthy();
  expect(tarefa!.responsavel_id, "sem dono no caso, o padrão assume").not.toBeNull();

  const { data: dono } = await admin
    .from("usuarios")
    .select("tipo, ativo")
    .eq("id", tarefa!.responsavel_id)
    .single();
  expect(dono!.tipo, "dono precisa ser da equipe interna").toBe("interno");
  expect(dono!.ativo, "dono precisa estar ativo").toBe(true);
});

test("responsável escolhido na mão não é sobrescrito pela rede", async () => {
  const sufixo = `Escolha manual ${Date.now()}`;
  const { casoId } = await seedClienteCaso(admin, { sufixo, parceiroId });

  // Dono do caso é um; a tarefa é criada explicitamente pra outro.
  await admin.from("casos").update({ responsavel_id: internoId }).eq("id", casoId);

  const { data: tarefa, error } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      tipo: "interna",
      status: "a_fazer",
      prioridade: 2,
      titulo: "[E2E] tarefa com dono escolhido",
      responsavel_id: outroInternoId,
    })
    .select("responsavel_id")
    .single();

  expect(error, "criar tarefa com responsável explícito").toBeNull();
  expect(tarefa!.responsavel_id, "escolha explícita manda").toBe(outroInternoId);
});

// A RLS de casos deixa o parceiro dar UPDATE no próprio caso, e responsavel_id
// roteia trabalho da equipe — trg_casos_parceiro_guard reverte a coluna.
async function clienteComoParceiro(): Promise<SupabaseClient> {
  const c = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: ENV.parceiroEmail,
    password: ENV.parceiroPassword,
  });
  if (error) throw new Error(`login do parceiro no teste do guard: ${error.message}`);
  return c;
}

test("parceiro não redefine o dono do caso via API (guard)", async () => {
  test.skip(!ENV.parceiroPassword, "sem senha do parceiro (alvo != staging)");
  const sufixo = `Guard dono ${Date.now()}`;
  const { casoId } = await seedClienteCaso(admin, { sufixo, parceiroId });
  await admin.from("casos").update({ responsavel_id: internoId }).eq("id", casoId);

  const asParceiro = await clienteComoParceiro();
  await asParceiro.from("casos").update({ responsavel_id: outroInternoId }).eq("id", casoId);

  const { data: depois } = await admin
    .from("casos")
    .select("responsavel_id")
    .eq("id", casoId)
    .single();
  expect(depois!.responsavel_id, "parceiro não muda o dono do caso").toBe(internoId);
});

// E2E (banco): as duas travas que a Naira pediu antes de subir o lote #357.
//
// 1. "Perícia e audiência sempre têm processo" não pode valer só na tela:
//    qualquer caminho que grave o evento (importação, script, ferramenta de
//    IA futura) passa pelo gatilho `_agenda_evento_frente_unica`, que completa
//    a frente quando a resposta é ÚNICA e deixa nulo quando é ambígua —
//    inventar frente seria pior.
//
// 2. O dono escolhido no pedido ("quem cuida quando o documento voltar") vale
//    para as tarefas que os gatilhos criam, e NÃO vaza pela escada
//    (`_tarefas_set_responsavel`) para qualquer outra tarefa que carregue
//    `origem_solicitacao_documento_id` no metadata.
//
// Tudo pelo banco: é onde as regras moram.

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

const admin = adminClient();

let parceiroId: string;
let internoEscolhido: string;
let internoQuePediu: string;

function numero(prefixo: string): string {
  return `${prefixo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function criarProcessoAdmin(casoId: string): Promise<string> {
  const { data, error } = await admin
    .from("processos_admin")
    .insert({ caso_id: casoId, numero_requerimento: numero("E2E-REQ") })
    .select("id")
    .single();
  if (error) throw new Error(`seed requerimento: ${error.message}`);
  return data.id as string;
}

async function criarProcessoJudicial(casoId: string): Promise<string> {
  const { data, error } = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: numero("E2E-JUD") })
    .select("id")
    .single();
  if (error) throw new Error(`seed processo judicial: ${error.message}`);
  return data.id as string;
}

async function criarEvento(casoId: string, tipo: "pericia" | "audiencia" | "reuniao") {
  const start = new Date(Date.now() + 7 * 86400_000).toISOString();
  const { data, error } = await admin
    .from("agenda_eventos")
    .insert({
      caso_id: casoId,
      tipo,
      titulo: `[E2E] ${tipo}`,
      start_at: start,
      end_at: start,
    })
    .select("id, processo_admin_id, processo_judicial_id")
    .single();
  if (error) throw new Error(`seed evento ${tipo}: ${error.message}`);
  return data;
}

async function clienteComoParceiro(): Promise<SupabaseClient> {
  const c = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: ENV.parceiroEmail,
    password: ENV.parceiroPassword,
  });
  if (error) throw new Error(`login do parceiro: ${error.message}`);
  return c;
}

test.beforeAll(async () => {
  const { data: parceiro } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (!parceiro) throw new Error(`parceiro de teste não encontrado: ${ENV.parceiroEmail}`);
  parceiroId = parceiro.id as string;

  const { data: internos } = await admin
    .from("usuarios")
    .select("id")
    .eq("tipo", "interno")
    .eq("ativo", true)
    .order("email");
  if (!internos || internos.length < 2) throw new Error("preciso de 2 internos ativos");
  internoEscolhido = internos[0].id as string;
  internoQuePediu = internos[1].id as string;
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("perícia em caso de uma frente nasce com a frente, mesmo sem passar pela tela", async () => {
  const { casoId } = await seedClienteCaso(admin, { sufixo: `Frente única ${Date.now()}` });
  const requerimento = await criarProcessoAdmin(casoId);

  const evento = await criarEvento(casoId, "pericia");
  expect(evento.processo_admin_id).toBe(requerimento);
  expect(evento.processo_judicial_id).toBeNull();
});

test("perícia em caso de duas frentes fica sem frente — ninguém inventa", async () => {
  const { casoId } = await seedClienteCaso(admin, { sufixo: `Duas frentes ${Date.now()}` });
  await criarProcessoAdmin(casoId);
  const judicial = await criarProcessoJudicial(casoId);

  const pericia = await criarEvento(casoId, "pericia");
  expect(pericia.processo_admin_id).toBeNull();
  expect(pericia.processo_judicial_id).toBeNull();

  // Audiência corre no judiciário: com um processo judicial só, é esse.
  const audiencia = await criarEvento(casoId, "audiencia");
  expect(audiencia.processo_judicial_id).toBe(judicial);
});

test("reunião não é tocada pelo gatilho de frente", async () => {
  const { casoId } = await seedClienteCaso(admin, { sufixo: `Reunião ${Date.now()}` });
  await criarProcessoAdmin(casoId);

  const reuniao = await criarEvento(casoId, "reuniao");
  expect(reuniao.processo_admin_id).toBeNull();
  expect(reuniao.processo_judicial_id).toBeNull();
});

test("dono escolhido no pedido vale na tarefa da exigência e não vaza pela escada", async () => {
  test.skip(!ENV.parceiroPassword, "sem senha do parceiro (alvo != staging/local)");
  const { casoId } = await seedClienteCaso(admin, {
    sufixo: `Dono do pedido ${Date.now()}`,
    parceiroId,
  });
  const requerimento = await criarProcessoAdmin(casoId);

  const { data: solic, error } = await admin
    .from("solicitacoes_documento")
    .insert({
      caso_id: casoId,
      tipo: "outro",
      descricao: "[E2E] exigência do INSS",
      status: "pendente",
      origem: "template:exigencia",
      solicitado_por: internoQuePediu,
      responsavel_id: internoEscolhido,
      processo_admin_id: requerimento,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed exigência: ${error.message}`);
  const solicId = solic.id as string;

  // O parceiro cumpre (o gatilho da exigência só roda nessa transição).
  const comoParceiro = await clienteComoParceiro();
  const cumprir = await comoParceiro
    .from("solicitacoes_documento")
    .update({ status: "atendido", data_atendimento: new Date().toISOString() })
    .eq("id", solicId);
  expect(cumprir.error, "parceiro deveria conseguir cumprir").toBeFalsy();

  // A tarefa de cumprir a exigência nasce no nome escolhido, na frente certa.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("tarefas")
          .select("titulo, responsavel_id, processo_admin_id")
          .eq("caso_id", casoId)
          .ilike("titulo", "Cumprir Exigência%")
          .maybeSingle();
        return data;
      },
      { timeout: 15_000 },
    )
    .toMatchObject({ responsavel_id: internoEscolhido, processo_admin_id: requerimento });

  // Tarefa que só CARREGA a marca do pedido segue a escada de sempre: quem
  // pediu o documento, não o dono escolhido.
  const { data: generica, error: erroGenerica } = await admin
    .from("tarefas")
    .insert({
      caso_id: casoId,
      tipo: "interna",
      status: "a_fazer",
      prioridade: 2,
      titulo: "[E2E] tarefa genérica com a marca do pedido",
      origem: "manual",
      metadata: { origem_solicitacao_documento_id: solicId },
    })
    .select("responsavel_id")
    .single();
  expect(erroGenerica, "erro ao criar a tarefa genérica").toBeFalsy();
  // O que importa é o vazamento: a escolha do pedido NÃO pode alcançar esta
  // tarefa. Quem a escada escolhe no lugar varia por banco — no staging ela é
  // uma versão multi-tenant (achado 2 da revisão do Yuri) —, então a asserção
  // é sobre o que não pode acontecer.
  expect(generica!.responsavel_id).not.toBe(internoEscolhido);
  expect(generica!.responsavel_id, "tarefa não pode nascer órfã").toBeTruthy();
});

test("pedido não aceita processo de outro caso", async () => {
  const a = await seedClienteCaso(admin, { sufixo: `Frente do caso A ${Date.now()}` });
  const b = await seedClienteCaso(admin, { sufixo: `Frente do caso B ${Date.now()}` });
  const processoDeB = await criarProcessoAdmin(b.casoId);

  const { error } = await admin.from("solicitacoes_documento").insert({
    caso_id: a.casoId,
    tipo: "cnis",
    status: "pendente",
    origem: "externa",
    processo_admin_id: processoDeB,
  });
  expect(error, "pedido do caso A não pode apontar pro processo do caso B").toBeTruthy();
});

test("parceiro não troca a frente do pedido ao cumprir", async () => {
  test.skip(!ENV.parceiroPassword, "sem senha do parceiro (alvo != staging/local)");
  const { casoId } = await seedClienteCaso(admin, {
    sufixo: `Guard de frente ${Date.now()}`,
    parceiroId,
  });
  const requerimento = await criarProcessoAdmin(casoId);
  const judicial = await criarProcessoJudicial(casoId);

  const { data: solic, error } = await admin
    .from("solicitacoes_documento")
    .insert({
      caso_id: casoId,
      tipo: "cnis",
      descricao: "[E2E] pedido com frente",
      status: "pendente",
      origem: "externa",
      processo_admin_id: requerimento,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed pedido: ${error.message}`);

  // No MESMO update em que cumpre, o parceiro tenta mudar a frente.
  const comoParceiro = await clienteComoParceiro();
  const cumprir = await comoParceiro
    .from("solicitacoes_documento")
    .update({
      status: "atendido",
      data_atendimento: new Date().toISOString(),
      processo_admin_id: null,
      processo_judicial_id: judicial,
    })
    .eq("id", solic.id as string);
  expect(cumprir.error, "cumprir legítimo não deveria falhar").toBeFalsy();

  const { data: depois } = await admin
    .from("solicitacoes_documento")
    .select("status, processo_admin_id, processo_judicial_id")
    .eq("id", solic.id as string)
    .single();
  expect(depois!.status).toBe("atendido");
  expect(depois!.processo_admin_id).toBe(requerimento);
  expect(depois!.processo_judicial_id).toBeNull();
});

test("caso finalizado: tarefa de robô não reabre; pedido de gente reabre", async () => {
  const { casoId } = await seedClienteCaso(admin, { sufixo: `Reabrir ${Date.now()}` });
  const { error: erroProc } = await admin
    .from("processos_admin")
    .insert({
      caso_id: casoId,
      numero_requerimento: numero("E2E-REQ"),
      data_protocolo: new Date().toISOString(),
    });
  if (erroProc) throw new Error(`seed requerimento: ${erroProc.message}`);
  await admin.from("casos").update({ fase: "finalizado" }).eq("id", casoId);

  const robo = await admin.from("tarefas").insert({
    caso_id: casoId,
    tipo: "interna",
    status: "a_fazer",
    prioridade: 2,
    titulo: "[E2E] triagem automática",
    origem: "sync_djen",
  });
  expect(robo.error).toBeFalsy();
  const { data: aindaFinalizado } = await admin
    .from("casos")
    .select("fase")
    .eq("id", casoId)
    .single();
  expect(aindaFinalizado!.fase, "robô não reabre caso encerrado").toBe("finalizado");

  const manual = await admin.from("tarefas").insert({
    caso_id: casoId,
    tipo: "interna",
    status: "a_fazer",
    prioridade: 2,
    titulo: "[E2E] pedido de gente",
    origem: "manual",
  });
  expect(manual.error).toBeFalsy();
  await expect
    .poll(
      async () => {
        const { data } = await admin.from("casos").select("fase").eq("id", casoId).single();
        return data?.fase;
      },
      { timeout: 10_000 },
    )
    .toBe("admin");
});

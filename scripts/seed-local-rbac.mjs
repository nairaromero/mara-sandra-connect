#!/usr/bin/env node
// Seed do ambiente LOCAL para testar o RBAC multi-tenant.
//
//   bun run local:copiar            # banco local = cópia do staging
//   (aplicar as migration_rbac_0*.sql com msc-sql --local)
//   node scripts/seed-local-rbac.mjs
//
// Cria, pelos MESMOS caminhos que a interface usa (RPCs com a sessão de cada
// papel — nada de gravar por baixo do pano onde dá para evitar):
//
//   * QG da plataforma: dois donos (eliminar escritório exige segunda pessoa) e
//     uma conta de suporte. Staff NÃO é membro de escritório nenhum;
//   * escritório 2, "Canário Advocacia", criado pelo QG (qg_criar_escritorio),
//     com uma conta por papel e dados FICTÍCIOS gravados pela própria equipe
//     do canário — então a herança de escritorio_id e a RLS já são exercitadas;
//   * no escritório 1: uma conta de assistente e uma de financeiro (os papéis
//     novos), e uma pessoa com vínculo nos DOIS escritórios (o seletor).
//
// Senha de todas: STAGING_SYNTH_PASSWORD (.env.local). Idempotente.
// Só roda no banco LOCAL.

import { execSync } from "node:child_process";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const st = JSON.parse(execSync("bunx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString());
const API = st.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API)) {
  console.error(`alvo não é o Supabase local: ${API}`);
  process.exit(1);
}
const SENHA = fs.readFileSync(".env.local", "utf8").match(/^STAGING_SYNTH_PASSWORD=(.*)$/m)?.[1]?.replace(/^"|"$/g, "").trim();
if (!SENHA) {
  console.error("STAGING_SYNTH_PASSWORD ausente no .env.local");
  process.exit(1);
}

const admin = createClient(API, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const DOM = "marasandraconnect.com";

const CONTAS = {
  qgDono:       { email: `qg+dono@${DOM}`,            nome: "QG · Dona da Plataforma" },
  qgDono2:      { email: `qg+dono2@${DOM}`,           nome: "QG · Segundo Dono" },
  qgSuporte:    { email: `qg+suporte@${DOM}`,         nome: "QG · Suporte" },
  cAdmin:       { email: `canario+admin@${DOM}`,      nome: "Carla Nogueira (admin do Canário)" },
  cAdvogado:    { email: `canario+advogado@${DOM}`,   nome: "Diego Prado (advogado do Canário)" },
  cAssistente:  { email: `canario+assistente@${DOM}`, nome: "Elisa Rocha (assistente do Canário)" },
  cFinanceiro:  { email: `canario+financeiro@${DOM}`, nome: "Fábio Lins (financeiro do Canário)" },
  cParceiro:    { email: `canario+parceiro@${DOM}`,   nome: "Gilda Moura (parceira do Canário)" },
  m1Assistente: { email: `rbac+assistente@${DOM}`,    nome: "[RBAC] Assistente (escritório 1)" },
  m1Financeiro: { email: `rbac+financeiro@${DOM}`,    nome: "[RBAC] Financeiro (escritório 1)" },
  duplo:        { email: `rbac+duplo@${DOM}`,         nome: "[RBAC] Parceira nos dois escritórios" },
};

const log = (...a) => console.log("  ·", ...a);
const falha = (oque, err) => {
  if (err) throw new Error(`${oque}: ${err.message ?? JSON.stringify(err)}`);
};

async function authPorEmail() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  falha("listUsers", error);
  return new Map(data.users.map((u) => [u.email?.toLowerCase(), u]));
}

/** Conta no Auth + linha em usuarios. `escritorioOrigem` decide onde o vínculo nasce. */
async function garantirConta(conta, { tipo, escritorioOrigem, existentes }) {
  let u = existentes.get(conta.email);
  if (!u) {
    const { data, error } = await admin.auth.admin.createUser({
      email: conta.email, password: SENHA, email_confirm: true, user_metadata: { nome: conta.nome },
    });
    falha(`createUser ${conta.email}`, error);
    u = data.user;
  } else {
    const { error } = await admin.auth.admin.updateUserById(u.id, { password: SENHA, email_confirm: true, ban_duration: "none" });
    falha(`updateUser ${conta.email}`, error);
  }
  const agora = new Date().toISOString();
  const { data: ja } = await admin.from("usuarios").select("id").eq("id", u.id).maybeSingle();
  if (!ja) {
    const { error } = await admin.from("usuarios").insert({
      id: u.id, email: conta.email, nome: conta.nome, tipo, ativo: true,
      eh_parceiro: tipo === "parceiro", onboarded_em: agora, aceitou_termos_em: agora,
      termos_versao: TERMOS, senha_definida_em: agora, escritorio_origem_id: escritorioOrigem ?? null,
    });
    falha(`usuarios ${conta.email}`, error);
  }
  conta.id = u.id;
  return u.id;
}

async function sessaoDe(conta, escritorioId) {
  const sb = createClient(API, st.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: escritorioId ? { headers: { "x-escritorio-id": escritorioId } } : {},
  });
  const { error } = await sb.auth.signInWithPassword({ email: conta.email, password: SENHA });
  falha(`login ${conta.email}`, error);
  return sb;
}

const TERMOS = /TERMOS_VERSAO = "([^"]+)"/.exec(fs.readFileSync("src/lib/legal/termos.ts", "utf8"))?.[1] ?? null;

function cpfValido(semente) {
  const n = String(semente).padStart(9, "0").slice(-9).split("").map(Number);
  const dv = (b) => { const r = (b.reduce((a, d, i) => a + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

// ---------------------------------------------------------------------------
console.log(`seed RBAC — alvo: ${API}`);
const existentes = await authPorEmail();

// 0. Configuração local do QG: sem MFA obrigatório e sem carência (para dar
//    para testar a eliminação). Em produção: qg_exigir_aal2=true e 30 dias.
for (const [chave, valor] of [["qg_exigir_aal2", "false"], ["qg_carencia_dias", "0"]]) {
  falha("app_config", (await admin.from("app_config").upsert({ chave, valor }, { onConflict: "chave" })).error);
}

const { data: esc1, error: e1 } = await admin.from("escritorios").select("id, nome").eq("padrao_sistema", true).single();
falha("escritório 1", e1);
log(`escritório 1: ${esc1.nome}`);

// 1. Staff do QG — conta sem vínculo com escritório nenhum.
for (const [conta, papel] of [[CONTAS.qgDono, "dono"], [CONTAS.qgDono2, "dono"], [CONTAS.qgSuporte, "suporte"]]) {
  await garantirConta(conta, { tipo: "interno", existentes });
  // usuarios → membros sincroniza sozinho (código antigo); staff não é membro.
  falha("tirar vínculo do staff", (await admin.from("membros").delete().eq("usuario_id", conta.id)).error);
  falha("staff", (await admin.from("plataforma_staff").upsert(
    { usuario_id: conta.id, papel, ativo: true, break_glass: papel === "dono" }, { onConflict: "usuario_id" })).error);
}
log("QG: 2 donos + 1 suporte");

// 2. Escritório canário, criado PELO QG.
const qg = await sessaoDe(CONTAS.qgDono);
let { data: canario } = await admin.from("escritorios").select("id, status").eq("slug", "canario").maybeSingle();
if (!canario) {
  const r = await qg.rpc("qg_criar_escritorio", { p_nome: "Canário Advocacia", p_slug: "canario", p_cnpj: "12.345.678/0001-90", p_plano: "padrao" });
  falha("qg_criar_escritorio", r.error);
  canario = { id: r.data, status: "provisionando" };
  log("Canário Advocacia criado pelo QG (provisionando)");
}
const ESC2 = canario.id;

await garantirConta(CONTAS.cAdmin, { tipo: "interno", escritorioOrigem: ESC2, existentes });
falha("qg_vincular_primeiro_admin", (await qg.rpc("qg_vincular_primeiro_admin", { p_escritorio_id: ESC2, p_usuario_id: CONTAS.cAdmin.id })).error);
log("primeiro admin vinculado → escritório ativo");

// 3. Equipe do canário: contas nascem no canário; papéis novos pelo admin dele.
await garantirConta(CONTAS.cAdvogado,   { tipo: "interno",  escritorioOrigem: ESC2, existentes });
await garantirConta(CONTAS.cAssistente, { tipo: "interno",  escritorioOrigem: ESC2, existentes });
await garantirConta(CONTAS.cFinanceiro, { tipo: "interno",  escritorioOrigem: ESC2, existentes });
await garantirConta(CONTAS.cParceiro,   { tipo: "parceiro", escritorioOrigem: ESC2, existentes });
const comoCAdmin = await sessaoDe(CONTAS.cAdmin, ESC2);
falha("papel assistente", (await comoCAdmin.rpc("definir_papel", { p_usuario_id: CONTAS.cAssistente.id, p_papel: "assistente" })).error);
falha("papel financeiro", (await comoCAdmin.rpc("definir_papel", { p_usuario_id: CONTAS.cFinanceiro.id, p_papel: "financeiro" })).error);
log("canário: admin, advogado, assistente, financeiro e parceira");

// 4. Escritório 1: papéis novos + a pessoa dos dois escritórios.
await garantirConta(CONTAS.m1Assistente, { tipo: "interno",  escritorioOrigem: esc1.id, existentes });
await garantirConta(CONTAS.m1Financeiro, { tipo: "interno",  escritorioOrigem: esc1.id, existentes });
await garantirConta(CONTAS.duplo,        { tipo: "parceiro", escritorioOrigem: esc1.id, existentes });
const admin1 = { email: `e2e+admin@${DOM}` };
const comoAdmin1 = await sessaoDe(admin1, esc1.id);
falha("papel assistente (1)", (await comoAdmin1.rpc("definir_papel", { p_usuario_id: CONTAS.m1Assistente.id, p_papel: "assistente" })).error);
falha("papel financeiro (1)", (await comoAdmin1.rpc("definir_papel", { p_usuario_id: CONTAS.m1Financeiro.id, p_papel: "financeiro" })).error);
falha("vincular duplo no canário", (await comoCAdmin.rpc("vincular_pessoa", { p_email: CONTAS.duplo.email, p_papel: "parceiro" })).error);
log("escritório 1: assistente e financeiro; rbac+duplo é parceira nos dois");

// 5. Dados fictícios do canário, gravados PELA EQUIPE DO CANÁRIO (RLS + herança).
const comoCAdv = await sessaoDe(CONTAS.cAdvogado, ESC2);
const { count: jaTem } = await admin.from("clientes").select("id", { count: "exact", head: true }).eq("escritorio_id", ESC2);
if (!jaTem) {
  const CLIENTES = [
    { nome: "Helena Bastos Ferraz",   beneficio: "Aposentadoria por idade",  parceiro: CONTAS.cParceiro.id, fase: "analise" },
    { nome: "Ivo Tavares Queiroz",    beneficio: "Auxílio-doença",           parceiro: CONTAS.cParceiro.id, fase: "admin" },
    { nome: "Joana Reis Camargo",     beneficio: "Pensão por morte",         parceiro: null,               fase: "judicial" },
    { nome: "Kleber Antunes Siqueira", beneficio: "BPC/LOAS",                parceiro: CONTAS.duplo.id,    fase: "analise" },
  ];
  let i = 0;
  for (const c of CLIENTES) {
    i++;
    const cli = await comoCAdv.from("clientes").insert({ nome: c.nome, cpf: cpfValido(770000000 + i) }).select("id, escritorio_id").single();
    falha(`cliente ${c.nome}`, cli.error);
    if (cli.data.escritorio_id !== ESC2) throw new Error("cliente do canário nasceu em outro escritório");
    const caso = await comoCAdv.from("casos").insert({
      cliente_id: cli.data.id, tipo_beneficio: c.beneficio, fase: c.fase, parceiro_id: c.parceiro,
      responsavel_id: CONTAS.cAdvogado.id,
    }).select("id, escritorio_id").single();
    falha(`caso ${c.nome}`, caso.error);
    const casoId = caso.data.id;

    falha("andamento interno", (await comoCAdv.from("andamentos").insert({
      caso_id: casoId, origem: "interno", titulo: "Análise inicial do caso",
      descricao: "Documentação conferida; estratégia definida com a equipe.", visivel_parceiro: false, data_evento: new Date().toISOString(),
    })).error);
    falha("andamento visível", (await comoCAdv.from("andamentos").insert({
      caso_id: casoId, origem: "interno", titulo: "Caso recebido pelo escritório",
      descricao: "Recebemos a indicação e iniciamos a análise.", visivel_parceiro: true, data_evento: new Date().toISOString(),
    })).error);
    falha("tarefa", (await comoCAdv.from("tarefas").insert({
      caso_id: casoId, tipo: "interna", status: "a_fazer", titulo: `Montar requerimento — ${c.nome.split(" ")[0]}`,
      origem: "manual", responsavel_id: i % 2 ? CONTAS.cAdvogado.id : CONTAS.cAssistente.id,
      due_at: new Date(Date.now() + i * 86400_000).toISOString(),
    })).error);
    if (c.parceiro) {
      falha("solicitação", (await comoCAdv.from("solicitacoes_documento").insert({
        caso_id: casoId, tipo: "cnis", descricao: "CNIS atualizado do cliente.", status: "pendente",
        origem: "externa", solicitado_por: CONTAS.cAdvogado.id,
        prazo_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      })).error);
    }
  }
  falha("agenda", (await comoCAdv.from("agenda_eventos").insert({
    tipo: "reuniao", titulo: "Reunião de equipe — Canário", start_at: new Date(Date.now() + 2 * 86400_000).toISOString(),
    end_at: new Date(Date.now() + 2 * 86400_000 + 3600_000).toISOString(), responsavel_id: CONTAS.cAdvogado.id,
  })).error);
  falha("etiqueta", (await comoCAdv.from("etiquetas").insert({ nome: "STATUS:ATIVO", cor: "#16a34a" })).error);
  log(`canário: ${CLIENTES.length} clientes/casos, andamentos, tarefas, solicitações, agenda e etiqueta`);
} else {
  log("canário já tinha dados — mantidos");
}

// 5b. Marca do Canário (RBAC 10): logo SVG no bucket público `marcas` + nome/cor.
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="12" fill="#0f766e"/>
  <circle cx="44" cy="40" r="22" fill="#facc15"/>
  <text x="84" y="48" font-family="Georgia, serif" font-size="26" fill="#ffffff">Canário Advocacia</text>
</svg>`;
  const caminho = `${ESC2}/logo.svg`;
  const up = await admin.storage.from("marcas").upload(caminho, new Blob([svg], { type: "image/svg+xml" }), { upsert: true, contentType: "image/svg+xml" });
  falha("logo do canário", up.error);
  const logoUrl = `${API}/storage/v1/object/public/marcas/${caminho}`;
  falha("marca do canário", (await admin.from("escritorio_config").upsert({
    escritorio_id: ESC2,
    marca: { nome_exibicao: "Canário Advocacia", logo_url: logoUrl, cor: "#0f766e" },
    updated_at: new Date().toISOString(),
  }, { onConflict: "escritorio_id" })).error);
  log("canário: marca (logo SVG, nome e cor)");
}

// 6. Relatório
const { data: resumo } = await admin.from("membros")
  .select("status, escritorio:escritorios(nome), papel:papeis(chave), usuario:usuarios!membros_usuario_id_fkey(email)")
  .in("usuario_id", Object.values(CONTAS).map((c) => c.id).filter(Boolean));
console.log("\nVÍNCULOS");
console.table((resumo ?? []).map((m) => ({ email: m.usuario.email, escritorio: m.escritorio.nome, papel: m.papel.chave, status: m.status }))
  .sort((a, b) => (a.escritorio + a.email).localeCompare(b.escritorio + b.email)));
const { data: staff } = await admin.from("plataforma_staff").select("papel, break_glass, usuario:usuarios!plataforma_staff_usuario_id_fkey(email)");
console.log("STAFF DO QG");
console.table((staff ?? []).map((s) => ({ email: s.usuario.email, papel: s.papel, break_glass: s.break_glass })));
console.log(`senha de todas as contas: STAGING_SYNTH_PASSWORD (.env.local)`);

// E2E (revisão de 23/11): o parceiro só lê/grava a senha do Meu INSS do cliente
// com vínculo ATIVO e ACEITE dos termos em dia — não basta ser o parceiro do
// caso. A regra "parceiro sem aceite não recebe dado de cliente" valia só na
// saída de e-mail/WhatsApp e, na tela, por um redirecionamento no navegador; a
// RPC `get_senha_meu_inss` (e tem/set) não conferia. O lote "copiar CPF e
// senha" (#532) transformou isso num clique. Agora o túnel
// `private.parceiro_pode_senha_meu_inss` fecha as três RPCs.
//
// Parceiro, cliente e caso próprios, apagados no fim. Só no local (cria usuário
// de auth; não mexe em conta compartilhada).

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient, cpfValido } from "../supabase-admin";
import { escritorioPadrao, escritorioCanario, clienteComo, contaDoCanario, limpezaLocal } from "../rbac";
import { TERMOS_VERSAO } from "../../supabase/functions/_shared/termos";

const admin = adminClient();
const EMAIL = "e2e+senha-aceite@marasandraconnect.com";
const SENHA_INSS = "MeuINSS!Secreta-123";

let ESC: string;
let PARCEIRO: string | null = null;
let CLIENTE: string | null = null;
let CASO: string | null = null;

/** Sessão do parceiro descartável, com o header do escritório (como o front manda). */
async function comoParceiro(): Promise<SupabaseClient> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-escritorio-id": ESC } },
  });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: ENV.parceiroPassword });
  if (error) throw new Error(`login parceiro: ${error.message}`);
  return sb;
}

async function limpar() {
  if (CASO) await admin.from("casos").delete().eq("id", CASO);
  if (CLIENTE) await admin.from("clientes").delete().eq("id", CLIENTE);
  const { data: u } = await admin.from("usuarios").select("id").eq("email", EMAIL).maybeSingle();
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const id = (u?.id as string | undefined) ?? lista?.users.find((x) => x.email === EMAIL)?.id;
  if (id) {
    await admin.from("usuarios").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

/** Troca o estado de aceite/vínculo do parceiro para o cenário. */
async function estado(campos: Record<string, unknown>) {
  const { error } = await admin.from("usuarios").update(campos).eq("id", PARCEIRO!);
  if (error) throw new Error(`estado do parceiro: ${error.message}`);
}

test.describe.serial("senha do Meu INSS: parceiro só com aceite e vínculo ativo", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "cria usuário de auth — só no banco local");
    ESC = await escritorioPadrao();
    await limpar();
    const { data: au, error: eAu } = await admin.auth.admin.createUser({ email: EMAIL, password: ENV.parceiroPassword, email_confirm: true });
    if (eAu || !au.user) throw new Error(`parceiro descartável: ${eAu?.message}`);
    PARCEIRO = au.user.id;
    const agora = new Date().toISOString();
    const { error: eU } = await admin.from("usuarios").upsert({ id: PARCEIRO, email: EMAIL, nome: "[E2E] Parceiro senha", tipo: "parceiro", eh_parceiro: true, ativo: true, onboarded_em: agora, aceitou_termos_em: agora, termos_versao: TERMOS_VERSAO });
    if (eU) throw new Error(`perfil: ${eU.message}`);
    const { data: cli, error: eC } = await admin.from("clientes").insert({ escritorio_id: ESC, nome: "[E2E] Cliente senha", cpf: cpfValido() }).select("id").single();
    if (eC) throw new Error(`cliente: ${eC.message}`);
    CLIENTE = cli.id;
    const { data: caso, error: eCa } = await admin.from("casos").insert({ escritorio_id: ESC, cliente_id: CLIENTE, parceiro_id: PARCEIRO, fase: "analise", tipo_beneficio: "aposentadoria_idade" }).select("id").single();
    if (eCa) throw new Error(`caso: ${eCa.message}`);
    CASO = caso.id;
  });
  test.afterAll(limpezaLocal(limpar));

  test("parceiro ativo e com aceite grava e lê a senha do cliente do caso dele", async () => {
    const sb = await comoParceiro();
    const gravou = await sb.rpc("set_senha_meu_inss", { p_cliente_id: CLIENTE, p_senha: SENHA_INSS });
    expect(gravou.error, gravou.error?.message).toBeNull();
    const leu = await sb.rpc("get_senha_meu_inss", { p_cliente_id: CLIENTE });
    expect([leu.error, leu.data]).toEqual([null, SENHA_INSS]);
    expect((await sb.rpc("tem_senha_meu_inss", { p_cliente_id: CLIENTE })).data).toBe(true);
  });

  test("sem nenhum aceite (nunca entrou/assinou): a RPC recusa a senha (antes passava)", async () => {
    // O gate exige vínculo ativo + aceite: onboarded e com versão registrada.
    // Limite conhecido: não fixa a versão EXATA (o servidor não tem a versão
    // vigente; só a tela/edge têm, em _shared/termos.ts). Um parceiro uma versão
    // atrás ainda passaria — paridade exata com a trava de e-mail é decisão à parte.
    await estado({ onboarded_em: null, termos_versao: null });
    const sb = await comoParceiro();
    expect((await sb.rpc("get_senha_meu_inss", { p_cliente_id: CLIENTE })).error, "sem aceite não lê").toBeTruthy();
    expect((await sb.rpc("set_senha_meu_inss", { p_cliente_id: CLIENTE, p_senha: "x" })).error, "sem aceite não grava").toBeTruthy();
    expect((await sb.rpc("tem_senha_meu_inss", { p_cliente_id: CLIENTE })).data ?? null).toBeNull();
    await estado({ onboarded_em: new Date().toISOString(), termos_versao: TERMOS_VERSAO });
  });

  test("parceiro desligado (ativo=false): a RPC recusa, mesmo dono do caso", async () => {
    await estado({ ativo: false });
    const sb = await comoParceiro();
    expect((await sb.rpc("get_senha_meu_inss", { p_cliente_id: CLIENTE })).error, "desligado não lê").toBeTruthy();
    await estado({ ativo: true });
    // restaurado: volta a ler
    const sb2 = await comoParceiro();
    expect((await sb2.rpc("get_senha_meu_inss", { p_cliente_id: CLIENTE })).data).toBe(SENHA_INSS);
  });
});

// A LEITURA do interno cobra a mesma régua da escrita (senha_inss:ler). Antes,
// `get_senha_meu_inss`/`tem_senha_meu_inss` davam `tipo = interno` como bastante
// e só o `set` conferia a permissão: a tela escondia a senha de quem não a tem
// (ex.: financeiro), mas a RPC direta entregava a credencial do portal. Usa as
// contas do seed do Canário — financeiro (sem a permissão) × admin (com).
test.describe.serial("senha do Meu INSS: a leitura do interno cobra senha_inss:ler", () => {
  let ESC_C: string;
  let CLI_C: string | null = null;
  let CASO_C: string | null = null;

  test.beforeAll(async () => {
    test.skip(!ENV.local, "usa as contas do seed do Canário — só no banco local");
    ESC_C = await escritorioCanario();
    const { data: cli, error: eC } = await admin.from("clientes").insert({ escritorio_id: ESC_C, nome: "[E2E] Cliente senha interno", cpf: cpfValido() }).select("id").single();
    if (eC) throw new Error(`cliente: ${eC.message}`);
    CLI_C = cli.id;
    const { data: caso, error: eCa } = await admin.from("casos").insert({ escritorio_id: ESC_C, cliente_id: CLI_C, fase: "analise", tipo_beneficio: "aposentadoria_idade" }).select("id").single();
    if (eCa) throw new Error(`caso: ${eCa.message}`);
    CASO_C = caso.id;
    // grava a senha como admin do Canário (tem senha_inss:ler)
    const adm = await clienteComo(contaDoCanario("admin"), ESC_C);
    const g = await adm.rpc("set_senha_meu_inss", { p_cliente_id: CLI_C, p_senha: SENHA_INSS });
    if (g.error) throw new Error(`seed senha (admin): ${g.error.message}`);
  });

  test.afterAll(limpezaLocal(async () => {
    if (CLI_C) await admin.from("acessos_senha_inss").delete().eq("cliente_id", CLI_C);
    if (CASO_C) await admin.from("casos").delete().eq("id", CASO_C);
    if (CLI_C) await admin.from("clientes").delete().eq("id", CLI_C);
  }));

  test("interno SEM senha_inss:ler (financeiro) não lê pela RPC — antes a tela era o único freio", async () => {
    const fin = await clienteComo(contaDoCanario("financeiro"), ESC_C);
    expect((await fin.rpc("get_senha_meu_inss", { p_cliente_id: CLI_C })).error, "financeiro não lê").toBeTruthy();
    expect((await fin.rpc("tem_senha_meu_inss", { p_cliente_id: CLI_C })).data ?? null, "financeiro não vê que existe").toBeNull();
  });

  test("interno COM senha_inss:ler (admin) lê normalmente", async () => {
    const adm = await clienteComo(contaDoCanario("admin"), ESC_C);
    expect((await adm.rpc("get_senha_meu_inss", { p_cliente_id: CLI_C })).data).toBe(SENHA_INSS);
    expect((await adm.rpc("tem_senha_meu_inss", { p_cliente_id: CLI_C })).data).toBe(true);
  });
});

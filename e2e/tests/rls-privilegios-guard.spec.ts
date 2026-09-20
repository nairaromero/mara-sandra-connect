// E2E: guardas de privilégio e de vínculo no BANCO (hotfix de RLS, 2026-09-20).
//
// Tudo aqui é ataque via API com a sessão real do papel — nada de UI. É o
// único jeito de provar o que a tela esconde: as quatro falhas abaixo foram
// achadas lendo o catálogo de produção e reproduzidas no ambiente local.
//
//  1. auto-promoção: parceiro virava interno/admin com um PATCH na própria
//     linha de usuarios (migration_usuarios_guard_privilegios);
//  2. vínculo do caso: parceiro abria (ou repontava) caso para QUALQUER
//     cliente_id e passava a ler aquele cliente e a senha do MEU INSS dele
//     (migration_rls_with_check_e_vinculos);
//  3. caminho do arquivo: documento registrado no próprio caso com o
//     storage_path de outro caso abria o arquivo alheio pela policy do
//     Storage (mesma migration);
//  4. funções SECURITY DEFINER abertas a anon, entre elas a que devolve nome
//     e CPF do cliente de qualquer caso (migration_revoke_execute_anon).
//
// Conta descartável de propósito: spec que mexe em papel nunca usa as contas
// e2e+ compartilhadas — suíte interrompida deixaria a conta compartilhada com
// privilégio trocado (foi o que aconteceu em 14/09).

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../env";
import { adminClient, cleanupE2E, cpfValido, MARCADOR, seedClienteCaso } from "../supabase-admin";

const admin = adminClient();
const EMAIL_DESCARTAVEL = "e2e+guard-privilegios@marasandraconnect.com";
const NOME_DESCARTAVEL = `${MARCADOR} Parceiro guard`;

let parceiroId: string;
let comoParceiro: SupabaseClient;
let clienteAlheioId: string;
let casoAlheioId: string;

async function apagarDescartavel() {
  const { data: perfil } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", EMAIL_DESCARTAVEL)
    .maybeSingle();
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const authUser = lista?.users.find((u) => u.email === EMAIL_DESCARTAVEL);
  const id = (perfil?.id as string | undefined) ?? authUser?.id;
  if (!id) return;
  await admin.from("casos").delete().eq("parceiro_id", id);
  await admin.from("usuarios").delete().eq("id", id);
  await admin.auth.admin.deleteUser(id);
}

test.beforeAll(async () => {
  test.skip(!ENV.parceiroPassword, "sem senha sintética (alvo != staging/local)");
  await apagarDescartavel(); // sobra de run interrompido

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL_DESCARTAVEL,
    password: ENV.parceiroPassword,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`criar parceiro descartável: ${error?.message}`);
  parceiroId = data.user.id;

  const agora = new Date().toISOString();
  const { error: perfilErr } = await admin.from("usuarios").upsert({
    id: parceiroId,
    email: EMAIL_DESCARTAVEL,
    nome: NOME_DESCARTAVEL,
    tipo: "parceiro",
    eh_parceiro: true,
    ativo: true,
    onboarded_em: agora,
    aceitou_termos_em: agora,
  });
  if (perfilErr) throw new Error(`perfil descartável: ${perfilErr.message}`);

  comoParceiro = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await comoParceiro.auth.signInWithPassword({
    email: EMAIL_DESCARTAVEL,
    password: ENV.parceiroPassword,
  });
  if (login.error) throw new Error(`login descartável: ${login.error.message}`);

  // Alvo "de outra pessoa": cliente e caso que o descartável não alcança.
  const alheio = await seedClienteCaso(admin, { sufixo: `guard alheio ${Date.now()}` });
  clienteAlheioId = alheio.clienteId;
  casoAlheioId = alheio.casoId;
});

test.afterAll(async () => {
  await cleanupE2E(admin);
  await apagarDescartavel();
});

test("parceiro não se promove a interno nem a admin", async () => {
  const ataque = await comoParceiro
    .from("usuarios")
    .update({ tipo: "interno", eh_admin: true })
    .eq("id", parceiroId);
  expect(ataque.error, "a promoção tinha que ser recusada").toBeTruthy();

  const { data: depois } = await admin
    .from("usuarios")
    .select("tipo, eh_admin")
    .eq("id", parceiroId)
    .single();
  expect(depois!.tipo).toBe("parceiro");
  expect(depois!.eh_admin).toBeFalsy();

  // O que a tela de Configurações faz continua passando.
  const legitimo = await comoParceiro
    .from("usuarios")
    .update({ nome: NOME_DESCARTAVEL, telefone: "17999990000", oab: "123456" })
    .eq("id", parceiroId);
  expect(legitimo.error, "editar o próprio perfil não pode quebrar").toBeFalsy();
});

test("parceiro não abre caso para cliente alheio, nem reaponta o caso dele", async () => {
  const ataque = await comoParceiro.from("casos").insert({
    cliente_id: clienteAlheioId,
    parceiro_id: parceiroId,
    tipo_beneficio: "Salário-maternidade",
    fase: "analise",
  });
  expect(ataque.error, "caso apontando pra cliente alheio tinha que ser recusado").toBeTruthy();

  // Fluxo legítimo: cliente próprio + caso próprio.
  const cliente = await comoParceiro
    .from("clientes")
    .insert({ nome: `${MARCADOR} Cliente do parceiro guard`, cpf: cpfValido(), created_by: parceiroId })
    .select("id")
    .single();
  expect(cliente.error, "parceiro tem que poder cadastrar o próprio cliente").toBeFalsy();

  const caso = await comoParceiro
    .from("casos")
    .insert({
      cliente_id: cliente.data!.id,
      parceiro_id: parceiroId,
      tipo_beneficio: "Salário-maternidade",
      fase: "analise",
    })
    .select("id")
    .single();
  expect(caso.error, "caso do próprio cliente tem que passar").toBeFalsy();

  // Repontar o caso próprio pro cliente alheio: o guard devolve o valor antigo.
  await comoParceiro.from("casos").update({ cliente_id: clienteAlheioId }).eq("id", caso.data!.id);
  const { data: depois } = await admin
    .from("casos")
    .select("cliente_id")
    .eq("id", caso.data!.id)
    .single();
  expect(depois!.cliente_id).toBe(cliente.data!.id);

  // E o cliente alheio segue invisível pra ele.
  const { data: visiveis } = await comoParceiro
    .from("clientes")
    .select("id")
    .eq("id", clienteAlheioId);
  expect(visiveis ?? []).toHaveLength(0);
});

test("documento do parceiro tem que apontar pro próprio caso", async () => {
  const caso = await admin
    .from("casos")
    .select("id")
    .eq("parceiro_id", parceiroId)
    .limit(1)
    .single();
  const meuCaso = caso.data!.id as string;

  const { data: alheio } = await admin
    .from("documentos")
    .select("storage_path")
    .eq("caso_id", casoAlheioId)
    .limit(1)
    .maybeSingle();
  const pathAlheio = (alheio?.storage_path as string | undefined) ?? `${casoAlheioId}/contrato.pdf`;

  const ataque = await comoParceiro.from("documentos").insert({
    caso_id: meuCaso,
    tipo: "outro",
    nome_arquivo: "alheio.pdf",
    storage_path: pathAlheio,
    visivel_parceiro: true,
  });
  expect(ataque.error, "path de outro caso tinha que ser recusado").toBeTruthy();

  const legitimo = await comoParceiro.from("documentos").insert({
    caso_id: meuCaso,
    tipo: "outro",
    nome_arquivo: "meu.pdf",
    storage_path: `${meuCaso}/meu.pdf`,
    visivel_parceiro: true,
  });
  expect(legitimo.error, "upload no próprio caso não pode quebrar").toBeFalsy();
});

test("anon não executa função SECURITY DEFINER do banco", async () => {
  const anon = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Devolvia nome + CPF do cliente de qualquer caso.
  const ref = await anon.rpc("webhook_cliente_ref", { p_caso_id: casoAlheioId });
  expect(ref.error, "webhook_cliente_ref não pode ser chamável por anon").toBeTruthy();

  // Rotina de cron que dispara e-mail.
  const rotina = await anon.rpc("rotina_diaria_pericia");
  expect(rotina.error, "rotina de cron não pode ser chamável por anon").toBeTruthy();

  // O que NÃO pode mudar: leitura anônima de tabela com RLS continua
  // devolvendo lista vazia, e não erro — os helpers usados dentro das
  // policies seguem executáveis por anon de propósito.
  const casos = await anon.from("casos").select("id").limit(1);
  expect(casos.error, "select anônimo não pode virar erro de permissão").toBeFalsy();
  expect(casos.data ?? []).toHaveLength(0);
});

// E2E: quem é convidado cria senha antes de usar o sistema (#362).
//
// O teste percorre o convite DE VERDADE: `generateLink({ type: "invite" })`
// deixa a conta no mesmo estado do convite enviado pela tela de Equipe (a edge
// convidar-usuario chama inviteUserByEmail; a única diferença aqui é o e-mail
// não sair). Até 2026-09-18 este teste forjava o estado zerando a senha pela
// Management API — estado que o produto nunca produz. Ele passava enquanto o
// convite real levava a pessoa direto pro sistema, sem nunca criar senha.
//
// Cobre os três caminhos que decidem isso:
//   - interno convidado: sem senha não entra, e depois de criar entra sempre;
//   - parceiro convidado: a senha vem ANTES das boas-vindas;
//   - quem já tem senha: entra direto, sem passar pela tela.
//
// Os usuários daqui NAO usam o storageState compartilhado (auth.setup): cada um
// precisa nascer no estado certo, então são criados e destruídos aqui mesmo.

import { test, expect, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";

const SENHA_NOVA = "SenhaE2E!2026";
const CONTAS = {
  interno: "e2e+primeiroacesso@marasandraconnect.com",
  parceiro: "e2e+primeiroacessoparceiro@marasandraconnect.com",
  comSenha: "e2e+jatemsenha@marasandraconnect.com",
};

const admin = adminClient();
const anon = () =>
  createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function apagarSeExistir(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const achado = data?.users.find((u) => u.email === email);
  if (achado) {
    await admin.from("usuarios").delete().eq("id", achado.id);
    await admin.auth.admin.deleteUser(achado.id);
  }
}

/** Perfil como a edge convidar-usuario cria: interno já onboardado, parceiro não. */
async function gravarPerfil(id: string, email: string, tipo: "interno" | "parceiro") {
  const { error } = await admin.from("usuarios").upsert({
    id,
    nome: `[E2E] Primeiro Acesso ${tipo}`,
    email,
    tipo,
    eh_parceiro: tipo === "parceiro",
    ativo: true,
    onboarded_em: tipo === "interno" ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`perfil: ${error.message}`);
}

/** Convida (sem mandar e-mail) e devolve a sessão de quem abriu o link. */
async function convidarEAbrirLink(
  email: string,
  tipo: "interno" | "parceiro",
): Promise<{ userId: string; session: Session }> {
  await apagarSeExistir(email);
  const { data: convite, error: convErr } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
  });
  if (convErr || !convite.user) throw new Error(`convite: ${convErr?.message}`);
  await gravarPerfil(convite.user.id, email, tipo);

  const { data: verif, error: otpErr } = await anon().auth.verifyOtp({
    token_hash: convite.properties!.hashed_token,
    type: "invite",
  });
  if (otpErr || !verif.session) throw new Error(`abrir o convite: ${otpErr?.message}`);
  return { userId: convite.user.id, session: verif.session };
}

/** Injeta a sessão no localStorage, como faz o auth.setup dos outros specs. */
async function entrarComSessao(page: Page, session: Session) {
  await page.goto("/login");
  await page.evaluate(
    ([chave, valor]) => window.localStorage.setItem(chave, valor),
    [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)] as const,
  );
}

/** A marca no banco: nula enquanto a pessoa não criou a própria senha. */
async function senhaDefinidaEm(userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("usuarios")
    .select("senha_definida_em")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`ler senha_definida_em: ${error.message}`);
  return (data as { senha_definida_em: string | null }).senha_definida_em;
}

async function criarSenhaNaTela(page: Page) {
  await expect(page.getByText("Crie sua senha de acesso")).toBeVisible();
  await page.getByLabel("Nova senha").fill(SENHA_NOVA);
  await page.getByLabel("Confirmar senha").fill(SENHA_NOVA);
  await page.getByRole("button", { name: "Salvar senha e entrar" }).click();
}

test.afterAll(async () => {
  for (const email of Object.values(CONTAS)) await apagarSeExistir(email);
});

test("interno convidado só entra depois de criar a senha", async ({ page }) => {
  const { userId, session } = await convidarEAbrirLink(CONTAS.interno, "interno");
  // Abrir o convite faz o Supabase gravar um hash no auth — é esse hash que
  // enganava o sistema. No nosso banco a marca continua nula.
  expect(await senhaDefinidaEm(userId)).toBeNull();

  await entrarComSessao(page, session);

  // Qualquer tela do sistema devolve para a criação de senha.
  await page.goto("/casos");
  await expect(page).toHaveURL(/\/definir-senha/);
  await page.goto("/tarefas");
  await expect(page).toHaveURL(/\/definir-senha/);

  await criarSenhaNaTela(page);

  // Entrou, e não volta mais para a tela de senha.
  await expect(page).toHaveURL(/\/(casos|tarefas)/);
  await page.goto("/casos");
  await expect(page).not.toHaveURL(/\/definir-senha/);
  expect(await senhaDefinidaEm(userId), "o banco não registrou a senha").not.toBeNull();

  // Verificação forte: a senha autentica de verdade.
  const { data: login, error: loginErr } = await anon().auth.signInWithPassword({
    email: CONTAS.interno,
    password: SENHA_NOVA,
  });
  expect(loginErr, `login por senha falhou: ${loginErr?.message}`).toBeNull();
  expect(login.session).toBeTruthy();
});

test("parceiro convidado cria a senha antes das boas-vindas", async ({ page }) => {
  const { userId, session } = await convidarEAbrirLink(CONTAS.parceiro, "parceiro");
  await entrarComSessao(page, session);

  // Parceiro sem onboarding vai para /boas-vindas — mas só depois da senha.
  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/definir-senha/);

  await criarSenhaNaTela(page);

  await expect(page).toHaveURL(/\/boas-vindas/);
  expect(await senhaDefinidaEm(userId)).not.toBeNull();
});

test("quem já tem senha entra direto, sem passar pela tela", async ({ page }) => {
  await apagarSeExistir(CONTAS.comSenha);
  const { data: criado, error } = await admin.auth.admin.createUser({
    email: CONTAS.comSenha,
    password: SENHA_NOVA,
    email_confirm: true,
  });
  if (error) throw new Error(`criar usuario: ${error.message}`);
  await gravarPerfil(criado.user.id, CONTAS.comSenha, "interno");

  const { data: login, error: loginErr } = await anon().auth.signInWithPassword({
    email: CONTAS.comSenha,
    password: SENHA_NOVA,
  });
  if (loginErr || !login.session) throw new Error(`login: ${loginErr?.message}`);

  await entrarComSessao(page, login.session);
  await page.goto("/casos");
  await expect(page).toHaveURL(/\/tarefas/);
  await expect(page).not.toHaveURL(/\/definir-senha/);
});

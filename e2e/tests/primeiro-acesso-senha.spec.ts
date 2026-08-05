// E2E: primeiro acesso obriga a criar senha.
//
// Cobre o fluxo completo de quem recebe convite/magic link e ainda nao tem
// senha: entra -> e desviado pra /definir-senha -> cria a senha -> cai no
// sistema -> na proxima vez entra com e-mail e senha, sem depender do link.
//
// O usuario deste teste NAO passa pelo storageState compartilhado (auth.setup):
// ele precisa nascer sem senha, entao e criado e destruido aqui mesmo.

import { test, expect, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient, zerarSenha } from "../supabase-admin";

const EMAIL = "e2e+primeiroacesso@marasandraconnect.com";
const SENHA_NOVA = "SenhaE2E!2026";

const admin = adminClient();
const anon = () =>
  createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

let userId: string;

async function apagarSeExistir() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const achado = data?.users.find((u) => u.email === EMAIL);
  if (achado) {
    await admin.from("usuarios").delete().eq("id", achado.id);
    await admin.auth.admin.deleteUser(achado.id);
  }
}

test.beforeAll(async () => {
  await apagarSeExistir();

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
  });
  if (error) throw new Error(`criar usuario: ${error.message}`);
  userId = data.user.id;

  const { error: perfilErr } = await admin.from("usuarios").upsert({
    id: userId,
    nome: "[E2E] Primeiro Acesso",
    email: EMAIL,
    tipo: "interno",
    ativo: true,
  });
  if (perfilErr) throw new Error(`perfil: ${perfilErr.message}`);

  // createUser sem `password` ainda grava um hash (de string vazia), o que NAO
  // e o estado de quem foi convidado de verdade — nesse caso encrypted_password
  // fica nulo. Zeramos pra reproduzir o convite fielmente.
  await zerarSenha(userId);
});

test.afterAll(async () => {
  await apagarSeExistir();
});

/** Injeta a sessao no localStorage, como faz o auth.setup dos outros specs. */
async function entrarComMagicLink(page: Page, session: Session) {
  await page.goto("/login");
  await page.evaluate(
    ([chave, valor]) => window.localStorage.setItem(chave, valor),
    [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)] as const,
  );
}

test("primeiro acesso obriga a criar senha e depois o login por senha funciona", async ({
  page,
}) => {
  // 1. Chega pelo magic link (generateLink nao dispara e-mail).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (linkErr) throw new Error(`generateLink: ${linkErr.message}`);
  const { data: verif, error: otpErr } = await anon().auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: "email",
  });
  if (otpErr || !verif.session) throw new Error(`verifyOtp: ${otpErr?.message}`);

  await entrarComMagicLink(page, verif.session);

  // 2. Tentar ir pro sistema deve cair na tela de criar senha.
  await page.goto("/casos");
  await expect(page).toHaveURL(/\/definir-senha/);
  await expect(page.getByText("Crie sua senha de acesso")).toBeVisible();

  // 3. Cria a senha.
  await page.getByLabel("Nova senha").fill(SENHA_NOVA);
  await page.getByLabel("Confirmar senha").fill(SENHA_NOVA);
  await page.getByRole("button", { name: "Salvar senha e entrar" }).click();

  // 4. Entrou no sistema — e nao volta mais pra tela de senha.
  await expect(page).toHaveURL(/\/(casos|tarefas)/);
  await page.goto("/casos");
  await expect(page).not.toHaveURL(/\/definir-senha/);

  // 5. Verificacao forte: a senha realmente autentica.
  const { data: login, error: loginErr } = await anon().auth.signInWithPassword({
    email: EMAIL,
    password: SENHA_NOVA,
  });
  expect(loginErr, `login por senha falhou: ${loginErr?.message}`).toBeNull();
  expect(login.session).toBeTruthy();
});

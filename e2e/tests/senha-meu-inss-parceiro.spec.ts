// E2E: equipe pede ao parceiro a troca da senha do Meu INSS (card #305).
//
//  1. Interno pede no card "Dados do cliente": prazo sugerido de 3 dias úteis,
//     motivo opcional → solicitação 'senha_meu_inss' pendente, e o card mostra
//     o pedido aberto no lugar do botão.
//  2. Parceiro informa a nova senha pelo kanban → senha gravada (criptografada,
//     auditada), pedido atendido, tarefa "Senha do Meu INSS alterada" pra quem
//     pediu, andamento SÓ INTERNO, e nenhuma "Analisar documento recebido".
//     A senha não aparece em tarefa, andamento nem solicitação.
//  3. Trocar pelo botão "Alterar" (que o parceiro já tinha) também cumpre o
//     pedido aberto.
//  4. Guardas no banco: pedido de novo devolve o aberto; parceiro não pede;
//     interno não cumpre no lugar do parceiro.

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_INTERNO, STORAGE_PARCEIRO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.describe.configure({ mode: "serial" });

const admin = adminClient();

let parceiroId: string;
let internoId: string;
// Caso 1: fluxo pelo kanban. Caso 2: fluxo pelo botão "Alterar".
let caso1: { casoId: string; clienteId: string; nome: string };
let caso2: { casoId: string; clienteId: string; nome: string };

const SENHA_KANBAN = `E2e!Kanban${Date.now().toString().slice(-6)}`;
const SENHA_ALTERAR = `E2e!Alterar${Date.now().toString().slice(-6)}`;

async function logado(email: string, senha: string): Promise<SupabaseClient> {
  const c = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

// "aaaa-mm-dd" de hoje + N dias úteis (sáb/dom não contam), em Brasília.
function diasUteisBR(n: number): string {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = hoje.split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d));
  let restantes = n;
  while (restantes > 0) {
    dia.setUTCDate(dia.getUTCDate() + 1);
    if (dia.getUTCDay() !== 0 && dia.getUTCDay() !== 6) restantes--;
  }
  return dia.toISOString().slice(0, 10);
}

async function pedidosDoCaso(casoId: string) {
  const { data, error } = await admin
    .from("solicitacoes_documento")
    .select("id, tipo, status, origem, descricao, prazo_at, solicitado_por, data_atendimento, comentario")
    .eq("caso_id", casoId)
    .eq("tipo", "senha_meu_inss");
  if (error) throw new Error(`solicitações: ${error.message}`);
  return data;
}

test.beforeAll(async () => {
  const { data: p, error: e1 } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (e1 || !p) throw new Error(`parceiro de teste: ${e1?.message}`);
  parceiroId = p.id;
  const { data: i, error: e2 } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.internoEmail)
    .single();
  if (e2 || !i) throw new Error(`interno de teste: ${e2?.message}`);
  internoId = i.id;

  const s1 = `Senha Kanban ${Date.now()}`;
  const r1 = await seedClienteCaso(admin, { sufixo: s1, parceiroId });
  caso1 = { ...r1, nome: `[E2E] ${s1}` };
  const s2 = `Senha Alterar ${Date.now()}`;
  const r2 = await seedClienteCaso(admin, { sufixo: s2, parceiroId });
  caso2 = { ...r2, nome: `[E2E] ${s2}` };
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test.describe("equipe", () => {
  test.use({ storageState: STORAGE_INTERNO });

  test("pede a troca pelo card Dados do cliente", async ({ page }) => {
    await page.goto(`/casos/${caso1.casoId}`);
    await page.getByRole("button", { name: "Pedir troca ao parceiro" }).click();
    const dialog = page.getByRole("dialog", { name: "Pedir troca da senha do Meu INSS" });
    await expect(dialog).toBeVisible();

    const prazo = diasUteisBR(3);
    await expect(dialog.getByLabel("Prazo para o parceiro")).toHaveValue(prazo);
    await dialog.getByLabel(/Motivo/).fill("[E2E] a senha cadastrada não entra no Meu INSS");
    await dialog.getByRole("button", { name: "Enviar pedido" }).click();

    await expect(page.getByText(/Troca pedida ao parceiro em/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Pedir troca ao parceiro" })).toHaveCount(0);

    const pedidos = await pedidosDoCaso(caso1.casoId);
    expect(pedidos).toHaveLength(1);
    const p = pedidos[0];
    expect(p.status).toBe("pendente");
    expect(p.origem).toBe("externa");
    expect(p.solicitado_por).toBe(internoId);
    expect(p.descricao).toContain("não entra no Meu INSS");
    // Fim do dia de Brasília do prazo escolhido.
    const prazoBR = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(p.prazo_at!));
    expect(prazoBR).toBe(prazo);
  });
});

test.describe("parceiro", () => {
  test.use({ storageState: STORAGE_PARCEIRO });

  test("informa a nova senha pelo kanban e a equipe é avisada", async ({ page }) => {
    await page.goto("/tarefas");
    const card = page.getByRole("button", { name: `Abrir caso de ${caso1.nome}` });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText("Senha Meu INSS")).toBeVisible();
    await card.getByRole("button", { name: "Informar nova senha" }).click();

    const dialog = page.getByRole("dialog", { name: "Informar nova senha do Meu INSS" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("não entra no Meu INSS")).toBeVisible();
    await dialog.getByLabel("Nova senha do Meu INSS").fill(SENHA_KANBAN);
    await dialog.getByLabel("Repita a nova senha").fill(SENHA_KANBAN + "x");
    await expect(dialog.getByText("As senhas não conferem.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Salvar nova senha" })).toBeDisabled();
    await dialog.getByLabel("Repita a nova senha").fill(SENHA_KANBAN);
    await dialog.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByText(/Senha do Meu INSS alterada/)).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveCount(0);

    // Pedido atendido.
    const [pedido] = await pedidosDoCaso(caso1.casoId);
    expect(pedido.status).toBe("atendido");
    expect(pedido.data_atendimento).toBeTruthy();

    // Tarefa pra quem pediu; nada de "Analisar documento recebido".
    const { data: tarefas, error: errT } = await admin
      .from("tarefas")
      .select("titulo, descricao, responsavel_id, metadata")
      .eq("caso_id", caso1.casoId);
    expect(errT).toBeNull();
    const aviso = tarefas!.filter((t) => t.titulo.startsWith("Senha do Meu INSS alterada"));
    expect(aviso, "tarefa pra quem pediu").toHaveLength(1);
    expect(aviso[0].responsavel_id).toBe(internoId);
    expect(tarefas!.some((t) => t.titulo.startsWith("Analisar documento recebido"))).toBe(false);

    // Andamento só interno.
    const { data: ands, error: errA } = await admin
      .from("andamentos")
      .select("titulo, descricao, visivel_parceiro")
      .eq("caso_id", caso1.casoId)
      .eq("titulo", "Senha do Meu INSS alterada");
    expect(errA).toBeNull();
    expect(ands).toHaveLength(1);
    expect(ands![0].visivel_parceiro).toBe(false);

    // LGPD: a senha não vazou pra nenhum texto.
    const textos = [
      ...tarefas!.map((t) => `${t.titulo} ${t.descricao ?? ""} ${JSON.stringify(t.metadata)}`),
      ...ands!.map((a) => `${a.titulo} ${a.descricao ?? ""}`),
      JSON.stringify(pedido),
    ].join("\n");
    expect(textos).not.toContain(SENHA_KANBAN);

    // Auditoria da escrita pelo parceiro.
    const { data: audit, error: errAu } = await admin
      .from("acessos_senha_inss")
      .select("usuario_id, acao")
      .eq("cliente_id", caso1.clienteId);
    expect(errAu).toBeNull();
    expect(audit!.some((x) => x.usuario_id === parceiroId && x.acao === "escrita")).toBe(true);

    // A senha gravada é a nova (lida pela equipe, como na tela).
    const interno = await logado(ENV.internoEmail, ENV.internoPassword);
    const { data: lida, error: errL } = await interno.rpc("get_senha_meu_inss", {
      p_cliente_id: caso1.clienteId,
    });
    expect(errL).toBeNull();
    expect(lida).toBe(SENHA_KANBAN);
    await interno.auth.signOut({ scope: "local" });
  });

  test("trocar pelo botão Alterar também cumpre o pedido aberto", async ({ page }) => {
    // Pedido criado pela equipe direto no banco (a tela já foi coberta acima);
    // pedir de novo devolve o mesmo pedido.
    const interno = await logado(ENV.internoEmail, ENV.internoPassword);
    const r1 = await interno.rpc("pedir_troca_senha_meu_inss", {
      p_caso_id: caso2.casoId,
      p_prazo_at: null,
      p_motivo: null,
    });
    expect(r1.error).toBeNull();
    const r2 = await interno.rpc("pedir_troca_senha_meu_inss", {
      p_caso_id: caso2.casoId,
      p_prazo_at: null,
      p_motivo: "outro motivo",
    });
    expect(r2.error).toBeNull();
    expect((r2.data as { id: string; ja_existia: boolean }).ja_existia).toBe(true);
    expect((r2.data as { id: string }).id).toBe((r1.data as { id: string }).id);

    // Interno não cumpre no lugar do parceiro.
    const tentativa = await interno.rpc("cumprir_troca_senha_meu_inss", {
      p_solicitacao_id: (r1.data as { id: string }).id,
      p_senha: "NaoPode123",
    });
    expect(tentativa.error?.message).toContain("Só o parceiro do caso");
    await interno.auth.signOut({ scope: "local" });

    // Parceiro não pede troca.
    const parceiro = await logado(ENV.parceiroEmail, ENV.parceiroPassword);
    const pedidoParceiro = await parceiro.rpc("pedir_troca_senha_meu_inss", {
      p_caso_id: caso2.casoId,
      p_prazo_at: null,
      p_motivo: null,
    });
    expect(pedidoParceiro.error?.message).toContain("Só a equipe");
    await parceiro.auth.signOut({ scope: "local" });

    // Parceiro vê o aviso no card e troca pelo "Alterar" de sempre.
    await page.goto(`/casos/${caso2.casoId}`);
    await expect(page.getByText("A equipe pediu a troca desta senha")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Alterar", exact: true }).click();
    await page.getByPlaceholder("Senha do MEU INSS do cliente").fill(SENHA_ALTERAR);
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Pedido de troca da equipe concluído.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("A equipe pediu a troca desta senha")).toHaveCount(0);

    const [pedido] = await pedidosDoCaso(caso2.casoId);
    expect(pedido.status).toBe("atendido");
    const { data: tarefas, error } = await admin
      .from("tarefas")
      .select("titulo")
      .eq("caso_id", caso2.casoId);
    expect(error).toBeNull();
    expect(tarefas!.filter((t) => t.titulo.startsWith("Senha do Meu INSS alterada"))).toHaveLength(1);
  });
});

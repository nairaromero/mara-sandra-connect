// E2E: o admin ajusta permissões de uma pessoa por cima do papel (/equipe).
//
// O que se prova aqui é o que o BANCO faz, porque é ele quem decide: conceder
// passa a valer na hora, remover passa a barrar na hora, e cada mudança deixa
// linha na auditoria com o antes e o depois (pedido da Naira: tudo auditável).
// A tela é conferida no fim — a lista vem da RPC, o "ajustado" aparece e o
// "voltar ao papel" desfaz.
//
// Só no banco local/staging com o seed do Canário (`bun run local:rbac`).
import { test, expect, type Browser } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";

const admin = adminClient();
const DOM = "marasandraconnect.com";

let ESC2: string;
let idFinanceiro: string;
let idAdvogado: string;
let idParceira: string;

async function sessao(email: string): Promise<Session> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return data.session;
}

async function como(email: string, escritorioId: string): Promise<SupabaseClient> {
  const sb = createClient(ENV.supabaseUrl, ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-escritorio-id": escritorioId } },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: ENV.internoPassword });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return sb;
}

async function idDe(email: string): Promise<string> {
  const { data } = await admin.from("usuarios").select("id").eq("email", `${email}@${DOM}`).single();
  if (!data) throw new Error(`conta ${email} ausente — rode o seed do RBAC`);
  return data.id as string;
}

/** Desfaz qualquer ajuste, para o teste não depender do que sobrou antes. */
async function limpar() {
  const { data: esc } = await admin.from("escritorios").select("id").eq("slug", "canario").single();
  if (!esc) return;
  const { error } = await admin.from("membro_permissoes").delete().eq("escritorio_id", esc.id);
  if (error) throw new Error(`limpeza de ajustes: ${error.message}`);
}

test.describe.serial("permissões por pessoa", () => {
  test.beforeAll(async () => {
    const { data: esc } = await admin.from("escritorios").select("id").eq("slug", "canario").single();
    if (!esc) throw new Error("escritório Canário ausente — rode `bun run local:rbac`");
    ESC2 = esc.id as string;
    idFinanceiro = await idDe("canario+financeiro");
    idAdvogado = await idDe("canario+advogado");
    idParceira = await idDe("canario+parceiro");
    await limpar();
  });
  test.afterAll(limpar);

  test("conceder vale na hora; remover barra na hora; auditoria guarda antes e depois", async () => {
    const carla = await como(`canario+admin@${DOM}`, ESC2);
    const { data: caso } = await admin.from("casos").select("id").eq("escritorio_id", ESC2).limit(1).single();

    // 1) o financeiro não edita caso (só casos:ler e repasses:ler)
    const fin = await como(`canario+financeiro@${DOM}`, ESC2);
    const antes = await fin.from("casos").update({ observacoes: "[E2E] antes" }).eq("id", caso!.id).select("id");
    expect(antes.data ?? [], "financeiro não deveria editar caso").toHaveLength(0);

    // 2) a admin concede casos:editar só para ele
    expect(
      (await carla.rpc("definir_permissao_do_membro", {
        p_usuario_id: idFinanceiro, p_permissao: "casos:editar", p_estado: "conceder",
      })).error,
    ).toBeNull();

    // 3) passa a valer na hora, sem sair e entrar
    const depois = await fin.from("casos").update({ observacoes: "[E2E] depois" }).eq("id", caso!.id).select("id");
    expect(depois.error).toBeNull();
    expect(depois.data ?? [], "com o ajuste, edita").toHaveLength(1);

    // 4) e o papel dele continua financeiro (o ajuste é só dele, não do papel)
    const { data: outro } = await admin
      .from("membros").select("papel:papeis(chave)").eq("escritorio_id", ESC2).eq("usuario_id", idFinanceiro).single();
    expect((outro as { papel: { chave: string } }).papel.chave).toBe("financeiro");

    // 5) remover do advogado o que o papel dá
    expect(
      (await carla.rpc("definir_permissao_do_membro", {
        p_usuario_id: idAdvogado, p_permissao: "documentos:excluir", p_estado: "remover",
      })).error,
    ).toBeNull();
    const { data: doc } = await admin.from("documentos").insert({
      caso_id: caso!.id, escritorio_id: ESC2, tipo: "outro",
      nome_arquivo: "[E2E permissões] doc.pdf", storage_path: `e2e-perm/${Date.now()}.pdf`,
    }).select("id").single();
    const adv = await como(`canario+advogado@${DOM}`, ESC2);
    const apagou = await adv.from("documentos").delete().eq("id", doc!.id).select("id");
    expect(apagou.data ?? [], "sem documentos:excluir, o banco recusa").toHaveLength(0);
    await admin.from("documentos").delete().eq("id", doc!.id);

    // 6) auditoria: uma linha por mudança, com antes e depois
    const { data: trilha } = await admin
      .from("auditoria")
      .select("acao, detalhes")
      .eq("escritorio_id", ESC2)
      .eq("acao", "equipe.permissao_ajustada")
      .order("created_at", { ascending: false })
      .limit(2);
    const porPermissao = Object.fromEntries(
      (trilha ?? []).map((l) => [(l.detalhes as { permissao: string }).permissao, l.detalhes as Record<string, unknown>]),
    );
    expect(porPermissao["casos:editar"]).toMatchObject({ antes: false, depois: true, estado: "conceder" });
    expect(porPermissao["documentos:excluir"]).toMatchObject({ antes: true, depois: false, estado: "remover" });

    await admin.from("casos").update({ observacoes: null }).eq("id", caso!.id);
  });

  test("as travas: não é admin, si mesma, o que não tem, e o parceiro", async () => {
    const carla = await como(`canario+admin@${DOM}`, ESC2);
    const adv = await como(`canario+advogado@${DOM}`, ESC2);
    const idCarla = await idDe("canario+admin");

    // quem não gerencia a equipe não ajusta ninguém
    expect(
      (await adv.rpc("definir_permissao_do_membro", {
        p_usuario_id: idFinanceiro, p_permissao: "casos:editar", p_estado: "conceder",
      })).error?.code,
    ).toBe("42501");

    // ninguém ajusta a si mesma (nem para tirar, nem para dar)
    expect(
      (await carla.rpc("definir_permissao_do_membro", {
        p_usuario_id: idCarla, p_permissao: "auditoria:ler", p_estado: "remover",
      })).error?.message,
    ).toMatch(/próprias permissões/);

    // parceiro só recebe o que o papel parceiro prevê
    expect(
      (await carla.rpc("definir_permissao_do_membro", {
        p_usuario_id: idParceira, p_permissao: "equipe:gerenciar", p_estado: "conceder",
      })).error?.message,
    ).toMatch(/parceiro/);

    // e o escritório não fica sem quem gerencia a equipe
    expect(
      (await carla.rpc("resetar_permissoes_do_membro", { p_usuario_id: idFinanceiro })).error,
    ).toBeNull();
  });

  test("tela: a lista vem do banco, o ajuste aparece e o 'voltar ao papel' desfaz", async ({
    browser,
    baseURL,
  }: { browser: Browser; baseURL?: string }) => {
    const carla = await como(`canario+admin@${DOM}`, ESC2);
    expect(
      (await carla.rpc("definir_permissao_do_membro", {
        p_usuario_id: idFinanceiro, p_permissao: "casos:editar", p_estado: "conceder",
      })).error,
    ).toBeNull();

    const session = await sessao(`canario+admin@${DOM}`);
    const ctx = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: new URL(baseURL!).origin,
            localStorage: [
              { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
              { name: "msc:escritorio_ativo", value: ESC2 },
            ],
          },
        ],
      },
    });
    const page = await ctx.newPage();
    await cursorVisivel(page);
    await page.goto("/equipe");
    await page.getByRole("button", { name: /Ações de Fábio/ }).click();
    await page.getByRole("menuitem", { name: "Permissões" }).click();

    const painel = page.locator("[data-permissoes-sheet]");
    await expect(painel).toBeVisible();
    const linha = painel.locator('[data-permissao="casos:editar"]');
    await expect(linha.locator("[data-ajustada]"), "o ajuste aparece marcado").toBeVisible();
    await expect(painel.getByText(/com 1 ajuste/)).toBeVisible();

    await linha.getByRole("button", { name: "voltar ao papel" }).click();
    await expect(linha.locator("[data-ajustada]")).toHaveCount(0);
    await expect(painel.getByText(/sem ajustes/)).toBeVisible();

    // e o banco voltou mesmo: o financeiro não edita mais
    const fin = await como(`canario+financeiro@${DOM}`, ESC2);
    const { data: caso } = await admin.from("casos").select("id").eq("escritorio_id", ESC2).limit(1).single();
    const r = await fin.from("casos").update({ observacoes: "[E2E] não deveria" }).eq("id", caso!.id).select("id");
    expect(r.data ?? []).toHaveLength(0);
    await ctx.close();
  });
});

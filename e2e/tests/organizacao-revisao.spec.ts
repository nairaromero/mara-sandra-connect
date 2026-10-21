// E2E: os consertos da revisão de 21/10 no lote de organização de documentos
// (#434 — PRs #465/#473/#474). Cada teste prova um achado que a revisão
// conferiu no código; o comentário diz qual.
//
// Roda também contra o staging. O que só existe no banco local (escritório
// Canário, segredo do sistema) está em organizacao-revisao-local.spec.ts.

import { test, expect } from "@playwright/test";
import { STORAGE_ADMIN, STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { chamadorComo, clienteComo, escritorioPadrao, idDe } from "../rbac";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { abrirAtividadesDoCaso } from "../tarefas";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let casoId: string;
let parceiroId: string;
let internoId: string;

test.beforeAll(async () => {
  parceiroId = await idDe(ENV.parceiroEmail);
  internoId = await idDe(ENV.internoEmail);
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Revisao org ${Date.now()}`, parceiroId }));
  // O benefício decide a segunda metade do checklist.
  await admin.from("casos").update({ tipo_beneficio: "Aposentadoria especial" }).eq("id", casoId);
  // A tarefa nasce no nome de quem o escritório configurou; o teste olha
  // pela conta do E2E.
  const { error } = await admin
    .from("tarefas")
    .update({ responsavel_id: internoId })
    .eq("caso_id", casoId)
    .eq("metadata->>etapa", "organizacao_documentos");
  if (error) throw new Error(`tarefa de organização: ${error.message}`);
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

test("concluir só vale para a tarefa de ORGANIZAÇÃO", async () => {
  const { data: outra, error } = await admin
    .from("tarefas")
    .insert({ caso_id: casoId, titulo: "[E2E] outra tarefa", tipo: "interna", status: "a_fazer", responsavel_id: internoId })
    .select("id")
    .single();
  expect(error, error?.message).toBeNull();
  const sb = await clienteComo(ENV.internoEmail, await escritorioPadrao());
  const r = await sb.rpc("concluir_organizacao_documentos", { p_tarefa_id: outra!.id });
  expect(r.error?.code, r.error?.message).toBe("P0001");
  const { count } = await admin
    .from("tarefas")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId)
    .eq("metadata->>etapa", "analise_inicial_parceiro");
  expect(count, "nenhuma análise nasceu por cima").toBe(0);
});

// Achado 3: três funções SECURITY DEFINER abertas a qualquer conta logada,
// sem filtro de escritório (nome de arquivo e casos de todos).
test("as funções da fila não atendem conta logada", async () => {
  const sb = await clienteComo(ENV.parceiroEmail, await escritorioPadrao());
  for (const [nome, args] of [
    ["casos_com_leitura_pendente", { p_quieto_minutos: 0, p_limite: 5 }],
    ["documentos_leitura_pendente", { p_caso_id: casoId, p_limite: 5 }],
    ["responsavel_etapa", { p_caso_id: casoId, p_chave: "analise" }],
    ["registrar_falha_leitura_ia", { p_documento_id: casoId, p_motivo: "x" }],
  ] as const) {
    const { error } = await sb.rpc(nome, args);
    expect(error?.code, `${nome}: ${error?.message}`).toBe("42501");
  }
});

test.describe("a fila da leitura", () => {
  // Fila travada: o corte de 15 vinha ANTES do filtro de formato, e arquivo que
  // falhava nunca saía da fila.
  test("o que falta ler: formato filtrado antes do corte, e falha conta até sair", async () => {
    const docx = Array.from({ length: 16 }, (_, i) => ({
      caso_id: casoId,
      tipo: "outro",
      nome_arquivo: `[E2E] antigo-${i}.docx`,
      storage_path: `e2e-revisao/${casoId}/antigo-${i}.docx`,
      uploaded_by: parceiroId,
    }));
    const { error: e1 } = await admin.from("documentos").insert(docx);
    expect(e1, e1?.message).toBeNull();
    const { data: pdf, error: e2 } = await admin
      .from("documentos")
      .insert({
        caso_id: casoId,
        tipo: "outro",
        nome_arquivo: "[E2E] extrato.pdf",
        storage_path: `e2e-revisao/${casoId}/extrato.pdf`,
        uploaded_by: parceiroId,
      })
      .select("id")
      .single();
    expect(e2, e2?.message).toBeNull();

    const pendentes = async () => {
      const { data, error } = await admin.rpc("documentos_leitura_pendente", { p_caso_id: casoId, p_limite: 15 });
      expect(error, error?.message).toBeNull();
      return (data ?? []).map((d: { id: string }) => d.id);
    };
    expect(await pendentes(), "o PDF entra mesmo atrás de 16 .docx").toEqual([pdf!.id]);

    for (let i = 0; i < 3; i++) {
      const { error } = await admin.rpc("registrar_falha_leitura_ia", {
        p_documento_id: pdf!.id,
        p_motivo: "não entendi a resposta do modelo",
      });
      expect(error, error?.message).toBeNull();
    }
    const { data: depois } = await admin
      .from("documentos")
      .select("ia_tentativas, ia_falha")
      .eq("id", pdf!.id)
      .single();
    expect(depois).toEqual({ ia_tentativas: 3, ia_falha: "não entendi a resposta do modelo" });
    expect(await pendentes(), "na 3ª falha o arquivo sai da fila").toEqual([]);
  });

  test("a conferência mostra por que a IA desistiu do arquivo", async ({ page }) => {
    await abrirAtividadesDoCaso(page, casoId);
    await page.getByText("Organizar documentos", { exact: false }).first().click();
    const folha = page.locator('[role="dialog"]').last();
    await expect(folha.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({ timeout: 20_000 });
    const caixa = folha.locator("div.rounded-md.p-2").filter({ hasText: "[E2E] extrato.pdf" });
    await expect(caixa.getByText("a IA não conseguiu ler")).toBeVisible();
    await expect(caixa.locator("[data-ia-falha]")).toHaveText("não entendi a resposta do modelo");
    // E o "Ler N novos" não oferece o que já foi desistido.
    await expect(folha.getByRole("button", { name: /^Ler \d+ novo/ })).toHaveCount(0);
  });
});

test.describe("o link da pasta: o banco guarda a regra", () => {
  // Achado 6: o navegador gravava o veredito (o parceiro podia gravar
  // "compartilhado" pela API); trocar o link só zerava na tela; `criado_por`
  // vinha do navegador; trocar e tirar não deixavam rastro.
  test("veredito, autoria, troca e retirada", async () => {
    const comoParceiro = await clienteComo(ENV.parceiroEmail, await escritorioPadrao());
    const { data: linha, error } = await comoParceiro
      .from("caso_pastas_externas")
      .insert({
        caso_id: casoId,
        url: `https://1drv.ms/f/s!revisao-${Date.now()}`,
        criado_por: internoId,
        checado_status: "aberto",
      })
      .select("id, criado_por, checado_status")
      .single();
    expect(error, error?.message).toBeNull();
    expect(linha!.criado_por, "autor é quem está logado").toBe(parceiroId);
    expect(linha!.checado_status, "veredito do navegador é descartado").toBeNull();

    const upd = await comoParceiro
      .from("caso_pastas_externas")
      .update({ checado_status: "aberto", checado_detalhe: "confia" })
      .eq("id", linha!.id)
      .select("checado_status")
      .single();
    expect(upd.error, upd.error?.message).toBeNull();
    expect(upd.data!.checado_status).toBeNull();

    // O sistema grava; trocar o link zera.
    await admin.from("caso_pastas_externas").update({ checado_status: "aberto" }).eq("id", linha!.id);
    const novaUrl = `https://1drv.ms/f/s!trocado-${Date.now()}`;
    const troca = await comoParceiro
      .from("caso_pastas_externas")
      .update({ url: novaUrl })
      .eq("id", linha!.id)
      .select("checado_status, atualizado_por")
      .single();
    expect(troca.error, troca.error?.message).toBeNull();
    expect(troca.data).toEqual({ checado_status: null, atualizado_por: parceiroId });

    const del = await comoParceiro.from("caso_pastas_externas").delete().eq("id", linha!.id).select("id");
    expect(del.data, del.error?.message).toHaveLength(1);

    const { data: andamentos } = await admin
      .from("andamentos")
      .select("titulo, descricao")
      .eq("caso_id", casoId)
      .in("titulo", ["Link da pasta trocado", "Link da pasta retirado"])
      .order("created_at");
    expect(andamentos?.map((a) => a.titulo)).toEqual(["Link da pasta trocado", "Link da pasta retirado"]);
    expect(andamentos![0].descricao).toContain(novaUrl);
  });

  test("a function confere pela pasta e grava ela mesma", async () => {
    const { data: linha } = await admin
      .from("caso_pastas_externas")
      .insert({ caso_id: casoId, url: `https://example.com/pasta-${Date.now()}`, criado_por: parceiroId })
      .select("id")
      .single();
    const chamar = await chamadorComo(ENV.parceiroEmail, await escritorioPadrao());
    // Host fora da lista: a resposta sai sem a function buscar nada.
    const r = await chamar("checar-link-pasta", { pasta_id: linha!.id });
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    expect(r.json).toMatchObject({ status: "indefinido", gravado: true });
    const { data } = await admin
      .from("caso_pastas_externas")
      .select("checado_status, checado_em")
      .eq("id", linha!.id)
      .single();
    expect(data!.checado_status).toBe("indefinido");
    expect(data!.checado_em).toBeTruthy();

    // URL solta não é mais aceita: só pasta de um caso que a pessoa alcança.
    const solta = await chamar("checar-link-pasta", { url: "https://1drv.ms/f/x" });
    expect(solta.status).toBe(400);
  });
});

test.describe("o checklist é do escritório e do benefício", () => {
  test("lista base + a do benefício do caso, e a tela cobra as duas", async ({ page }) => {
    const { data: cfg } = await admin
      .from("escritorio_config")
      .select("checklist_documentos")
      .eq("escritorio_id", await escritorioPadrao())
      .single();
    const sb = await clienteComo(ENV.internoEmail, await escritorioPadrao());
    const { data, error } = await sb.rpc("checklist_documentos_do_caso", { p_caso_id: casoId });
    expect(error, error?.message).toBeNull();
    const itens = data as string[][];
    for (const item of cfg!.checklist_documentos as string[][]) expect(itens).toContainEqual(item);
    const { data: beneficio } = await admin
      .from("tipos_beneficio")
      .select("documentos_exigidos")
      .eq("escritorio_id", await escritorioPadrao())
      .eq("nome", "Aposentadoria especial")
      .single();
    for (const item of beneficio!.documentos_exigidos as string[][]) expect(itens).toContainEqual(item);

    if ((beneficio!.documentos_exigidos as string[][]).some((i) => i[0] === "ppp")) {
      await abrirAtividadesDoCaso(page, casoId);
      const card = page.locator("div.group").filter({ hasText: "Organizar documentos" }).first();
      await expect(card.getByText(/Falta:.*PPP/)).toBeVisible({ timeout: 20_000 });
    }
  });

});

test.describe("telas de configuração", () => {
  test.use({ storageState: STORAGE_ADMIN });

  test("Tipos de benefício mostra a lista base e a de cada benefício", async ({ page }) => {
    await page.goto("/configuracoes?tab=beneficios");
    await expect(page.getByText("Documentos que todo caso precisa ter")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-checklist-editor]").first()).toContainText("Procuração");
    const botao = page.locator('[data-beneficio-documentos="Aposentadoria especial"]');
    await botao.click();
    await expect(page.locator("[data-checklist-editor]").nth(1)).toBeVisible();
  });

  test("Escritório mostra quem faz cada etapa", async ({ page }) => {
    await page.goto("/configuracoes?tab=escritorio");
    await expect(page.getByText("Quem faz cada etapa")).toBeVisible({ timeout: 20_000 });
    for (const etapa of ["organiza_documentos", "organiza_documentos_substituto", "analise"]) {
      await expect(page.locator(`[data-etapa="${etapa}"]`)).toBeVisible();
    }
  });
});

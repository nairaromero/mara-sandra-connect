// E2E: os consertos da revisão de 21/10 no lote de organização de documentos
// (#434) que só se provam no banco LOCAL — o escritório Canário e o segredo
// de sistema só existem aqui. A parte que roda também no staging está em
// organizacao-revisao.spec.ts.

import { test, expect } from "@playwright/test";
import { ENV } from "../env";
import {
  chamadorComo,
  chamarComoSistema,
  clienteComo,
  contaDoCanario,
  escritorioCanario,
  idDe,
  limpezaLocal,
  segredoDeSistemaLocal,
  ultimaLinhaDaTrilha,
} from "../rbac";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";
import { TIPOS_DOCUMENTO_CHAVES } from "../../supabase/functions/_shared/tipos-documento";

const admin = adminClient();
let casoId: string;
let tarefaId: string;

test.beforeAll(async () => {
  test.skip(!ENV.local, "o Canário e o segredo do sistema só existem no banco local");
  const parceiroId = await idDe(ENV.parceiroEmail);
  ({ casoId } = await seedClienteCaso(admin, { sufixo: `Revisao org local ${Date.now()}`, parceiroId }));
  const { data: tarefa, error } = await admin
    .from("tarefas")
    .select("id")
    .eq("caso_id", casoId)
    .eq("metadata->>etapa", "organizacao_documentos")
    .single();
  if (error || !tarefa) throw new Error(`tarefa de organização: ${error?.message}`);
  tarefaId = tarefa.id as string;
});

test.afterAll(limpezaLocal(async () => {
  await cleanupE2E(admin);
}));

test.describe("escritório: um não alcança o outro", () => {
  // Achado 1: a trava lia o escritório do PRÓPRIO caso e filtrava por ele
  // mesmo — sempre passava, e o caso de outro escritório era lido com a chave
  // de IA dele.
  test("ler os documentos de um caso de outro escritório: não encontrado", async () => {
    const chamar = await chamadorComo(contaDoCanario("admin"), await escritorioCanario());
    const r = await chamar("identificar-documentos", { caso_id: casoId });
    expect(r.status, r.texto.slice(0, 200)).toBe(404);
  });

  // Achado 2: concluir aceitava tarefa de qualquer escritório.
  test("concluir a organização de outro escritório: não encontrada", async () => {
    const sb = await clienteComo(contaDoCanario("admin"), await escritorioCanario());
    const { error } = await sb.rpc("concluir_organizacao_documentos", { p_tarefa_id: tarefaId });
    // `exigir_no_escritorio` responde "registro não encontrado" (P0002); o
    // PostgREST devolve sem o código — como nas outras specs de isolamento,
    // vale a recusa e o estado.
    expect(error, "tarefa de outro escritório não se conclui").toBeTruthy();
    const { data } = await admin.from("tarefas").select("status").eq("id", tarefaId).single();
    expect(data?.status, "a tarefa continua aberta").toBe("a_fazer");
  });

  test("o checklist de um caso de outro escritório vem vazio", async () => {
    const sb = await clienteComo(contaDoCanario("admin"), await escritorioCanario());
    const { data, error } = await sb.rpc("checklist_documentos_do_caso", { p_caso_id: casoId });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

test.describe("a fila da leitura", () => {
  // Achado 4: o cron assina como 'cron:identificar-documentos' e a function
  // conferia outro nome — toda chamada da fila voltava 401.
  test("o cron entra com a assinatura do job; outro nome é recusado", async () => {
    test.skip(!segredoDeSistemaLocal(), "sem MSC_SYSTEM_SECRET em supabase/functions/.env");
    const certo = await chamarComoSistema("identificar-documentos", "cron:identificar-documentos", {});
    expect(certo.status, certo.texto.slice(0, 200)).toBe(200);
    expect(typeof certo.json?.casos).toBe("number");
    const errado = await chamarComoSistema("identificar-documentos", "identificar-documentos", {});
    expect(errado.status).toBe(401);
  });

});

test.describe("o checklist é do escritório", () => {
  test("os tipos da tela existem no enum do banco", async () => {
    // A CHECK da lista confere cada chave contra `public.tipo_documento`.
    const todas = TIPOS_DOCUMENTO_CHAVES.filter((t) => t !== "outro").map((t) => [t]);
    const { data: alvo } = await admin
      .from("tipos_beneficio")
      .select("id, documentos_exigidos")
      .eq("escritorio_id", await escritorioCanario())
      .limit(1)
      .single();
    const { error } = await admin.from("tipos_beneficio").update({ documentos_exigidos: todas }).eq("id", alvo!.id);
    await admin.from("tipos_beneficio").update({ documentos_exigidos: alvo!.documentos_exigidos }).eq("id", alvo!.id);
    expect(error, `chave da tela fora do enum do banco: ${error?.message}`).toBeNull();
  });

  test.describe("gravar pela RPC", () => {
    let original: unknown;
    test.beforeAll(async () => {
      const { data } = await admin
        .from("escritorio_config")
        .select("checklist_documentos")
        .eq("escritorio_id", await escritorioCanario())
        .single();
      original = data?.checklist_documentos;
    });
    test.afterAll(limpezaLocal(async () => {
      await admin
        .from("escritorio_config")
        .update({ checklist_documentos: original })
        .eq("escritorio_id", await escritorioCanario());
    }));

    test("quem gerencia grava e audita; tipo inventado e papel sem permissão são recusados", async () => {
      const esc = await escritorioCanario();
      const adm = await clienteComo(contaDoCanario("admin"), esc);
      const ruim = await adm.rpc("escritorio_definir_checklist", { p_itens: [["xyz"]] });
      expect(ruim.error?.code).toBe("22023");

      const nova = [["procuracao"], ["cnis", "cnis_resumido"]];
      const ok = await adm.rpc("escritorio_definir_checklist", { p_itens: nova });
      expect(ok.error, ok.error?.message).toBeNull();
      const trilha = await ultimaLinhaDaTrilha(esc, "escritorio.checklist");
      expect(trilha?.detalhes).toMatchObject({ depois: nova });

      const fin = await clienteComo(contaDoCanario("financeiro"), esc);
      const negado = await fin.rpc("escritorio_definir_checklist", { p_itens: nova });
      expect(negado.error?.code).toBe("42501");
    });
  });
});

test.describe("quem faz cada etapa", () => {
  let original: unknown;
  test.beforeAll(async () => {
    const { data } = await admin
      .from("escritorio_config")
      .select("responsaveis")
      .eq("escritorio_id", await escritorioCanario())
      .single();
    original = data?.responsaveis;
  });
  test.afterAll(limpezaLocal(async () => {
    await admin
      .from("escritorio_config")
      .update({ responsaveis: original })
      .eq("escritorio_id", await escritorioCanario());
  }));

  test("grava gente interna ativa, recusa parceiro e audita", async () => {
    const esc = await escritorioCanario();
    const adm = await clienteComo(contaDoCanario("admin"), esc);
    const assistente = await idDe(contaDoCanario("assistente"));
    const advogado = await idDe(contaDoCanario("advogado"));

    const parceiro = await adm.rpc("escritorio_definir_responsaveis", {
      p_organiza: await idDe(contaDoCanario("parceiro")),
      p_organiza_substituto: null,
      p_analise: null,
    });
    expect(parceiro.error?.code).toBe("22023");

    const ok = await adm.rpc("escritorio_definir_responsaveis", {
      p_organiza: assistente,
      p_organiza_substituto: null,
      p_analise: advogado,
    });
    expect(ok.error, ok.error?.message).toBeNull();
    expect(ok.data).toEqual({ organiza_documentos: assistente, analise: advogado });
    const trilha = await ultimaLinhaDaTrilha(esc, "escritorio.responsaveis");
    expect(trilha?.detalhes).toMatchObject({ depois: { organiza_documentos: assistente } });

    // Quem não configura o escritório não escolhe.
    const adv = await clienteComo(contaDoCanario("advogado"), esc);
    const negado = await adv.rpc("escritorio_definir_responsaveis", {
      p_organiza: null,
      p_organiza_substituto: null,
      p_analise: null,
    });
    expect(negado.error?.code).toBe("42501");
  });
});


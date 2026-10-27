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
  escritorioPadrao,
  idDe,
  limpezaLocal,
  segredoDeSistemaLocal,
  ultimaLinhaDaTrilha,
} from "../rbac";
import { adminClient, cleanupE2E, cpfValido, seedClienteCaso } from "../supabase-admin";
import { TIPOS_DOCUMENTO_CHAVES } from "../../supabase/functions/_shared/tipos-documento";

const admin = adminClient();
let casoId: string;
let tarefaId: string;
// Integração de IA de mentira que a spec cria quando o banco não tem uma: desde
// o espelho de 27/10 o staging (e a cópia local) chega sem chave de IA, porque
// escritorio_integracoes não sai de produção. Apagada no fim.
let iaDeTeste: string | null = null; // escritório onde a spec criou a linha

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
  if (iaDeTeste) await admin.from("escritorio_integracoes").delete().eq("escritorio_id", iaDeTeste).eq("tipo", "ia");
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
  // Achado da explicação de 22/10: escritório sem IA ligada voltava à fila a
  // cada 10 minutos (a function respondia "não configurado" sem marcar nada)
  // e ocupava as vagas de quem tem chave.
  test("só entra na fila o escritório com IA ligada", async () => {
    const esc = await escritorioCanario();
    const { data: semIa, error: eSemIa } = await admin
      .from("escritorio_integracoes")
      .select("ativo")
      .eq("escritorio_id", esc)
      .eq("tipo", "ia")
      .eq("ativo", true);
    expect(eSemIa, eSemIa?.message).toBeNull();
    test.skip((semIa ?? []).length > 0, "o Canário deste banco tem IA ligada");

    // O escritório do casoId precisa de IA ligada (private.escritorio_tem_ia).
    const padrao = await escritorioPadrao();
    const { data: comIa, error: eIa } = await admin
      .from("escritorio_integracoes")
      .select("ativo")
      .eq("escritorio_id", padrao)
      .eq("tipo", "ia");
    expect(eIa, eIa?.message).toBeNull();
    if (!(comIa ?? []).some((l) => l.ativo)) {
      test.skip((comIa ?? []).length > 0, "o escritório padrão tem IA cadastrada e desligada — não mexo nela");
      const { error: eNova } = await admin.from("escritorio_integracoes").insert({
        escritorio_id: padrao, tipo: "ia", ativo: true,
        config: { provider: "anthropic", modelo: "e2e-fila" },
        segredo_cipher: "e2e", segredo_iv: "e2e",
      });
      expect(eNova, eNova?.message).toBeNull();
      iaDeTeste = padrao;
    }

    // Um caso de parceiro em cada escritório, cada um com um PDF por ler.
    const parceiroCanario = await idDe(contaDoCanario("parceiro"));
    const { data: cli, error: eCli } = await admin
      .from("clientes")
      .insert({ nome: `[E2E] Fila sem IA ${Date.now()}`, cpf: cpfValido(), escritorio_id: esc })
      .select("id")
      .single();
    expect(eCli, eCli?.message).toBeNull();
    const { data: casoCanario, error: eCaso } = await admin
      .from("casos")
      .insert({ cliente_id: cli!.id, escritorio_id: esc, tipo_beneficio: "Outro", fase: "analise", parceiro_id: parceiroCanario })
      .select("id")
      .single();
    expect(eCaso, eCaso?.message).toBeNull();
    for (const caso of [casoCanario!.id as string, casoId]) {
      const { error } = await admin.from("documentos").insert({
        caso_id: caso,
        tipo: "outro",
        nome_arquivo: "[E2E] fila.pdf",
        storage_path: `e2e-fila/${caso}/fila.pdf`,
      });
      expect(error, error?.message).toBeNull();
    }

    const { data: fila, error } = await admin.rpc("casos_com_leitura_pendente", {
      p_quieto_minutos: 0,
      p_limite: 1000,
    });
    expect(error, error?.message).toBeNull();
    const ids = (fila ?? []).map((l: { caso_id: string }) => l.caso_id);
    expect(ids, "o escritório com IA entra").toContain(casoId);
    expect(ids, "o escritório sem IA fica de fora").not.toContain(casoCanario!.id);
  });

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
    // Qualquer linha serve: a CHECK é a mesma em todos os escritórios (o Canário
    // pode chegar sem tipos depois do espelho).
    const { data: alvo, error: eAlvo } = await admin
      .from("tipos_beneficio")
      .select("id, documentos_exigidos")
      .order("id")
      .limit(1)
      .single();
    expect(eAlvo, eAlvo?.message).toBeNull();
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


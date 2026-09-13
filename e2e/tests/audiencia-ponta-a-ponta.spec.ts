// E2E: audiência de ponta a ponta (análise da Naira, 2026-09-13).
//
// 1. Pela Agenda: caso com UM processo judicial → o select já vem com ele
//    marcado; o template de audiência entra sozinho e "Preparar audiência"
//    (D-3) de uma audiência de TERÇA recua pra SEXTA — antes empurrava pro
//    sábado→segunda e a preparação ficava com 1 dia.
// 2. Publicação chegou: aplicar_audiencia_da_publicacao (o que a edge
//    ler-audiencia-publicacao chama depois da IA) recebe uma leitura SIMULADA —
//    o staging não tem chave de IA e a leitura não é o que se testa aqui:
//      a) com data → evento + tarefas do template + aviso COMPLETO com o link
//         da publicação, e a tarefa não tem mais botão de criar audiência;
//      b) publicação repetida → reaproveita o evento e abre "Analisar
//         publicação repetida" (nada é excluído);
//      c) sem data → "Conferir audiência", sem evento;
//      d) sem data e com data do MESMO processo, em qualquer ordem → análise de
//         publicação repetida (nada some calado).
// 3. Botões das tarefas do template:
//      "Preparar audiência" → "Cliente instruído" (andamento ao parceiro + conclui);
//      "Acompanhar ata/sentença" → "Sentença ainda não saiu" (+10 dias, interno)
//      e "Sentença saiu" (andamento ao parceiro + conclui).
//    A leitura automática fica DESLIGADA no staging (app_config), senão o
//    gatilho mandaria o andamento pra edge ao mesmo tempo que o teste.

import { test, expect, type Page } from "@playwright/test";
import { STORAGE_INTERNO } from "../auth.setup";
import { ENV } from "../env";
import { adminClient, cleanupE2E, seedClienteCaso } from "../supabase-admin";

test.use({ storageState: STORAGE_INTERNO });

const admin = adminClient();
let parceiroId: string;

test.beforeAll(async () => {
  const { data, error } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", ENV.parceiroEmail)
    .single();
  if (error || !data) throw new Error(`parceiro de teste não encontrado: ${ENV.parceiroEmail}`);
  parceiroId = data.id;

  const { data: cfg, error: errCfg } = await admin
    .from("app_config")
    .select("valor")
    .eq("chave", "audiencia_leitura_auto")
    .maybeSingle();
  if (errCfg) throw new Error(`app_config: ${errCfg.message}`);
  if (cfg?.valor === "true") {
    throw new Error(
      "audiencia_leitura_auto está LIGADA neste banco: o gatilho correria contra o teste. Desligue antes.",
    );
  }
});

test.afterAll(async () => {
  await cleanupE2E(admin);
});

const pad = (n: number) => String(n).padStart(2, "0");

// Próxima TERÇA (calendário de Brasília) a pelo menos 8 dias — longe o
// bastante pra D-3 não bater no "hoje" nem a data parecer passada.
function proximaTercaBR(): { chave: string; br: string } {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = hoje.split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d + 8));
  while (dia.getUTCDay() !== 2) dia.setUTCDate(dia.getUTCDate() + 1);
  const chave = `${dia.getUTCFullYear()}-${pad(dia.getUTCMonth() + 1)}-${pad(dia.getUTCDate())}`;
  const br = `${pad(dia.getUTCDate())}/${pad(dia.getUTCMonth() + 1)}/${dia.getUTCFullYear()}`;
  return { chave, br };
}

// "aaaa-mm-dd" + N dias, às 15:00 de Brasília, como instante.
function instanteBR15h(chave: string, deltaDias: number): number {
  const [y, m, d] = chave.split("-").map(Number);
  return Date.UTC(y, m - 1, d + deltaDias, 18, 0, 0); // 15:00 BRT = 18:00Z
}

async function seedProcessoJudicial(casoId: string, numero: string): Promise<string> {
  const { data, error } = await admin
    .from("processos_judiciais")
    .insert({ caso_id: casoId, numero_processo: numero })
    .select("id")
    .single();
  if (error) throw new Error(`seed processo: ${error.message}`);
  return data.id;
}

test("agenda: processo único já vem marcado e a preparação de terça recua pra sexta", async ({
  page,
}) => {
  const sufixo = `Audiencia Agenda ${Date.now()}`;
  const nomeCliente = `[E2E] ${sufixo}`;
  const { casoId } = await seedClienteCaso(admin, { sufixo });
  const numero = `5000${Date.now().toString().slice(-9)}-11.2026.8.26.0001`;
  const procId = await seedProcessoJudicial(casoId, numero);
  const terca = proximaTercaBR();

  await page.goto("/agenda");
  await page.getByRole("button", { name: "Novo evento" }).click();
  const agenda = page.getByRole("dialog", { name: "Agendamentos" });
  await expect(agenda).toBeVisible();

  await agenda.getByRole("combobox").filter({ hasText: "Sem cliente" }).click();
  await page.getByRole("option", { name: nomeCliente }).click();
  await agenda.getByRole("combobox").filter({ hasText: "Perícia" }).click();
  await page.getByRole("option", { name: "Audiência", exact: true }).click();

  // (b) O processo judicial único aparece JÁ selecionado.
  await expect(
    agenda.getByRole("combobox").filter({ hasText: `Judicial · ${numero}` }),
  ).toBeVisible();
  // O template de audiência entrou sozinho (título preenchido por ele).
  await expect(agenda.locator("#a-titulo")).toHaveValue(`Audiência - ${nomeCliente}`);

  await agenda.locator("#a-start").fill(`${terca.chave}T15:00`);
  await agenda.locator("#a-end").fill(`${terca.chave}T16:00`);
  await agenda.getByRole("button", { name: "Salvar" }).click();

  await expect
    .poll(
      async () => {
        const { data, error } = await admin
          .from("tarefas")
          .select("id")
          .eq("caso_id", casoId)
          .eq("metadata->>template_aplicado", "audiencia_judicial");
        if (error) throw error;
        return data.length;
      },
      { timeout: 20_000, message: "esperando as 3 tarefas do template de audiência" },
    )
    .toBe(3);

  const { data: evento, error: errEv } = await admin
    .from("agenda_eventos")
    .select("processo_judicial_id")
    .eq("caso_id", casoId)
    .eq("tipo", "audiencia")
    .single();
  expect(errEv).toBeNull();
  expect(evento!.processo_judicial_id, "evento sem o processo").toBe(procId);

  const { data: tarefas, error: errT } = await admin
    .from("tarefas")
    .select("titulo, due_at, processo_judicial_id")
    .eq("caso_id", casoId)
    .eq("metadata->>template_aplicado", "audiencia_judicial");
  expect(errT).toBeNull();
  const porTitulo = (p: string) => tarefas!.find((t) => t.titulo.startsWith(p))!;
  for (const t of tarefas!) {
    expect(t.processo_judicial_id, `tarefa sem processo: ${t.titulo}`).toBe(procId);
  }
  // (a) D-3 de terça = sábado → recua pra SEXTA (terça − 4).
  expect(new Date(porTitulo("Preparar audiência").due_at).getTime()).toBe(
    instanteBR15h(terca.chave, -4),
  );
  // D+1 = quarta; D+10 = sexta — dias úteis, ficam onde estão.
  expect(new Date(porTitulo("Registrar como foi").due_at).getTime()).toBe(
    instanteBR15h(terca.chave, 1),
  );
  expect(new Date(porTitulo("Acompanhar ata").due_at).getTime()).toBe(
    instanteBR15h(terca.chave, 10),
  );
});

const CERTIDAO = "https://comunicaapi.pje.jus.br/api/v9/comunicacao/E2ETESTE/certidao";

interface Publicacao {
  casoId: string;
  nomeCliente: string;
  numero: string;
  procId: string;
  andamentoId: string;
  terca: { chave: string; br: string };
}

async function seedCasoComProcesso(sufixo: string, comParceiro = true) {
  const nomeCliente = `[E2E] ${sufixo}`;
  const { casoId } = await seedClienteCaso(admin, {
    sufixo,
    parceiroId: comParceiro ? parceiroId : null,
  });
  const numero = `5001${Date.now().toString().slice(-9)}-22.2026.8.26.0001`;
  const procId = await seedProcessoJudicial(casoId, numero);
  return { casoId, nomeCliente, numero, procId };
}

// Andamento do DJEN que designa audiência (o gatilho de aviso cria a tarefa).
async function seedPublicacao(
  base: { casoId: string; nomeCliente: string; numero: string; procId: string },
  terca = proximaTercaBR(),
): Promise<Publicacao> {
  const { data, error } = await admin
    .from("andamentos")
    .insert({
      caso_id: base.casoId,
      origem: "djen",
      titulo: "Intimação — TJSP",
      descricao: `Processo ${base.numero}. Fica designada audiência de conciliação para o dia ${terca.br}, às 14:30, na sala virtual do CEJUSC. Intimem-se.`,
      data_evento: new Date().toISOString(),
      processo_judicial_id: base.procId,
      visivel_parceiro: false,
      metadata: { certidao_url: CERTIDAO, sigla_tribunal: "TJSP" },
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed andamento: ${error.message}`);
  return { ...base, andamentoId: data.id, terca };
}

async function aplicar(andamentoId: string, leitura: Record<string, unknown>) {
  const { data, error } = await admin.rpc("aplicar_audiencia_da_publicacao", {
    p_andamento_id: andamentoId,
    p_leitura: leitura,
  });
  if (error) throw new Error(`aplicar: ${error.message}`);
  return data as { status: string; evento_id: string | null };
}

const leituraComData = (terca: { chave: string }) => ({
  designacao: true,
  data: terca.chave,
  hora: "14:30",
  local: "Sala virtual — CEJUSC",
  link_sala: null,
  tipo_audiencia: "Conciliação (art. 334 CPC)",
  motivo: "designa audiência de conciliação",
});

async function tarefasDoCaso(casoId: string) {
  const { data, error } = await admin
    .from("tarefas")
    .select("id, titulo, status, due_at, processo_judicial_id, responsavel_id, origem_ref, metadata")
    .eq("caso_id", casoId);
  if (error) throw new Error(`tarefas: ${error.message}`);
  return data;
}

test("publicação com data cria a audiência, as tarefas e o aviso completo com o link", async ({
  page,
}) => {
  const base = await seedCasoComProcesso(`Publicacao Com Data ${Date.now()}`);
  const pub = await seedPublicacao(base);

  const r = await aplicar(pub.andamentoId, leituraComData(pub.terca));
  expect(r.status).toBe("agendada");
  expect(r.evento_id).toBeTruthy();

  // Evento: processo, horário de Brasília, local, dono, e sem 2º aviso.
  const { data: ev, error: errEv } = await admin
    .from("agenda_eventos")
    .select("id, titulo, start_at, local, processo_judicial_id, responsavel_id, metadata")
    .eq("id", r.evento_id!)
    .single();
  expect(errEv).toBeNull();
  expect(ev!.titulo).toBe(`Audiência - ${pub.nomeCliente}`);
  expect(new Date(ev!.start_at).getTime()).toBe(
    instanteBR15h(pub.terca.chave, 0) - 30 * 60_000, // 14:30
  );
  expect(ev!.local).toBe("Sala virtual — CEJUSC");
  expect(ev!.processo_judicial_id).toBe(pub.procId);
  expect(ev!.responsavel_id, "evento sem responsável").toBeTruthy();
  expect(ev!.metadata?.aviso_direto).toBe(true);

  const tarefas = await tarefasDoCaso(pub.casoId);
  const doTemplate = tarefas.filter(
    (t) => (t.metadata as { template_aplicado?: string })?.template_aplicado === "audiencia_judicial",
  );
  expect(doTemplate, "tarefas do template").toHaveLength(3);
  for (const t of doTemplate) {
    expect(t.processo_judicial_id, `sem processo: ${t.titulo}`).toBe(pub.procId);
    expect(t.responsavel_id, `sem responsável: ${t.titulo}`).toBeTruthy();
  }
  const preparar = doTemplate.find((t) => t.titulo.startsWith("Preparar audiência"))!;
  // Terça − 3 = sábado → recua pra sexta (terça − 4), mesmo horário.
  expect(new Date(preparar.due_at).getTime()).toBe(
    instanteBR15h(pub.terca.chave, -4) - 30 * 60_000,
  );

  // Aviso: a MESMA tarefa do gatilho, ligada ao evento, texto completo + link.
  const avisos = tarefas.filter((t) => t.origem_ref === `andamento:${pub.andamentoId}`);
  expect(avisos, "uma tarefa de aviso só").toHaveLength(1);
  const aviso = avisos[0];
  const meta = aviso.metadata as { enviar_aviso: { evento_id: string; texto: string } };
  expect(meta.enviar_aviso.evento_id).toBe(r.evento_id);
  expect(meta.enviar_aviso.texto).toContain(pub.terca.br);
  expect(meta.enviar_aviso.texto).toContain("14:30");
  expect(meta.enviar_aviso.texto).toContain("Sala virtual — CEJUSC");
  expect(meta.enviar_aviso.texto).toContain(`📄 Publicação: ${CERTIDAO}`);
  expect(meta.enviar_aviso.texto, "texto ainda com lacunas").not.toContain("_____");
  expect(tarefas.filter((t) => t.origem_ref === `evento:${r.evento_id}`)).toHaveLength(0);

  // Reaplicar a mesma publicação não faz nada.
  expect((await aplicar(pub.andamentoId, leituraComData(pub.terca))).status).toBe("ja_processada");
  expect(await tarefasDoCaso(pub.casoId)).toHaveLength(tarefas.length);

  // Na tela: sem botão de criar audiência; texto pronto pra enviar.
  await page.goto(`/casos/${pub.casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await page.getByText(aviso.titulo).first().click();
  await expect(page.getByRole("heading", { name: "Editar tarefa" })).toBeVisible({
    timeout: 15_000,
  });
  const sheet = page.getByRole("dialog", { name: "Editar tarefa" });
  await expect(sheet.getByLabel("Texto do aviso ao parceiro")).toHaveValue(
    new RegExp(pub.terca.br.replace(/\//g, "\\/")),
  );
  await expect(sheet.getByLabel("Texto do aviso ao parceiro")).toHaveValue(/📄 Publicação: https:/);
  await expect(page.getByRole("button", { name: /Criar audiência na agenda/ })).toHaveCount(0);
});

test("publicação repetida reaproveita o evento e abre tarefa de análise", async () => {
  const base = await seedCasoComProcesso(`Publicacao Repetida ${Date.now()}`);
  const terca = proximaTercaBR();
  const pub1 = await seedPublicacao(base, terca);
  const pub2 = await seedPublicacao(base, terca);

  const r1 = await aplicar(pub1.andamentoId, leituraComData(terca));
  // Mesma data e hora, mas outro local: a análise precisa mostrar a diferença.
  const r2 = await aplicar(pub2.andamentoId, {
    ...leituraComData(terca),
    local: "Sala 8 - CEJUSC (presencial)",
  });
  expect(r1.status).toBe("agendada");
  expect(r2.status).toBe("repetida");
  expect(r2.evento_id).toBe(r1.evento_id);

  const { data: eventos, error } = await admin
    .from("agenda_eventos")
    .select("id")
    .eq("caso_id", base.casoId)
    .eq("tipo", "audiencia");
  expect(error).toBeNull();
  expect(eventos, "evento duplicado").toHaveLength(1);

  const tarefas = await tarefasDoCaso(base.casoId);
  expect(
    tarefas.filter(
      (t) => (t.metadata as { template_aplicado?: string })?.template_aplicado === "audiencia_judicial",
    ),
    "tarefas do template duplicadas",
  ).toHaveLength(3);
  const temChave = (t: { metadata: unknown }, chave: string) =>
    chave in ((t.metadata as object | null) ?? {});
  expect(tarefas.filter((t) => temChave(t, "enviar_aviso")), "dois avisos").toHaveLength(1);

  const analises = tarefas.filter((t) => temChave(t, "analisar_publicacao_repetida"));
  expect(analises, "não abriu a análise da publicação repetida").toHaveLength(1);
  const analise = analises[0];
  expect(analise.titulo).toBe(`Analisar publicação repetida - ${base.nomeCliente}`);
  expect(analise.status).toBe("a_fazer");
  expect(analise.origem_ref).toBe(`andamento:${pub2.andamentoId}`);
  expect(analise.processo_judicial_id).toBe(base.procId);
  expect(analise.responsavel_id, "análise sem responsável").toBeTruthy();
  const { data: det, error: errDet } = await admin
    .from("tarefas")
    .select("descricao, metadata")
    .eq("id", analise.id)
    .single();
  expect(errDet).toBeNull();
  expect(det!.descricao).toContain(terca.br);
  expect(det!.descricao).toContain("Local nesta publicação: Sala 8 - CEJUSC (presencial)");
  expect(det!.descricao).toContain("Local na agenda: Sala virtual — CEJUSC");
  expect(det!.descricao).toContain(`Publicação: ${CERTIDAO}`);
  expect(
    (det!.metadata as { analisar_publicacao_repetida: { evento_id: string } })
      .analisar_publicacao_repetida.evento_id,
  ).toBe(r1.evento_id);

  // Nada foi excluído calado.
  const { data: log, error: errLog } = await admin
    .from("tarefas_excluidas")
    .select("id")
    .eq("caso_id", base.casoId);
  expect(errLog).toBeNull();
  expect(log, "publicação repetida não pode apagar tarefa").toHaveLength(0);
});

test("publicação sem data vira tarefa de conferência, sem evento", async () => {
  const base = await seedCasoComProcesso(`Publicacao Sem Data ${Date.now()}`);
  const pub = await seedPublicacao(base);

  const r = await aplicar(pub.andamentoId, {
    designacao: true,
    data: null,
    hora: null,
    local: null,
    link_sala: null,
    tipo_audiencia: "Conciliação (art. 334 CPC)",
    motivo: "data a ser marcada pelo CEJUSC",
  });
  expect(r.status).toBe("conferir");
  expect(r.evento_id).toBeNull();

  const { data: eventos, error } = await admin
    .from("agenda_eventos")
    .select("id")
    .eq("caso_id", base.casoId);
  expect(error).toBeNull();
  expect(eventos, "não pode inventar evento").toHaveLength(0);

  const [conferir] = (await tarefasDoCaso(pub.casoId)).filter(
    (t) => t.origem_ref === `andamento:${pub.andamentoId}`,
  );
  expect(conferir.titulo).toBe(`Conferir audiência - ${pub.nomeCliente}`);
  const meta = conferir.metadata as Record<string, unknown>;
  expect(meta.enviar_aviso, "conferência não é mais tarefa de aviso").toBeUndefined();
  expect((meta.conferir_audiencia as { motivo: string }).motivo).toContain("data a ser marcada");
});

test("sem data antes, data depois: a conferência vira análise de publicação repetida", async () => {
  const base = await seedCasoComProcesso(`Conferencia Vira Analise ${Date.now()}`);
  const terca = proximaTercaBR();
  const semData = await seedPublicacao(base, terca);
  const comData = await seedPublicacao(base, terca);

  expect(
    (await aplicar(semData.andamentoId, { designacao: true, data: null, hora: null, motivo: "data a ser marcada" }))
      .status,
  ).toBe("conferir");
  const r = await aplicar(comData.andamentoId, leituraComData(terca));
  expect(r.status).toBe("agendada");

  const tarefas = await tarefasDoCaso(base.casoId);
  const temChave = (t: { metadata: unknown }, chave: string) =>
    chave in ((t.metadata as object | null) ?? {});
  expect(tarefas.filter((t) => temChave(t, "conferir_audiencia")), "conferência ficou solta").toHaveLength(0);
  const [analise] = tarefas.filter((t) => temChave(t, "analisar_publicacao_repetida"));
  expect(analise, "a conferência não virou análise").toBeTruthy();
  expect(analise.titulo).toBe(`Analisar publicação repetida - ${base.nomeCliente}`);
  expect(analise.origem_ref).toBe(`andamento:${semData.andamentoId}`);
  const { data: det, error } = await admin
    .from("tarefas")
    .select("descricao, metadata")
    .eq("id", analise.id)
    .single();
  expect(error).toBeNull();
  expect(det!.descricao).toContain("data a ser marcada");
  expect(det!.descricao).toContain(terca.br);
  expect(
    (det!.metadata as { analisar_publicacao_repetida: { evento_id: string } })
      .analisar_publicacao_repetida.evento_id,
  ).toBe(r.evento_id);

  const { data: log, error: errLog } = await admin
    .from("tarefas_excluidas")
    .select("id")
    .eq("caso_id", base.casoId);
  expect(errLog).toBeNull();
  expect(log, "nada pode ser excluído calado").toHaveLength(0);
});

test("data antes, sem data depois: vira análise de publicação repetida, não conferência", async () => {
  const base = await seedCasoComProcesso(`Sem Data Depois ${Date.now()}`);
  const terca = proximaTercaBR();
  const comData = await seedPublicacao(base, terca);
  const semData = await seedPublicacao(base, terca);

  const r1 = await aplicar(comData.andamentoId, leituraComData(terca));
  expect(r1.status).toBe("agendada");
  const r2 = await aplicar(semData.andamentoId, {
    designacao: false,
    data: null,
    hora: null,
    motivo: "movimentação do DataJud sem data",
  });
  expect(r2.status).toBe("repetida");
  expect(r2.evento_id).toBe(r1.evento_id);

  const tarefas = await tarefasDoCaso(base.casoId);
  const temChave = (t: { metadata: unknown }, chave: string) =>
    chave in ((t.metadata as object | null) ?? {});
  expect(tarefas.filter((t) => temChave(t, "conferir_audiencia"))).toHaveLength(0);
  const analises = tarefas.filter((t) => temChave(t, "analisar_publicacao_repetida"));
  expect(analises).toHaveLength(1);
  expect(analises[0].origem_ref).toBe(`andamento:${semData.andamentoId}`);
  expect(tarefas.filter((t) => temChave(t, "enviar_aviso")), "aviso duplicado").toHaveLength(1);
});

// Caso com audiência agendada pela publicação (as 3 tarefas do template).
async function seedAudienciaAgendada(sufixo: string) {
  const base = await seedCasoComProcesso(sufixo);
  const pub = await seedPublicacao(base);
  const r = await aplicar(pub.andamentoId, leituraComData(pub.terca));
  expect(r.status).toBe("agendada");
  const tarefas = await tarefasDoCaso(base.casoId);
  const por = (prefixo: string) => tarefas.find((t) => t.titulo.startsWith(prefixo))!;
  return {
    ...pub,
    eventoId: r.evento_id!,
    preparar: por("Preparar audiência"),
    sentenca: por("Acompanhar ata/sentença"),
  };
}

async function abrirTarefa(page: Page, casoId: string, titulo: string) {
  await page.goto(`/casos/${casoId}`);
  await page.getByText("Atividades", { exact: true }).first().click();
  await page.getByText(titulo).first().click();
  const sheet = page.getByRole("dialog", { name: "Editar tarefa" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  return sheet;
}

async function andamentosDoCaso(casoId: string) {
  const { data, error } = await admin
    .from("andamentos")
    .select("id, titulo, descricao, visivel_parceiro, processo_judicial_id, metadata")
    .eq("caso_id", casoId)
    .eq("origem", "interno");
  if (error) throw new Error(`andamentos: ${error.message}`);
  return data;
}

test("Preparar audiência: Cliente instruído conclui e informa o parceiro", async ({ page }) => {
  const a = await seedAudienciaAgendada(`Cliente Instruido ${Date.now()}`);
  const sheet = await abrirTarefa(page, a.casoId, a.preparar.titulo);

  await sheet.getByRole("button", { name: "Cliente instruído" }).click();
  await expect(sheet.getByText(/Cliente instruído em/)).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole("button", { name: "Cliente instruído" })).toHaveCount(0);

  const { data: t, error } = await admin
    .from("tarefas")
    .select("status, completed_at, metadata")
    .eq("id", a.preparar.id)
    .single();
  expect(error).toBeNull();
  expect(t!.status).toBe("feito");
  expect(t!.completed_at).toBeTruthy();
  expect((t!.metadata as { cliente_instruido_em?: string }).cliente_instruido_em).toBeTruthy();

  const ands = (await andamentosDoCaso(a.casoId)).filter(
    (x) => x.titulo === "Cliente instruído para a audiência",
  );
  expect(ands, "um andamento só").toHaveLength(1);
  expect(ands[0].visivel_parceiro, "parceiro precisa ver").toBe(true);
  expect(ands[0].processo_judicial_id).toBe(a.procId);
  expect(ands[0].descricao).toContain(a.terca.br);
  expect(ands[0].descricao).toContain("14:30");
});

test("Acompanhar ata/sentença: ainda não saiu adia 10 dias; saiu informa o parceiro", async ({
  page,
}) => {
  const a = await seedAudienciaAgendada(`Sentenca ${Date.now()}`);
  const sheet = await abrirTarefa(page, a.casoId, a.sentenca.titulo);

  // --- Ainda não saiu: +10 dias (fora do fim de semana), andamento interno.
  const antes = Date.now();
  await sheet.getByRole("button", { name: "Sentença ainda não saiu" }).click();
  let dueNovo = "";
  await expect
    .poll(
      async () => {
        const { data, error } = await admin
          .from("tarefas")
          .select("due_at")
          .eq("id", a.sentenca.id)
          .single();
        if (error) throw error;
        dueNovo = data.due_at;
        return data.due_at !== a.sentenca.due_at;
      },
      { timeout: 15_000, message: "prazo não foi adiado" },
    )
    .toBe(true);
  const diasAdiados = (new Date(dueNovo).getTime() - antes) / 86400_000;
  expect(diasAdiados).toBeGreaterThanOrEqual(9.9);
  expect(diasAdiados).toBeLessThanOrEqual(12.1); // até +2 se cair no fim de semana
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" })
    .format(new Date(dueNovo));
  expect(["Sat", "Sun"], "próxima conferência no fim de semana").not.toContain(dow);
  const conferencias = (await andamentosDoCaso(a.casoId)).filter((x) =>
    x.titulo.startsWith("Conferência: ata/sentença da audiência ainda não saiu"),
  );
  expect(conferencias).toHaveLength(1);
  expect(conferencias[0].visivel_parceiro, "conferência sem novidade não vai pro parceiro").toBe(
    false,
  );

  // --- Saiu: resumo (com palavras que o gatilho de aviso pegaria) + parceiro.
  await sheet.getByRole("button", { name: "Sentença saiu" }).click();
  await sheet
    .getByLabel("Resumo da sentença para o parceiro")
    .fill("Procedente: concedida a aposentadoria rural. Nova audiência designada? Não.");
  await sheet.getByRole("button", { name: "Registrar e informar o parceiro" }).click();
  await expect(sheet.getByText(/Sentença saiu em/)).toBeVisible({ timeout: 15_000 });

  const { data: t, error } = await admin
    .from("tarefas")
    .select("status, metadata")
    .eq("id", a.sentenca.id)
    .single();
  expect(error).toBeNull();
  expect(t!.status).toBe("feito");
  const meta = t!.metadata as { checagens?: string[]; sentenca_resumo?: string };
  expect(meta.checagens, "histórico de conferências perdido").toHaveLength(2);
  expect(meta.sentenca_resumo).toContain("Procedente");

  const saiu = (await andamentosDoCaso(a.casoId)).filter((x) => x.titulo === "Sentença saiu");
  expect(saiu).toHaveLength(1);
  expect(saiu[0].visivel_parceiro).toBe(true);
  expect(saiu[0].descricao).toContain("Procedente: concedida a aposentadoria rural");
  expect(saiu[0].processo_judicial_id).toBe(a.procId);

  // O resumo falava em "audiência designada": nenhuma tarefa de aviso fantasma.
  const { data: fantasmas, error: errF } = await admin
    .from("tarefas")
    .select("id")
    .eq("origem_ref", `andamento:${saiu[0].id}`);
  expect(errF).toBeNull();
  expect(fantasmas).toHaveLength(0);
});

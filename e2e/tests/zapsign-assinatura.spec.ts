// E2E: assinatura eletrônica pelo ZapSign (#517).
//
// O que prova:
//   · sem credencial a function responde 412, e documento de outro escritório
//     responde 404 (nunca 412: não revela que o id existe);
//   · o admin cadastra o token (cifrado, nunca volta) e o segredo do webhook
//     nasce junto; quem não tem `documentos:enviar` não envia;
//   · o envio cria o documento no ZapSign com o id da nossa linha como
//     `external_id`, deixa trilha, e o segundo clique não gasta a cota de novo;
//   · o webhook só aceita o segredo do escritório, IGNORA o que o corpo diz
//     (status vem da leitura na API) e, com dois avisos ao mesmo tempo, grava
//     o PDF assinado UMA vez só;
//   · a tela mostra o envio como "Assinado" e o endereço do webhook.
//
// Só no banco local com o seed (`bun run local:rbac`) e o mock dos provedores
// (`node e2e/demo/mocks/provedores.cjs`, ZAPSIGN_BASE_URL no supabase/functions/.env).
import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import type { Session } from "@supabase/supabase-js";
import { ENV, PROJECT_REF } from "../env";
import { adminClient } from "../supabase-admin";
import { cursorVisivel } from "../cursor";
import { formatoAssinavel } from "../../supabase/functions/_shared/assinatura";
import {
  chamarFuncao, contaDoCanario, contaPadrao, escritorioCanario, escritorioPadrao, idDoCanario, limpezaLocal, sessaoComo,
  ultimaLinhaDaTrilha,
} from "../rbac";

const admin = adminClient();
const MOCK = "http://localhost:8787";
const WEBHOOK = `${ENV.supabaseUrl}/functions/v1/zapsign-webhook`;
const NOME_DOC = "E2E ZapSign - Contrato e procuracao.pdf";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

let ESC1: string;
let ESC2: string;
let casoId: string;
let docId: string;
let assinaturaId: string;
let docToken: string;
let segredoWebhook: string;
let mockVivo = false;
// CPFs fictícios (válidos pelos dígitos) dos clientes que nascem de documento criado direto no ZapSign
const CPF_ADOTADO = "52998224725";
const CPFS_DE_TESTE = [CPF_ADOTADO];

/** Faz o papel do painel do ZapSign: cria o documento lá, sem passar pelo sistema. */
async function criarNoPainel(corpo: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${MOCK}/zapsign/api/v1/docs/`, {
    method: "POST", headers: { Authorization: "Bearer token-zapsign-canario", "Content-Type": "application/json" },
    body: JSON.stringify({ base64_pdf: PDF.toString("base64"), ...corpo }),
  });
  const j = (await r.json()) as { token?: string };
  if (!r.ok || !j.token) throw new Error(`criando documento no simulador: HTTP ${r.status}`);
  return j.token;
}
async function clientesDeTeste() {
  const { data, error } = await admin.from("clientes").select("id, nome, cpf, email, endereco").eq("escritorio_id", ESC2).in("cpf", CPFS_DE_TESTE);
  if (error) throw new Error(`lendo clientes de teste: ${error.message}`);
  return data ?? [];
}

async function avisar(token: string | null, corpo: Record<string, unknown>, onde: "url" | "cabecalho" = "url") {
  // o segredo vai no cabeçalho `x-inbound-token` (o que o ZapSign recomenda) ou, como antes, em `?token=`
  const r = await fetch(token === null || onde === "cabecalho" ? WEBHOOK : `${WEBHOOK}?token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token !== null && onde === "cabecalho" ? { "x-inbound-token": token } : {}) }, body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  return { status: r.status, json, texto };
}
async function linhaDaAssinatura() {
  const { data, error } = await admin.from("assinaturas").select("status, documento_assinado_id, signatarios, zapsign_doc_token").eq("id", assinaturaId).single();
  if (error) throw new Error(`lendo a assinatura: ${error.message}`);
  return data as { status: string; documento_assinado_id: string | null; signatarios: Array<{ papel: string; status: string; sign_url: string }>; zapsign_doc_token: string };
}
async function documentosAssinados() {
  const { data, error } = await admin.from("documentos").select("id, tipo, nome_arquivo, storage_path").eq("caso_id", casoId).like("nome_arquivo", "E2E ZapSign%(assinado).pdf");
  if (error) throw new Error(`lendo documentos assinados: ${error.message}`);
  return data ?? [];
}
async function tarefasDaAssinatura(id: string) {
  const { data, error } = await admin.from("tarefas").select("titulo, status, tipo, responsavel_id, origem_ref, completed_at")
    .eq("origem", "zapsign_assinatura").like("origem_ref", `%:${id}`).order("created_at");
  if (error) throw new Error(`lendo tarefas da assinatura: ${error.message}`);
  return data ?? [];
}
async function limpar() {
  if (!ESC2) return;
  const e0 = await admin.from("tarefas").delete().eq("escritorio_id", ESC2).eq("origem", "zapsign_assinatura");
  if (e0.error) throw new Error(`limpeza de tarefas: ${e0.error.message}`);
  // envios que nasceram de um modelo (#522): o PDF assinado deles não tem o prefixo "E2E ZapSign"
  const { data: deModelo, error: eMod } = await admin.from("assinaturas").select("id, documento_assinado_id").eq("escritorio_id", ESC2).not("modelo_token", "is", null);
  if (eMod) throw new Error(`limpeza dos envios de modelo: ${eMod.message}`);
  if (deModelo?.length) {
    const eDelMod = await admin.from("assinaturas").delete().in("id", deModelo.map((a) => a.id));
    if (eDelMod.error) throw new Error(`limpeza dos envios de modelo: ${eDelMod.error.message}`);
    const idsDocs = deModelo.map((a) => a.documento_assinado_id).filter((x): x is string => !!x);
    if (idsDocs.length) {
      const { data: docsMod } = await admin.from("documentos").select("id, storage_path").in("id", idsDocs);
      if (docsMod?.length) {
        await admin.storage.from("documentos").remove(docsMod.map((d) => d.storage_path));
        const eDocMod = await admin.from("documentos").delete().in("id", docsMod.map((d) => d.id));
        if (eDocMod.error) throw new Error(`limpeza dos PDFs de modelo: ${eDocMod.error.message}`);
      }
    }
  }
  const e1 = await admin.from("assinaturas").delete().eq("escritorio_id", ESC2).like("nome", "E2E ZapSign%");
  if (e1.error) throw new Error(`limpeza de assinaturas: ${e1.error.message}`);
  const { data: docs, error: e2 } = await admin.from("documentos").select("id, storage_path").eq("escritorio_id", ESC2).like("nome_arquivo", "E2E ZapSign%");
  if (e2) throw new Error(`limpeza de documentos: ${e2.message}`);
  if (docs?.length) {
    await admin.storage.from("documentos").remove(docs.map((d) => d.storage_path));
    const e3 = await admin.from("documentos").delete().in("id", docs.map((d) => d.id));
    if (e3.error) throw new Error(`limpeza de documentos: ${e3.error.message}`);
  }
  // clientes e casos que nasceram de documento criado direto no ZapSign
  const { data: cls, error: e5 } = await admin.from("clientes").select("id").eq("escritorio_id", ESC2).in("cpf", CPFS_DE_TESTE);
  if (e5) throw new Error(`limpeza de clientes: ${e5.message}`);
  if (cls?.length) {
    const ids = cls.map((c) => c.id);
    const e6 = await admin.from("casos").delete().in("cliente_id", ids);
    if (e6.error) throw new Error(`limpeza de casos: ${e6.error.message}`);
    const e7 = await admin.from("clientes").delete().in("id", ids);
    if (e7.error) throw new Error(`limpeza de clientes: ${e7.error.message}`);
  }
  const e4 = await admin.from("escritorio_integracoes").delete().eq("escritorio_id", ESC2).eq("tipo", "zapsign");
  if (e4.error) throw new Error(`limpeza de escritorio_integracoes: ${e4.error.message}`);
}
async function contexto(browser: Browser, baseURL: string, session: Session, escritorioId: string): Promise<BrowserContext> {
  return browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin: new URL(baseURL).origin, localStorage: [
        { name: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(session) },
        { name: "msc:escritorio_ativo", value: escritorioId },
      ] }],
    },
  });
}

test.describe.serial("ZapSign: enviar do caso e receber o assinado", () => {
  test.beforeAll(async () => {
    test.skip(!ENV.local, "só no banco local");
    ESC2 = await escritorioCanario();
    ESC1 = await escritorioPadrao();
    mockVivo = await fetch(`${MOCK}/_health`).then((r) => r.ok).catch(() => false);
    await limpar();
    const { data: caso, error: eCaso } = await admin.from("casos").select("id").eq("escritorio_id", ESC2).order("created_at").order("id").limit(1).single();
    if (eCaso || !caso) throw new Error(`caso do Canário: ${eCaso?.message ?? "nenhum"}`);
    casoId = caso.id;
    const caminho = `${casoId}/${Date.now()}_e2e_zapsign_contrato.pdf`;
    const up = await admin.storage.from("documentos").upload(caminho, PDF, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(`upload do documento de teste: ${up.error.message}`);
    const { data: doc, error: eDoc } = await admin.from("documentos")
      .insert({ caso_id: casoId, tipo: "contrato_honorarios", nome_arquivo: NOME_DOC, storage_path: caminho, tamanho_bytes: PDF.length, uploaded_by: await idDoCanario("admin") })
      .select("id").single();
    if (eDoc || !doc) throw new Error(`documento de teste: ${eDoc?.message ?? "sem retorno"}`);
    docId = doc.id;
  });
  test.afterAll(limpezaLocal(limpar));

  test("sem credencial: 412; documento de outro escritório: 404", async () => {
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const r = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "enviar", documento_id: docId });
    expect(r.status, r.texto.slice(0, 160)).toBe(412);
    expect(r.json?.code).toBe("integracao_nao_configurada");
    const { data: alheio, error } = await admin.from("documentos").select("id").eq("escritorio_id", ESC1).limit(1).maybeSingle();
    if (error) throw new Error(`documento do escritório padrão: ${error.message}`);
    test.skip(!alheio, "escritório padrão sem documento para o ataque");
    const ataque = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "enviar", documento_id: alheio!.id });
    expect(ataque.status, "id de outro escritório não pode revelar que existe").toBe(404);
  });

  test("admin cadastra o token (cifrado) e testa; o segredo do webhook nasce junto; financeiro não envia", async () => {
    test.skip(!mockVivo, "mock dos provedores (:8787) fora do ar");
    const adm = await sessaoComo(contaDoCanario("admin"), ESC2);
    const salvo = await chamarFuncao("integracoes-escritorio", adm.jwt, ESC2, { action: "salvar", tipo: "zapsign", config: { ambiente: "sandbox", inbound_token: "escolhido-pela-tela" }, segredo: "token-zapsign-canario" });
    expect(salvo.status, salvo.texto.slice(0, 160)).toBe(200);
    expect(salvo.texto).not.toContain("token-zapsign-canario");
    const config = salvo.json?.config as { ambiente: string; inbound_token: string };
    expect(config.ambiente).toBe("sandbox");
    expect(config.inbound_token, "o segredo do webhook é gerado, não aceito da tela").toMatch(/^[0-9a-f]{48}$/);
    segredoWebhook = config.inbound_token;
    const teste = await chamarFuncao("integracoes-escritorio", adm.jwt, ESC2, { action: "testar", tipo: "zapsign" });
    expect(teste.json?.ok, teste.texto.slice(0, 160)).toBe(true);
    // financeiro não tem documentos:enviar
    const fin = await sessaoComo(contaDoCanario("financeiro"), ESC2);
    expect((await chamarFuncao("zapsign-enviar", fin.jwt, ESC2, { action: "enviar", documento_id: docId })).status).toBe(403);
    // parceiro nem é interno
    const par = await sessaoComo(contaDoCanario("parceiro"), ESC2);
    expect((await chamarFuncao("zapsign-enviar", par.jwt, ESC2, { action: "enviar", documento_id: docId })).status).toBe(403);
  });

  test("advogado envia: documento criado no ZapSign com o nosso id, trilha gravada, segundo clique recusado", async () => {
    test.skip(!mockVivo, "mock dos provedores (:8787) fora do ar");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const corpo = { action: "enviar", documento_id: docId, cliente: { email: "cliente.e2e@exemplo.com.br", telefone: "(17) 99999-0000" }, segundo: { nome: "Advogada Canário", email: "advogada.e2e@exemplo.com.br" } };
    const r = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo);
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    const a = r.json?.assinatura as { id: string; status: string; sandbox: boolean; zapsign_doc_token: string; signatarios: Array<{ papel: string; sign_url: string; telefone: string }> };
    expect(a.status).toBe("enviado");
    expect(a.sandbox).toBe(true);
    expect(a.signatarios.map((s) => s.papel)).toEqual(["cliente", "escritorio"]);
    expect(a.signatarios[0].telefone).toBe("17999990000");
    expect(a.signatarios[0].sign_url).toContain("/verificar/");
    assinaturaId = a.id;
    docToken = a.zapsign_doc_token;
    // o que chegou no ZapSign
    const lado = (await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<{ token: string; external_id: string; name: string; signers: Array<{ send_automatic_whatsapp: boolean; send_automatic_email: boolean }> }>;
    const la = lado.find((d) => d.token === docToken);
    expect(la?.external_id).toBe(assinaturaId);
    expect(la?.name).toBe(NOME_DOC);
    expect(la?.signers[0].send_automatic_whatsapp).toBe(true);
    // ao enviar nasce UMA tarefa, a de acompanhar, em nome de quem enviou
    const noEnvio = await tarefasDaAssinatura(assinaturaId);
    expect(noEnvio.map((t) => `${t.status} ${t.titulo}`)).toEqual([`a_fazer Acompanhar assinatura: ${NOME_DOC}`]);
    expect(noEnvio[0].responsavel_id).toBe(adv.id);
    // trilha
    const trilha = await ultimaLinhaDaTrilha(ESC2, "assinatura.enviada");
    expect(trilha?.recurso_id).toBe(assinaturaId);
    // a tela lê pela VIEW `assinaturas_tela` (#545): interno vê, parceiro não.
    // A tabela `assinaturas` em si está fechada para a tela (nem leitura).
    const { data: visto, error: eVisto } = await adv.sb.from("assinaturas_tela").select("id").eq("id", assinaturaId);
    expect(eVisto).toBeNull();
    expect(visto).toHaveLength(1);
    const par = await sessaoComo(contaDoCanario("parceiro"), ESC2);
    const { data: doParceiro, error: eParceiro } = await par.sb.from("assinaturas_tela").select("id").eq("id", assinaturaId);
    expect(eParceiro, "a leitura do parceiro não falha: volta vazia").toBeNull();
    expect(doParceiro).toHaveLength(0);
    // escrita direta pela API REST é negada
    const { error: eEscrita } = await adv.sb.from("assinaturas").update({ status: "assinado" }).eq("id", assinaturaId);
    expect(eEscrita?.code).toBe("42501");
    // segundo clique
    const repetido = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo);
    expect(repetido.status).toBe(409);
    expect(repetido.json?.code).toBe("ja_em_assinatura");
  });

  test("o sign_url sai da leitura ampla e só vem pela RPC, com escopo e trilha (#545)", async () => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);

    // A tela lê a VIEW: a linha aparece, mas sem o `sign_url` cru — só `tem_link`.
    const { data: naTela, error: eTela } = await adv.sb.from("assinaturas_tela").select("id, signatarios").eq("id", assinaturaId).single();
    expect(eTela).toBeNull();
    const sigs = naTela!.signatarios as Array<{ token: string; papel: string; status: string; tem_link: boolean; sign_url?: string }>;
    expect(sigs.every((s) => s.sign_url === undefined), "o sign_url não vem na view").toBe(true);
    const cli = sigs.find((s) => s.papel === "cliente")!;
    expect(cli.tem_link, "o cliente pendente tem link para copiar").toBe(true);

    // a própria coluna `signatarios` da TABELA (onde mora o sign_url cru) não é
    // legível pela API REST — nem para quem gerencia: o único caminho é a RPC.
    const cru = await adv.sb.from("assinaturas").select("signatarios").eq("id", assinaturaId);
    expect(cru.error, "a coluna signatarios é inalcançável pela tela").not.toBeNull();
    // mas ler o id (o que `exigirRecurso` faz) segue valendo
    const soId = await adv.sb.from("assinaturas").select("id").eq("id", assinaturaId);
    expect([soId.error, soId.data?.length]).toEqual([null, 1]);

    // O link vem pela RPC, para quem gerencia (documentos:enviar), e deixa trilha.
    const { data: link, error: eLink } = await adv.sb.rpc("assinatura_sign_url", { p_assinatura_id: assinaturaId, p_signatario_token: cli.token });
    expect(eLink, eLink?.message).toBeNull();
    expect(String(link)).toContain("/verificar/");
    const trilha = await ultimaLinhaDaTrilha(ESC2, "assinatura.link_copiado");
    expect(trilha?.recurso_id).toBe(assinaturaId);
    expect((trilha?.detalhes as { signatario?: string })?.signatario).toBe(cli.token);

    // Interno sem documentos:enviar e sem ser dono do caso (financeiro): vê a linha, NÃO o link.
    const fin = await sessaoComo(contaDoCanario("financeiro"), ESC2);
    const { data: finVe } = await fin.sb.from("assinaturas_tela").select("id").eq("id", assinaturaId);
    expect(finVe, "financeiro é interno: vê o envelope").toHaveLength(1);
    const finLink = await fin.sb.rpc("assinatura_sign_url", { p_assinatura_id: assinaturaId, p_signatario_token: cli.token });
    expect(finLink.error, "mas o link lhe é recusado").not.toBeNull();
    expect(finLink.error?.code).toBe("42501");

    // Parceiro não é interno: nem a linha, nem o link.
    const par = await sessaoComo(contaDoCanario("parceiro"), ESC2);
    const { data: parVe } = await par.sb.from("assinaturas_tela").select("id").eq("id", assinaturaId);
    expect(parVe).toHaveLength(0);
    expect((await par.sb.rpc("assinatura_sign_url", { p_assinatura_id: assinaturaId, p_signatario_token: cli.token })).error).not.toBeNull();

    // Ramo "dono do caso": o responsável alcança o link mesmo sem documentos:enviar.
    const { data: caso } = await admin.from("casos").select("responsavel_id").eq("id", casoId).single();
    const finId = await idDoCanario("financeiro");
    expect((await admin.from("casos").update({ responsavel_id: finId }).eq("id", casoId)).error).toBeNull();
    try {
      const comoDono = await fin.sb.rpc("assinatura_sign_url", { p_assinatura_id: assinaturaId, p_signatario_token: cli.token });
      expect(comoDono.error, "dono do caso alcança mesmo sem a permissão").toBeNull();
      expect(String(comoDono.data)).toContain("/verificar/");
    } finally {
      await admin.from("casos").update({ responsavel_id: caso!.responsavel_id }).eq("id", casoId);
    }
  });

  test("webhook: exige o segredo do escritório, ignora o que o corpo diz e grava o PDF assinado uma vez só", async () => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    expect((await avisar(null, { token: docToken })).status).toBe(401);
    expect((await avisar("segredo-errado", { token: docToken })).status).toBe(401);
    // documento que não saiu do sistema (criado direto no painel): 200 e nada acontece
    const alheio = await avisar(segredoWebhook, { event_type: "doc_signed", token: "00000000-0000-0000-0000-000000000000", status: "signed" });
    expect(alheio.status).toBe(200);
    expect(alheio.json.ignorado).toBeTruthy();
    // corpo forjado: diz "signed", mas no ZapSign ninguém assinou
    const forjado = await avisar(segredoWebhook, { event_type: "doc_signed", token: docToken, status: "signed", signed_file: "https://exemplo.invalid/falso.pdf" });
    expect(forjado.status).toBe(200);
    expect((await linhaDaAssinatura()).status).toBe("enviado");
    expect(await documentosAssinados()).toHaveLength(0);
    // o cliente assina; falta o escritório
    await fetch(`${MOCK}/zapsign/_assinar/${docToken}?quem=0`, { method: "POST" });
    expect((await avisar(segredoWebhook, { event_type: "doc_signed", token: docToken })).status).toBe(200);
    const meio = await linhaDaAssinatura();
    expect(meio.status).toBe("aberto");
    expect(meio.signatarios.map((s) => s.status)).toEqual(["assinou", "pendente"]);
    // todos assinam; o ZapSign manda dois avisos colados (um por signatário / reenvio)
    await fetch(`${MOCK}/zapsign/_assinar/${docToken}?quem=todos`, { method: "POST" });
    const [a1, a2] = await Promise.all([
      avisar(segredoWebhook, { event_type: "doc_signed", token: docToken }),
      avisar(segredoWebhook, { event_type: "doc_signed", token: docToken }),
    ]);
    expect([a1.status, a2.status]).toEqual([200, 200]);
    await expect.poll(async () => (await linhaDaAssinatura()).status, { timeout: 15_000 }).toBe("assinado");
    const assinados = await documentosAssinados();
    expect(assinados, "o PDF assinado entra no caso UMA vez").toHaveLength(1);
    expect(assinados[0].tipo, "herda o tipo do arquivo enviado").toBe("contrato_honorarios");
    expect((await linhaDaAssinatura()).documento_assinado_id).toBe(assinados[0].id);
    const baixado = await admin.storage.from("documentos").download(assinados[0].storage_path);
    expect(baixado.error).toBeNull();
    expect(Buffer.from(await baixado.data!.arrayBuffer()).toString("utf8")).toContain("assinado (simulação)");
    // aviso repetido depois de pronto: nada muda
    expect((await avisar(segredoWebhook, { event_type: "doc_signed", token: docToken })).status).toBe(200);
    expect(await documentosAssinados()).toHaveLength(1);
    // tarefas: a de acompanhar foi concluída sozinha e nasceu UMA de dar prosseguimento, com o nome do documento
    const depois = await tarefasDaAssinatura(assinaturaId);
    expect(depois.map((t) => `${t.status} ${t.titulo}`).sort()).toEqual([
      `a_fazer Contrato assinado — dar prosseguimento: ${NOME_DOC}`,
      `feito Acompanhar assinatura: ${NOME_DOC}`,
    ]);
    expect(depois.find((t) => t.status === "feito")?.completed_at).toBeTruthy();
    // o PDF que voltou assinado não se envia de novo
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const reenvio = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "enviar", documento_id: assinados[0].id });
    expect(reenvio.status).toBe(409);
    expect(reenvio.json?.code).toBe("ja_assinado");
    // o escritório padrão não enxerga nada disso
    const e2e = await sessaoComo(contaPadrao("interno"), ESC1);
    const { data: deFora, error: eFora } = await e2e.sb.from("assinaturas_tela").select("id").eq("id", assinaturaId);
    expect(eFora).toBeNull();
    expect(deFora).toHaveLength(0);
    // "Atualizar" pela function: de outro escritório é 404; id que não é uuid é 400; do dono, devolve a linha
    const sinc = (jwt: string, esc: string, id: unknown) => chamarFuncao("zapsign-enviar", jwt, esc, { action: "sincronizar", assinatura_id: id });
    expect((await sinc(e2e.jwt, ESC1, assinaturaId)).status).toBe(404);
    const dono = await sessaoComo(contaDoCanario("advogado"), ESC2);
    expect((await sinc(dono.jwt, ESC2, "não-é-uuid")).status).toBe(400);
    const ok = await sinc(dono.jwt, ESC2, assinaturaId);
    expect([ok.status, (ok.json?.assinatura as { status?: string })?.status]).toEqual([200, "assinado"]);
  });

  test("telefone de fora do Brasil vai com o código do país; código de país desconhecido colado ao número é recusado", async () => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const colado = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "enviar", documento_id: docId, cliente: { email: "cliente.e2e@exemplo.com.br", telefone: "+999613761609" } });
    expect(colado.status, "não adivinha onde o código do país termina").toBe(400);
    const r = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "enviar", documento_id: docId, cliente: { email: "cliente.e2e@exemplo.com.br", telefone: "+34 613761609" } });
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    const token = (r.json?.assinatura as { zapsign_doc_token: string }).zapsign_doc_token;
    const lado = (await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<{ token: string; signers: Array<{ phone_country: string; phone_number: string }> }>;
    const la = lado.find((d) => d.token === token);
    expect([la?.signers[0].phone_country, la?.signers[0].phone_number]).toEqual(["34", "613761609"]);
    // some do ZapSign para não deixar envio em curso (o teste de tela quer o botão do original ligado)
    await fetch(`${MOCK}/zapsign/_excluir/${token}`, { method: "POST" });
    const excluido = await avisar(segredoWebhook, { event_type: "doc_deleted", token });
    expect([excluido.status, excluido.json.status]).toEqual([200, "cancelado"]);
  });

  test("dois envios ao mesmo tempo gastam uma cota só; recusado pelo signatário vira Recusado e libera novo envio", async () => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const corpo = { action: "enviar", documento_id: docId, cliente: { email: "cliente.e2e@exemplo.com.br" } };
    const antes = ((await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as unknown[]).length;
    const [a, b] = await Promise.all([chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo), chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo)]);
    expect([a.status, b.status].sort(), `${a.texto.slice(0, 120)} | ${b.texto.slice(0, 120)}`).toEqual([200, 409]);
    const depois = ((await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as unknown[]).length;
    expect(depois - antes, "só UM documento nasce no ZapSign").toBe(1);
    const venceu = (a.status === 200 ? a : b).json?.assinatura as { id: string; zapsign_doc_token: string };
    // o signatário recusa: o envio vira Recusado e o documento pode ser enviado de novo
    await fetch(`${MOCK}/zapsign/_recusar/${venceu.zapsign_doc_token}`, { method: "POST" });
    const recusa = await avisar(segredoWebhook, { event_type: "doc_refused", token: venceu.zapsign_doc_token });
    expect([recusa.status, recusa.json.status]).toEqual([200, "recusado"]);
    const { data: linha, error } = await admin.from("assinaturas").select("status").eq("id", venceu.id).single();
    expect([error, linha?.status]).toEqual([null, "recusado"]);

    // A documentação do ZapSign escreve a recusa de dois jeitos ("refused" e "recusado") e a abertura do
    // link também ("link-opened" e "abriu-link"): as duas formas valem, senão o recusado ficaria "enviado".
    const emPt = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo);
    expect(emPt.status, emPt.texto.slice(0, 160)).toBe(200);
    const pt = emPt.json?.assinatura as { id: string; zapsign_doc_token: string };
    await fetch(`${MOCK}/zapsign/_recusar/${pt.zapsign_doc_token}?forma=pt`, { method: "POST" });
    expect((await avisar(segredoWebhook, { event_type: "doc_refused", token: pt.zapsign_doc_token })).json.status).toBe("recusado");
    const { data: ptLinha } = await admin.from("assinaturas").select("signatarios").eq("id", pt.id).single();
    expect((ptLinha?.signatarios as Array<{ status: string }>)[0].status).toBe("abriu");
  });

  test("cancelar e excluir envio (#550): cancela no ZapSign e fecha a tarefa; excluir só o encerrado; PDF e tarefas só se pedidos, com a trilha de quem", async () => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const corpo = { action: "enviar", documento_id: docId, cliente: { email: "cliente.e2e@exemplo.com.br" } };
    const enviar = async () => {
      const r = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo);
      expect(r.status, r.texto.slice(0, 160)).toBe(200);
      return r.json?.assinatura as { id: string; zapsign_doc_token: string };
    };
    const docsLa = async () => (await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<{ token: string; deleted?: boolean }>;

    // 1) em curso: quem não exclui documento é barrado; excluir sem cancelar antes é recusado
    const envio = await enviar();
    const fin = await sessaoComo(contaDoCanario("financeiro"), ESC2);
    expect((await chamarFuncao("zapsign-enviar", fin.jwt, ESC2, { action: "cancelar", assinatura_id: envio.id })).status).toBe(403);
    const cedo = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "excluir", assinatura_id: envio.id });
    expect([cedo.status, cedo.json?.code]).toEqual([409, "em_curso"]);

    // 2) cancelar: exclui no ZapSign, a linha vira cancelado e a tarefa de acompanhar fecha
    const cancelado = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "cancelar", assinatura_id: envio.id });
    expect(cancelado.status, cancelado.texto.slice(0, 160)).toBe(200);
    expect((cancelado.json?.assinatura as { status: string }).status).toBe("cancelado");
    expect((await docsLa()).find((d) => d.token === envio.zapsign_doc_token)?.deleted).toBe(true);
    expect((await tarefasDaAssinatura(envio.id)).map((t) => t.status)).toEqual(["cancelado"]);
    expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "cancelar", assinatura_id: envio.id })).status, "cancelar de novo").toBe(409);

    // 3) excluir o cancelado, com as tarefas: a tarefa sai com o motivo na trilha
    const tarefaId = (await admin.from("tarefas").select("id").eq("origem", "zapsign_assinatura").eq("origem_ref", `acompanhar:${envio.id}`).single()).data!.id;
    const fora = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "excluir", assinatura_id: envio.id, apagar_tarefas: true });
    expect(fora.status, fora.texto.slice(0, 160)).toBe(200);
    expect((await admin.from("assinaturas").select("id").eq("id", envio.id)).data).toHaveLength(0);
    const { data: tarefaLog } = await admin.from("tarefas_excluidas").select("excluida_por, motivo").eq("tarefa_id", tarefaId).single();
    expect([tarefaLog!.excluida_por, String(tarefaLog!.motivo)]).toEqual([adv.id, expect.stringContaining("Envio do ZapSign excluído")]);
    const { data: trilha } = await admin.from("auditoria").select("acao, ator_id").eq("recurso_id", envio.id).order("created_at");
    expect((trilha ?? []).map((l) => l.acao)).toEqual(["assinatura.enviada", "assinatura.cancelada", "assinatura.excluida"]);

    // 4) assinado: excluir SEM marcar nada deixa o PDF e as tarefas no caso
    const assinado1 = await enviar();
    await fetch(`${MOCK}/zapsign/_assinar/${assinado1.zapsign_doc_token}?quem=todos`, { method: "POST" });
    expect((await avisar(segredoWebhook, { event_type: "doc_signed", token: assinado1.zapsign_doc_token })).json.status).toBe("assinado");
    const pdf1 = (await admin.from("assinaturas").select("documento_assinado_id").eq("id", assinado1.id).single()).data!.documento_assinado_id;
    expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "excluir", assinatura_id: assinado1.id })).status).toBe(200);
    expect((await admin.from("documentos").select("id").eq("id", pdf1)).data, "o PDF assinado continua no caso").toHaveLength(1);
    expect(await tarefasDaAssinatura(assinado1.id), "as tarefas continuam").toHaveLength(2);

    // 5) assinado: marcando o PDF, ele sai — e a trilha de documentos registra quem
    const assinado2 = await enviar();
    await fetch(`${MOCK}/zapsign/_assinar/${assinado2.zapsign_doc_token}?quem=todos`, { method: "POST" });
    expect((await avisar(segredoWebhook, { event_type: "doc_signed", token: assinado2.zapsign_doc_token })).json.status).toBe("assinado");
    const pdf2 = (await admin.from("assinaturas").select("documento_assinado_id").eq("id", assinado2.id).single()).data!.documento_assinado_id;
    const comPdf = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "excluir", assinatura_id: assinado2.id, apagar_pdf: true, apagar_tarefas: true });
    expect(comPdf.status, comPdf.texto.slice(0, 160)).toBe(200);
    expect((await admin.from("documentos").select("id").eq("id", pdf2)).data).toHaveLength(0);
    expect((await admin.from("documentos_excluidos").select("excluido_por").eq("documento_id", pdf2).single()).data!.excluido_por).toBe(adv.id);
    expect(await tarefasDaAssinatura(assinado2.id)).toHaveLength(0);
    // o PDF do passo 4 sai de cena para os testes de tela
    await admin.from("documentos").delete().eq("id", pdf1);
  });

  test("documento que não está na conta ligada (404, ou envio de outro ambiente) NÃO vira cancelado nem libera envio em dobro", async () => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const corpo = { action: "enviar", documento_id: docId, cliente: { email: "cliente.e2e@exemplo.com.br" } };
    const envio = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo);
    expect(envio.status, envio.texto.slice(0, 160)).toBe(200);
    const linha = envio.json?.assinatura as { id: string; zapsign_doc_token: string };
    let limpeza: string | null = null;
    const statusNoBanco = async () => (await admin.from("assinaturas").select("status").eq("id", linha.id).single()).data?.status;
    const sinc = () => chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "sincronizar", assinatura_id: linha.id });
    try {
      // excluir no ZapSign é só uma marca (o documento continua respondendo); 404 é documento de OUTRA conta
      await fetch(`${MOCK}/zapsign/_sumir/${linha.zapsign_doc_token}`, { method: "POST" });
      const aviso = await avisar(segredoWebhook, { event_type: "doc_signed", token: linha.zapsign_doc_token });
      expect([aviso.status, aviso.json.ignorado], "200 para o ZapSign não ficar reenviando").toEqual([200, "documento fora da conta ligada"]);
      const pelaTela = await sinc();
      expect([pelaTela.status, pelaTela.json?.code]).toEqual([409, "documento_fora_da_conta"]);
      expect(await statusNoBanco(), "o envio fica como estava").toBe("enviado");
      expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo)).status, "segue em curso: não libera um segundo envio").toBe(409);
      // envio feito na produção com a integração hoje no sandbox: nem pergunta ao ZapSign
      expect((await admin.from("assinaturas").update({ sandbox: false }).eq("id", linha.id)).error).toBeNull();
      expect((await sinc()).json?.code).toBe("documento_fora_da_conta");
      expect(await statusNoBanco()).toBe("enviado");
    } finally {
      // sai de cena: os testes de tela querem o botão do original ligado
      limpeza = (await admin.from("assinaturas").delete().eq("id", linha.id)).error?.message ?? null;
    }
    expect(limpeza, "a linha do teste foi removida").toBeNull();
  });

  test("resposta do ZapSign que se perde não é dada como 'não enviou': a linha fica e o aviso de criação religa", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const nome = "E2E ZapSign - [sem resposta].pdf";
    const caminho = `${casoId}/${Date.now()}_e2e_zapsign_sem_resposta.pdf`;
    const up = await admin.storage.from("documentos").upload(caminho, PDF, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data: doc, error: eDoc } = await admin.from("documentos")
      .insert({ caso_id: casoId, tipo: "contrato_honorarios", nome_arquivo: nome, storage_path: caminho, tamanho_bytes: PDF.length, uploaded_by: adv.id }).select("id").single();
    if (eDoc || !doc) throw new Error(eDoc?.message ?? "sem documento");
    const r = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "enviar", documento_id: doc.id, cliente: { email: "cliente.e2e@exemplo.com.br" } });
    expect([r.status, r.json?.code], r.texto.slice(0, 200)).toEqual([502, "envio_incerto"]);
    // a linha NÃO foi apagada (o documento existe lá) e barra o reenvio imediato
    const { data: presa, error: ePresa } = await admin.from("assinaturas").select("id, status, zapsign_doc_token").eq("documento_id", doc.id);
    expect(ePresa).toBeNull();
    expect(presa?.map((l) => [l.status, l.zapsign_doc_token])).toEqual([["enviando", null]]);
    expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "enviar", documento_id: doc.id, cliente: { email: "cliente.e2e@exemplo.com.br" } })).status).toBe(409);
    // o aviso de criação do ZapSign chega: a linha ganha o token, sem virar cliente novo nem tarefa de cadastro
    const lado = (await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<{ token: string; external_id: string }>;
    const criado = lado.find((d) => d.external_id === presa![0].id);
    expect(criado, "o documento existe no ZapSign").toBeTruthy();
    const aviso = await avisar(segredoWebhook, { event_type: "doc_created", token: criado!.token });
    expect(aviso.json.ignorado).toBe("documento enviado pelo sistema");
    const { data: religada } = await admin.from("assinaturas").select("status, zapsign_doc_token").eq("id", presa![0].id).single();
    expect([religada?.status, religada?.zapsign_doc_token]).toEqual(["enviado", criado!.token]);
    expect((await tarefasDaAssinatura(presa![0].id)).map((t) => t.titulo)).toEqual([`Acompanhar assinatura: ${nome}`]);
    const { data: semCpf } = await admin.from("tarefas").select("id").eq("origem_ref", `sem_cpf:${criado!.token}`);
    expect(semCpf).toHaveLength(0);
  });

  test("uma conta do ZapSign por escritório; o endereço do webhook pode ser trocado e o antigo para de valer", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    // o mesmo token da API em outro escritório é recusado (o aviso do ZapSign vale para a conta inteira)
    const padrao = await sessaoComo(contaPadrao("admin"), ESC1);
    const repetido = await chamarFuncao("integracoes-escritorio", padrao.jwt, ESC1, { action: "salvar", tipo: "zapsign", config: { ambiente: "sandbox" }, segredo: "token-zapsign-canario" });
    expect([repetido.status, repetido.json?.code], repetido.texto.slice(0, 160)).toEqual([409, "token_em_uso"]);
    // gerar endereço novo: o segredo muda, o antigo vira 401
    const adm = await sessaoComo(contaDoCanario("admin"), ESC2);
    const novo = await chamarFuncao("integracoes-escritorio", adm.jwt, ESC2, { action: "gerar_token", tipo: "zapsign" });
    expect(novo.status, novo.texto.slice(0, 160)).toBe(200);
    const segredoNovo = (novo.json?.config as { inbound_token: string }).inbound_token;
    expect(segredoNovo).toMatch(/^[0-9a-f]{48}$/);
    expect(segredoNovo).not.toBe(segredoWebhook);
    expect((await avisar(segredoWebhook, { event_type: "doc_signed", token: docToken })).status).toBe(401);
    expect((await avisar(segredoNovo, { event_type: "doc_signed", token: docToken })).status).toBe(200);
    // o segredo no cabeçalho (o que o card ensina a cadastrar) vale igual; o antigo, nem no cabeçalho
    expect((await avisar(segredoNovo, { event_type: "doc_signed", token: docToken }, "cabecalho")).status).toBe(200);
    expect((await avisar(segredoWebhook, { event_type: "doc_signed", token: docToken }, "cabecalho")).status).toBe(401);
    segredoWebhook = segredoNovo;
  });

  test("documento criado direto no ZapSign: sem CPF vira só tarefa; só com gente da equipe é ignorado", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    // sem CPF não há cadastro: fica a tarefa pedindo o cadastro, sem caso
    const semCpf = await criarNoPainel({ name: "E2E ZapSign - painel sem CPF.pdf", signers: [{ name: "E2E ZapSign Sem Cpf", email: "semcpf.e2e@exemplo.com.br" }] });
    const r1 = await avisar(segredoWebhook, { event_type: "doc_created", token: semCpf });
    expect(r1.status, r1.texto.slice(0, 160)).toBe(200);
    expect(r1.json.ignorado).toBe("signatário sem CPF");
    const { data: pedido, error: ePedido } = await admin.from("tarefas").select("titulo, caso_id, escritorio_id, descricao").eq("origem", "zapsign_assinatura").eq("origem_ref", `sem_cpf:${semCpf}`);
    if (ePedido) throw new Error(ePedido.message);
    expect(pedido).toHaveLength(1);
    expect(pedido![0].caso_id).toBeNull();
    expect(pedido![0].escritorio_id).toBe(ESC2);
    expect(pedido![0].descricao).toContain("semcpf.e2e@exemplo.com.br");
    // aviso repetido não duplica a tarefa
    expect((await avisar(segredoWebhook, { event_type: "doc_created", token: semCpf })).status).toBe(200);
    const { data: denovo } = await admin.from("tarefas").select("id").eq("origem_ref", `sem_cpf:${semCpf}`);
    expect(denovo).toHaveLength(1);
    // todos os signatários são da equipe (documento interno): nada nasce, mesmo com CPF
    const interno = await criarNoPainel({ name: "E2E ZapSign - painel interno.pdf", signers: [{ name: "Admin Canário", email: contaDoCanario("admin"), cpf: CPF_ADOTADO }] });
    const r2 = await avisar(segredoWebhook, { event_type: "doc_created", token: interno });
    expect(r2.json.ignorado).toBe("todos os signatários são da equipe");
    // CPF só num campo que fala de OUTRA pessoa, ou dois CPFs diferentes nas respostas: não dá para saber
    // qual é o do cliente — vira a tarefa de cadastro, em vez de o contrato entrar no cliente errado
    const deOutro = await criarNoPainel({
      name: "E2E ZapSign - painel CPF do representante.pdf", signers: [{ name: "E2E ZapSign Representado", email: "representado.e2e@exemplo.com.br" }],
      answers: [{ variable: "CPF DO REPRESENTANTE LEGAL", value: "529.982.247-25" }],
    });
    expect((await avisar(segredoWebhook, { event_type: "doc_created", token: deOutro })).json.ignorado).toBe("signatário sem CPF");
    const doisCpfs = await criarNoPainel({
      name: "E2E ZapSign - painel dois CPFs.pdf", signers: [{ name: "E2E ZapSign Dois Cpfs", email: "doiscpfs.e2e@exemplo.com.br" }],
      answers: [{ variable: "CPF", value: "529.982.247-25" }, { variable: "CPF DO CONTRATANTE 2", value: "111.444.777-35" }],
    });
    expect((await avisar(segredoWebhook, { event_type: "doc_created", token: doisCpfs })).json.ignorado).toBe("signatário sem CPF");
    // aviso que não é de criação, de documento desconhecido, não adota (contrato antigo não vira cliente)
    const antigo = await criarNoPainel({ name: "E2E ZapSign - painel antigo.pdf", signers: [{ name: "E2E ZapSign Antigo", cpf: CPF_ADOTADO }] });
    expect((await avisar(segredoWebhook, { event_type: "doc_signed", token: antigo })).json.ignorado).toBeTruthy();
    expect(await clientesDeTeste()).toHaveLength(0);
  });

  test("documento criado direto no ZapSign com CPF: nasce cliente, caso e a tarefa de acompanhar; assinado, troca a tarefa", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const advogado = await idDoCanario("advogado");
    // CPF no signatário; quem criou no ZapSign é a advogada, que também assina
    const doc = await criarNoPainel({
      name: "E2E ZapSign - painel com CPF.pdf", created_by_email: contaDoCanario("advogado"),
      signers: [
        { name: "E2E ZapSign Cliente Novo", email: "novo.e2e@exemplo.com.br", cpf: "529.982.247-25", phone_country: "55", phone_number: "17999990001" },
        { name: "Advogada Canário", email: contaDoCanario("advogado") },
      ],
    });
    const r = await avisar(segredoWebhook, { event_type: "doc_created", token: doc });
    expect(r.status, r.texto.slice(0, 200)).toBe(200);
    expect([r.json.adotado, r.json.cliente_novo, r.json.caso_novo]).toEqual([true, true, true]);
    const [cliente] = await clientesDeTeste();
    expect([cliente.nome, cliente.cpf, cliente.email]).toEqual(["E2E ZAPSIGN CLIENTE NOVO", CPF_ADOTADO, "novo.e2e@exemplo.com.br"]);
    const { data: casos, error: eCasos } = await admin.from("casos").select("id, tipo_beneficio, responsavel_id, escritorio_id").eq("cliente_id", cliente.id);
    if (eCasos) throw new Error(eCasos.message);
    expect(casos).toHaveLength(1);
    expect([casos![0].tipo_beneficio, casos![0].responsavel_id, casos![0].escritorio_id]).toEqual(["a_definir", advogado, ESC2]);
    const { data: linhas, error: eLinhas } = await admin.from("assinaturas").select("id, caso_id, status, signatarios, enviado_por").eq("zapsign_doc_token", doc);
    if (eLinhas) throw new Error(eLinhas.message);
    expect(linhas).toHaveLength(1);
    const linha = linhas![0] as { id: string; caso_id: string; status: string; enviado_por: string; signatarios: Array<{ papel: string }> };
    expect([linha.caso_id, linha.status, linha.enviado_por]).toEqual([casos![0].id, "enviado", advogado]);
    expect(linha.signatarios.map((x) => x.papel)).toEqual(["cliente", "escritorio"]);
    const t1 = await tarefasDaAssinatura(linha.id);
    expect(t1.map((t) => `${t.status} ${t.titulo}`)).toEqual(["a_fazer Acompanhar assinatura: E2E ZapSign - painel com CPF.pdf"]);
    expect(t1[0].responsavel_id).toBe(advogado);
    // aviso de criação repetido: nada em dobro
    expect((await avisar(segredoWebhook, { event_type: "doc_created", token: doc })).status).toBe(200);
    expect(await clientesDeTeste()).toHaveLength(1);
    expect((await admin.from("casos").select("id").eq("cliente_id", cliente.id)).data).toHaveLength(1);
    expect(await tarefasDaAssinatura(linha.id)).toHaveLength(1);

    // segundo contrato do MESMO cliente, agora de um modelo (CPF e endereço nas respostas): reaproveita cliente e caso
    const doModelo = await criarNoPainel({
      name: "E2E ZapSign - painel modelo.pdf", signers: [{ name: "Outro Nome Digitado" }],
      answers: [{ variable: "NOME COMPLETO", value: "Outro Nome Digitado" }, { variable: "NÚMERO DO CPF", value: "529.982.247-25" }, { variable: "ENDEREÇO", value: "Rua Fictícia, 100" }],
    });
    const r2 = await avisar(segredoWebhook, { event_type: "doc_created", token: doModelo });
    expect([r2.json.adotado, r2.json.cliente_novo, r2.json.caso_novo], r2.texto.slice(0, 200)).toEqual([true, false, false]);
    const depois = await clientesDeTeste();
    expect(depois).toHaveLength(1);
    expect(depois[0].nome, "cliente que já existe não é sobrescrito").toBe("E2E ZAPSIGN CLIENTE NOVO"); // o banco grava em caixa alta
    const { data: linha2 } = await admin.from("assinaturas").select("caso_id").eq("zapsign_doc_token", doModelo).single();
    expect(linha2?.caso_id).toBe(casos![0].id);

    // todos assinam o primeiro: PDF no caso, acompanhar concluída, nasce a de dar prosseguimento
    await fetch(`${MOCK}/zapsign/_assinar/${doc}?quem=todos`, { method: "POST" });
    const fim = await avisar(segredoWebhook, { event_type: "doc_signed", token: doc });
    expect(fim.json.status, fim.texto.slice(0, 200)).toBe("assinado");
    const { data: pdfs } = await admin.from("documentos").select("nome_arquivo, tipo").eq("caso_id", casos![0].id);
    expect((pdfs ?? []).map((d) => d.nome_arquivo)).toEqual(["E2E ZapSign - painel com CPF (assinado).pdf"]);
    const t2 = await tarefasDaAssinatura(linha.id);
    expect(t2.map((t) => `${t.status} ${t.titulo}`).sort()).toEqual([
      "a_fazer Contrato assinado — dar prosseguimento: E2E ZapSign - painel com CPF.pdf",
      "feito Acompanhar assinatura: E2E ZapSign - painel com CPF.pdf",
    ]);
  });

  test("modelos da conta: lista inteira (todas as páginas), só DOCX ativo, com os campos já respondidos pelo cadastro", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const lista = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "modelos" });
    expect(lista.status, lista.texto.slice(0, 200)).toBe(200);
    const modelos = lista.json?.modelos as Array<{ token: string; nome: string; pasta: string }>;
    // 25 no ZapSign simulado (2 páginas): saem o de PDF e o desativado
    expect(modelos).toHaveLength(23);
    expect(modelos.some((m) => /PDF|desativado/.test(m.nome))).toBe(false);
    expect(modelos.some((m) => m.nome === "Contrato cível 11"), "modelo da segunda página do ZapSign").toBe(true);
    expect(modelos.map((m) => m.pasta)).toEqual([...modelos.map((m) => m.pasta)].sort((a, b) => a.localeCompare(b, "pt-BR")));
    // financeiro não tem documentos:enviar; caso de outro escritório é 404
    const fin = await sessaoComo(contaDoCanario("financeiro"), ESC2);
    expect((await chamarFuncao("zapsign-enviar", fin.jwt, ESC2, { action: "modelos" })).status).toBe(403);
    const { data: alheio } = await admin.from("casos").select("id").eq("escritorio_id", ESC1).limit(1).single();
    expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "modelo", caso_id: alheio!.id, modelo_token: "modelo-03" })).status).toBe(404);

    const { data: caso } = await admin.from("casos").select("clientes(nome, cpf)").eq("id", casoId).single();
    const cli = (caso as unknown as { clientes: { nome: string; cpf: string } }).clientes;
    const det = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "modelo", caso_id: casoId, modelo_token: "modelo-03" });
    expect(det.status, det.texto.slice(0, 200)).toBe(200);
    const campos = Object.fromEntries((det.json?.campos as Array<{ rotulo: string; sugestao: string; obrigatorio: boolean; variavel: string }>).map((c) => [c.rotulo, c]));
    expect(campos["NOME COMPLETO"].sugestao).toBe(cli.nome);
    expect(campos["CPF"].sugestao.replace(/\D/g, "")).toBe(cli.cpf);
    expect(campos["CPF"].sugestao, "CPF vem formatado para o contrato").toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect(campos["NOME DA MÃE"].sugestao, "nome da mãe NÃO é o nome do cliente").toBe("");
    expect([campos["VALOR DOS HONORÁRIOS"].sugestao, campos["VALOR DOS HONORÁRIOS"].obrigatorio]).toEqual(["", true]);
    expect(campos["CPF"].variavel).toBe("{{CPF}}");
    // nome e CPF de quem assina são do cadastro: fixos (a tela não mostra, o servidor envia o cadastro)
    const fixos = campos as unknown as Record<string, { fixo: boolean }>;
    expect([fixos["NOME COMPLETO"].fixo, fixos["CPF"].fixo, fixos["NOME DA MÃE"].fixo]).toEqual([true, true, false]);
    expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "modelo", caso_id: casoId, modelo_token: "nao-existe" })).status).toBe(404);
  });

  test("contrato gerado de um modelo: campos obrigatórios cobrados, um envio em curso por modelo, PDF assinado entra com o tipo escolhido", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const MODELO = "Contrato de honorários - Aposentadoria por idade";
    const base = { action: "enviar_modelo", caso_id: casoId, modelo_token: "modelo-03", cliente: { email: "cliente.e2e@exemplo.com.br" }, tipo_documento: "procuracao" };
    const incompleto = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas: { "{{NOME COMPLETO}}": "Helena Bastos Ferraz" } });
    expect([incompleto.status, incompleto.json?.code]).toEqual([400, "campos_faltando"]);
    expect(String(incompleto.json?.error)).toContain("VALOR DOS HONORÁRIOS");
    expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, tipo_documento: "inventado", respostas: {} })).status).toBe(400);

    const respostas = { "{{NOME COMPLETO}}": "Helena Bastos Ferraz", "{{CPF}}": "770.000.001-80", "{{VALOR DOS HONORÁRIOS}}": "30%", "{{CAMPO QUE NÃO EXISTE}}": "x" };
    // dois cliques ao mesmo tempo: um envio só
    const [a, b] = await Promise.all([
      chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas }),
      chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas }),
    ]);
    expect([a.status, b.status].sort(), `${a.texto.slice(0, 120)} | ${b.texto.slice(0, 120)}`).toEqual([200, 409]);
    const ass = (a.status === 200 ? a : b).json?.assinatura as { id: string; nome: string; status: string; zapsign_doc_token: string; documento_id: string | null; modelo_token: string; signatarios: Array<{ papel: string; email: string }> };
    expect([ass.nome, ass.status, ass.documento_id, ass.modelo_token]).toEqual([MODELO, "enviado", null, "modelo-03"]);
    expect(ass.signatarios.map((s) => [s.papel, s.email])).toEqual([["cliente", "cliente.e2e@exemplo.com.br"]]);
    // o que chegou no ZapSign: o nosso id, só os campos que o modelo tem, e-mail automático
    const lado = (await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<{ token: string; external_id: string; template_id: string; answers: Array<{ variable: string; value: string }>; signers: Array<{ send_automatic_email: boolean }> }>;
    const la = lado.find((d) => d.token === ass.zapsign_doc_token)!;
    expect([la.external_id, la.template_id, la.signers[0].send_automatic_email]).toEqual([ass.id, "modelo-03", true]);
    expect(la.answers.map((x) => x.variable).sort()).toEqual(["CPF", "NOME COMPLETO", "VALOR DOS HONORÁRIOS"]);
    // o que a tela mandou no nome e no CPF não vale: foi o cadastro do cliente
    const { data: doCad } = await admin.from("casos").select("clientes(nome, cpf)").eq("id", casoId).single();
    const cad = (doCad as unknown as { clientes: { nome: string; cpf: string } }).clientes;
    const foiAo = Object.fromEntries(la.answers.map((x) => [x.variable, x.value]));
    expect([foiAo["NOME COMPLETO"], foiAo["CPF"].replace(/\D/g, "")]).toEqual([cad.nome, cad.cpf]);
    expect((await tarefasDaAssinatura(ass.id)).map((t) => `${t.status} ${t.titulo}`)).toEqual([`a_fazer Acompanhar assinatura: ${MODELO}`]);
    // o aviso de criação do próprio envio não vira "documento criado direto no ZapSign"
    expect((await avisar(segredoWebhook, { event_type: "doc_created", token: ass.zapsign_doc_token })).json.status).toBe("enviado");

    // o cliente assina: PDF no caso com o tipo escolhido e troca das tarefas
    await fetch(`${MOCK}/zapsign/_assinar/${ass.zapsign_doc_token}?quem=todos`, { method: "POST" });
    const fim = await avisar(segredoWebhook, { event_type: "doc_signed", token: ass.zapsign_doc_token });
    expect(fim.json.status, fim.texto.slice(0, 200)).toBe("assinado");
    const { data: linha } = await admin.from("assinaturas").select("documento_assinado_id").eq("id", ass.id).single();
    const { data: pdf, error: ePdf } = await admin.from("documentos").select("nome_arquivo, tipo, caso_id").eq("id", linha!.documento_assinado_id).single();
    expect(ePdf).toBeNull();
    expect([pdf!.nome_arquivo, pdf!.tipo, pdf!.caso_id]).toEqual([`${MODELO} (assinado).pdf`, "procuracao", casoId]);
    expect((await tarefasDaAssinatura(ass.id)).map((t) => `${t.status} ${t.titulo}`).sort()).toEqual([
      `a_fazer Contrato assinado — dar prosseguimento: ${MODELO}`,
      `feito Acompanhar assinatura: ${MODELO}`,
    ]);
    // assinado não está mais em curso: o mesmo modelo pode ser enviado de novo neste caso (e sai de cena para o próximo teste)
    const denovo = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas });
    expect(denovo.status, denovo.texto.slice(0, 160)).toBe(200);
    const tokenNovo = (denovo.json?.assinatura as { zapsign_doc_token: string }).zapsign_doc_token;
    await fetch(`${MOCK}/zapsign/_excluir/${tokenNovo}`, { method: "POST" });
    expect((await avisar(segredoWebhook, { event_type: "doc_deleted", token: tokenNovo })).json.status).toBe("cancelado");
  });

  test("envio por modelo que falha sem criar o documento não trava o modelo no caso para sempre", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const base = { action: "enviar_modelo", caso_id: casoId, modelo_token: "modelo-03", cliente: { email: "cliente.e2e@exemplo.com.br" } };
    const boas = { "{{NOME COMPLETO}}": "Helena Bastos Ferraz", "{{CPF}}": "770.000.001-80", "{{VALOR DOS HONORÁRIOS}}": "30%" };
    // o ZapSign responde 500 e NÃO cria o documento: não dá para saber, então a linha fica `enviando`
    const falhou = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas: { ...boas, "{{VALOR DOS HONORÁRIOS}}": "30% [fora do ar]" } });
    expect([falhou.status, falhou.json?.code], falhou.texto.slice(0, 160)).toEqual([502, "envio_incerto"]);
    const { data: presas, error: ePresas } = await admin.from("assinaturas").select("id, status").eq("caso_id", casoId).eq("modelo_token", "modelo-03").eq("status", "enviando");
    if (ePresas) throw new Error(ePresas.message);
    expect(presas).toHaveLength(1);
    // na hora, segue barrado (pode ser só a resposta que se perdeu: reenviar gastaria a cota em dobro)
    expect((await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas: boas })).status).toBe(409);
    // passados os 2 minutos sem o aviso de criação religar, a linha morta sai e o modelo volta a poder ser enviado
    expect((await admin.from("assinaturas").update({ created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString() }).eq("id", presas![0].id)).error).toBeNull();
    const denovo = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas: boas });
    expect(denovo.status, denovo.texto.slice(0, 160)).toBe(200);
    const { data: restou } = await admin.from("assinaturas").select("id").eq("id", presas![0].id);
    expect(restou, "a linha morta foi removida").toHaveLength(0);
    const token = (denovo.json?.assinatura as { zapsign_doc_token: string }).zapsign_doc_token;
    await fetch(`${MOCK}/zapsign/_excluir/${token}`, { method: "POST" });
    expect((await avisar(segredoWebhook, { event_type: "doc_deleted", token })).json.status).toBe("cancelado");
  });

  test("tela: 'Gerar contrato' lista todos os modelos, sugere os do tipo de benefício do caso, busca sem acento e abre os campos preenchidos", async ({ browser, baseURL }) => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const { session } = await sessaoComo(contaDoCanario("admin"));
    const ctx = await contexto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      const { data: caso } = await admin.from("casos").select("tipo_beneficio, clientes(nome)").eq("id", casoId).single();
      const doCaso = caso as unknown as { tipo_beneficio: string; clientes: { nome: string } };
      await page.goto(`/casos/${casoId}?tab=documentos`);
      await page.locator("[data-gerar-contrato]").click();
      const dlg = page.locator("[data-dialog-modelos]");
      await expect(dlg.locator("[data-contagem-modelos]")).toHaveText("23 modelos");
      await expect(dlg.locator("[data-modelo]").first()).toBeVisible();
      // sugeridos: só quando o tipo de benefício do caso casa com o nome de algum modelo
      const esperaSugestao = /aposentadoria|aux[ií]lio|pens[aã]o|revis[aã]o|bpc|sal[aá]rio/i.test(doCaso.tipo_beneficio);
      await expect(dlg.locator("[data-modelos-sugeridos]")).toHaveCount(esperaSugestao ? 1 : 0);
      await expect(dlg.locator("[data-modelos-pasta]")).toHaveCount(4);
      // busca sem acento, por palavra do nome
      await dlg.locator("[data-busca-modelo]").fill("pensao");
      await expect(dlg.locator("[data-contagem-modelos]")).toHaveText("1 de 23 modelos");
      await expect(dlg.locator("[data-modelo]")).toHaveCount(1);
      await expect(dlg.locator("[data-modelos-sugeridos]")).toHaveCount(0);
      await dlg.locator("[data-modelo]").click();
      // passo 2: campos do modelo já com o cadastro; obrigatório vazio segura o envio
      await expect(dlg.locator("[data-campos-modelo]")).toBeVisible();
      await expect(dlg.getByRole("heading", { name: "Contrato de honorários - Pensão por morte" })).toBeVisible();
      // nome e CPF de quem assina não são perguntados: aparecem só no "Quem assina", vindos do cadastro
      await expect(dlg.locator('[data-campo="{{NOME COMPLETO}}"]')).toHaveCount(0);
      await expect(dlg.locator('[data-campo="{{CPF}}"]')).toHaveCount(0);
      // no bloco do contratante: nome e CPF do cadastro, travados; o endereço do modelo também mora lá
      await expect(dlg.locator("#contratante-nome")).toHaveValue(doCaso.clientes.nome);
      await expect(dlg.locator("#contratante-nome")).toHaveAttribute("readonly", "");
      await expect(dlg.locator("#contratante-cpf")).toHaveValue(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
      await expect(dlg.locator("#contratante-cpf")).toHaveAttribute("readonly", "");
      await expect(dlg.locator('[data-campo="{{ENDEREÇO}}"]')).toHaveCount(0);
      await expect(dlg.locator("[data-endereco] #end-rua")).toBeVisible();
      await expect(dlg.getByLabel(/NOME DA MÃE/)).toHaveValue("");
      await expect(dlg.getByRole("button", { name: "Enviar para assinatura" })).toBeDisabled();
      // WhatsApp: país com o Brasil por padrão e máscara de DDD; fora do Brasil, só os dígitos
      const campoTel = dlg.locator("[data-telefone-com-pais]");
      await expect(campoTel.locator('[data-selecao="telefone-pais"]')).toContainText("+55");
      await campoTel.locator("input[type=tel]").pressSequentially("17999990000");
      await expect(campoTel.locator("input[type=tel]")).toHaveValue("(17) 99999-0000");
      await campoTel.locator('[data-selecao="telefone-pais"]').click();
      await page.locator("[data-selecao-busca]").fill("espanha");
      await page.getByRole("option", { name: /Espanha/ }).click();
      await expect(campoTel.locator('[data-selecao="telefone-pais"]')).toContainText("+34");
      await expect(campoTel.locator("input[type=tel]"), "trocar de país tira a máscara do Brasil").toHaveValue("17999990000");
      await dlg.getByLabel(/VALOR DOS HONORÁRIOS/).fill("30%");
      await expect(dlg.getByRole("button", { name: "Enviar para assinatura" })).toBeEnabled();
      // "Outro modelo" volta à lista inteira
      await dlg.getByRole("button", { name: "Outro modelo" }).click();
      await expect(dlg.locator("[data-contagem-modelos]")).toHaveText("1 de 23 modelos");
      await dlg.getByRole("button", { name: "Cancelar" }).click();
      await expect(dlg).toHaveCount(0);
      // reabrir: a lista guardada aparece na hora, sem ir ao ZapSign (menos de 1 minuto)
      const listas: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/functions/v1/zapsign-enviar") && (r.postData() ?? "").includes('"modelos"')) listas.push(r.url());
      });
      await page.locator("[data-gerar-contrato]").click();
      await expect(dlg.locator("[data-contagem-modelos]")).toHaveText("23 modelos");
      expect(listas, "a lista veio do cache").toHaveLength(0);
      // "Atualizar" vai ao ZapSign na hora
      await dlg.locator("[data-atualizar-modelos]").click();
      await expect.poll(() => listas.length).toBe(1);
      await dlg.getByRole("button", { name: "Cancelar" }).click();
    } finally {
      await ctx.close();
    }
  });

  test("honorários do modelo: padrão vem do texto de ajuda, o extenso é do sistema, a faixa é cobrada e a prévia não cria documento", async () => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    type Campo = { variavel: string; rotulo: string; sugestao: string; padrao: string; tipo: string; maximo: number | null; extensoDe: string | null; copiaDe: string | null; ajuda: string; especie: string | null; opcoes: Array<string> };
    const det = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "modelo", caso_id: casoId, modelo_token: "modelo-kit" });
    expect(det.status, det.texto.slice(0, 200)).toBe(200);
    const campos = Object.fromEntries((det.json?.campos as Array<Campo>).map((c) => [c.variavel, c]));
    const perc = campos["{{PERCENTUAL_ATRASADOS}}"];
    expect([perc.tipo, perc.padrao, perc.sugestao, perc.maximo, perc.ajuda]).toEqual(["percentual", "35%", "35%", 50, ""]);
    expect([campos["{{QTD_PRESTACOES}}"].tipo, campos["{{QTD_PRESTACOES}}"].sugestao]).toEqual(["inteiro", "5"]);
    expect(campos["{{PERCENTUAL_ATRASADOS_EXTENSO}}"].extensoDe).toBe("{{PERCENTUAL_ATRASADOS}}");
    expect(campos["{{TEXTO_PARCEIRO}}"].ajuda, "ajuda que não é regra continua na tela").toContain("Nome do parceiro");
    // o que o sistema monta sem ninguém digitar: qualificação (cadastro), benefício (caso + catálogo) e a data de hoje
    const { data: doCaso } = await admin.from("casos").select("tipo_beneficio, clientes(nome, cpf)").eq("id", casoId).single();
    const cc = doCaso as unknown as { tipo_beneficio: string; clientes: { nome: string; cpf: string } };
    const quali = campos["{{QUALIFICACAO_CONTRATANTE}}"];
    expect(quali.especie).toBe("qualificacao");
    expect(quali.sugestao.startsWith(`${cc.clientes.nome}, brasileiro(a), CPF n.º ${cc.clientes.cpf.slice(0, 3)}.`), quali.sugestao).toBe(true);
    const obj = campos["{{OBJETO_SERVICO}}"];
    expect(obj.especie).toBe("beneficio");
    expect(obj.opcoes).toContain("pensão por morte");
    expect(obj.opcoes, "'Outro' não é benefício: quem não achar escreve").not.toContain("outro");
    if (!/^outro$/i.test(cc.tipo_beneficio)) expect(obj.sugestao.toLowerCase()).toBe(cc.tipo_beneficio.toLowerCase());
    // o segundo campo de benefício do modelo repete o primeiro; o parceiro vem do caso
    expect(campos["{{BENEFICIO_OBJETO}}"].copiaDe).toBe("{{OBJETO_SERVICO}}");
    const { data: comParceiro } = await admin.from("casos").select("parceiro_id").eq("id", casoId).single();
    const nomeParceiro = comParceiro?.parceiro_id ? (await admin.from("usuarios").select("nome").eq("id", comParceiro.parceiro_id).single()).data?.nome : null;
    expect(campos["{{TEXTO_PARCEIRO}}"].sugestao).toBe(nomeParceiro || "não há");
    expect(campos["{{DATA}}"].sugestao).toMatch(/^\d{1,2} de [a-zç]+ de \d{4}$/);

    const antes = ((await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<unknown>).length;
    const respostas = {
      "{{NOME_ASSINANTE}}": "Helena Bastos Ferraz", "{{CPF_ASSINANTE}}": "770.000.001-80", "{{QUALIFICACAO_CONTRATANTE}}": "brasileira, aposentada",
      "{{OBJETO_SERVICO}}": "revisão de aposentadoria", "{{BENEFICIO_OBJETO}}": "o que a tela mandar aqui não vale",
      "{{PERCENTUAL_ATRASADOS}}": "30", "{{QTD_PRESTACOES}}": "4", "{{CIDADE}}": "São Paulo", "{{DATA}}": "20 de novembro de 2026", "{{FORO}}": "São Paulo",
      // o que a tela mandar no extenso não vale: quem escreve é o servidor
      "{{PERCENTUAL_ATRASADOS_EXTENSO}}": "noventa por cento",
    };
    // o texto do modelo vem em parágrafos, com os campos por preencher; ler NÃO cria documento no ZapSign
    type Par = { centro: boolean; trechos: Array<{ t: string; n: boolean }> };
    const lido = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "texto_modelo", caso_id: casoId, modelo_token: "modelo-kit" });
    expect(lido.status, lido.texto.slice(0, 200)).toBe(200);
    const pars = lido.json?.paragrafos as Array<Par>;
    const texto = pars.map((p) => p.trechos.map((t) => t.t).join(""));
    expect(pars[0].centro).toBe(true);
    // o campo que o Word partiu em dois pedaços chega inteiro no texto do parágrafo
    expect(texto).toContain("a) {{PERCENTUAL_ATRASADOS}} ({{PERCENTUAL_ATRASADOS_EXTENSO}}) sobre os valores retroativos;");
    expect(texto).toContain("Sigilo & dados. Parceiro indicador: {{TEXTO_PARCEIRO}}");
    expect(((await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<unknown>).length, "ler o modelo NÃO cria documento no ZapSign").toBe(antes);
    // modelo sem arquivo avisa e não derruba
    const semArquivo = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { action: "texto_modelo", caso_id: casoId, modelo_token: "modelo-03" });
    expect([semArquivo.status, semArquivo.json?.code]).toEqual([422, "previa_indisponivel"]);

    // envio: acima do máximo do modelo é recusado ANTES de ir ao ZapSign
    const base = { action: "enviar_modelo", caso_id: casoId, modelo_token: "modelo-kit", cliente: { email: "cliente.e2e@exemplo.com.br" } };
    const acima = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas: { ...respostas, "{{PERCENTUAL_ATRASADOS}}": "60%" } });
    expect([acima.status, acima.json?.code]).toEqual([400, "campos_faltando"]);
    expect(String(acima.json?.error)).toContain("o máximo deste modelo é 50%");
    const texto2 = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas: { ...respostas, "{{QTD_PRESTACOES}}": "cinco" } });
    expect([texto2.status, String(texto2.json?.error)]).toEqual([400, expect.stringContaining("use só o número")]);
    expect(((await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<unknown>).length).toBe(antes);

    const ok = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, { ...base, respostas });
    expect(ok.status, ok.texto.slice(0, 200)).toBe(200);
    const token = (ok.json?.assinatura as { zapsign_doc_token: string }).zapsign_doc_token;
    const lado = (await (await fetch(`${MOCK}/zapsign/_docs`)).json()) as Array<{ token: string; answers: Array<{ variable: string; value: string }> }>;
    const foi = Object.fromEntries(lado.find((d) => d.token === token)!.answers.map((x) => [x.variable, x.value]));
    expect([foi.PERCENTUAL_ATRASADOS, foi.PERCENTUAL_ATRASADOS_EXTENSO, foi.QTD_PRESTACOES, foi.QTD_PRESTACOES_EXTENSO]).toEqual(["30%", "trinta por cento", "4", "quatro"]);
    expect(foi.TEXTO_PARCEIRO, "campo opcional vazio não vai").toBeUndefined();
    // sai de cena para os próximos testes
    await fetch(`${MOCK}/zapsign/_excluir/${token}`, { method: "POST" });
    expect((await avisar(segredoWebhook, { event_type: "doc_deleted", token })).json.status).toBe("cancelado");
  });

  test("tela: o kit abre com os honorários do modelo, mostra o extenso, segura o que passa do máximo e deixa conferir o contrato antes de enviar", async ({ browser, baseURL }) => {
    test.skip(!mockVivo || !segredoWebhook, "depende da integração");
    const { session } = await sessaoComo(contaDoCanario("admin"), ESC2);
    const ctx = await contexto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto(`/casos/${casoId}?tab=documentos`);
      await page.locator("[data-gerar-contrato]").click();
      const dlg = page.locator("[data-dialog-modelos]");
      await dlg.locator("[data-busca-modelo]").fill("kit");
      await dlg.locator('[data-modelo="modelo-kit"]').click();
      await expect(dlg.locator("[data-campos-modelo]")).toBeVisible();
      const perc = dlg.locator('[data-campo="{{PERCENTUAL_ATRASADOS}}"]');
      await expect(perc.locator("input")).toHaveValue("35%");
      await expect(perc.locator("[data-origem-do-valor]")).toHaveText("padrão do modelo");
      await expect(perc.locator("[data-extenso]")).toHaveText("No contrato: 35% (trinta e cinco por cento)");
      // os campos "por extenso" não são pedidos: quem escreve é o sistema
      await expect(dlg.locator('[data-campo="{{PERCENTUAL_ATRASADOS_EXTENSO}}"]')).toHaveCount(0);
      await expect(dlg.locator('[data-campo="{{QTD_PRESTACOES}}"] [data-extenso]')).toHaveText("No contrato: 5 (cinco)");
      await perc.locator("input").fill("30");
      await expect(perc.locator("[data-extenso]")).toHaveText("No contrato: 30% (trinta por cento)");
      await expect(perc.locator("[data-origem-do-valor]")).toHaveText("padrão do modelo: 35%");
      // qualificação: nome, CPF e endereço do cadastro; o resto se escolhe em lista e o sistema escreve a frase
      const quali = dlg.locator("[data-qualificacao]");
      await expect(quali.locator("[data-qualificacao-texto]")).toContainText("brasileiro(a), CPF n.º");
      await quali.locator('[data-parte="estado-civil"] button').click();
      await page.getByRole("option", { name: "casado(a)" }).click();
      await quali.locator('[data-parte="profissao"] button').click();
      await page.getByRole("option", { name: /Outro/ }).click();
      await quali.locator('[data-parte="profissao"] input').fill("costureira");
      await expect(quali.locator("[data-qualificacao-texto]")).toContainText("brasileiro(a), casado(a), costureira, CPF n.º");
      // benefício: lista do escritório (já vem o do caso, quando o caso tem um)
      // o benefício é perguntado UMA vez, mesmo com dois campos no modelo; o parceiro vem do caso
      await expect(dlg.locator('[data-campo="{{BENEFICIO_OBJETO}}"]')).toHaveCount(0);
      await dlg.locator('[data-campo="{{OBJETO_SERVICO}}"] button').first().click();
      await page.getByRole("option", { name: "auxílio-acidente" }).click();
      await expect(dlg.locator('[data-campo="{{TEXTO_PARCEIRO}}"] textarea')).not.toHaveValue("");
      await expect(dlg.locator('[data-campo="{{DATA}}"] textarea'), "a data de hoje vem escrita").toHaveValue(/ de \d{4}$/);
      for (const [campo, valor] of [["CIDADE", "São Paulo"], ["FORO", "São Paulo"]]) {
        await dlg.locator(`[data-campo="{{${campo}}}"] textarea`).fill(valor);
      }
      const enviar = dlg.locator("[data-enviar-modelo]");
      await expect(enviar).toBeEnabled();
      await perc.locator("input").fill("60");
      await expect(enviar, "acima do máximo do modelo").toBeDisabled();
      await perc.locator("input").fill("30");
      // conferir: o contrato montado, com o que foi preenchido em destaque
      await dlg.locator("[data-conferir-contrato]").click();
      const previa = dlg.locator("[data-previa-contrato]");
      await expect(previa).toContainText("30% (trinta por cento) sobre");
      await expect(previa.locator('[data-trecho="preenchido"]', { hasText: "trinta por cento" })).toBeVisible();
      await expect(previa.locator("[data-previa-vazios]"), "nada vai em branco").toHaveCount(0);
      await expect(previa).toContainText("para obter auxílio-acidente");
      await expect(enviar).toBeEnabled();
      // voltar para corrigir mantém o que foi digitado
      await dlg.locator("[data-voltar-aos-campos]").click();
      await expect(perc.locator("input")).toHaveValue("30");
      // o que foi escolhido nas listas continua lá: mexer num campo não apaga estado civil e profissão
      await quali.locator('input[id$="-rg"]').fill("12.345.678-9");
      // conferir de novo mostra o que mudou SEM ler o modelo outra vez
      let leituras = 0;
      page.on("request", (r) => {
        if (r.url().includes("/functions/v1/zapsign-enviar") && (r.postData() ?? "").includes("texto_modelo")) leituras++;
      });
      await perc.locator("input").fill("25");
      await dlg.locator("[data-conferir-contrato]").click();
      await expect(previa).toContainText("25% (vinte e cinco por cento) sobre");
      expect(leituras, "o texto do modelo já estava na tela").toBe(0);
      await dlg.locator("[data-voltar-aos-campos]").click();
      await expect(quali.locator("[data-qualificacao-texto]")).toContainText("casado(a), costureira, RG n.º 12.345.678-9, CPF n.º");
      await dlg.getByRole("button", { name: "Cancelar" }).click();
      await expect(dlg).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("tela: o caso mostra o envio como Assinado e o botão no PDF; Integrações mostra o endereço do webhook", async ({ browser, baseURL }) => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    const { session } = await sessaoComo(contaDoCanario("admin"));
    const ctx = await contexto(browser, baseURL!, session, ESC2);
    const page = await ctx.newPage();
    await cursorVisivel(page);
    try {
      await page.goto(`/casos/${casoId}?tab=documentos`);
      const envio = page.locator(`[data-assinatura="${assinaturaId}"]`);
      await expect(envio).toBeVisible();
      await expect(envio).toHaveAttribute("data-assinatura-status", "assinado");
      await expect(envio).toContainText("Assinado");
      await expect(page.getByText("E2E ZapSign - Contrato e procuracao (assinado).pdf")).toBeVisible();
      // o PDF que voltou assinado não oferece o botão; os outros PDF/DOCX do caso, sim
      const { data: docsDoCaso, error: eDocs } = await admin.from("documentos").select("id, nome_arquivo").eq("caso_id", casoId);
      if (eDocs) throw new Error(`documentos do caso: ${eDocs.message}`);
      const assinaveis = (docsDoCaso ?? []).filter((d) => formatoAssinavel(d.nome_arquivo));
      expect(assinaveis.some((d) => d.nome_arquivo.includes("(assinado)"))).toBe(true);
      // os PDFs que voltaram assinados (o do arquivo e o do modelo) são os únicos sem botão
      const { data: voltaram, error: eVolta } = await admin.from("assinaturas").select("documento_assinado_id").eq("caso_id", casoId).not("documento_assinado_id", "is", null);
      if (eVolta) throw new Error(`assinados do caso: ${eVolta.message}`);
      const jaAssinados = new Set((voltaram ?? []).map((a) => a.documento_assinado_id as string));
      expect(jaAssinados.size).toBeGreaterThan(0);
      await expect(page.getByRole("button", { name: "Enviar para assinatura" })).toHaveCount(assinaveis.filter((d) => !jaAssinados.has(d.id)).length);
      // o original já foi assinado e o último envio foi recusado: pode ser enviado de novo (botão ligado)
      const doOriginal = page.locator(`[data-assinar-documento="${docId}"]`);
      await expect(doOriginal).toBeEnabled();
      // o assinado não tem botão nenhum
      const assinado = assinaveis.find((d) => jaAssinados.has(d.id))!;
      await expect(page.locator(`[data-assinar-documento="${assinado.id}"]`)).toHaveCount(0);
      await doOriginal.click();
      await expect(page.locator("[data-dialog-assinatura]")).toContainText("conta um documento no plano do ZapSign");
      // o WhatsApp do envio de arquivo é o mesmo campo: Brasil por padrão, com DDD
      const telDoEnvio = page.locator("[data-dialog-assinatura] [data-telefone-com-pais]");
      await telDoEnvio.locator("input[type=tel]").pressSequentially("1133334444");
      await expect(telDoEnvio.locator("input[type=tel]")).toHaveValue("(11) 3333-4444");
      // colar o número com o código do país: o 55 não vira DDD, e o de fora troca a caixa do país
      await telDoEnvio.locator("input[type=tel]").fill("+55 17 99999-0000");
      await expect(telDoEnvio.locator("input[type=tel]")).toHaveValue("(17) 99999-0000");
      await telDoEnvio.locator("input[type=tel]").fill("+34 613761609");
      await expect(telDoEnvio.locator("input[type=tel]")).toHaveValue("613761609");
      await expect(telDoEnvio).toContainText("+34");
      await page.getByRole("button", { name: "Cancelar" }).click();
      // catálogo: a linha do ZapSign mostra o estado deste escritório e abre a configuração pelo endereço
      await page.goto("/configuracoes?tab=integracoes&abrir=zapsign");
      await expect(page.locator('[data-integracao-linha="zapsign"] [data-integracao-linha-estado]')).toHaveAttribute("data-integracao-linha-estado", "ativa");
      const card = page.locator('[data-card-integracao="zapsign"]');
      await expect(card.locator("[data-integracao-estado]")).toHaveText("ativo");
      // o segredo vai num cabeçalho, não na URL (que fica no histórico de avisos do painel do ZapSign)
      await expect(card.locator('[data-zapsign-copiavel="endereco"]')).toHaveText(/\/functions\/v1\/zapsign-webhook$/);
      await expect(card.locator('[data-zapsign-copiavel="cabecalho"]')).toHaveText("x-inbound-token");
      await expect(card.locator('[data-zapsign-copiavel="segredo"]')).toHaveText(/^[0-9a-f]{48}$/);
    } finally {
      await ctx.close();
    }
  });
});

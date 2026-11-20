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
    // a tela lê pela RLS: interno vê, parceiro não
    const { data: visto, error: eVisto } = await adv.sb.from("assinaturas").select("id").eq("id", assinaturaId);
    expect(eVisto).toBeNull();
    expect(visto).toHaveLength(1);
    const par = await sessaoComo(contaDoCanario("parceiro"), ESC2);
    const { data: doParceiro, error: eParceiro } = await par.sb.from("assinaturas").select("id").eq("id", assinaturaId);
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
    const { data: deFora, error: eFora } = await e2e.sb.from("assinaturas").select("id").eq("id", assinaturaId);
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

  test("documento que não está na conta ligada (404, ou envio de outro ambiente) NÃO vira cancelado nem libera envio em dobro", async () => {
    test.skip(!mockVivo || !assinaturaId, "depende do envio");
    const adv = await sessaoComo(contaDoCanario("advogado"), ESC2);
    const corpo = { action: "enviar", documento_id: docId, cliente: { email: "cliente.e2e@exemplo.com.br" } };
    const envio = await chamarFuncao("zapsign-enviar", adv.jwt, ESC2, corpo);
    expect(envio.status, envio.texto.slice(0, 160)).toBe(200);
    const linha = envio.json?.assinatura as { id: string; zapsign_doc_token: string };
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
      const { error } = await admin.from("assinaturas").delete().eq("id", linha.id);
      if (error) throw new Error(error.message);
    }
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
    expect([cliente.nome, cliente.cpf, cliente.email]).toEqual(["E2E ZapSign Cliente Novo", CPF_ADOTADO, "novo.e2e@exemplo.com.br"]);
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
    expect(depois[0].nome, "cliente que já existe não é sobrescrito").toBe("E2E ZapSign Cliente Novo");
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
    // 24 no ZapSign simulado (2 páginas): saem o de PDF e o desativado
    expect(modelos).toHaveLength(22);
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
      await expect(dlg.locator("[data-contagem-modelos]")).toHaveText("22 modelos");
      await expect(dlg.locator("[data-modelo]").first()).toBeVisible();
      // sugeridos: só quando o tipo de benefício do caso casa com o nome de algum modelo
      const esperaSugestao = /aposentadoria|aux[ií]lio|pens[aã]o|revis[aã]o|bpc|sal[aá]rio/i.test(doCaso.tipo_beneficio);
      await expect(dlg.locator("[data-modelos-sugeridos]")).toHaveCount(esperaSugestao ? 1 : 0);
      await expect(dlg.locator("[data-modelos-pasta]")).toHaveCount(3);
      // busca sem acento, por palavra do nome
      await dlg.locator("[data-busca-modelo]").fill("pensao");
      await expect(dlg.locator("[data-contagem-modelos]")).toHaveText("1 de 22 modelos");
      await expect(dlg.locator("[data-modelo]")).toHaveCount(1);
      await expect(dlg.locator("[data-modelos-sugeridos]")).toHaveCount(0);
      await dlg.locator("[data-modelo]").click();
      // passo 2: campos do modelo já com o cadastro; obrigatório vazio segura o envio
      await expect(dlg.locator("[data-campos-modelo]")).toBeVisible();
      await expect(dlg.getByRole("heading", { name: "Contrato de honorários - Pensão por morte" })).toBeVisible();
      await expect(dlg.getByLabel(/NOME COMPLETO/)).toHaveValue(doCaso.clientes.nome);
      await expect(dlg.getByLabel(/^CPF/)).toHaveValue(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
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
      await expect(dlg.locator("[data-contagem-modelos]")).toHaveText("1 de 22 modelos");
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

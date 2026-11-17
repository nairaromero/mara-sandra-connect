// zapsign-enviar (#517) — manda um documento do caso para assinatura no ZapSign
// e, a pedido da tela, atualiza o status de um envio.
//
// Quem chama: equipe interna com `documentos:enviar`. Ações:
//   enviar       { documento_id, cliente?: { email?, telefone? }, segundo?: { nome, email } }
//                cria o documento no ZapSign com o cliente do caso como
//                signatário (e, se vier, uma segunda pessoa do escritório).
//   sincronizar  { assinatura_id }
//                lê o ZapSign agora; se todos assinaram, grava o PDF no caso.
//
// O envio conta na cota do plano do ZapSign no momento em que é criado — a tela
// confirma antes de chamar.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { escopado, exigirRecurso, exigirUsuario } from "../_shared/auth.ts";
import { auditar } from "../_shared/auditoria.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { integracaoDoEscritorio, semIntegracao } from "../_shared/integracoes.ts";
import { EM_CURSO, formatoAssinavel } from "../_shared/assinatura.ts";
import {
  abrirTarefaAcompanhar, COLUNAS_ASSINATURA, criarDocumento, ehSandbox, ehUuid, envioAceito, ErroZapsign, type LinhaAssinatura,
  type NovoSignatario, sincronizarAssinatura, ZAPSIGN_MAX_BYTES,
} from "../_shared/zapsign.ts";

/** A chamada ao ZapSign tem teto de 45s; `enviando` além disto não tem dono. */
const ENVIANDO_VELHO_MS = 2 * 60 * 1000;
const EMAIL_RE =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "(17) 99999-9999" ou "+55 17 99999-9999" → { ddi: "55", numero: "17999999999" }.
 * Número de fora do Brasil precisa vir como "+<código do país> <número>" (com
 * espaço): "+34 613761609" → { ddi: "34", numero: "613761609" }. Sem o "+", é
 * sempre Brasil. `null` = não dá para mandar WhatsApp para isso.
 */
function telefoneDe(bruto: unknown): { ddi: string; numero: string } | null {
  const texto = String(bruto ?? "").trim();
  const fora = texto.match(/^\+(\d{1,3})[\s.-]+(.+)$/);
  if (fora && fora[1] !== "55") {
    const numero = fora[2].replace(/\D/g, "");
    return numero.length >= 6 && numero.length <= 14 ? { ddi: fora[1], numero } : null;
  }
  let d = texto.replace(/\D/g, "");
  // "+34613761609" (sem espaço) não dá para saber onde o código do país termina:
  // recusar é melhor do que mandar como se fosse um DDD brasileiro.
  if (texto.startsWith("+") && !d.startsWith("55")) return null;
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? { ddi: "55", numero: d } : null;
}
function emailValido(bruto: unknown): string {
  const e = String(bruto ?? "").trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "método não permitido" }, 405);

  const quem = await exigirUsuario(req, { tipo: "interno", permissao: "documentos:enviar" });
  if (quem instanceof Response) return quem;
  const escritorioId = quem.perfil.escritorio_id;
  if (!escritorioId) return jsonResponse({ error: "sem escritório ativo" }, 400);

  let body: {
    action?: string; documento_id?: string; assinatura_id?: string;
    cliente?: { email?: string; telefone?: string }; segundo?: { nome?: string; email?: string };
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body inválido" }, 400);
  }
  const sb = escopado(quem.admin, escritorioId);

  // -------------------------------------------------------------------------
  // sincronizar
  // -------------------------------------------------------------------------
  if (body.action === "sincronizar") {
    const id = body.assinatura_id;
    if (!ehUuid(id)) return jsonResponse({ error: "assinatura_id inválido" }, 400);
    const semAcesso = await exigirRecurso(quem, "assinaturas", id);
    if (semAcesso) return semAcesso;
    const integ = await integracaoDoEscritorio(quem.admin, escritorioId, "zapsign");
    if (!integ) return semIntegracao("zapsign", corsHeaders);
    const { data: linha, error } = await sb.from("assinaturas").select(COLUNAS_ASSINATURA).eq("id", id).maybeSingle();
    if (error) return jsonResponse({ error: `lendo assinatura: ${error.message}` }, 500);
    if (!linha) return jsonResponse({ error: "assinatura não encontrada" }, 404);
    try {
      const atual = await sincronizarAssinatura(sb, integ, linha as unknown as LinhaAssinatura);
      return jsonResponse({ ok: true, assinatura: atual });
    } catch (e) {
      console.error("[zapsign-enviar] sincronizar:", String((e as Error)?.message ?? e));
      return jsonResponse({ error: "Não consegui consultar o ZapSign agora. Tente de novo em instantes." }, 502);
    }
  }

  if (body.action !== "enviar") return jsonResponse({ error: "ação desconhecida" }, 400);

  // -------------------------------------------------------------------------
  // enviar
  // -------------------------------------------------------------------------
  const documentoId = body.documento_id;
  if (!ehUuid(documentoId)) return jsonResponse({ error: "documento_id inválido" }, 400);
  // o documento tem que ser visível a quem pediu: id de outro escritório → 404, nunca 412
  const semAcesso = await exigirRecurso(quem, "documentos", documentoId);
  if (semAcesso) return semAcesso;
  const integ = await integracaoDoEscritorio(quem.admin, escritorioId, "zapsign");
  if (!integ) return semIntegracao("zapsign", corsHeaders);

  const { data: doc, error: eDoc } = await sb
    .from("documentos").select("id, caso_id, nome_arquivo, storage_path, tamanho_bytes").eq("id", documentoId).maybeSingle();
  if (eDoc) return jsonResponse({ error: `lendo documento: ${eDoc.message}` }, 500);
  if (!doc) return jsonResponse({ error: "documento não encontrado" }, 404);

  const formato = formatoAssinavel(doc.nome_arquivo);
  if (!formato) {
    return jsonResponse({ error: "O ZapSign aceita PDF ou DOCX. Converta o arquivo e envie de novo." }, 400);
  }
  const grandeDemais = () => jsonResponse({ error: "Arquivo maior que 10 MB: o ZapSign não aceita." }, 400);
  if ((doc.tamanho_bytes ?? 0) > ZAPSIGN_MAX_BYTES) return grandeDemais();
  // o arquivo tem de ser do próprio caso: a linha é de quem pediu, o caminho também
  if (!String(doc.storage_path ?? "").startsWith(`${doc.caso_id}/`)) {
    return jsonResponse({ error: "O arquivo deste documento não está na pasta do caso." }, 400);
  }

  // Um envio em curso por documento: clique repetido não gasta a cota duas vezes.
  // O PDF que voltou assinado não se envia de novo: gastaria a cota à toa.
  const { data: jaAssinado, error: eJa } = await sb.from("assinaturas").select("id").eq("documento_assinado_id", documentoId).limit(1);
  if (eJa) return jsonResponse({ error: `conferindo envios: ${eJa.message}` }, 500);
  if (jaAssinado?.length) {
    return jsonResponse({ error: "Este arquivo já é a versão assinada de um documento. Envie o documento original.", code: "ja_assinado" }, 409);
  }

  const { data: emCurso, error: eCurso } = await sb
    .from("assinaturas").select("id, status, created_at").eq("documento_id", documentoId).in("status", [...EM_CURSO]);
  if (eCurso) return jsonResponse({ error: `conferindo envios: ${eCurso.message}` }, 500);
  // `enviando` velho é envio que morreu antes de chegar ao ZapSign (function
  // derrubada no meio) ou cuja resposta se perdeu: se o documento existe lá, o
  // aviso de criação já religou a linha (`adotarDocumento`) e ela não está mais
  // `enviando`. O que sobrou depois de 2 minutos não pode travar o próximo.
  const vivos = (emCurso ?? []).filter((a) => a.status !== "enviando" || Date.now() - new Date(a.created_at).getTime() < ENVIANDO_VELHO_MS);
  const mortos = (emCurso ?? []).filter((a) => !vivos.includes(a)).map((a) => a.id);
  if (mortos.length) {
    const { error: eMortos } = await sb.from("assinaturas").delete().in("id", mortos).eq("status", "enviando");
    if (eMortos) console.error(`[zapsign-enviar] não removi envios mortos: ${eMortos.message}`);
  }
  if (vivos.length) {
    return jsonResponse({ error: "Este documento já está em assinatura. Acompanhe o envio que está em curso.", code: "ja_em_assinatura" }, 409);
  }

  const { data: caso, error: eCaso } = await sb.from("casos").select("id, cliente_id").eq("id", doc.caso_id).maybeSingle();
  if (eCaso || !caso) return jsonResponse({ error: `lendo o caso: ${eCaso?.message ?? "não encontrado"}` }, 500);
  const { data: cliente, error: eCli } = await sb.from("clientes").select("nome, email, telefone").eq("id", caso.cliente_id).maybeSingle();
  if (eCli || !cliente) return jsonResponse({ error: `lendo o cliente: ${eCli?.message ?? "não encontrado"}` }, 500);

  // Contato do cliente: o que a tela mandou (corrigido na hora) ou o cadastro.
  const emailCli = body.cliente?.email !== undefined ? emailValido(body.cliente.email) : emailValido(cliente.email);
  const telCli = telefoneDe(body.cliente?.telefone !== undefined ? body.cliente.telefone : cliente.telefone);
  if (body.cliente?.email && !emailCli) return jsonResponse({ error: "E-mail do cliente inválido." }, 400);
  if (body.cliente?.telefone && !telCli) return jsonResponse({ error: "Telefone do cliente inválido: informe DDD e número (de fora do Brasil: +código do país, espaço e o número)." }, 400);
  if (!emailCli && !telCli) {
    return jsonResponse({ error: "O cliente precisa de e-mail ou WhatsApp para receber o link de assinatura." }, 400);
  }
  const signatarios: NovoSignatario[] = [{ nome: cliente.nome, papel: "cliente", email: emailCli, telefone: telCli?.numero ?? "", ddi: telCli?.ddi ?? "55" }];
  if (body.segundo) {
    const nome = String(body.segundo.nome ?? "").trim();
    const email = emailValido(body.segundo.email);
    if (!nome || !email) return jsonResponse({ error: "Informe nome e e-mail de quem assina pelo escritório." }, 400);
    if (email === emailCli) return jsonResponse({ error: "Quem assina pelo escritório precisa de um e-mail diferente do e-mail do cliente." }, 400);
    signatarios.push({ nome: nome.slice(0, 200), papel: "escritorio", email, telefone: "", ddi: "55" });
  }

  const baixado = await quem.admin.storage.from("documentos").download(doc.storage_path);
  if (baixado.error || !baixado.data) {
    return jsonResponse({ error: `não consegui abrir o arquivo: ${baixado.error?.message ?? "vazio"}` }, 500);
  }
  const bytes = new Uint8Array(await baixado.data.arrayBuffer());
  if (bytes.length > ZAPSIGN_MAX_BYTES) return grandeDemais();

  // A linha nasce antes da chamada: o id dela é o `external_id` lá, e é ela que
  // barra o segundo envio — o índice único `assinaturas_um_em_curso_por_documento`
  // recusa a segunda linha em curso do mesmo documento (duas pessoas ao mesmo tempo).
  const { data: nova, error: eNova } = await sb
    .from("assinaturas")
    .insert({ caso_id: doc.caso_id, documento_id: doc.id, nome: doc.nome_arquivo, status: "enviando", sandbox: ehSandbox(integ), enviado_por: quem.uid })
    .select("id")
    .single();
  if (eNova?.code === "23505") {
    return jsonResponse({ error: "Este documento já está em assinatura. Acompanhe o envio que está em curso.", code: "ja_em_assinatura" }, 409);
  }
  if (eNova || !nova) return jsonResponse({ error: `registrando o envio: ${eNova?.message ?? "sem retorno"}` }, 500);

  let aceito: ReturnType<typeof envioAceito>;
  try {
    aceito = envioAceito(await criarDocumento(integ, { nome: doc.nome_arquivo, base64: encodeBase64(bytes), formato, externalId: nova.id, signatarios }));
    if (!aceito) throw new ErroZapsign(502, "ZapSign não devolveu o token do documento");
  } catch (e) {
    console.error("[zapsign-enviar] enviar:", String((e as Error)?.message ?? e));
    const http = e instanceof ErroZapsign ? e.http : 0;
    if (http >= 400 && http < 500) {
      // recusa clara: nada foi criado lá, a linha sai para não travar o próximo envio
      const { error: eDel } = await sb.from("assinaturas").delete().eq("id", nova.id).eq("status", "enviando");
      if (eDel) console.error(`[zapsign-enviar] não removi a assinatura ${nova.id}: ${eDel.message}`);
      const frase = http === 401 || http === 403
        ? "O ZapSign recusou o token. Confira a integração em Configurações → Integrações."
        : "O ZapSign não aceitou o documento. Confira o arquivo e os contatos e tente de novo.";
      return jsonResponse({ error: frase }, 502);
    }
    // Sem resposta (ou erro do lado deles): o documento PODE ter sido criado. A
    // linha fica; se foi criado, o aviso de criação a religa. Reenviar agora
    // gastaria a cota duas vezes e mandaria dois links ao cliente.
    return jsonResponse({
      error: "Não deu para confirmar se o ZapSign recebeu o documento. Espere um minuto e confira o painel de assinaturas do caso antes de enviar de novo.",
      code: "envio_incerto",
    }, 502);
  }

  // O ZapSign aceitou. Daqui em diante nada pode dizer à tela que "não enviou".
  const gravarEnvio = () => sb.from("assinaturas").update({ ...aceito, updated_at: new Date().toISOString() }).eq("id", nova.id).select(COLUNAS_ASSINATURA).single();
  let gravado = await gravarEnvio();
  if (gravado.error) gravado = await gravarEnvio(); // uma segunda tentativa; se falhar, o aviso de criação religa
  if (gravado.error || !gravado.data) {
    console.error(`[zapsign-enviar] documento ${aceito.zapsign_doc_token} criado, mas não gravei na assinatura ${nova.id}: ${gravado.error?.message}`);
    return jsonResponse({ error: "O documento foi enviado, mas não consegui registrar aqui. Espere um minuto e confira o painel de assinaturas antes de enviar de novo.", code: "envio_incerto" }, 500);
  }
  const linha = gravado.data as unknown as LinhaAssinatura;
  try {
    await abrirTarefaAcompanhar(sb, linha);
    await auditar(quem, {
      acao: "assinatura.enviada", recurso: "assinaturas", recurso_id: nova.id,
      detalhes: { caso_id: doc.caso_id, documento_id: doc.id, signatarios: signatarios.map((x) => x.papel), sandbox: ehSandbox(integ) },
    });
  } catch (e) {
    console.error(`[zapsign-enviar] envio ${nova.id} feito; falhou o registro de tarefa/trilha:`, String((e as Error)?.message ?? e));
  }
  return jsonResponse({ ok: true, assinatura: linha });
});

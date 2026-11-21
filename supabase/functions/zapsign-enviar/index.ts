// zapsign-enviar (#517, #522) — manda um documento para assinatura no ZapSign
// e, a pedido da tela, atualiza o status de um envio.
//
// Quem chama: equipe interna com `documentos:enviar`. Ações:
//   enviar         { documento_id, cliente?: { email?, telefone? }, segundo?: { nome, email } }
//                  cria o documento no ZapSign a partir de um ARQUIVO do caso, com
//                  o cliente como signatário (e, se vier, alguém do escritório).
//   modelos        {}
//                  os modelos de contrato da conta do ZapSign do escritório.
//   modelo         { caso_id, modelo_token }
//                  os campos do modelo, já com o que o cadastro do cliente responde
//                  e com o padrão que o modelo define (texto de ajuda do campo).
//   texto_modelo   { caso_id, modelo_token }
//                  o texto do modelo (campos por preencher): a tela monta a prévia do
//                  contrato com ele. Não cria documento no ZapSign.
//   enviar_modelo  { caso_id, modelo_token, respostas: { "<variável>": "<valor>" },
//                    cliente?: { email?, telefone? }, tipo_documento? }
//                  cria o documento no ZapSign a partir do MODELO preenchido.
//   sincronizar    { assinatura_id }
//                  lê o ZapSign agora; se todos assinaram, grava o PDF no caso.
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
import { respostasDoModelo } from "../_shared/modelo-contrato.ts";
import { telefoneDe } from "../_shared/telefone.ts";
import { TIPOS_DOCUMENTO } from "../_shared/tipos-documento.ts";
import {
  abrirTarefaAcompanhar, COLUNAS_ASSINATURA, criarDocumento, criarDocumentoDeModelo, detalharModelo, DocumentoForaDaConta, ehSandbox, ehUuid, envioAceito,
  ErroZapsign, fraseDoErroZapsign, type LinhaAssinatura, listarModelos, type NovoSignatario, sincronizarAssinatura, textoDoModelo, ZAPSIGN_MAX_BYTES,
} from "../_shared/zapsign.ts";

/** A chamada ao ZapSign tem teto de 45s; `enviando` além disto não tem dono. */
const ENVIANDO_VELHO_MS = 2 * 60 * 1000;
const EMAIL_RE =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailValido(bruto: unknown): string {
  const e = String(bruto ?? "").trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : "";
}

/**
 * Falha NOSSA (banco, armazenamento): o texto cru fica no log e a tela recebe
 * uma frase que não culpa o ZapSign nem mostra mensagem do Postgres.
 */
function falhaInterna(onde: string, detalhe: unknown): Response {
  console.error(`[zapsign-enviar] ${onde}: ${String((detalhe as Error)?.message ?? detalhe ?? "sem retorno")}`);
  return jsonResponse({ error: "Não consegui concluir agora por uma falha do sistema. Tente de novo em instantes.", code: "falha_interna" }, 500);
}
/** Erro de leitura do nosso banco dentro de um bloco que também fala com o ZapSign. */
class ErroInterno extends Error {}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "método não permitido" }, 405);

  const quem = await exigirUsuario(req, { tipo: "interno", permissao: "documentos:enviar" });
  if (quem instanceof Response) return quem;
  const escritorioId = quem.perfil.escritorio_id;
  if (!escritorioId) return jsonResponse({ error: "sem escritório ativo" }, 400);

  let body: {
    action?: string; documento_id?: string; assinatura_id?: string; caso_id?: string; modelo_token?: string;
    respostas?: Record<string, unknown>; tipo_documento?: string;
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
    if (error) return falhaInterna("lendo assinatura", error);
    if (!linha) return jsonResponse({ error: "assinatura não encontrada" }, 404);
    try {
      const atual = await sincronizarAssinatura(sb, integ, linha as unknown as LinhaAssinatura);
      return jsonResponse({ ok: true, assinatura: atual });
    } catch (e) {
      console.error("[zapsign-enviar] sincronizar:", String((e as Error)?.message ?? e));
      if (e instanceof DocumentoForaDaConta) {
        return jsonResponse({
          error: "Este documento não está na conta do ZapSign ligada agora: a integração mudou de ambiente (produção ou teste) ou de conta depois do envio. O envio fica como está.",
          code: "documento_fora_da_conta",
        }, 409);
      }
      const http = e instanceof ErroZapsign ? e.http : 0;
      return jsonResponse({ error: fraseDoErroZapsign(http, "Não consegui consultar o ZapSign agora. Tente de novo em instantes.") }, 502);
    }
  }

  const ACOES = ["enviar", "modelos", "modelo", "texto_modelo", "enviar_modelo"];
  if (!ACOES.includes(String(body.action))) return jsonResponse({ error: "ação desconhecida" }, 400);

  /** O cliente do caso, lido no escopo do escritório. */
  const clienteDoCaso = async (casoId: string) => {
    const { data: caso, error: eCaso } = await sb.from("casos").select("id, cliente_id, tipo_beneficio, parceiro_id").eq("id", casoId).maybeSingle();
    if (eCaso || !caso) throw new ErroInterno(`lendo o caso: ${eCaso?.message ?? "não encontrado"}`);
    const { data: cliente, error: eCli } = await sb.from("clientes").select("nome, cpf, email, telefone, endereco, data_nascimento").eq("id", caso.cliente_id).maybeSingle();
    if (eCli || !cliente) throw new ErroInterno(`lendo o cliente: ${eCli?.message ?? "não encontrado"}`);
    return { ...cliente, tipoBeneficio: (caso.tipo_beneficio as string | null) ?? null, parceiroId: (caso.parceiro_id as string | null) ?? null };
  };
  /** O parceiro que indicou o caso: o contrato o nomeia na cláusula de compartilhamento de dados. */
  const nomeDoParceiro = async (parceiroId: string | null): Promise<string> => {
    if (!parceiroId) return "";
    const { data, error } = await sb.from("usuarios").select("nome").eq("id", parceiroId).maybeSingle();
    if (error) throw new ErroInterno(`lendo o parceiro do caso: ${error.message}`);
    return String(data?.nome ?? "");
  };
  /** Os tipos de benefício do escritório, na ordem do catálogo: a lista de onde o contrato escolhe o benefício. */
  const beneficiosDoEscritorio = async (): Promise<string[]> => {
    const { data, error } = await sb.from("tipos_beneficio").select("nome").eq("ativo", true).order("ordem").order("nome");
    if (error) throw new ErroInterno(`lendo os tipos de benefício: ${error.message}`);
    return (data ?? []).map((t) => String(t.nome));
  };
  /** Contato do cliente: o que a tela mandou (corrigido na hora) ou o cadastro. Devolve a recusa quando não serve. */
  const contatoDoCliente = (cliente: { nome: string; email: string | null; telefone: string | null }): NovoSignatario | Response => {
    const email = body.cliente?.email !== undefined ? emailValido(body.cliente.email) : emailValido(cliente.email);
    const tel = telefoneDe(body.cliente?.telefone !== undefined ? body.cliente.telefone : cliente.telefone);
    if (body.cliente?.email && !email) return jsonResponse({ error: "E-mail do cliente inválido." }, 400);
    if (body.cliente?.telefone && !tel) return jsonResponse({ error: "Telefone do cliente inválido: informe DDD e número (de fora do Brasil: +código do país, espaço e o número)." }, 400);
    if (!email && !tel) return jsonResponse({ error: "O cliente precisa de e-mail ou WhatsApp para receber o link de assinatura." }, 400);
    return { nome: cliente.nome, papel: "cliente", email, telefone: tel?.numero ?? "", ddi: tel?.ddi ?? "55" };
  };
  /**
   * O envio vai sair SEM WhatsApp porque o telefone do cadastro não serve (e a
   * tela não mandou outro)? Não barra — o e-mail basta para assinar —, mas a
   * resposta leva o aviso: mandar só por e-mail em silêncio deixa a pessoa
   * esperando o cliente abrir um WhatsApp que nunca foi.
   */
  const avisoSemWhatsapp = (cliente: { telefone: string | null }): string | undefined =>
    body.cliente?.telefone === undefined && String(cliente.telefone ?? "").trim() && !telefoneDe(cliente.telefone)
      ? `O link foi só por e-mail: o telefone do cadastro (${String(cliente.telefone).trim().slice(0, 40)}) não serve para WhatsApp. Corrija o cadastro do cliente.`
      : undefined;
  /**
   * Do `enviando` até a resposta à tela — igual para arquivo e para modelo.
   * `criar` é a única coisa que muda: a chamada que cria o documento no ZapSign.
   */
  const concluirEnvio = async (
    novaId: string,
    criar: () => Promise<{ token?: string; signers?: unknown }>,
    detalhes: Record<string, unknown>,
    aviso?: string,
  ): Promise<Response> => {
    let aceito: ReturnType<typeof envioAceito>;
    try {
      aceito = envioAceito(await criar());
      if (!aceito) throw new ErroZapsign(502, "ZapSign não devolveu o token do documento");
    } catch (e) {
      console.error("[zapsign-enviar] enviar:", String((e as Error)?.message ?? e));
      const http = e instanceof ErroZapsign ? e.http : 0;
      if (http >= 400 && http < 500) {
        // recusa clara: nada foi criado lá, a linha sai para não travar o próximo envio
        const { error: eDel } = await sb.from("assinaturas").delete().eq("id", novaId).eq("status", "enviando");
        if (eDel) console.error(`[zapsign-enviar] não removi a assinatura ${novaId}: ${eDel.message}`);
        return jsonResponse({ error: fraseDoErroZapsign(http, "O ZapSign não aceitou o documento. Confira o arquivo, os campos e os contatos e tente de novo.") }, 502);
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
    const gravarEnvio = () => sb.from("assinaturas").update({ ...aceito, updated_at: new Date().toISOString() }).eq("id", novaId).select(COLUNAS_ASSINATURA).single();
    let gravado = await gravarEnvio();
    if (gravado.error) gravado = await gravarEnvio(); // uma segunda tentativa; se falhar, o aviso de criação religa
    if (gravado.error || !gravado.data) {
      console.error(`[zapsign-enviar] documento ${aceito.zapsign_doc_token} criado, mas não gravei na assinatura ${novaId}: ${gravado.error?.message}`);
      return jsonResponse({ error: "O documento foi enviado, mas não consegui registrar aqui. Espere um minuto e confira o painel de assinaturas antes de enviar de novo.", code: "envio_incerto" }, 500);
    }
    const linha = gravado.data as unknown as LinhaAssinatura;
    try {
      await abrirTarefaAcompanhar(sb, linha);
      await auditar(quem, { acao: "assinatura.enviada", recurso: "assinaturas", recurso_id: novaId, detalhes: { ...detalhes, sandbox: ehSandbox(integ!) } });
    } catch (e) {
      console.error(`[zapsign-enviar] envio ${novaId} feito; falhou o registro de tarefa/trilha:`, String((e as Error)?.message ?? e));
    }
    return jsonResponse({ ok: true, assinatura: linha, ...(aviso ? { aviso } : {}) });
  };
  const JA_EM_CURSO = (oQue = "Este documento já está") =>
    jsonResponse({ error: `${oQue} em assinatura. Acompanhe o envio que está em curso.`, code: "ja_em_assinatura" }, 409);
  const MODELO_EM_CURSO = () => JA_EM_CURSO("Este modelo já foi enviado neste caso e ainda está");
  /**
   * Há envio em curso para este alvo (um documento, ou um modelo num caso)?
   * A única porta dessa pergunta, para arquivo e para modelo. No caminho,
   * remove o `enviando` velho: é envio que morreu antes de chegar ao ZapSign
   * (function derrubada, timeout sem documento criado) — se o documento
   * existisse lá, o aviso de criação já teria religado a linha
   * (`adotarDocumento`) e ela não estaria mais `enviando`. O que sobrou depois
   * de 2 minutos não pode travar o próximo envio para sempre.
   */
  const haEnvioEmCurso = async (alvo: { documento_id: string } | { caso_id: string; modelo_token: string }): Promise<boolean | Response> => {
    const { data: emCurso, error: eCurso } = await sb.from("assinaturas").select("id, status, created_at").match(alvo).in("status", [...EM_CURSO]);
    if (eCurso) return falhaInterna("conferindo envios", eCurso);
    const vivos = (emCurso ?? []).filter((a) => a.status !== "enviando" || Date.now() - new Date(a.created_at).getTime() < ENVIANDO_VELHO_MS);
    const mortos = (emCurso ?? []).filter((a) => !vivos.includes(a)).map((a) => a.id);
    if (mortos.length) {
      const { error: eMortos } = await sb.from("assinaturas").delete().in("id", mortos).eq("status", "enviando");
      if (eMortos) console.error(`[zapsign-enviar] não removi envios mortos: ${eMortos.message}`);
    }
    return vivos.length > 0;
  };

  // -------------------------------------------------------------------------
  // modelos de contrato da conta do escritório (#522)
  // -------------------------------------------------------------------------
  let integ: Awaited<ReturnType<typeof integracaoDoEscritorio>> = null;
  if (body.action !== "enviar") {
    // caso de outro escritório → 404 antes de dizer qualquer coisa sobre a integração
    if (body.action !== "modelos") {
      if (!ehUuid(body.caso_id)) return jsonResponse({ error: "caso_id inválido" }, 400);
      const semAcessoAoCaso = await exigirRecurso(quem, "casos", body.caso_id);
      if (semAcessoAoCaso) return semAcessoAoCaso;
    }
    integ = await integracaoDoEscritorio(quem.admin, escritorioId, "zapsign");
    if (!integ) return semIntegracao("zapsign", corsHeaders);
    try {
      if (body.action === "modelos") return jsonResponse({ ok: true, modelos: await listarModelos(integ) });

      const modeloToken = String(body.modelo_token ?? "").trim();
      if (!modeloToken) return jsonResponse({ error: "modelo_token obrigatório" }, 400);
      const cliente = await clienteDoCaso(body.caso_id!);
      // O que o caso sabe (lista de benefícios, parceiro) só serve para ABRIR os campos:
      // a prévia e o envio usam o que a tela devolveu e não pagam essas duas leituras.
      const abrindo = body.action === "modelo";
      const { modelo, campos, arquivo } = await detalharModelo(integ, modeloToken, {
        cliente,
        ...(abrindo ? { beneficios: await beneficiosDoEscritorio(), beneficioDoCaso: cliente.tipoBeneficio, parceiro: await nomeDoParceiro(cliente.parceiroId) } : {}),
      });
      if (abrindo) {
        // nome, CPF e endereço vão à tela para ela montar a qualificação com as listas
        return jsonResponse({ ok: true, modelo, campos, cliente: { nome: cliente.nome, email: cliente.email ?? "", telefone: cliente.telefone ?? "", cpf: cliente.cpf ?? "", endereco: cliente.endereco ?? "" } });
      }

      // texto_modelo: o DOCX do modelo em parágrafos. A tela preenche com `previaDoContrato`
      // e não volta aqui a cada conferência. Não cria documento no ZapSign (lá, documento
      // criado conta no plano mesmo sem assinar).
      if (body.action === "texto_modelo") {
        try {
          return jsonResponse({ ok: true, paragrafos: await textoDoModelo(arquivo) });
        } catch (e) {
          console.warn(`[zapsign-enviar] texto do modelo ${modelo.token}:`, String((e as Error)?.message ?? e));
          return jsonResponse({ error: "Não consegui montar a prévia deste modelo. O envio continua disponível.", code: "previa_indisponivel" }, 422);
        }
      }

      // O valor de cada campo sai de UMA conta (`respostasDoModelo`): só os campos que o
      // modelo TEM, o extenso escrito pelo sistema e a faixa que o modelo aceita.
      const dadas = body.respostas && typeof body.respostas === "object" ? body.respostas : {};
      const { respostas, erros } = respostasDoModelo(campos, dadas);
      if (erros.length) return jsonResponse({ error: erros.join(" "), code: "campos_faltando" }, 400);
      const tipoDocumento = body.tipo_documento ?? "contrato_honorarios";
      if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) return jsonResponse({ error: "tipo de documento desconhecido" }, 400);
      const signatario = contatoDoCliente(cliente);
      if (signatario instanceof Response) return signatario;

      // um envio em curso por modelo e caso (índice `assinaturas_um_em_curso_por_modelo`)
      const emCurso = await haEnvioEmCurso({ caso_id: body.caso_id!, modelo_token: modelo.token });
      if (emCurso instanceof Response) return emCurso;
      if (emCurso) return MODELO_EM_CURSO();
      const { data: nova, error: eNova } = await sb
        .from("assinaturas")
        .insert({ caso_id: body.caso_id, nome: modelo.nome.slice(0, 255), status: "enviando", sandbox: ehSandbox(integ), enviado_por: quem.uid, modelo_token: modelo.token, tipo_documento: tipoDocumento })
        .select("id")
        .single();
      if (eNova?.code === "23505") return MODELO_EM_CURSO();
      if (eNova || !nova) return falhaInterna("registrando o envio", eNova);
      return await concluirEnvio(
        nova.id,
        () => criarDocumentoDeModelo(integ!, { modeloToken: modelo.token, externalId: nova.id, respostas: respostas.filter((r) => r.valor), signatario }),
        { caso_id: body.caso_id, modelo: modelo.nome, signatarios: ["cliente"] },
        avisoSemWhatsapp(cliente),
      );
    } catch (e) {
      // falha de leitura do NOSSO banco não é culpa do ZapSign
      if (e instanceof ErroInterno) return falhaInterna(String(body.action), e);
      console.error(`[zapsign-enviar] ${body.action}:`, String((e as Error)?.message ?? e));
      const http = e instanceof ErroZapsign ? e.http : 0;
      if (http === 404) return jsonResponse({ error: "Este modelo não existe mais na conta do ZapSign." }, 404);
      return jsonResponse({ error: fraseDoErroZapsign(http, "Não consegui consultar os modelos no ZapSign agora. Tente de novo em instantes.") }, 502);
    }
  }

  // -------------------------------------------------------------------------
  // enviar
  // -------------------------------------------------------------------------
  const documentoId = body.documento_id;
  if (!ehUuid(documentoId)) return jsonResponse({ error: "documento_id inválido" }, 400);
  // o documento tem que ser visível a quem pediu: id de outro escritório → 404, nunca 412
  const semAcesso = await exigirRecurso(quem, "documentos", documentoId);
  if (semAcesso) return semAcesso;
  integ = await integracaoDoEscritorio(quem.admin, escritorioId, "zapsign");
  if (!integ) return semIntegracao("zapsign", corsHeaders);

  const { data: doc, error: eDoc } = await sb
    .from("documentos").select("id, caso_id, nome_arquivo, storage_path, tamanho_bytes").eq("id", documentoId).maybeSingle();
  if (eDoc) return falhaInterna("lendo documento", eDoc);
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
  if (eJa) return falhaInterna("conferindo envios", eJa);
  if (jaAssinado?.length) {
    return jsonResponse({ error: "Este arquivo já é a versão assinada de um documento. Envie o documento original.", code: "ja_assinado" }, 409);
  }

  const emCurso = await haEnvioEmCurso({ documento_id: documentoId });
  if (emCurso instanceof Response) return emCurso;
  if (emCurso) return JA_EM_CURSO();

  let cliente: Awaited<ReturnType<typeof clienteDoCaso>>;
  try {
    cliente = await clienteDoCaso(doc.caso_id);
  } catch (e) {
    return falhaInterna("lendo o cliente do caso", e);
  }
  const doCliente = contatoDoCliente(cliente);
  if (doCliente instanceof Response) return doCliente;
  const signatarios: NovoSignatario[] = [doCliente];
  if (body.segundo) {
    const nome = String(body.segundo.nome ?? "").trim();
    const email = emailValido(body.segundo.email);
    if (!nome || !email) return jsonResponse({ error: "Informe nome e e-mail de quem assina pelo escritório." }, 400);
    if (email === doCliente.email) return jsonResponse({ error: "Quem assina pelo escritório precisa de um e-mail diferente do e-mail do cliente." }, 400);
    signatarios.push({ nome: nome.slice(0, 200), papel: "escritorio", email, telefone: "", ddi: "55" });
  }

  const baixado = await quem.admin.storage.from("documentos").download(doc.storage_path);
  if (baixado.error || !baixado.data) {
    return falhaInterna("abrindo o arquivo", baixado.error ?? "vazio");
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
  if (eNova?.code === "23505") return JA_EM_CURSO();
  if (eNova || !nova) return falhaInterna("registrando o envio", eNova);

  return await concluirEnvio(
    nova.id,
    () => criarDocumento(integ!, { nome: doc.nome_arquivo, base64: encodeBase64(bytes), formato, externalId: nova.id, signatarios }),
    { caso_id: doc.caso_id, documento_id: doc.id, signatarios: signatarios.map((x) => x.papel) },
    avisoSemWhatsapp(cliente),
  );
});

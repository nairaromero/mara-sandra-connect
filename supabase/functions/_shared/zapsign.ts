// ZapSign (#517) — o único lugar que fala com a API do ZapSign e o único que
// decide o status de um envio A PARTIR do que o ZapSign diz. Quem usa:
//   zapsign-enviar         cria o documento lá — de um arquivo do caso ou de um
//                          MODELO da conta (só abre e fecha o `enviando`) — e, a
//                          pedido da tela, chama `sincronizarAssinatura`
//   zapsign-webhook        recebe o aviso: `sincronizarAssinatura` ou `adotarDocumento`
//   integracoes-escritorio "Testar conexão" (`testarToken`)
//
// Regra que não varia: o status e o PDF assinado vêm SEMPRE de uma leitura
// nossa na API do ZapSign (`detalharDocumento`), nunca do corpo do aviso. O
// ZapSign não assina o webhook; o corpo só serve para saber QUAL documento
// olhar.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatoAssinavel, type ModeloZapsign, type Signatario, type StatusAssinatura, type StatusSignatario } from "./assinatura.ts";
import { fetchT } from "./auth.ts";
import { cpfValido } from "./documento-campos.ts";
import { equipeInterna } from "./equipe.ts";
import { baseZapsign, type Integracao } from "./integracoes.ts";
import { type CampoDoModelo, camposDoModelo, type EntradaDoModelo, type ParagrafoDoContrato, paragrafosDoDocx, previaDoContrato } from "./modelo-contrato.ts";
import { telefoneGuardado } from "./telefone.ts";

/** Teto do arquivo enviado (o ZapSign documenta 10 MB para PDF por URL). */
export const ZAPSIGN_MAX_BYTES = 10 * 1024 * 1024;
/** Teto do PDF assinado que aceitamos baixar (o bucket aceita 50 MB). */
const ASSINADO_MAX_BYTES = 50 * 1024 * 1024;
/** `gravando` mais velho que isto é trava de uma tentativa que morreu no meio. */
const TRAVA_VELHA_MS = 2 * 60 * 1000;

/** A linha de `assinaturas` como as functions leem (e devolvem à tela). */
export interface LinhaAssinatura {
  id: string;
  caso_id: string;
  documento_id: string | null;
  documento_assinado_id: string | null;
  nome: string;
  zapsign_doc_token: string | null;
  sandbox: boolean;
  status: StatusAssinatura;
  signatarios: Signatario[];
  enviado_por: string | null;
  /** modelo do ZapSign de onde o documento nasceu (envio sem arquivo do caso) */
  modelo_token: string | null;
  /** tipo do PDF assinado quando não há arquivo original de quem herdar */
  tipo_documento: string | null;
  created_at: string;
  updated_at: string;
  assinado_em: string | null;
}
export const COLUNAS_ASSINATURA =
  "id, caso_id, documento_id, documento_assinado_id, nome, zapsign_doc_token, sandbox, status, signatarios, enviado_por, modelo_token, tipo_documento, created_at, updated_at, assinado_em";

/** O escritório está no sandbox do ZapSign (sem validade jurídica, sem cota)? */
export const ehSandbox = (integ: Integracao): boolean => integ.config.ambiente === "sandbox";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
interface SignerZapsign {
  token?: string;
  sign_url?: string;
  status?: string;
  name?: string;
  email?: string;
  phone_country?: string;
  phone_number?: string;
  signed_at?: string | null;
  cpf?: string | null;
  /** o que mandamos em `criarDocumento`: o papel do signatário */
  external_id?: string;
}
interface DocumentoZapsign {
  token?: string;
  name?: string;
  external_id?: string;
  status?: string;
  deleted?: boolean;
  signed_file?: string | null;
  signers?: SignerZapsign[];
  created_by?: { email?: string } | null;
  /** respostas do modelo dinâmico, quando o documento nasceu de um modelo */
  answers?: Array<{ variable?: unknown; value?: unknown }> | null;
}

export class ErroZapsign extends Error {
  constructor(public http: number, mensagem: string) {
    super(mensagem);
  }
}

/**
 * O documento do envio não está na conta do ZapSign ligada AGORA: o escritório
 * trocou de ambiente (produção ↔ teste) ou de conta depois de enviar. Não é
 * cancelamento — excluir no ZapSign é só uma marca (`deleted`), o documento
 * continua respondendo. Quem chama não muda o status da linha.
 */
export class DocumentoForaDaConta extends Error {
  constructor() {
    super("o documento não está na conta do ZapSign ligada agora");
  }
}

/**
 * A frase que a tela mostra para um erro do ZapSign, pelo código que ele
 * devolveu (docs.zapsign.com.br/status-de-erros). Um lugar só: o envio, os
 * modelos e o "Atualizar" dizem a mesma coisa para o mesmo erro.
 */
export function fraseDoErroZapsign(http: number, padrao: string): string {
  if (http === 401) return "O ZapSign recusou o token. Confira a integração em Configurações → Integrações.";
  if (http === 403) return "O token do ZapSign não é do ambiente escolhido (produção ou teste). Confira a integração em Configurações → Integrações.";
  if (http === 402) return "A conta do ZapSign não tem um plano com acesso à API. Confira o plano no painel do ZapSign.";
  if (http === 429) return "O ZapSign limitou as chamadas agora. Espere um minuto e tente de novo.";
  return padrao;
}

async function chamar(integ: Integracao, caminho: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const r = await fetchT(`${baseZapsign(integ.config)}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${integ.segredo}`, Accept: "application/json", ...(init.headers ?? {}) },
  });
  const texto = await r.text();
  if (!r.ok) {
    // o texto cru do provedor fica no log; quem chama decide a frase da tela
    console.warn(`[zapsign] ${init.method ?? "GET"} ${caminho} → HTTP ${r.status}: ${texto.slice(0, 300)}`);
    throw new ErroZapsign(r.status, `ZapSign respondeu HTTP ${r.status}`);
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroZapsign(r.status, "ZapSign respondeu algo que não é JSON");
  }
}

export interface NovoSignatario {
  nome: string;
  papel: "cliente" | "escritorio";
  email: string;
  /** só dígitos, sem o código do país */
  telefone: string;
  /** código do país, só dígitos ("55" = Brasil) */
  ddi: string;
}

export async function criarDocumento(
  integ: Integracao,
  entrada: { nome: string; base64: string; formato: "pdf" | "docx"; externalId: string; signatarios: NovoSignatario[] },
): Promise<DocumentoZapsign> {
  const corpo = {
    name: entrada.nome.slice(0, 255),
    [entrada.formato === "pdf" ? "base64_pdf" : "base64_docx"]: entrada.base64,
    external_id: entrada.externalId,
    lang: "pt-br",
    signers: entrada.signatarios.map((s) => ({
      name: s.nome,
      email: s.email,
      phone_country: s.telefone ? s.ddi : "",
      phone_number: s.telefone,
      external_id: s.papel,
      lock_name: true,
      send_automatic_email: !!s.email,
      send_automatic_whatsapp: !!s.telefone,
    })),
  };
  return (await chamar(integ, "/api/v1/docs/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    timeoutMs: 45_000, // sobe o arquivo inteiro em base64
  })) as DocumentoZapsign;
}

async function detalharDocumento(integ: Integracao, docToken: string): Promise<DocumentoZapsign> {
  return (await chamar(integ, `/api/v1/docs/${encodeURIComponent(docToken)}/`)) as DocumentoZapsign;
}

/** "Testar conexão": listar documentos é a leitura mais barata que prova o token. */
export async function testarToken(integ: Integracao): Promise<{ ok: boolean; http: number }> {
  try {
    await chamar(integ, "/api/v1/docs/?page=1", { timeoutMs: 15_000 });
    return { ok: true, http: 200 };
  } catch (e) {
    if (e instanceof ErroZapsign) return { ok: false, http: e.http };
    throw e; // não alcançou o ZapSign: quem chama diz isso à tela
  }
}

// ---------------------------------------------------------------------------
// Modelos de contrato da conta do escritório (#522)
// ---------------------------------------------------------------------------
/** Teto de páginas da lista (20 modelos por página no ZapSign): 400 modelos. */
const MODELOS_MAX_PAGINAS = 20;

/** TODOS os modelos ativos de DOCX da conta, em ordem de pasta e nome. */
export async function listarModelos(integ: Integracao): Promise<ModeloZapsign[]> {
  const modelos: ModeloZapsign[] = [];
  for (let pagina = 1; pagina <= MODELOS_MAX_PAGINAS; pagina++) {
    const r = (await chamar(integ, `/api/v1/templates/?page=${pagina}`)) as {
      next?: string | null;
      results?: Array<{ token?: string; name?: string; active?: boolean; template_type?: string; folder_path?: string }>;
    };
    for (const m of r.results ?? []) {
      // só DOCX gera documento por `models/create-doc` (o de PDF é preenchido na tela do ZapSign)
      if (!m.token || m.active === false || (m.template_type && m.template_type !== "docx")) continue;
      modelos.push({ token: m.token, nome: String(m.name ?? "Modelo sem nome"), pasta: String(m.folder_path || "/") });
    }
    if (!r.next) break;
  }
  return modelos.sort((a, b) => a.pasta.localeCompare(b.pasta, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** O que o cadastro do cliente sabe responder num modelo. */
export interface DadosDoCliente {
  nome?: string | null;
  cpf?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  data_nascimento?: string | null;
}
const cpfFormatado = (cpf: string) => (/^\d{11}$/.test(cpf) ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf);

/** Nome de campo do modelo sem acento e em minúsculas, para casar com as regras abaixo. */
const semAcento = (v: string): string => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** O campo fala de OUTRA pessoa que não o cliente ("nome da mãe", "CPF do representante legal"). */
const DE_OUTRA_PESSOA = /\b(mae|pai|advogad|escritorio|testemunha|conjuge|representante|procurador|contratad)/;

/** Valor do cadastro para um campo do modelo, pelo nome que o campo tem lá. "" = não sabemos. */
function sugestaoPara(rotulo: string, c: DadosDoCliente): string {
  const r = semAcento(rotulo);
  if (/\bcpf\b/.test(r)) return DE_OUTRA_PESSOA.test(r) ? "" : cpfFormatado(String(c.cpf ?? "").replace(/\D/g, ""));
  if (/e-?mail/.test(r)) return String(c.email ?? "");
  if (/telefone|celular|whats/.test(r)) return String(c.telefone ?? "");
  if (/endereco/.test(r)) return String(c.endereco ?? "");
  if (/nascimento/.test(r)) {
    const m = String(c.data_nascimento ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  }
  // "nome", "nome completo", "nome do contratante" — mas não "nome da mãe" nem "nome do advogado"
  if (/\bnome\b/.test(r) && !DE_OUTRA_PESSOA.test(r)) return String(c.nome ?? "");
  return "";
}

/**
 * Nome e campos de UM modelo, já com o que o cadastro do cliente responde e
 * com as regras do texto de ajuda (`camposDoModelo`). `arquivo` é o endereço
 * do DOCX do modelo — de vida curta, só para a prévia ler agora.
 */
export async function detalharModelo(integ: Integracao, modeloToken: string, cliente: DadosDoCliente): Promise<{ modelo: ModeloZapsign; campos: CampoDoModelo[]; arquivo: string }> {
  const m = (await chamar(integ, `/api/v1/templates/${encodeURIComponent(modeloToken)}/`)) as {
    token?: string; name?: string; folder_path?: string; template_file?: string; inputs?: EntradaDoModelo[];
  };
  return {
    modelo: { token: m.token ?? modeloToken, nome: String(m.name ?? "Modelo sem nome"), pasta: String(m.folder_path || "/") },
    campos: camposDoModelo(m.inputs ?? [], (rotulo) => sugestaoPara(rotulo, cliente)),
    arquivo: String(m.template_file ?? ""),
  };
}

/** Teto do DOCX de um modelo (o ZapSign aceita até 10 MB). */
const MODELO_MAX_BYTES = 10 * 1024 * 1024;

/** O contrato do modelo com os campos preenchidos, para a pessoa conferir ANTES de enviar. Não cria nada no ZapSign. */
export async function previaDoModelo(arquivo: string, respostas: ReadonlyArray<{ variavel: string; valor: string }>): Promise<ParagrafoDoContrato[]> {
  if (!arquivo) throw new Error("o ZapSign não informou o arquivo deste modelo");
  const docx = await baixarDoZapsign(arquivo, MODELO_MAX_BYTES, "o arquivo do modelo");
  return previaDoContrato(await paragrafosDoDocx(docx), respostas);
}

/** Cria o documento a partir do modelo, com os campos preenchidos e o cliente como signatário. */
export async function criarDocumentoDeModelo(
  integ: Integracao,
  entrada: { modeloToken: string; externalId: string; respostas: Array<{ variavel: string; valor: string }>; signatario: NovoSignatario },
): Promise<DocumentoZapsign> {
  const s = entrada.signatario;
  const corpo = {
    template_id: entrada.modeloToken,
    signer_name: s.nome,
    signer_email: s.email,
    signer_phone_country: s.telefone ? s.ddi : "",
    signer_phone_number: s.telefone,
    external_id: entrada.externalId,
    lang: "pt-br",
    send_automatic_email: !!s.email,
    send_automatic_whatsapp: !!s.telefone,
    data: entrada.respostas.map((r) => ({ de: r.variavel, para: r.valor })),
  };
  return (await chamar(integ, "/api/v1/models/create-doc/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    timeoutMs: 45_000,
  })) as DocumentoZapsign;
}

// ---------------------------------------------------------------------------
// Do que o ZapSign diz para o que a gente guarda
// ---------------------------------------------------------------------------
// A documentação do ZapSign escreve os mesmos status de dois jeitos: em inglês
// nas tabelas ("refused", "link-opened", "signed") e em português nos exemplos
// de aviso ("recusado", "abriu-link") e na listagem ("assinou", "abriu"). As
// duas formas valem: com uma só, um contrato recusado ficaria "enviado" para sempre.
const SIGNATARIO_ASSINOU = ["signed", "assinou"];
const SIGNATARIO_ABRIU = ["link-opened", "abriu-link", "abriu"];
const DOCUMENTO_ASSINADO = ["signed", "assinado"];
const DOCUMENTO_RECUSADO = ["refused", "recusado"];

function statusDoSignatario(bruto: string | undefined): StatusSignatario {
  if (SIGNATARIO_ASSINOU.includes(String(bruto))) return "assinou";
  if (SIGNATARIO_ABRIU.includes(String(bruto))) return "abriu";
  return "pendente";
}

type Papel = Signatario["papel"];

/**
 * Do que o ZapSign devolveu para o que a gente guarda. O papel de cada
 * signatário vem, nesta ordem: de `papelDe` (a adoção sabe quem é o cliente),
 * do que já estava gravado (casado pelo token do signatário), do `external_id`
 * que mandamos no envio e, por último, da posição (o primeiro é o cliente).
 * Nunca só pela posição: o ZapSign não promete devolver na ordem enviada.
 */
function signatariosDe(doc: DocumentoZapsign, anteriores: Signatario[], papelDe?: (s: SignerZapsign, i: number) => Papel): Signatario[] {
  return (doc.signers ?? []).map((s, i) => {
    const antes = anteriores.find((a) => a.token && a.token === s.token);
    const doEnvio = s.external_id === "cliente" || s.external_id === "escritorio" ? s.external_id : null;
    return {
      nome: String(s.name ?? antes?.nome ?? "").slice(0, 200),
      papel: papelDe?.(s, i) ?? antes?.papel ?? doEnvio ?? (i === 0 ? "cliente" : "escritorio"),
      email: s.email || antes?.email || "",
      telefone: s.phone_number || antes?.telefone || "",
      token: s.token ?? "",
      sign_url: s.sign_url ?? antes?.sign_url ?? "",
      status: statusDoSignatario(s.status),
      assinado_em: s.signed_at ?? null,
    };
  });
}

/** Status do envio a partir da leitura do ZapSign (sem o passo de gravar o PDF). */
function statusDe(doc: DocumentoZapsign, signatarios: Signatario[]): "enviado" | "aberto" | "todos_assinaram" | "recusado" | "cancelado" {
  if (doc.deleted) return "cancelado";
  if (DOCUMENTO_ASSINADO.includes(String(doc.status))) return "todos_assinaram";
  if (DOCUMENTO_RECUSADO.includes(String(doc.status))) return "recusado";
  return signatarios.some((s) => s.status !== "pendente") ? "aberto" : "enviado";
}

/** O que `zapsign-enviar` grava na linha quando o ZapSign aceita o documento. */
export function envioAceito(criado: { token?: string; signers?: unknown }): { zapsign_doc_token: string; status: StatusAssinatura; signatarios: Signatario[] } | null {
  const doc = criado as DocumentoZapsign;
  if (!doc.token) return null;
  return { zapsign_doc_token: doc.token, status: "enviado", signatarios: signatariosDe(doc, []) };
}

// ---------------------------------------------------------------------------
// Tarefas que acompanham a assinatura (pedido da Naira, 17/11/2026)
// ---------------------------------------------------------------------------
// Ao enviar nasce "Acompanhar assinatura"; quando todos assinam ela é concluída
// e nasce "Contrato assinado — dar prosseguimento", para o caso não ficar
// parado. `origem_ref` = '<etapa>:<id da assinatura>': o índice único
// uq_tarefas_origem_ref barra a tarefa em dobro quando o aviso se repete.
// Falha aqui NÃO desfaz o envio nem o PDF gravado: vai para o log.
const ORIGEM_TAREFA = "zapsign_assinatura";
const DIA_MS = 24 * 60 * 60 * 1000;

/** Vencimento daqui a `dias`; se cair no fim de semana (Brasília), vai para a segunda. */
function prazoEm(dias: number): string {
  const quando = new Date(Date.now() + dias * DIA_MS);
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(quando);
  if (dia === "Sat") quando.setTime(quando.getTime() + 2 * DIA_MS);
  if (dia === "Sun") quando.setTime(quando.getTime() + DIA_MS);
  return quando.toISOString();
}

/** A única porta das tarefas desta integração: uma por `ref`, nunca em dobro. */
async function criarTarefa(
  sb: SupabaseClient,
  t: { ref: string; casoId: string | null; responsavel: string | null; tipo: string; titulo: string; descricao: string; dias: number; metadata: Record<string, unknown> },
): Promise<void> {
  const { error } = await sb.from("tarefas").insert({
    caso_id: t.casoId, responsavel_id: t.responsavel, created_by: t.responsavel,
    tipo: t.tipo, titulo: t.titulo.slice(0, 200), descricao: t.descricao.slice(0, 2000), due_at: prazoEm(t.dias),
    origem: ORIGEM_TAREFA, origem_ref: t.ref, metadata: t.metadata,
  });
  // 23505 = já existe a tarefa desta etapa (aviso repetido): é o esperado
  if (error && error.code !== "23505") console.error(`[zapsign] tarefa ${t.ref}: ${error.message}`);
}

/** Ao enviar: alguém fica de olho até o cliente assinar. */
export async function abrirTarefaAcompanhar(sb: SupabaseClient, linha: LinhaAssinatura): Promise<void> {
  await criarTarefa(sb, {
    ref: `acompanhar:${linha.id}`, casoId: linha.caso_id, responsavel: linha.enviado_por, tipo: "contato_cliente", dias: 3,
    titulo: `Acompanhar assinatura: ${linha.nome}`,
    descricao: "Documento enviado para assinatura pelo ZapSign. Se o cliente demorar, copie o link de assinatura na aba Documentos do caso e reenvie.",
    metadata: { assinatura_id: linha.id, etapa: "acompanhar" },
  });
}

/** Todos assinaram: conclui o acompanhamento e abre o passo seguinte. */
async function tarefasDoAssinado(sb: SupabaseClient, linha: LinhaAssinatura): Promise<void> {
  const { error } = await sb.from("tarefas")
    .update({ status: "feito", completed_at: new Date().toISOString() })
    .eq("origem", ORIGEM_TAREFA).eq("origem_ref", `acompanhar:${linha.id}`).eq("status", "a_fazer");
  if (error) console.error(`[zapsign] concluindo "acompanhar" da assinatura ${linha.id}: ${error.message}`);
  await criarTarefa(sb, {
    ref: `prosseguir:${linha.id}`, casoId: linha.caso_id, responsavel: linha.enviado_por, tipo: "interna", dias: 1,
    titulo: `Contrato assinado — dar prosseguimento: ${linha.nome}`,
    descricao: `"${linha.nome}" foi assinado por todos e o PDF assinado está nos documentos do caso.`,
    metadata: { assinatura_id: linha.id, etapa: "prosseguir" },
  });
}

// ---------------------------------------------------------------------------
// Adotar: documento criado DIRETO no ZapSign vira envio do sistema
// ---------------------------------------------------------------------------
// Pedido da Naira (17/11/2026): quem manda o contrato pelo painel do ZapSign
// não precisa cadastrar o cliente antes. O aviso `doc_created` traz o token; o
// resto vem da nossa leitura na API. Regras:
//   · o cliente é o primeiro signatário cujo e-mail NÃO é de alguém da equipe;
//   · o CPF vem do signatário ou de uma resposta do modelo cuja variável fala
//     em CPF. Sem CPF válido não há cliente (o cadastro exige): nasce só uma
//     tarefa pedindo o cadastro à mão;
//   · cliente que já existe (mesmo CPF) é reaproveitado, sem sobrescrever nada,
//     e o envio entra no caso mais recente dele; cliente novo ganha um caso
//     "a_definir";
//   · responsável = quem criou o documento no ZapSign, se o e-mail for de
//     alguém da equipe.
type Adocao =
  | { adotado: true; assinatura: LinhaAssinatura; cliente_novo: boolean; caso_novo: boolean }
  | { adotado: false; motivo: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
const emailDe = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** Resposta do modelo dinâmico cuja variável casa com `padrao` (texto, aparado). */
function respostaDoModelo(doc: DocumentoZapsign, padrao: RegExp): string[] {
  return (doc.answers ?? []).filter((r) => padrao.test(String(r?.variable ?? ""))).map((r) => String(r?.value ?? "").trim()).filter(Boolean);
}

/**
 * O CPF do cliente: o do próprio signatário; sem ele, o das respostas do
 * modelo — mas só quando elas apontam UM CPF só, e nunca o de um campo que
 * fala de outra pessoa ("CPF do representante legal", "CPF do advogado").
 * Na dúvida não há CPF: nasce a tarefa de cadastro à mão, em vez de o contrato
 * entrar no cliente errado.
 */
function cpfDoSignatario(doc: DocumentoZapsign, signer: SignerZapsign): string {
  const doSigner = soDigitos(signer.cpf);
  if (cpfValido(doSigner)) return doSigner;
  const doModelo = new Set(
    (doc.answers ?? [])
      .filter((r) => { const v = semAcento(String(r?.variable ?? "")); return /cpf/.test(v) && !DE_OUTRA_PESSOA.test(v); })
      .map((r) => soDigitos(r?.value))
      .filter(cpfValido),
  );
  return doModelo.size === 1 ? [...doModelo][0] : "";
}

/**
 * `sb` = service role JÁ ESCOPADO ao escritório do segredo do webhook.
 * `admin` = service role SEM escopo, usado só para UMA pergunta: este documento
 * já é de algum escritório? (Dois escritórios na mesma conta do ZapSign recebem
 * o mesmo aviso; o que não enviou não pode adotar o contrato do outro.)
 */
export async function adotarDocumento(
  { sb, admin }: { sb: SupabaseClient; admin: SupabaseClient },
  integ: Integracao,
  docToken: string,
): Promise<Adocao> {
  const doc = await detalharDocumento(integ, docToken);
  if (doc.deleted) return { adotado: false, motivo: "documento excluído no ZapSign" };
  const signers = doc.signers ?? [];
  if (!signers.length) return { adotado: false, motivo: "documento sem signatário" };

  // Documento que o sistema enviou. O aviso pode chegar antes de a linha
  // receber o token — ou a resposta do envio pode ter se perdido (timeout):
  // nesse caso é este aviso que religa a linha ao documento.
  if (ehUuid(doc.external_id)) {
    const { data: nossa, error } = await admin.from("assinaturas").select("id, escritorio_id, zapsign_doc_token").eq("id", doc.external_id).maybeSingle();
    if (error) throw new Error(`conferindo o envio: ${error.message}`);
    if (nossa) {
      if (!nossa.zapsign_doc_token) {
        const signatarios = signatariosDe(doc, []);
        const situacao = statusDe(doc, signatarios);
        const { data: religada, error: eRel } = await sb.from("assinaturas")
          .update({ zapsign_doc_token: docToken, status: situacao === "todos_assinaram" ? "aberto" : situacao, signatarios, updated_at: new Date().toISOString() })
          .eq("id", nossa.id).is("zapsign_doc_token", null).select(COLUNAS_ASSINATURA).maybeSingle();
        if (eRel) throw new Error(`religando o envio: ${eRel.message}`);
        if (religada) {
          console.warn(`[zapsign] envio ${nossa.id} religado ao documento ${docToken} pelo aviso de criação`);
          await abrirTarefaAcompanhar(sb, religada as unknown as LinhaAssinatura);
        }
      }
      return { adotado: false, motivo: "documento enviado pelo sistema" };
    }
  }
  const { data: jaDeAlguem, error: eJa } = await admin.from("assinaturas").select("id").eq("zapsign_doc_token", docToken).limit(1);
  if (eJa) throw new Error(`conferindo o documento: ${eJa.message}`);
  if (jaDeAlguem?.length) return { adotado: false, motivo: "documento já registrado" };

  // Quem é da equipe DESTE escritório (pelo vínculo, não por `usuarios.tipo`).
  const equipe = new Map<string, string>(); // e-mail → usuario_id
  for (const pessoa of await equipeInterna(sb)) if (pessoa.email) equipe.set(pessoa.email, pessoa.usuario_id);
  const iCliente = signers.findIndex((s) => !equipe.has(emailDe(s.email)));
  if (iCliente < 0) return { adotado: false, motivo: "todos os signatários são da equipe" };
  const sCli = signers[iCliente];
  const responsavel = equipe.get(emailDe(doc.created_by?.email)) ?? null;
  const nomeDoc = String(doc.name ?? "documento").slice(0, 255);

  const cpf = cpfDoSignatario(doc, sCli);
  if (!cpf) {
    // Sem CPF não há cadastro: fica uma tarefa para ninguém perder o contrato.
    const contato = [sCli.name, sCli.email, telefoneGuardado(sCli.phone_country, sCli.phone_number)].filter(Boolean).join(" · ");
    await criarTarefa(sb, {
      ref: `sem_cpf:${docToken}`, casoId: null, responsavel, tipo: "interna", dias: 1,
      titulo: `Cadastrar cliente do contrato enviado pelo ZapSign: ${nomeDoc}`,
      descricao: `O documento foi enviado direto pelo ZapSign sem o CPF do signatário, e sem CPF o sistema não cadastra o cliente. Signatário: ${contato}. Cadastre o cliente e o caso e anexe o contrato quando for assinado.`,
      metadata: { zapsign_doc_token: docToken, etapa: "sem_cpf" },
    });
    return { adotado: false, motivo: "signatário sem CPF" };
  }

  // Cliente: o do CPF, se já existe; senão, novo.
  let clienteNovo = false;
  const achado = await sb.from("clientes").select("id").eq("cpf", cpf).maybeSingle();
  if (achado.error) throw new Error(`procurando o cliente: ${achado.error.message}`);
  let clienteId: string | null = achado.data?.id ?? null;
  if (!clienteId) {
    const ins = await sb.from("clientes").insert({
      nome: String(sCli.name ?? "").trim().slice(0, 200) || "Cliente sem nome", cpf,
      email: emailDe(sCli.email) || null,
      // com o código do país quando é de fora: é como a tela guarda e o `telefoneDe` lê
      telefone: telefoneGuardado(sCli.phone_country, sCli.phone_number) || null, created_by: responsavel,
      // endereço: só de modelo que tenha uma variável de endereço
      endereco: respostaDoModelo(doc, /endere[cç]o/i)[0]?.slice(0, 500) ?? null,
    }).select("id").single();
    if (ins.error?.code === "23505") {
      // outro aviso do mesmo documento cadastrou primeiro
      const de = await sb.from("clientes").select("id").eq("cpf", cpf).maybeSingle();
      if (de.error || !de.data) throw new Error(`relendo o cliente: ${de.error?.message ?? "não encontrado"}`);
      clienteId = de.data.id;
    } else if (ins.error || !ins.data) {
      throw new Error(`cadastrando o cliente: ${ins.error?.message ?? "sem retorno"}`);
    } else {
      clienteId = ins.data.id;
      clienteNovo = true;
    }
  }

  // Caso: o mais recente do cliente; cliente sem caso ganha um.
  let casoNovo = false;
  const { data: casos, error: eCasos } = await sb.from("casos").select("id").eq("cliente_id", clienteId).order("created_at", { ascending: false }).order("id").limit(1);
  if (eCasos) throw new Error(`procurando o caso: ${eCasos.message}`);
  let casoId = casos?.[0]?.id as string | undefined;
  if (!casoId) {
    const ins = await sb.from("casos").insert({
      cliente_id: clienteId, tipo_beneficio: "a_definir", responsavel_id: responsavel,
      observacoes: `Caso aberto automaticamente a partir do documento "${nomeDoc}", enviado pelo ZapSign.`,
    }).select("id").single();
    if (ins.error || !ins.data) throw new Error(`abrindo o caso: ${ins.error?.message ?? "sem retorno"}`);
    casoId = ins.data.id;
    casoNovo = true;
  }

  const signatarios = signatariosDe(doc, [], (_, i) => (i === iCliente ? "cliente" : "escritorio"));
  const situacao = statusDe(doc, signatarios);
  const { data: linha, error: eLinha } = await sb.from("assinaturas").insert({
    caso_id: casoId, nome: nomeDoc, zapsign_doc_token: docToken, sandbox: ehSandbox(integ),
    // "todos_assinaram" entra como aberto: quem grava o PDF é o sincronizar, com a trava
    status: situacao === "todos_assinaram" ? "aberto" : situacao, signatarios, enviado_por: responsavel,
  }).select(COLUNAS_ASSINATURA).single();
  if (eLinha || !linha) {
    // Aviso repetido: o outro já adotou. O caso aberto agora sai — mas só se
    // ficou vazio (o outro aviso pode ter pendurado o envio justamente nele).
    if (casoNovo) {
      const { data: emUso, error: eUso } = await sb.from("assinaturas").select("id").eq("caso_id", casoId).limit(1);
      if (!eUso && !emUso?.length) {
        const { error: eDel } = await sb.from("casos").delete().eq("id", casoId);
        if (eDel) console.error(`[zapsign] não removi o caso ${casoId} aberto em dobro: ${eDel.message}`);
      }
    }
    if (eLinha?.code === "23505") return { adotado: false, motivo: "documento já registrado" };
    throw new Error(`registrando o envio: ${eLinha?.message ?? "sem retorno"}`);
  }
  const assinatura = linha as unknown as LinhaAssinatura;
  await abrirTarefaAcompanhar(sb, assinatura);
  return { adotado: true, assinatura, cliente_novo: clienteNovo, caso_novo: casoNovo };
}

// ---------------------------------------------------------------------------
// Sincronizar: ler o ZapSign e trazer status e PDF assinado
// ---------------------------------------------------------------------------
function nomeDoAssinado(nome: string): string {
  const base = (formatoAssinavel(nome) ? nome.replace(/\.[^.]+$/, "") : nome).trim() || "documento";
  return `${base} (assinado).pdf`;
}
function nomeNoStorage(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

/** Baixa um arquivo que o ZapSign apontou, com teto ANTES de carregar e sem seguir endereço estranho. */
async function baixarDoZapsign(url: string, teto: number, oQue: string): Promise<Uint8Array> {
  // https sempre; http só quando a base é a do simulador local (ZAPSIGN_BASE_URL)
  const destino = new URL(url);
  if (destino.protocol !== "https:" && !(destino.protocol === "http:" && Deno.env.get("ZAPSIGN_BASE_URL"))) {
    throw new Error(`endereço de ${oQue} não é https`);
  }
  const r = await fetchT(url, { timeoutMs: 60_000 });
  const declarado = Number(r.headers.get("content-length") ?? 0);
  if (!r.ok || declarado > teto) {
    await r.body?.cancel();
    throw new Error(r.ok ? `${oQue} maior que o limite` : `baixando ${oQue}: HTTP ${r.status}`);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length) throw new Error(`${oQue} veio vazio`);
  if (bytes.length > teto) throw new Error(`${oQue} maior que o limite`);
  return bytes;
}
const baixarAssinado = (url: string) => baixarDoZapsign(url, ASSINADO_MAX_BYTES, "o PDF assinado");

/**
 * Traz para a linha o que o ZapSign diz AGORA. Quando todos assinaram, baixa o
 * PDF e grava como documento do caso — uma vez só: o status `gravando` é a
 * trava contra o aviso repetido (o ZapSign reenvia e manda um aviso por
 * signatário).
 *
 * `sb` é o client de service role JÁ ESCOPADO ao escritório da linha.
 */
export async function sincronizarAssinatura(sb: SupabaseClient, integ: Integracao, linha: LinhaAssinatura): Promise<LinhaAssinatura> {
  if (!linha.zapsign_doc_token) return linha;
  const agora = new Date().toISOString();
  const ler = async (): Promise<LinhaAssinatura> => {
    const { data, error } = await sb.from("assinaturas").select(COLUNAS_ASSINATURA).eq("id", linha.id).single();
    if (error) throw new Error(`relendo assinatura: ${error.message}`);
    return data as unknown as LinhaAssinatura;
  };
  /** Update condicionado ao status que a linha tem AGORA no banco; `null` = outra chamada passou na frente. */
  const gravarSe = async (statusAtuais: StatusAssinatura[], campos: Record<string, unknown>): Promise<LinhaAssinatura | null> => {
    const { data, error } = await sb.from("assinaturas").update({ ...campos, updated_at: agora })
      .eq("id", linha.id).in("status", statusAtuais).select(COLUNAS_ASSINATURA).maybeSingle();
    if (error) throw new Error(`atualizando assinatura: ${error.message}`);
    return data as unknown as LinhaAssinatura | null;
  };

  // PDF já gravado e status para trás (uma chamada atrasada escreveu por cima): só conserta.
  if (linha.documento_assinado_id) {
    const certa = linha.status === "assinado" ? linha : (await gravarSe(["enviado", "aberto", "gravando", "recusado", "cancelado"], { status: "assinado" })) ?? (await ler());
    await tarefasDoAssinado(sb, certa); // sem efeito se já existem; refaz se falharam
    return certa;
  }

  // Envio feito num ambiente e integração ligada no outro (o escritório trocou
  // produção ↔ teste com contratos pendentes): o documento não existe na base
  // de agora. Nem pergunta — e, principalmente, não cancela.
  if (linha.sandbox !== ehSandbox(integ)) throw new DocumentoForaDaConta();
  let doc: DocumentoZapsign;
  try {
    doc = await detalharDocumento(integ, linha.zapsign_doc_token);
  } catch (e) {
    // 404 NÃO é cancelamento: documento excluído continua respondendo, com
    // `deleted: true` (tratado em `statusDe`). 404 é documento de outra conta.
    // Marcar "cancelado" aqui liberaria um segundo envio do mesmo contrato.
    if (e instanceof ErroZapsign && e.http === 404) throw new DocumentoForaDaConta();
    throw e;
  }
  const signatarios = signatariosDe(doc, linha.signatarios ?? []);
  const situacao = statusDe(doc, signatarios);

  if (situacao !== "todos_assinaram") {
    // nunca por cima de `gravando`/`assinado`: quem está gravando o PDF manda
    return (await gravarSe(["enviado", "aberto", "recusado", "cancelado"], { status: situacao, signatarios })) ?? (await ler());
  }

  // Trava: só quem conseguir passar a linha para `gravando` baixa o PDF. A
  // trava velha (tentativa que morreu no meio) só é tomada por UM: o
  // `updated_at` que lemos tem de ser o que ainda está lá.
  const travaVelha = linha.status === "gravando" && Date.now() - new Date(linha.updated_at).getTime() > TRAVA_VELHA_MS;
  let tomar = sb.from("assinaturas").update({ status: "gravando", signatarios, updated_at: agora })
    .eq("id", linha.id).is("documento_assinado_id", null);
  tomar = travaVelha
    ? tomar.eq("status", "gravando").eq("updated_at", linha.updated_at)
    : tomar.in("status", ["enviado", "aberto", "recusado", "cancelado"]);
  const { data: travada, error: eTrava } = await tomar.select("id");
  if (eTrava) throw new Error(`travando assinatura: ${eTrava.message}`);
  if (!travada?.length) return await ler(); // outra chamada está gravando (ou já gravou)

  let caminho: string | null = null;
  let novoDocId: string | null = null;
  try {
    if (!doc.signed_file) throw new Error("ZapSign diz assinado, mas não devolveu o arquivo");
    const bytes = await baixarAssinado(doc.signed_file);

    // o assinado herda tipo e visibilidade do arquivo que foi enviado
    let tipo = linha.tipo_documento ?? "outro";
    let tipoPersonalizado: string | null = null;
    let visivelParceiro = false;
    if (linha.documento_id) {
      const { data: original, error: eOrig } = await sb
        .from("documentos").select("tipo, tipo_personalizado, visivel_parceiro").eq("id", linha.documento_id).maybeSingle();
      if (eOrig) throw new Error(`lendo o documento enviado: ${eOrig.message}`);
      if (original) {
        tipo = original.tipo;
        tipoPersonalizado = original.tipo_personalizado ?? null;
        visivelParceiro = !!original.visivel_parceiro;
      }
    }

    const nome = nomeDoAssinado(linha.nome);
    caminho = `${linha.caso_id}/${Date.now()}_${nomeNoStorage(nome)}`;
    const up = await sb.storage.from("documentos").upload(caminho, new Blob([bytes], { type: "application/pdf" }), {
      contentType: "application/pdf", upsert: false,
    });
    if (up.error) throw new Error(`guardando o PDF assinado: ${up.error.message}`);

    const { data: novoDoc, error: eDoc } = await sb
      .from("documentos")
      .insert({
        caso_id: linha.caso_id, tipo, tipo_personalizado: tipoPersonalizado, nome_arquivo: nome, storage_path: caminho,
        tamanho_bytes: bytes.length, uploaded_by: linha.enviado_por, visivel_parceiro: visivelParceiro,
      })
      .select("id")
      .single();
    if (eDoc || !novoDoc) throw new Error(`registrando o documento assinado: ${eDoc?.message ?? "sem retorno"}`);
    novoDocId = novoDoc.id;

    const assinada = await gravarSe(["gravando"], { status: "assinado", signatarios, documento_assinado_id: novoDocId, assinado_em: agora });
    if (!assinada) throw new Error("a trava mudou de mão enquanto o PDF era gravado");
    await tarefasDoAssinado(sb, assinada);
    return assinada;
  } catch (e) {
    // Desfaz o que ficou pela metade (sem a ligação na linha, o próximo aviso
    // gravaria um segundo PDF) e solta a trava: o próximo aviso tenta de novo.
    if (novoDocId) {
      const { error: eDocDel } = await sb.from("documentos").delete().eq("id", novoDocId);
      if (eDocDel) console.error(`[zapsign] não removi o documento ${novoDocId} órfão: ${eDocDel.message}`);
    }
    if (caminho) await sb.storage.from("documentos").remove([caminho]);
    const { error: eVolta } = await sb.from("assinaturas").update({ status: "aberto", updated_at: agora }).eq("id", linha.id).eq("status", "gravando");
    if (eVolta) console.error(`[zapsign] não soltei a trava de ${linha.id}: ${eVolta.message}`);
    throw e;
  }
}

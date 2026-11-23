// Contrato a partir de um MODELO do ZapSign: as regras dos campos e a prévia.
//
// Módulo PURO (não importa nada): a tela usa por `@shared/modelo-contrato` e a
// function `zapsign-enviar` por `../_shared/modelo-contrato.ts`. É o ÚNICO
// lugar que decide:
//   - o que o texto de ajuda do campo no ZapSign diz ao sistema
//     ("Padrão: 35% · Máximo: 50%"): o valor que já vem preenchido e a faixa aceita;
//   - que campo o sistema escreve sozinho: `{{X_EXTENSO}}` é o `{{X}}` por
//     extenso ("30%" → "trinta por cento"), para o número e o extenso do
//     contrato nunca divergirem;
//   - o que a pessoa NÃO digita, e de onde veio (`origem`): cadastro do cliente,
//     caso, data de hoje ou padrão do modelo — a tela só mostra;
//   - o valor que vai ao ZapSign em cada campo (`respostasDoModelo`) — a tela
//     mostra e o servidor envia o MESMO resultado;
//   - o texto do contrato já preenchido: o servidor lê o DOCX do modelo UMA vez
//     (`paragrafosDoDocx`) e a tela preenche (`previaDoContrato`) com os mesmos
//     valores de `respostasDoModelo` — conferir de novo não vai mais ao ZapSign.

/** Como o ZapSign descreve um campo do modelo (`inputs` de GET /templates/{token}/). */
export interface EntradaDoModelo {
  variable?: string;
  label?: string;
  help_text?: string;
  required?: boolean;
  order?: number;
  /** lista de escolhas do campo no ZapSign: "Opção A; Opção B" */
  options?: string;
}

/**
 * Campo que o sistema sabe montar sem a pessoa digitar:
 * "qualificacao" = nome, nacionalidade, estado civil, profissão, RG, CPF e endereço numa frase;
 * "beneficio"    = o benefício do caso, escolhido na lista de tipos do escritório;
 * "parceiro"     = o parceiro que indicou o caso (ou "não há").
 */
export type EspecieDoCampo = "qualificacao" | "beneficio" | "parceiro";

/** O que o sistema sabe do caso e do cliente na hora de abrir o modelo. */
export interface ContextoDoModelo {
  /** tipos de benefício do escritório, na ordem do catálogo */
  beneficios?: ReadonlyArray<string>;
  /** tipo de benefício do caso */
  beneficioDoCaso?: string | null;
  cliente?: DadosDoCliente;
  /** nome do parceiro que indicou o caso (vazio = o caso não tem parceiro) */
  parceiro?: string | null;
  /** a data de hoje como o contrato escreve ("20 de novembro de 2026"), no calendário do escritório */
  hoje?: string;
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

/** De onde veio o valor que já está no campo ("" = ninguém preencheu). */
export type OrigemDoValor = "cadastro" | "caso" | "hoje" | "modelo" | "";

export type TipoDoCampo = "texto" | "percentual" | "inteiro";

/** Um campo do modelo, como a tela e o servidor o tratam. */
export interface CampoDoModelo {
  /** como o ZapSign chama a variável, com as chaves: "{{NOME COMPLETO}}" */
  variavel: string;
  rotulo: string;
  /** o texto de ajuda do ZapSign, sem as regras que o sistema já aplica */
  ajuda: string;
  obrigatorio: boolean;
  /** valor que já vem preenchido: o do cadastro do cliente ou, sem ele, o padrão do modelo */
  sugestao: string;
  /** de onde a `sugestao` veio — a tela mostra, não adivinha pelo nome do campo */
  origem: OrigemDoValor;
  tipo: TipoDoCampo;
  /** "Padrão: …" do texto de ajuda ("" = o modelo não define) */
  padrao: string;
  minimo: number | null;
  maximo: number | null;
  /** variável de que este campo é o extenso: o sistema escreve, a pessoa não digita */
  extensoDe: string | null;
  /** escolhas prontas (a pessoa ainda pode escrever outra); [] = campo livre */
  opcoes: string[];
  especie: EspecieDoCampo | null;
  /**
   * variável que este campo repete: o modelo pede o benefício em mais de um
   * campo ("objeto do serviço", "benefício ou serviço") e ele é um só — a
   * pessoa escolhe no primeiro e o sistema escreve nos outros.
   */
  copiaDe: string | null;
}

// ---------------------------------------------------------------------------
// Qualificação do contratante: escolhida em listas, escrita pelo sistema
// ---------------------------------------------------------------------------
export const NACIONALIDADES = ["brasileiro(a)", "brasileiro(a) naturalizado(a)", "estrangeiro(a)"] as const;
export const ESTADOS_CIVIS = ["solteiro(a)", "casado(a)", "em união estável", "divorciado(a)", "separado(a) judicialmente", "viúvo(a)"] as const;
export const PROFISSOES = [
  "aposentado(a)", "pensionista", "do lar", "trabalhador(a) rural", "autônomo(a)", "desempregado(a)", "empregado(a) doméstico(a)",
  "servidor(a) público(a)", "comerciante", "motorista", "pedreiro", "professor(a)", "vendedor(a)", "auxiliar de serviços gerais",
] as const;

export interface PartesDaQualificacao {
  nome: string;
  nacionalidade: string;
  estadoCivil: string;
  profissao: string;
  rg: string;
  cpf: string;
  endereco: string;
}

/** CPF como o contrato escreve: 529.982.247-25. O que não tem 11 dígitos volta como veio. */
export function cpfComPontos(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf.trim();
}

/** As partes da qualificação que o cadastro já responde; o resto a pessoa escolhe nas listas. */
export function partesDoCadastro(cliente: DadosDoCliente = {}): PartesDaQualificacao {
  return { nome: cliente.nome ?? "", nacionalidade: NACIONALIDADES[0], estadoCivil: "", profissao: "", rg: "", cpf: cliente.cpf ?? "", endereco: cliente.endereco ?? "" };
}

/** A frase da qualificação. Parte em branco simplesmente não entra. */
export function qualificacaoDe(p: Partial<PartesDaQualificacao>): string {
  const t = (v: string | undefined) => (v ?? "").trim();
  return [
    t(p.nome),
    t(p.nacionalidade),
    t(p.estadoCivil),
    t(p.profissao),
    t(p.rg) && `RG n.º ${t(p.rg)}`,
    t(p.cpf) && `CPF n.º ${cpfComPontos(t(p.cpf))}`,
    t(p.endereco) && `residente e domiciliado(a) em ${t(p.endereco).replace(/[.\s]+$/, "")}`,
  ].filter(Boolean).join(", ");
}

/** O nome do benefício como entra no meio de uma frase: "Aposentadoria por idade" → "aposentadoria por idade"; "BPC/LOAS" fica. */
export function beneficioNaFrase(nome: string): string {
  const v = nome.trim();
  return /^[A-ZÀ-Ý][a-zà-ÿ]/.test(v) ? v[0].toLowerCase() + v.slice(1) : v;
}

/** Minúsculas e sem acento: é assim que nome de campo e busca são comparados. */
export const semAcento = (v: string): string => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** O campo fala de OUTRA pessoa que não o cliente ("nome da mãe", "CPF do representante legal"). */
export const DE_OUTRA_PESSOA = /\b(mae|pai|advogad|escritorio|testemunha|conjuge|representante|procurador|contratad)/;
const nomeDaVariavel = (variavel: string): string => variavel.replace(/[{}]/g, "").trim();

// ---------------------------------------------------------------------------
// Número por extenso
// ---------------------------------------------------------------------------
const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ateMil(n: number): string {
  if (n === 100) return "cem";
  const partes: string[] = [];
  if (n >= 100) partes.push(CENTENAS[Math.floor(n / 100)]);
  const resto = n % 100;
  if (resto >= 20) {
    partes.push(DEZENAS[Math.floor(resto / 10)]);
    if (resto % 10) partes.push(UNIDADES[resto % 10]);
  } else if (resto > 0 || n === 0) partes.push(UNIDADES[resto]);
  return partes.join(" e ");
}

/** Inteiro de 0 a 999.999 por extenso ("" fora disso). */
export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return "";
  if (n < 1000) return ateMil(n);
  const milhares = Math.floor(n / 1000);
  const resto = n % 1000;
  const mil = milhares === 1 ? "mil" : `${ateMil(milhares)} mil`;
  if (!resto) return mil;
  // "mil e duzentos", "mil e cinco", mas "mil duzentos e cinco"
  return resto < 100 || resto % 100 === 0 ? `${mil} e ${ateMil(resto)}` : `${mil} ${ateMil(resto)}`;
}

const PERCENTUAL = /^(\d{1,3})(?:,(\d{1,2}))?%$/;

/**
 * O extenso de um valor já normalizado: "30%" → "trinta por cento",
 * "32,5%" → "trinta e dois vírgula cinco por cento", "5" → "cinco".
 * "" = não é número que o sistema saiba escrever.
 */
export function extensoDoValor(valor: string): string {
  const v = valor.trim();
  const p = PERCENTUAL.exec(v);
  if (p) {
    // "32,5" → "vírgula cinco"; "32,05" → "vírgula zero cinco"
    const decimal = (p[2] ?? "").replace(/0+$/, "");
    const zeros = decimal.length - decimal.replace(/^0+/, "").length;
    const fracao = decimal ? ` vírgula ${"zero ".repeat(zeros)}${numeroPorExtenso(Number(decimal))}` : "";
    return `${numeroPorExtenso(Number(p[1]))}${fracao} por cento`;
  }
  return /^\d{1,6}$/.test(v) ? numeroPorExtenso(Number(v)) : "";
}

// ---------------------------------------------------------------------------
// O que o texto de ajuda do campo diz ao sistema
// ---------------------------------------------------------------------------
/** Um número como a pessoa digita: "30", "30%", "30,5 %". */
const NUMERO = /^(\d{1,6})(?:[.,](\d{1,2}))?\s*%?$/;
const numeroDe = (texto: string): number | null => {
  const m = NUMERO.exec(texto.trim());
  return m ? Number(`${m[1]}.${m[2] ?? "0"}`) : null;
};

/** "Padrão: 35% · Máximo: 50%" → as regras; o que sobra é a ajuda que a pessoa lê. */
export function regrasDaAjuda(ajuda: string): { padrao: string; minimo: number | null; maximo: number | null; sistema: string; texto: string } {
  let padrao = "";
  let sistema = "";
  let minimo: number | null = null;
  let maximo: number | null = null;
  const resto: string[] = [];
  // Quebra no separador "·"/";"/"|"/linha E também logo ANTES de cada palavra-regra
  // ("Padrão:", "Máximo:"…): assim "Padrão: 35% Máximo: 50%" (espaço, porque "·" é
  // difícil de digitar) ainda separa as duas regras — antes o "35%" engolia o
  // "Máximo: 50%" e o teto se perdia.
  for (const parte of ajuda.split(/[·;|\n]|(?=(?:padr[aã]o|m[ií]nimo|m[aá]ximo|sistema)\s*:)/i)) {
    const m = /^\s*(padrao|minimo|maximo|sistema)\s*:\s*(.+?)\s*$/.exec(semAcento(parte));
    if (!m) {
      if (parte.trim()) resto.push(parte.trim());
      continue;
    }
    // o valor sai do texto original (com acento e maiúscula), não do comparado
    const valor = parte.slice(parte.indexOf(":") + 1).trim();
    if (m[1] === "padrao") padrao = valor;
    else if (m[1] === "sistema") sistema = m[2];
    else if (m[1] === "minimo") minimo = numeroDe(valor);
    else maximo = numeroDe(valor);
  }
  // sem regra nenhuma, a ajuda é a do modelo, como foi escrita (com o ";" que tiver)
  const achou = padrao || sistema || minimo !== null || maximo !== null;
  return { padrao, minimo, maximo, sistema, texto: achou ? resto.join(" · ") : ajuda.trim() };
}

/** Deixa o valor digitado como o contrato escreve: "30" ou "30,5 %" → "30%" / "30,5%". */
export function normalizarValor(tipo: TipoDoCampo, bruto: string): string {
  const v = bruto.trim();
  if (tipo === "texto" || !v) return v;
  const m = NUMERO.exec(v);
  if (!m) return v; // não é número: `respostasDoModelo` acusa
  if (tipo === "inteiro") return m[2] ? v : String(Number(m[1]));
  const decimal = m[2] && Number(m[2]) ? `,${m[2].replace(/0+$/, "")}` : "";
  return `${Number(m[1])}${decimal}%`;
}

/**
 * Que campo o sistema monta sozinho. O modelo manda ("Sistema: benefício" no
 * texto de ajuda); sem isso, vale o nome do campo. "Sistema: nenhum" desliga.
 */
function especieDe(sistema: string, nome: string, rotulo: string): EspecieDoCampo | null {
  if (/^qualifica/.test(sistema)) return "qualificacao";
  if (/^benefici/.test(sistema)) return "beneficio";
  if (/^parceiro/.test(sistema)) return "parceiro";
  if (sistema) return null;
  // o campo fala de OUTRA pessoa ("Qualificação do representante", "Benefício do
  // cônjuge")? então o sistema não o preenche com o cliente/caso — mesma guarda
  // que `doCadastro` já aplica aos campos genéricos. O "_" do nome da variável
  // vira espaço, senão o \b de DE_OUTRA_PESSOA não casa "..._representante".
  const outraPessoa = (t: string) => DE_OUTRA_PESSOA.test(semAcento(t).replace(/_/g, " "));
  if (outraPessoa(nome) || outraPessoa(rotulo)) return null;
  // só quando o campo COMEÇA falando disso: "Quantidade de prestações do benefício" é um número, não o benefício
  const comeca = (re: RegExp) => re.test(semAcento(nome)) || re.test(semAcento(rotulo));
  if (comeca(/^qualificac/)) return "qualificacao";
  if (comeca(/^benefici/)) return "beneficio";
  return comeca(/^(texto[ _])?parceiro/) ? "parceiro" : null;
}

/** O que o cadastro (ou o calendário) responde num campo, pelo nome que o campo tem no modelo. */
function doCadastro(rotulo: string, contexto: ContextoDoModelo): { valor: string; origem: OrigemDoValor } {
  const r = semAcento(rotulo);
  const c = contexto.cliente ?? {};
  const cadastro = (valor: string | null | undefined): { valor: string; origem: OrigemDoValor } => ({ valor: String(valor ?? ""), origem: valor ? "cadastro" : "" });
  if (/\bcpf\b/.test(r)) return DE_OUTRA_PESSOA.test(r) ? cadastro("") : cadastro(c.cpf ? cpfComPontos(c.cpf) : "");
  if (/e-?mail/.test(r)) return cadastro(c.email);
  if (/telefone|celular|whats/.test(r)) return cadastro(c.telefone);
  if (/endereco/.test(r)) return cadastro(c.endereco);
  if (/nascimento/.test(r)) {
    const m = String(c.data_nascimento ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return cadastro(m ? `${m[3]}/${m[2]}/${m[1]}` : "");
  }
  // a data em que o contrato é assinado é hoje
  if (/^data$|data d[ao] (assinatura|contrato)|data de hoje/.test(r)) return { valor: contexto.hoje ?? "", origem: contexto.hoje ? "hoje" : "" };
  // "nome", "nome completo", "nome do contratante" — mas não "nome da mãe" nem "nome do advogado"
  if (/\bnome\b/.test(r) && !DE_OUTRA_PESSOA.test(r)) return cadastro(c.nome);
  return cadastro("");
}

/**
 * Os campos do modelo, na ordem do ZapSign, com as regras lidas do texto de
 * ajuda e com o que o sistema já sabe responder (`contexto`: cadastro do
 * cliente, benefício e parceiro do caso, data de hoje).
 */
export function camposDoModelo(inputs: ReadonlyArray<EntradaDoModelo>, contexto: ContextoDoModelo = {}): CampoDoModelo[] {
  const validos = [...inputs].filter((i) => typeof i.variable === "string" && i.variable).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const porNome = new Map(validos.map((i) => [nomeDaVariavel(i.variable as string).toUpperCase(), i.variable as string]));
  // benefício: a lista do escritório, já do jeito que entra na frase; "Outro" não é um benefício
  const beneficios = (contexto.beneficios ?? []).filter((b) => semAcento(b) !== "outro").map(beneficioNaFrase);
  const doCaso = contexto.beneficioDoCaso && semAcento(contexto.beneficioDoCaso) !== "outro" ? beneficioNaFrase(contexto.beneficioDoCaso) : "";
  let primeiroBeneficio: string | null = null;
  return validos.map((i) => {
    const variavel = i.variable as string;
    const nome = nomeDaVariavel(variavel);
    const rotulo = String(i.label || nome).replace(/[{}]/g, "").trim();
    const regras = regrasDaAjuda(String(i.help_text ?? ""));
    // "{{X_EXTENSO}}" (ou "{{X EXTENSO}}") só é do sistema quando o modelo TEM o "{{X}}"
    const base = /^(.+?)[ _]EXTENSO$/i.exec(nome);
    const extensoDe = base ? (porNome.get(base[1].toUpperCase()) ?? null) : null;
    const tipo: TipoDoCampo = extensoDe
      ? "texto"
      : /%\s*$/.test(regras.padrao) || /^(PERCENTUAL|PORCENTAGEM)/i.test(nome)
        ? "percentual"
        : /^\d+$/.test(regras.padrao)
          ? "inteiro"
          : "texto";
    const especie = extensoDe ? null : especieDe(regras.sistema, nome, rotulo);
    const doModelo = String(i.options ?? "").split(";").map((o) => o.trim()).filter(Boolean);
    const copiaDe = especie === "beneficio" ? primeiroBeneficio : null;
    if (especie === "beneficio" && !primeiroBeneficio) primeiroBeneficio = variavel;
    const padrao = extensoDe ? "" : normalizarValor(tipo, regras.padrao);
    // quem responde o campo, em ordem: o que o caso sabe, o cadastro, o padrão do modelo
    const pronto: { valor: string; origem: OrigemDoValor } = extensoDe
      ? { valor: "", origem: "" }
      : especie === "beneficio"
        ? { valor: doCaso, origem: doCaso ? "caso" : "" }
        : especie === "qualificacao"
          ? { valor: qualificacaoDe(partesDoCadastro(contexto.cliente)), origem: "cadastro" }
          : especie === "parceiro"
            ? { valor: (contexto.parceiro ?? "").trim() || "não há", origem: "caso" }
            : doCadastro(rotulo, contexto);
    const sugestao = pronto.valor || padrao;
    return {
      variavel,
      rotulo,
      ajuda: extensoDe ? "" : regras.texto,
      obrigatorio: i.required === true,
      copiaDe,
      opcoes: extensoDe || copiaDe ? [] : doModelo.length ? doModelo : especie === "beneficio" ? [...new Set([doCaso, ...beneficios].filter(Boolean))] : [],
      especie,
      sugestao,
      origem: pronto.valor ? pronto.origem : sugestao ? "modelo" : "",
      tipo,
      padrao,
      minimo: regras.minimo,
      maximo: regras.maximo,
      extensoDe,
    };
  });
}

const TETO_DO_VALOR = 2000;

/** Número como se escreve aqui: 2.5 → "2,5". */
const numeroBr = (n: number): string => String(n).replace(".", ",");

/** A faixa que o modelo aceita num campo de número, para a tela dizer antes de a pessoa errar ("" = sem faixa). */
export function faixaDoCampo(c: Pick<CampoDoModelo, "tipo" | "minimo" | "maximo">): string {
  const sufixo = c.tipo === "percentual" ? "%" : "";
  return [c.minimo !== null ? `mínimo ${numeroBr(c.minimo)}${sufixo}` : "", c.maximo !== null ? `máximo ${numeroBr(c.maximo)}${sufixo}` : ""].filter(Boolean).join(", ");
}

/**
 * O valor de CADA campo que vai ao ZapSign, e o que impede o envio. A tela
 * chama para mostrar; o servidor chama de novo e é o resultado dele que vale.
 */
export function respostasDoModelo(
  campos: ReadonlyArray<CampoDoModelo>,
  dadas: Readonly<Record<string, unknown>>,
): { respostas: Array<{ variavel: string; valor: string }>; erros: string[] } {
  const erros: string[] = [];
  const valores = new Map<string, string>();
  const comErro = new Set<string>();
  const faltando: string[] = [];
  for (const c of campos) {
    if (c.extensoDe || c.copiaDe) continue;
    // só texto ou número: um objeto no lugar do valor não vira "[object Object]" no contrato
    const dada = dadas[c.variavel];
    const valor = normalizarValor(c.tipo, typeof dada === "string" || typeof dada === "number" ? String(dada) : "").slice(0, TETO_DO_VALOR);
    valores.set(c.variavel, valor);
    const acusar = (frase: string) => {
      erros.push(frase);
      comErro.add(c.variavel);
    };
    if (!valor) {
      if (c.obrigatorio) {
        faltando.push(c.rotulo);
        comErro.add(c.variavel);
      }
      continue;
    }
    if (c.tipo === "texto") continue;
    const n = numeroDe(valor);
    if (n === null || (c.tipo === "inteiro" && !Number.isInteger(n))) {
      acusar(`${c.rotulo}: use só o número (ex.: ${c.tipo === "percentual" ? "30" : "5"}).`);
      continue;
    }
    const sufixo = c.tipo === "percentual" ? "%" : "";
    if (c.minimo !== null && n < c.minimo) acusar(`${c.rotulo}: o mínimo deste modelo é ${numeroBr(c.minimo)}${sufixo}.`);
    if (c.maximo !== null && n > c.maximo) acusar(`${c.rotulo}: o máximo deste modelo é ${numeroBr(c.maximo)}${sufixo}.`);
  }
  // o campo que repete outro leva o valor dele (a falta já foi cobrada no primeiro)
  for (const c of campos) if (c.copiaDe) valores.set(c.variavel, valores.get(c.copiaDe) ?? "");
  for (const c of campos) {
    if (!c.extensoDe) continue;
    const base = valores.get(c.extensoDe) ?? "";
    const extenso = extensoDoValor(base);
    valores.set(c.variavel, extenso);
    // base vazia ou fora da faixa já foi acusada; aqui, só o valor que o sistema não sabe escrever
    if (base && !extenso && !comErro.has(c.extensoDe)) {
      const rotulo = campos.find((x) => x.variavel === c.extensoDe)?.rotulo ?? c.rotulo;
      erros.push(`${rotulo}: use só o número, para o sistema escrever por extenso.`);
    }
  }
  if (faltando.length) erros.unshift(`Preencha: ${faltando.join(", ")}.`);
  return { respostas: campos.map((c) => ({ variavel: c.variavel, valor: valores.get(c.variavel) ?? "" })), erros };
}

// ---------------------------------------------------------------------------
// Prévia: o texto do DOCX do modelo, com os campos preenchidos
// ---------------------------------------------------------------------------
export interface TrechoDoContrato {
  t: string;
  /** negrito */
  n: boolean;
  /** "preenchido" = valor que entrou num campo; "vazio" = campo que vai em branco */
  marca?: "preenchido" | "vazio";
}
export interface ParagrafoDoContrato {
  centro: boolean;
  trechos: TrechoDoContrato[];
}

/** Teto do `word/document.xml` aberto (um contrato tem dezenas de KB; isto barra arquivo armado). */
const XML_MAX_BYTES = 8 * 1024 * 1024;

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Quem descompacta um arquivo do ZIP ("deflate" sem cabeçalho). O teste troca pelo zlib do Node. */
export type Inflar = (dados: Uint8Array) => Promise<Uint8Array> | Uint8Array;

/** O do Deno e do navegador. O tamanho declarado no ZIP pode mentir: o teto vale sobre o que sai. */
async function inflarNativo(dados: Uint8Array): Promise<Uint8Array> {
  const leitor = new Blob([dados as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const pedacos: Uint8Array[] = [];
  let lidos = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lidos += value.length;
    if (lidos > XML_MAX_BYTES) {
      await leitor.cancel();
      throw new Error("o texto do modelo é grande demais para a prévia");
    }
    pedacos.push(value);
  }
  const saida = new Uint8Array(lidos);
  let o = 0;
  for (const pedaco of pedacos) {
    saida.set(pedaco, o);
    o += pedaco.length;
  }
  return saida;
}

/** Um arquivo de dentro do ZIP (o DOCX é um ZIP), ou null se não existe. */
async function arquivoDoZip(zip: Uint8Array, nome: string, inflar: Inflar): Promise<Uint8Array | null> {
  let fim = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 66_000); i--) {
    if (u32(zip, i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("o arquivo do modelo não é um DOCX válido");
  let p = u32(zip, fim + 16);
  const total = u16(zip, fim + 10);
  const decodificar = new TextDecoder();
  for (let n = 0; n < total && p + 46 <= zip.length; n++) {
    if (u32(zip, p) !== 0x02014b50) break;
    const metodo = u16(zip, p + 10);
    const comprimido = u32(zip, p + 20);
    const tamanho = u32(zip, p + 24);
    const nomeLen = u16(zip, p + 28);
    const local = u32(zip, p + 42);
    const esteNome = decodificar.decode(zip.subarray(p + 46, p + 46 + nomeLen));
    p += 46 + nomeLen + u16(zip, p + 30) + u16(zip, p + 32);
    if (esteNome !== nome) continue;
    if (tamanho > XML_MAX_BYTES) throw new Error("o texto do modelo é grande demais para a prévia");
    if (u32(zip, local) !== 0x04034b50) throw new Error("o arquivo do modelo não é um DOCX válido");
    const inicio = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    const dados = zip.subarray(inicio, inicio + comprimido);
    if (metodo === 0) {
      if (dados.length > XML_MAX_BYTES) throw new Error("o texto do modelo é grande demais para a prévia");
      return dados;
    }
    if (metodo !== 8) throw new Error("o arquivo do modelo usa uma compactação que a prévia não lê");
    const saida = await inflar(dados);
    if (saida.length > XML_MAX_BYTES) throw new Error("o texto do modelo é grande demais para a prévia");
    return saida;
  }
  return null;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const semEntidades = (t: string): string =>
  t.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (tudo, e: string) => {
    if (e[0] !== "#") return ENTIDADES[e] ?? tudo;
    const codigo = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : tudo;
  });

/** Os parágrafos do DOCX, com negrito e alinhamento ao centro — o bastante para ler o contrato. */
export async function paragrafosDoDocx(docx: Uint8Array, inflar: Inflar = inflarNativo): Promise<ParagrafoDoContrato[]> {
  const xmlBytes = await arquivoDoZip(docx, "word/document.xml", inflar);
  if (!xmlBytes) throw new Error("o arquivo do modelo não é um DOCX válido");
  const xml = new TextDecoder().decode(xmlBytes);
  const paragrafos: ParagrafoDoContrato[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const trechos: TrechoDoContrato[] = [];
    for (const r of p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []) {
      const b = /<w:b(?:\s+w:val="([^"]*)")?\s*\/>/.exec(r);
      const n = !!b && b[1] !== "0" && b[1] !== "false";
      let t = "";
      for (const m of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
        t += m[1] !== undefined ? semEntidades(m[1]) : m[0].startsWith("<w:tab") ? "\t" : "\n";
      }
      if (!t) continue;
      const anterior = trechos[trechos.length - 1];
      if (anterior && anterior.n === n) anterior.t += t;
      else trechos.push({ t, n });
    }
    if (trechos.some((x) => x.t.trim())) paragrafos.push({ centro: /<w:jc w:val="center"\s*\/>/.test(p), trechos });
  }
  return paragrafos;
}

/**
 * O contrato com os campos preenchidos. A troca é feita sobre o texto inteiro
 * do parágrafo: campo que o Word partiu em pedaços (por formatação) também é
 * achado. Campo sem valor fica marcado "vazio" — o ZapSign o deixa em branco.
 */
export function previaDoContrato(
  paragrafos: ReadonlyArray<ParagrafoDoContrato>,
  respostas: ReadonlyArray<{ variavel: string; valor: string }>,
): ParagrafoDoContrato[] {
  const valores = new Map(respostas.map((r) => [nomeDaVariavel(r.variavel).toUpperCase(), r.valor]));
  return paragrafos.map((p) => {
    const texto = p.trechos.map((x) => x.t).join("");
    const saida: TrechoDoContrato[] = [];
    const por = (t: string, n: boolean, marca?: "preenchido" | "vazio") => {
      if (!t) return;
      const anterior = saida[saida.length - 1];
      if (anterior && anterior.n === n && anterior.marca === marca) anterior.t += t;
      else saida.push(marca ? { t, n, marca } : { t, n });
    };
    // Anda pelos pedaços do parágrafo UMA vez, junto com o texto: `pedaco` é o
    // pedaço (com seu negrito) onde a posição `fimDoPedaco` ainda não chegou.
    let pedaco = 0;
    let fimDoPedaco = p.trechos[0]?.t.length ?? 0;
    const irAte = (pos: number) => {
      while (pedaco < p.trechos.length - 1 && pos >= fimDoPedaco) fimDoPedaco += p.trechos[++pedaco].t.length;
    };
    /** O texto fixo de `de` até `ate`, cada parte com o negrito do pedaço de onde veio. */
    const porFixo = (de: number, ate: number) => {
      let pos = de;
      while (pos < ate) {
        irAte(pos);
        const fim = Math.min(ate, fimDoPedaco);
        por(texto.slice(pos, fim), p.trechos[pedaco].n);
        pos = fim;
      }
    };
    let cursor = 0;
    for (const m of texto.matchAll(/\{\{([^{}]{1,120})\}\}/g)) {
      const inicio = m.index ?? 0;
      porFixo(cursor, inicio);
      irAte(inicio);
      const valor = valores.get(m[1].trim().toUpperCase()) ?? "";
      // o campo leva o negrito de onde ele COMEÇA no modelo
      por(valor || "(em branco)", p.trechos[pedaco].n, valor ? "preenchido" : "vazio");
      cursor = inicio + m[0].length;
    }
    porFixo(cursor, texto.length);
    return { centro: p.centro, trechos: saida };
  });
}

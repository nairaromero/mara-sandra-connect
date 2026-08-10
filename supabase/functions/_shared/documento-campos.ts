// Validacao e normalizacao dos campos lidos de documentos (RG/CNH/comprovante).
//
// Fica separado da edge function de proposito: e a barreira que impede um erro
// de leitura da IA de virar dado errado no cadastro, entao precisa ser testavel
// sem subir a funcao. Sem imports — roda em Deno e em Node/Bun igual.

/**
 * CPF valido pelos dois digitos verificadores.
 * Pega quase todo erro de OCR (trocar 3 por 8, perder um digito), que e
 * justamente o erro mais caro aqui: CPF errado cria cliente duplicado e
 * quebra a busca no INSS.
 */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  // 111.111.111-11 e afins passam na conta dos digitos mas nao existem.
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  for (const [ate, pos] of [[9, 10], [10, 11]] as const) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (pos - i);
    const resto = ((soma * 10) % 11) % 10;
    if (resto !== Number(cpf[ate])) return false;
  }
  return true;
}

/**
 * Aceita AAAA-MM-DD ou DD/MM/AAAA e devolve sempre AAAA-MM-DD.
 * Rejeita data que nao existe no calendario (31/02) e ano fora de faixa
 * plausivel pra uma pessoa viva — melhor campo vazio que data inventada.
 */
export function normalizarData(v: unknown, hoje = new Date()): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let ano: number, mes: number, dia: number;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso) [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) [ano, mes, dia] = [Number(br[3]), Number(br[2]), Number(br[1])];
  else return null;

  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }
  const anoAtual = hoje.getUTCFullYear();
  if (ano < anoAtual - 120 || ano > anoAtual) return null;

  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * O modelo as vezes embrulha o JSON em cerca de markdown apesar da instrucao.
 * Fatia do primeiro "{" ao ultimo "}", entao um objeto embrulhado num array
 * tambem e recuperado — leniencia proposital: melhor aproveitar a leitura do
 * que descartar tudo por causa do involucro.
 */
export function extrairJson(txt: string): Record<string, unknown> | null {
  const limpo = txt.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini === -1 || fim <= ini) return null;
  try {
    const obj = JSON.parse(limpo.slice(ini, fim + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj)
      ? obj as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** String util ou null. Trata "null"/"" /"N/A" que o modelo as vezes devolve. */
export function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const low = s.toLowerCase();
  if (low === "null" || low === "n/a" || low === "nao informado") return null;
  return s;
}

export interface CamposCliente {
  nome: string | null;
  cpf: string | null;
  data_nascimento: string | null;
  endereco: string | null;
}

export interface ResultadoCampos {
  campos: CamposCliente;
  avisos: string[];
}

/**
 * Converte a resposta crua do modelo nos campos do cadastro, descartando o que
 * nao passa nas validacoes e explicando por que. Nunca lanca.
 */
export function montarCampos(obj: Record<string, unknown>): ResultadoCampos {
  const avisos: string[] = [];

  let cpf: string | null = null;
  const cpfBruto = texto(obj.cpf);
  if (cpfBruto) {
    const digitos = cpfBruto.replace(/\D/g, "");
    if (cpfValido(digitos)) {
      cpf = digitos;
    } else {
      avisos.push("O CPF lido no documento não passou na validação — preencha à mão.");
    }
  }

  const dataNascimento = normalizarData(obj.data_nascimento);
  if (texto(obj.data_nascimento) && !dataNascimento) {
    avisos.push("A data de nascimento lida não é uma data válida — confira no documento.");
  }

  const observacoes = texto(obj.observacoes);
  if (observacoes) avisos.push(observacoes);

  const campos: CamposCliente = {
    nome: texto(obj.nome),
    cpf,
    data_nascimento: dataNascimento,
    endereco: texto(obj.endereco),
  };

  if (!campos.nome && !campos.cpf && !campos.data_nascimento && !campos.endereco) {
    avisos.push("Não foi possível ler nenhum campo. A foto pode estar cortada ou fora de foco.");
  }

  return { campos, avisos };
}

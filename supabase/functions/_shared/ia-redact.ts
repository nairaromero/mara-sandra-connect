// Redacao de dado sensivel (gaps #1 e #12).
//
//   - maskCpf: 11 digitos -> ***.***.<3 do meio>-** (nunca expoe CPF inteiro pro
//     LLM nem na auditoria).
//   - sanitizeBusca: remove caracteres que poderiam virar operadores no filtro
//     PostgREST (gap #5). So letras/numeros/espaco/acentos/.-@.
//   - redactArgs: limpa objetos antes de gravar em ia_acoes.argumentos — remove
//     chaves de segredo e mascara campos que parecam CPF.

export function maskCpf(cpf: unknown): string | null {
  if (cpf == null) return null;
  const d = String(cpf).replace(/\D/g, "");
  if (d.length !== 11) return null;
  return "***.***." + d.slice(6, 9) + "-**";
}

// Telefone: mostra so os 4 ultimos digitos (ex.: "(**) *****-4444").
export function maskTelefone(v: unknown): string | null {
  if (v == null) return null;
  const d = String(v).replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 4) return "****";
  return "(**) *****-" + d.slice(-4);
}

// Email: mostra so o comeco do local e a 1a letra do dominio (ex.: "te***@e***.com").
export function maskEmail(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const at = s.indexOf("@");
  if (at < 1) return "***";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot + 1) : "";
  const dname = dot > 0 ? domain.slice(0, dot) : domain;
  const maskLocal = local.slice(0, 2) + "***";
  const maskDomain = (dname ? dname.slice(0, 1) : "") + "***" + (tld ? "." + tld : "");
  return maskLocal + "@" + maskDomain;
}

export function sanitizeBusca(input: unknown): string {
  return String(input ?? "")
    .replace(/[^\p{L}\p{N}\s.\-@]/gu, " ")
    .trim()
    .slice(0, 80);
}

const SECRET_KEYS = /(senha|password|api[_-]?key|token|secret|authorization)/i;
const CPF_KEYS = /cpf/i;

export function redactArgs(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactArgs);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) {
        out[k] = "[redigido]";
      } else if (CPF_KEYS.test(k)) {
        out[k] = maskCpf(v) ?? "[redigido]";
      } else {
        out[k] = redactArgs(v);
      }
    }
    return out;
  }
  return value;
}

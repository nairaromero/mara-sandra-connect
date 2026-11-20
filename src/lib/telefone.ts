// Exibição de telefone no padrão brasileiro: (DD) 9XXXX-XXXX / (DD) XXXX-XXXX.
//
// O banco guarda o número como veio (em geral só dígitos, ex.: "17997227424");
// nas telas isso aparecia cru. `formatarTelefone` é só de EXIBIÇÃO — não altera
// o que está salvo. A máscara de DIGITAÇÃO dos formulários é `mascararTelefoneBR`
// (uma só: antes cada tela tinha a sua `maskTelefone`), e o telefone com país
// (`<TelefoneComPais>`) usa `PAISES_TELEFONE`, `separarTelefone` e
// `telefoneParaEnvio`. Número de fora do Brasil é guardado como "+34 613761609".
//
// Aceita DDI 55 na frente (13 dígitos) e descarta. Qualquer outra coisa que
// não seja 10 ou 11 dígitos volta como está (não inventa formato pra número
// estrangeiro, ramal, etc.).
export function formatarTelefone(v: string | null | undefined): string {
  if (!v) return "";
  let d = v.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

/**
 * Máscara de digitação do telefone brasileiro: conforme a pessoa digita vira
 * "(17) 9", "(17) 9999-9999" (fixo) e "(17) 99999-9999" (celular). Só dígitos
 * contam; o que passar de 11 é descartado.
 */
export function mascararTelefoneBR(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Um país no seletor do telefone: código de discagem (só dígitos), nome e bandeira. */
export interface PaisTelefone {
  ddi: string;
  nome: string;
  bandeira: string;
}
/** O código do Brasil: é o padrão do seletor e o único com máscara de DDD. */
export const DDI_BRASIL = "55";
/** Brasil primeiro (padrão); depois os vizinhos e os países onde há mais clientes fora, em ordem alfabética. */
export const PAISES_TELEFONE: ReadonlyArray<PaisTelefone> = [
  { ddi: "55", nome: "Brasil", bandeira: "🇧🇷" },
  { ddi: "49", nome: "Alemanha", bandeira: "🇩🇪" },
  { ddi: "244", nome: "Angola", bandeira: "🇦🇴" },
  { ddi: "54", nome: "Argentina", bandeira: "🇦🇷" },
  { ddi: "61", nome: "Austrália", bandeira: "🇦🇺" },
  { ddi: "32", nome: "Bélgica", bandeira: "🇧🇪" },
  { ddi: "591", nome: "Bolívia", bandeira: "🇧🇴" },
  { ddi: "238", nome: "Cabo Verde", bandeira: "🇨🇻" },
  { ddi: "56", nome: "Chile", bandeira: "🇨🇱" },
  { ddi: "86", nome: "China", bandeira: "🇨🇳" },
  { ddi: "57", nome: "Colômbia", bandeira: "🇨🇴" },
  { ddi: "34", nome: "Espanha", bandeira: "🇪🇸" },
  { ddi: "1", nome: "Estados Unidos e Canadá", bandeira: "🇺🇸" },
  { ddi: "33", nome: "França", bandeira: "🇫🇷" },
  { ddi: "31", nome: "Holanda", bandeira: "🇳🇱" },
  { ddi: "353", nome: "Irlanda", bandeira: "🇮🇪" },
  { ddi: "39", nome: "Itália", bandeira: "🇮🇹" },
  { ddi: "81", nome: "Japão", bandeira: "🇯🇵" },
  { ddi: "52", nome: "México", bandeira: "🇲🇽" },
  { ddi: "258", nome: "Moçambique", bandeira: "🇲🇿" },
  { ddi: "595", nome: "Paraguai", bandeira: "🇵🇾" },
  { ddi: "51", nome: "Peru", bandeira: "🇵🇪" },
  { ddi: "351", nome: "Portugal", bandeira: "🇵🇹" },
  { ddi: "44", nome: "Reino Unido", bandeira: "🇬🇧" },
  { ddi: "41", nome: "Suíça", bandeira: "🇨🇭" },
  { ddi: "598", nome: "Uruguai", bandeira: "🇺🇾" },
  { ddi: "58", nome: "Venezuela", bandeira: "🇻🇪" },
];

/** O que a pessoa vê no campo, pelo país: máscara com DDD no Brasil, só dígitos nos outros. */
export function mascararTelefoneDoPais(ddi: string, v: string): string {
  return ddi === DDI_BRASIL ? mascararTelefoneBR(v) : v.replace(/\D/g, "").slice(0, 14);
}

/**
 * O telefone como o servidor entende: no Brasil, o número com DDD; fora, o
 * código do país com "+", um espaço e o número ("+34 613761609"). Campo vazio
 * (só o país escolhido) é "" — não é um telefone.
 */
export function telefoneParaEnvio(ddi: string, numero: string): string {
  const d = numero.replace(/\D/g, "");
  if (!d) return "";
  return ddi === DDI_BRASIL ? mascararTelefoneBR(d) : `+${ddi} ${d}`;
}

/**
 * Do valor guardado (ou do que o campo emitiu) para país + número como aparece
 * no campo. "+34 613761609" → Espanha; qualquer outra coisa é Brasil (com ou
 * sem o 55 na frente), já com a máscara.
 */
export function separarTelefone(valor: string | null | undefined): { ddi: string; numero: string } {
  const texto = String(valor ?? "").trim();
  const fora = texto.match(/^\+(\d{1,3})(?:[\s.-]+(.*))?$/);
  if (fora && fora[1] !== DDI_BRASIL) return { ddi: fora[1], numero: mascararTelefoneDoPais(fora[1], fora[2] ?? "") };
  let d = texto.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith(DDI_BRASIL)) d = d.slice(2);
  return { ddi: DDI_BRASIL, numero: mascararTelefoneBR(d) };
}

/** O telefone está completo? Brasil: DDD + 8 ou 9 dígitos. Fora: de 6 a 14 dígitos depois do código do país. */
export function telefoneCompleto(valor: string | null | undefined): boolean {
  const { ddi, numero } = separarTelefone(valor);
  const d = numero.replace(/\D/g, "");
  return ddi === DDI_BRASIL ? d.length === 10 || d.length === 11 : d.length >= 6 && d.length <= 14;
}

/**
 * Só os dígitos, COM o código do país — o que um link `wa.me` precisa.
 * "(17) 99999-0000" → "5517999990000"; "+34 613761609" → "34613761609". "" se não há número.
 */
export function digitosInternacionais(valor: string | null | undefined): string {
  const { ddi, numero } = separarTelefone(valor);
  const d = numero.replace(/\D/g, "");
  return d ? `${ddi}${d}` : "";
}

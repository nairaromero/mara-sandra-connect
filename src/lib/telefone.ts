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
import { DDI_BRASIL, lerTelefone, PAISES_TELEFONE, telefoneDe } from "@shared/telefone";

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

export { DDI_BRASIL, PAISES_TELEFONE };

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
 * Do valor guardado (ou do que o campo emitiu, ou do que a pessoa colou) para
 * país + número como aparece no campo, já com a máscara. Quem lê é
 * `lerTelefone` (`@shared/telefone`), a mesma leitura do servidor. Código de
 * país desconhecido colado ao número ("+999123…") não tem leitura: aparece
 * como veio, no Brasil, e `telefoneCompleto` diz que não serve.
 */
export function separarTelefone(valor: string | null | undefined): { ddi: string; numero: string } {
  const lido = lerTelefone(valor) ?? { ddi: DDI_BRASIL, numero: String(valor ?? "") };
  return { ddi: lido.ddi, numero: mascararTelefoneDoPais(lido.ddi, lido.numero) };
}

/**
 * O telefone está completo? É a pergunta do servidor (`telefoneDe`): o que a
 * tela aceita é exatamente o que dá para mandar ao ZapSign.
 */
export function telefoneCompleto(valor: string | null | undefined): boolean {
  return telefoneDe(valor) !== null;
}

/**
 * Só os dígitos, COM o código do país — o que um link `wa.me` precisa.
 * "(17) 99999-0000" → "5517999990000"; "+34 613761609" → "34613761609". "" se não há número.
 */
export function digitosInternacionais(valor: string | null | undefined): string {
  const lido = lerTelefone(valor);
  // sem leitura = "+código desconhecido" colado: os dígitos já são o número internacional
  if (!lido) return String(valor ?? "").replace(/\D/g, "");
  return lido.numero ? `${lido.ddi}${lido.numero}` : "";
}

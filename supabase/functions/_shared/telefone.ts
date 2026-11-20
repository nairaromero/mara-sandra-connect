// Telefone como o servidor entende (#517): do que a pessoa digitou (ou do que
// está no cadastro) para código do país + número, que é o que o ZapSign pede.
//
// Módulo PURO: a régua e2e/unit/telefone.test.ts importa daqui para conferir
// que tudo o que o campo de telefone da tela (`telefoneParaEnvio`, em
// src/lib/telefone.ts) produz é aceito por esta função.

/**
 * "(17) 99999-9999" ou "+55 17 99999-9999" → { ddi: "55", numero: "17999999999" }.
 * Número de fora do Brasil precisa vir como "+<código do país> <número>" (com
 * espaço): "+34 613761609" → { ddi: "34", numero: "613761609" }. Sem o "+", é
 * sempre Brasil. `null` = não dá para mandar WhatsApp para isso.
 */
export function telefoneDe(bruto: unknown): { ddi: string; numero: string } | null {
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

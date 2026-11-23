// Telefone como o sistema inteiro entende (#517): do que a pessoa digitou (ou do
// que está no cadastro) para código do país + número, que é o que o ZapSign
// pede (`phone_country` + `phone_number`: DDD e número, só dígitos).
//
// Módulo PURO, e a ÚNICA leitura de telefone: a tela importa daqui por
// `@shared/telefone` (src/lib/telefone.ts põe a máscara por cima) e as
// functions usam direto. Tela e servidor não têm como discordar sobre o que é
// um telefone válido — até 20/11/2026 cada lado tinha a sua leitura e
// "+34613761609" era completo na tela e recusado no servidor.

/** O código do Brasil: é o padrão do seletor e o único com máscara de DDD. */
export const DDI_BRASIL = "55";
/** Brasil primeiro (padrão); depois os vizinhos e os países onde há mais clientes fora, em ordem alfabética. */
export const PAISES_TELEFONE: ReadonlyArray<{ ddi: string; nome: string; bandeira: string }> = [
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

const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/**
 * O código de país que abre uma sequência de dígitos, entre os da lista. Código
 * de país nunca é começo de outro, então no máximo um casa.
 */
function ddiColado(digitos: string): string | null {
  return PAISES_TELEFONE.find((p) => p.ddi !== DDI_BRASIL && digitos.startsWith(p.ddi))?.ddi ?? null;
}

/**
 * Do texto para país + dígitos do número, SEM julgar se está completo (quem
 * julga é `telefoneDe`). Formatos que existem no banco e que as pessoas colam:
 *   "(17) 99999-9999", "17999999999", "5517999999999", "+55 17 99999-9999" → Brasil
 *   "+34 613761609" → Espanha (é como o sistema guarda número de fora)
 *   "+34613761609"  → Espanha: sem espaço, mas o código é de um país da lista
 *   "351912345678"  → Portugal: sem "+", longo demais para o Brasil e abre com
 *                     um código da lista (lead antigo do formulário do site)
 * `null` = começa com "+" e o código colado não é de país conhecido: não dá
 * para saber onde ele termina, e chutar mandaria o WhatsApp para outro número.
 */
export function lerTelefone(bruto: unknown): { ddi: string; numero: string } | null {
  const texto = String(bruto ?? "").trim();
  const fora = texto.match(/^\+(\d{1,3})(?:[\s.-]+(.*))?$/);
  if (fora && fora[1] !== DDI_BRASIL) return { ddi: fora[1], numero: soDigitos(fora[2]) };
  let d = soDigitos(texto);
  const comMais = texto.startsWith("+");
  if ((comMais || d.length > 11) && !d.startsWith(DDI_BRASIL)) {
    const ddi = ddiColado(d);
    // sem o "+", código de 1 dígito não vale: "1" abriria qualquer número de DDD 11 a 19 digitado a mais
    if (ddi && (comMais || ddi.length > 1)) return { ddi, numero: d.slice(ddi.length) };
    if (comMais) return null;
  }
  if (d.length > 11 && d.startsWith(DDI_BRASIL)) d = d.slice(2);
  return { ddi: DDI_BRASIL, numero: d };
}

/**
 * O telefone pronto para o ZapSign: `{ ddi: "55", numero: "17999999999" }`.
 * Brasil: DDD + 8 ou 9 dígitos. Fora: de 6 a 14 dígitos depois do código do
 * país. `null` = não dá para mandar WhatsApp para isso.
 */
export function telefoneDe(bruto: unknown): { ddi: string; numero: string } | null {
  const lido = lerTelefone(bruto);
  if (!lido) return null;
  const n = lido.numero.length;
  const completo = lido.ddi === DDI_BRASIL ? n === 10 || n === 11 : n >= 6 && n <= 14;
  return completo ? lido : null;
}

/**
 * O caminho de volta: do par que o ZapSign devolve (`phone_country`,
 * `phone_number`) para o texto que o sistema guarda e que `lerTelefone` lê —
 * no Brasil só os dígitos com DDD, fora "+<código do país> <número>". "" se
 * não há número.
 */
export function telefoneGuardado(ddi: unknown, numero: unknown): string {
  const n = soDigitos(numero);
  if (!n) return "";
  const pais = soDigitos(ddi);
  return pais && pais !== DDI_BRASIL ? `+${pais} ${n}` : n;
}

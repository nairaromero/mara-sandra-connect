import { TZ_BR } from "./fuso";

// Datas de calendário de Brasília para as specs (o banco conta prazos no dia
// de Brasília, não no do runner).

/** Dia de Brasília, `n` dias a partir de hoje ("YYYY-MM-DD"). */
export function diaBR(n: number): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: TZ_BR });
  const [y, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Sábado/domingo recuam para a sexta (mesma regra do banco). */
export function recua(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const menos = dow === 6 ? 1 : dow === 0 ? 2 : 0;
  return new Date(Date.UTC(y, m - 1, d - menos)).toISOString().slice(0, 10);
}

/**
 * Prazo não cai em fim de semana (mesma regra do banco, para prazo de dia
 * inteiro): sábado/domingo recuam para a sexta; se a sexta já passou, segunda.
 */
export function foraDoFds(dia: string): string {
  const sexta = recua(dia);
  if (sexta === dia || sexta >= diaBR(0)) return sexta;
  const [y, m, d] = sexta.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
}

/**
 * N-ésimo dia de um prazo contado do PRÓXIMO DIA ÚTIL depois do evento (regra
 * do escritório; mesma conta de private.base_da_contagem): evento na sexta ou
 * no sábado, o dia 1 é a segunda.
 */
export function prazoDe(evento: string, n: number): string {
  const [y, m, d] = evento.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const folga = dow === 5 ? 2 : dow === 6 ? 1 : 0;
  return new Date(Date.UTC(y, m - 1, d + folga + n)).toISOString().slice(0, 10);
}

/** Primeiro dia útil a partir de `min` dias à frente: { dias, iso do meio-dia de Brasília }. */
export function diaUtilAFrente(min: number): { dias: number; iso: string } {
  let dias = min;
  for (;;) {
    const dia = diaBR(dias);
    if (recua(dia) === dia) return { dias, iso: `${dia}T12:00:00-03:00` };
    dias++;
  }
}

/** Dia de Brasília de um instante ISO. */
export function diaDoInstanteBR(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_BR });
}

/** "YYYY-MM-DD" → "dd/mm/aaaa". */
export function dataBR(dia: string): string {
  return dia.split("-").reverse().join("/");
}

/** Dias entre dois dias de calendário (b − a). */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Soma `n` dias a um dia de calendário "YYYY-MM-DD". */
export function somarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

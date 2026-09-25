// Datas de calendário de Brasília para as specs (o banco conta prazos no dia
// de Brasília, não no do runner).

/** Dia de Brasília, `n` dias a partir de hoje ("YYYY-MM-DD"). */
export function diaBR(n: number): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
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

/** Dia de Brasília de um instante ISO. */
export function diaDoInstanteBR(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
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

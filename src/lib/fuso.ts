// Fuso horário canônico do sistema.
//
// O escritório é operado da Espanha, mas TODO o conteúdo (perícias, prazos,
// audiências) é do Brasil. Sem isto, `new Date(iso).getHours()` devolve a hora
// do navegador: quem agenda em Madri às 14h grava 12:00Z, e o parceiro em SP
// lê 09:00 — foi exatamente o bug relatado. O backend já renderiza tudo em
// America/Sao_Paulo (pericia_draft_texto, ia-triagem-andamentos), então o
// frontend é quem estava fora do padrão.
//
// Regra: nenhum componente chama getHours/getDate/toLocale* direto num
// timestamp do banco. Passa por aqui.

export const TZ_BR = "America/Sao_Paulo";

const pad = (n: number) => String(n).padStart(2, "0");

interface PartesData {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  min: number;
  seg: number;
}

// hourCycle h23 evita o "24:00" que alguns runtimes devolvem com hour12:false.
const FMT_PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_BR,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Quebra um instante nos campos de calendário como vistos em Brasília. */
export function partesBR(d: Date): PartesData {
  const p = FMT_PARTES.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(p.find((x) => x.type === t)?.value ?? "0");
  return {
    ano: get("year"),
    mes: get("month"),
    dia: get("day"),
    hora: get("hour"),
    min: get("minute"),
    seg: get("second"),
  };
}

/** Offset de Brasília em ms naquele instante (hoje sempre -3h; o cálculo
 *  cobre datas históricas de horário de verão, extinto em 2019). */
function offsetBRms(d: Date): number {
  const p = partesBR(d);
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg) - d.getTime();
}

/** Instante UTC correspondente a uma hora de PAREDE de Brasília. */
export function instanteBR(
  ano: number,
  mes: number,
  dia: number,
  hora = 0,
  min = 0,
  seg = 0,
): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, min, seg);
  // Duas passadas: a primeira usa o offset do palpite, a segunda o do
  // instante já corrigido (só muda perto de uma virada de DST).
  let ts = palpite - offsetBRms(new Date(palpite));
  ts = palpite - offsetBRms(new Date(ts));
  return new Date(ts);
}

// --- Formatação -------------------------------------------------------------

const cacheFmt = new Map<string, Intl.DateTimeFormat>();

/** Intl.DateTimeFormat pt-BR já fixado em America/Sao_Paulo. */
export function formatarBR(iso: string | Date, opts: Intl.DateTimeFormatOptions): string {
  const chave = JSON.stringify(opts);
  let f = cacheFmt.get(chave);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ_BR, ...opts });
    cacheFmt.set(chave, f);
  }
  return f.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "HH:mm" em Brasília. */
export function horaBR(iso: string | Date): string {
  const p = partesBR(typeof iso === "string" ? new Date(iso) : iso);
  return `${pad(p.hora)}:${pad(p.min)}`;
}

/** Chave de dia "YYYY-MM-DD" em Brasília (agrupamento de calendário). */
export function chaveDiaBR(iso: string | Date): string {
  const p = partesBR(typeof iso === "string" ? new Date(iso) : iso);
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
}

/** O "hoje" do escritório é o dia no Brasil, não o do navegador. */
export function hojeChaveBR(): string {
  return chaveDiaBR(new Date());
}

// Teto de segurança: uma data absurda no banco não pode travar a renderização.
const MAX_DIAS_EVENTO = 400;

/**
 * Todas as chaves de dia (Brasília) que um evento OCUPA, do início ao fim.
 *
 * O calendário indexava o evento só pelo dia de `start_at`, então uma ausência
 * de 14 a 17 aparecia apenas no dia 14. Evento de um dia só devolve uma chave,
 * então o caso comum não muda.
 *
 * Terminar exatamente à meia-noite NÃO pinta o dia seguinte (00:00 do dia 18
 * pertence ao dia 17) — convenção de calendário.
 */
export function chavesDiasBR(inicio: string | Date, fim?: string | Date | null): Array<string> {
  const kInicio = chaveDiaBR(inicio);
  if (!fim) return [kInicio];

  const dFim = typeof fim === "string" ? new Date(fim) : fim;
  if (isNaN(dFim.getTime())) return [kInicio];

  const emDias = (chave: string) => {
    const [a, m, d] = chave.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  const deDias = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  const pFim = partesBR(dFim);
  let kFim = `${pFim.ano}-${pad(pFim.mes)}-${pad(pFim.dia)}`;
  // Fim em 00:00 fecha no dia anterior.
  if (kFim > kInicio && pFim.hora === 0 && pFim.min === 0 && pFim.seg === 0) {
    kFim = deDias(emDias(kFim) - 86_400_000);
  }
  if (kFim <= kInicio) return [kInicio];

  const out: Array<string> = [];
  const ultimo = emDias(kFim);
  for (let t = emDias(kInicio); t <= ultimo && out.length < MAX_DIAS_EVENTO; t += 86_400_000) {
    out.push(deDias(t));
  }
  return out;
}

/**
 * Date "espelho" cujos getters LOCAIS devolvem a hora de parede de Brasília.
 * Existe só pra alimentar date-fns (format/isSameDay/eachDayOfInterval) e
 * aritmética de calendário — NUNCA persistir o resultado.
 */
export function comoLocalBR(iso: string | Date): Date {
  const p = partesBR(typeof iso === "string" ? new Date(iso) : iso);
  return new Date(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg);
}

/** Inverso de comoLocalBR: campos locais do Date lidos como hora de Brasília. */
export function deLocalBR(d: Date): Date {
  return instanteBR(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
}

// --- <input type="datetime-local" / "date"> ---------------------------------
// O input não tem fuso: o valor digitado é sempre lido/escrito como hora de
// Brasília, independente de onde a pessoa está.

export function isoParaInputDateTimeBR(iso: string | null): string {
  if (!iso) return "";
  const p = partesBR(new Date(iso));
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}T${pad(p.hora)}:${pad(p.min)}`;
}

export function inputDateTimeBRParaIso(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return instanteBR(+m[1], +m[2], +m[3], +m[4], +m[5]).toISOString();
}

export function isoParaInputDateBR(iso: string | null): string {
  if (!iso) return "";
  return chaveDiaBR(new Date(iso));
}

/** "YYYY-MM-DD" → meia-noite de Brasília daquele dia. */
export function inputDateBRParaIso(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return instanteBR(+m[1], +m[2], +m[3]).toISOString();
}

// --- Aritmética de dias -----------------------------------------------------

/** Dias de calendário (Brasília) entre hoje e a data. 0 = hoje, <0 = atrasado. */
export function diasCorridosBR(iso: string): number {
  const parse = (chave: string) => {
    const [a, m, d] = chave.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((parse(chaveDiaBR(iso)) - parse(hojeChaveBR())) / 86_400_000);
}

/** Fim do dia (23:59:59.999 de Brasília) do dia em que o instante cai. */
export function fimDoDiaBR(iso: string | Date): Date {
  const p = partesBR(typeof iso === "string" ? new Date(iso) : iso);
  return new Date(instanteBR(p.ano, p.mes, p.dia, 23, 59, 59).getTime() + 999);
}

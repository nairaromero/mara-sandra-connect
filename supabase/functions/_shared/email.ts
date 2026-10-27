// Envio de e-mail — UM lugar (card #249). Antes cada function montava o POST no
// Resend à mão (5 cópias: notify-novo-andamento, notify-novo-comentario,
// notify-solicitacao-doc, digest-diario, send-email-hook), cada uma com o seu
// tratamento de erro. Régua: e2e/unit/email-tunel.test.ts (ninguém mais chama
// o Resend direto).

import { fetchT } from "./auth.ts";

// RESEND_BASE_URL só existe no ambiente LOCAL (mock de e2e/demo/mocks); fora dele é o Resend.
const RESEND_BASE = (Deno.env.get("RESEND_BASE_URL") ?? "https://api.resend.com").replace(/\/+$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

/** A chave do Resend está configurada nesta function? */
export function emailConfigurado(): boolean {
  return !!RESEND_API_KEY;
}

export interface Email {
  /** Remetente pronto ("Nome <endereco>"), ver `remetente()` de _shared/marca.ts. */
  de: string;
  para: string | string[];
  assunto: string;
  html: string;
  texto?: string;
}

export type ResultadoEmail =
  | { ok: true; id: string | null }
  | { ok: false; status: number; detalhe: string };

/** Manda o e-mail. Nunca estoura: falha volta como `{ ok: false }` (com timeout). */
export async function enviarEmail(m: Email): Promise<ResultadoEmail> {
  if (!RESEND_API_KEY) return { ok: false, status: 500, detalhe: "RESEND_API_KEY ausente" };
  try {
    const resp = await fetchT(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: m.de, to: m.para, subject: m.assunto, html: m.html, ...(m.texto ? { text: m.texto } : {}) }),
    });
    if (!resp.ok) return { ok: false, status: resp.status, detalhe: (await resp.text()).slice(0, 500) };
    const corpo = (await resp.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: corpo.id ?? null };
  } catch (e) {
    return { ok: false, status: 0, detalhe: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

// A data que o parceiro lê na mensagem não pode depender da IA.
//
// Regra da casa (Naira, 2026-08-31): o parceiro recebe o "enviar até" —
// fatal − 3 dias, calculado no front por prazoParceiroDoFatal —, nunca o fatal
// real. É a mesma data do card, do e-mail e dos lembretes da solicitação.
//
// Em 2026-09-15 a IA do staging escreveu por conta própria uma data diferente
// da pedida no prompt. Por isso a IA não escreve data nenhuma: ela deixa o
// marcador [PRAZO] numa linha, e esta função troca o marcador pelo bloco do
// prazo com a data certa. Se mesmo assim a resposta trouxer data ou contagem
// de dias, a mensagem é descartada e o template segue com o texto padrão.

export const MARCADOR_PRAZO = "[PRAZO]";

const MESES =
  "janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";

// Tudo que parece data ou prazo em dias: 22/09, 22/09/2026, 22-09-2026,
// "22 de setembro", "15 dias", "3 dias úteis".
const PADROES_PRAZO = [
  /\b\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?\b/g,
  new RegExp(`\\b\\d{1,2}\\s+de\\s+(?:${MESES})\\b`, "gi"),
  /\b\d+\s+dias?\b/gi,
];

/** "aaaa-mm-dd" → "dd/mm/aaaa". */
export function dataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Bloco do prazo que entra no lugar do marcador. */
export function blocoPrazo(prazoParceiro: string | null): string {
  return prazoParceiro
    ? `⚠️ Prazo para enviar os documentos ao escritório: *${dataBR(prazoParceiro)}*. ` +
        "Depois de recebê-los, o escritório ainda precisa de tempo para fazer o protocolo no processo."
    : "⚠️ O prazo é curto: o escritório vai confirmar a data com você. Envie os documentos o quanto antes.";
}

/** Trechos da resposta da IA que parecem data ou prazo. */
export function prazosNoTexto(texto: string): string[] {
  const achados: string[] = [];
  for (const padrao of PADROES_PRAZO) {
    for (const m of texto.matchAll(padrao)) achados.push(m[0]);
  }
  return achados;
}

export type Montagem =
  | { ok: true; mensagem: string }
  | { ok: false; motivo: "prazo_na_resposta"; achados: string[] };

/**
 * Mensagem final: a resposta da IA com o bloco do prazo no lugar do marcador.
 * Sem marcador, o bloco entra antes do último parágrafo (o fechamento).
 */
export function montarMensagem(textoIa: string, prazoParceiro: string | null): Montagem {
  const texto = textoIa.replace(/\r\n/g, "\n").trim();
  const achados = prazosNoTexto(texto);
  if (achados.length) return { ok: false, motivo: "prazo_na_resposta", achados };

  const bloco = blocoPrazo(prazoParceiro);
  if (texto.includes(MARCADOR_PRAZO)) {
    let usado = false;
    const linhas = texto.split("\n").map((linha) => {
      if (!linha.includes(MARCADOR_PRAZO)) return linha;
      if (usado) return "";
      usado = true;
      return bloco;
    });
    return { ok: true, mensagem: linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
  }

  const paragrafos = texto.split(/\n\s*\n/);
  if (paragrafos.length >= 2) paragrafos.splice(paragrafos.length - 1, 0, bloco);
  else paragrafos.push(bloco);
  return { ok: true, mensagem: paragrafos.join("\n\n") };
}

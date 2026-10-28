// O "cliente" do e-mail do INSS é, na verdade, o procurador do escritório?
// UM lugar para essa regra (card #503).
//
// O e-mail do MEU INSS traz o nome de quem fez o requerimento. Quando é alguém
// da equipe (o procurador), o e-mail não é de um cliente e segue um fluxo à
// parte (`cliente_eh_procurador`). Até 28/10 a lista era fixa no código —
// "(procurador)", "mara sandra vian" e "naira" — com nomes de pessoas de um
// escritório só, e o "naira" solto pegaria qualquer cliente chamada Naira.
//
// Agora (decisão da Naira, 28/10):
//   · o marcador "(procurador)", que o próprio INSS escreve;
//   · o nome completo de quem é da equipe interna ativa DO escritório;
//   · os nomes "como o INSS escreve" que o escritório cadastrou
//     (escritorio_config.extras.inss_procuradores — Integrações → Gmail do
//     INSS), para quem aparece no INSS com um nome diferente do cadastro.
// Nome com menos de duas palavras não conta: primeiro nome sozinho casaria
// com cliente.
//
// Módulo PURO (sem import): testado em e2e/unit/inss-procurador.test.ts.

export const MARCADOR_PROCURADOR = "(procurador)";

/** Minúsculas, sem acento, espaços colapsados. */
export function normalizarNome(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Só nomes com pelo menos duas palavras (de 2+ letras) valem como procurador. */
export function nomeValeComoProcurador(nome: string): boolean {
  return normalizarNome(nome).split(" ").filter((p) => p.length >= 2).length >= 2;
}

/** A lista que vale para um escritório: equipe + cadastrados, já normalizada e sem repetição. */
export function nomesDeProcurador(equipe: string[], cadastrados: string[]): string[] {
  return [...new Set([...equipe, ...cadastrados].filter(nomeValeComoProcurador).map(normalizarNome))];
}

/** O nome do "cliente" no e-mail é o procurador? */
export function ehProcurador(nomeCliente: string, nomes: string[]): boolean {
  const n = normalizarNome(nomeCliente);
  if (!n) return false;
  if (n.includes(MARCADOR_PROCURADOR)) return true;
  return nomes.some((p) => p && n.includes(p));
}

/** Lê `extras.inss_procuradores` sem confiar: só textos, aparados, sem vazios. */
export function lerProcuradoresCadastrados(extras: unknown): string[] {
  const o = extras && typeof extras === "object" && !Array.isArray(extras) ? (extras as Record<string, unknown>) : {};
  const lista = Array.isArray(o.inss_procuradores) ? o.inss_procuradores : [];
  return lista.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

// O "cliente" do e-mail do INSS é, na verdade, o procurador do escritório?
// UM lugar para essa regra (card #503).
//
// O e-mail do MEU INSS traz o nome de quem fez o requerimento. Quando é alguém
// da equipe (o procurador), o e-mail não é de um cliente e segue um fluxo à
// parte (`cliente_eh_procurador`). Até 28/10 a lista era fixa no código —
// "(procurador)", "mara sandra vian" e "naira" — com nomes de pessoas de um
// escritório só, e o "naira" solto pegaria qualquer cliente chamada Naira.
//
// Agora (decisões da Naira, 28 e 29/10):
//   · o marcador "(procurador)", que o próprio INSS escreve;
//   · o nome completo do PROCURADOR que o escritório escolheu na equipe (um
//     só — escritorio_config.extras.inss_procurador_id; antes contava a equipe
//     inteira, e a lista crescia com o escritório);
//   · os nomes "como o INSS escreve" que o escritório cadastrou
//     (escritorio_config.extras.inss_procuradores), para quem aparece no INSS
//     com um nome diferente do cadastro.
// Os dois se editam em Integrações → "Procurador nos e-mails do INSS".
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

/** A lista que vale para um escritório: o procurador escolhido + os cadastrados, normalizada e sem repetição. */
export function nomesDeProcurador(procuradorEscolhido: string | null, cadastrados: string[]): string[] {
  const todos = [...(procuradorEscolhido ? [procuradorEscolhido] : []), ...cadastrados];
  return [...new Set(todos.filter(nomeValeComoProcurador).map(normalizarNome))];
}

/** O nome do "cliente" no e-mail é o procurador? */
export function ehProcurador(nomeCliente: string, nomes: string[]): boolean {
  const n = normalizarNome(nomeCliente);
  if (!n) return false;
  if (n.includes(MARCADOR_PROCURADOR)) return true;
  return nomes.some((p) => p && n.includes(p));
}

/** Lê `extras.inss_procurador_id` sem confiar: uuid ou null. */
export function lerProcuradorEscolhido(extras: unknown): string | null {
  const o = extras && typeof extras === "object" && !Array.isArray(extras) ? (extras as Record<string, unknown>) : {};
  const v = o.inss_procurador_id;
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** Lê `extras.inss_procuradores` sem confiar: só textos, aparados, sem vazios. */
export function lerProcuradoresCadastrados(extras: unknown): string[] {
  const o = extras && typeof extras === "object" && !Array.isArray(extras) ? (extras as Record<string, unknown>) : {};
  const lista = Array.isArray(o.inss_procuradores) ? o.inss_procuradores : [];
  return lista.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

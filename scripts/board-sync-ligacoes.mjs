// Ligação PR → issue pelo corpo do PR, com as mesmas regras do GitHub.
//
// O GitHub só transforma o "Closes #N" do corpo em ligação
// (closingIssuesReferences / closedByPullRequestsReferences) quando o PR
// aponta para a branch PADRÃO. Aqui todo PR de trabalho aponta para a staging,
// então essas listas só trazem a ligação manual do campo Development — o
// "Closes #N" some (visto em 2026-09-15: #322, #325, #340 e #341 vieram com a
// lista vazia). O board-sync lê o corpo para suprir isso.
//
// Regras copiadas do GitHub:
//   - palavra em inglês: close/closes/closed, fix/fixes/fixed,
//     resolve/resolves/resolved (maiúscula ou minúscula, com ou sem ":");
//     "Fecha #N" não liga;
//   - uma palavra por referência: "Closes #1, closes #2" liga as duas;
//     "Closes #1, #2" liga só a #1;
//   - referência: #N, dono/repo#N ou a URL da issue — as de outro repositório
//     ficam de fora;
//   - nada dentro de bloco de código, código inline ou comentário HTML.

const PALAVRA = String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b`;
const REFERENCIA = String.raw`(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)#|#)(\d+)\b`;
const PADRAO = new RegExp(String.raw`${PALAVRA}\s*:?\s+${REFERENCIA}`, "gi");

function semCodigoNemComentario(texto) {
  return texto
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** Números das issues de `repo` ("dono/nome") que o corpo do PR fecha. */
export function issuesFechadasPeloCorpo(corpo, repo) {
  const numeros = new Set();
  for (const m of semCodigoNemComentario(corpo ?? "").matchAll(PADRAO)) {
    const outroRepo = m[1] ?? m[2];
    if (outroRepo && outroRepo.toLowerCase() !== repo.toLowerCase()) continue;
    numeros.add(Number(m[3]));
  }
  return [...numeros];
}

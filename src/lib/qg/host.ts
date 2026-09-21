// QG da plataforma (superadmin) — porta separada do produto.
//
// O QG mora num HOST próprio (`qg.<domínio>`; no ambiente local, `qg.localhost`).
// O Supabase guarda a sessão por origem, então a sessão do QG é outra: quem é
// dona de escritório E staff da plataforma troca de chapéu trocando de aba, e
// nenhuma tela do produto roda com a sessão do QG (nem o contrário).
//
// O host só decide QUAL interface aparece. Quem decide acesso é o banco:
// cada função `qg_*` confere `plataforma_staff` (e AAL2, onde ligado).

export function ehHostQG(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.split(".")[0] === "qg";
}

/** Endereço do QG a partir do host atual (para o link "abrir o QG"). */
export function urlDoQG(): string {
  if (typeof window === "undefined") return "/qg";
  const { protocol, hostname, port } = window.location;
  const host = ehHostQG() ? hostname : `qg.${hostname.replace(/^www\./, "")}`;
  return `${protocol}//${host}${port ? `:${port}` : ""}/qg`;
}

/** Endereço do produto a partir do host do QG. */
export function urlDoProduto(): string {
  if (typeof window === "undefined") return "/";
  const { protocol, hostname, port } = window.location;
  const host = ehHostQG() ? hostname.replace(/^qg\./, "") : hostname;
  return `${protocol}//${host}${port ? `:${port}` : ""}/`;
}

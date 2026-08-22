/**
 * Chunks ficam com hash no nome (casos.index-D3OuCYzn.js) e o hash muda a
 * cada deploy — os arquivos do build anterior somem do servidor (404). Uma
 * aba que ficou aberta de antes do deploy quebra na primeira navegação:
 * o import dinâmico da rota falha e estoura a tela "Algo deu errado".
 *
 * A saída é recarregar a página inteira (busca o HTML novo, que aponta pros
 * chunks novos). O guard de tempo evita loop de reload caso a falha não seja
 * de deploy (ex.: sem internet, o reload não resolveria e repetiria pra sempre).
 */

const K_RELOAD_EM = "msc:stale-chunk-reload-em";
const JANELA_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "");
  return (
    // Chrome/Edge e Firefox (Vite dynamic import)
    msg.includes("dynamically imported module") ||
    // Safari
    msg.includes("Importing a module script failed") ||
    // Preload de CSS de rota (Vite)
    msg.includes("Unable to preload CSS") ||
    msg.includes("ChunkLoadError")
  );
}

/**
 * Recarrega a página uma única vez por janela de 30s. Retorna true se o
 * reload foi disparado (o chamador deve renderizar algo neutro e esperar);
 * false se já recarregamos há pouco e o erro persiste (aí é outra causa —
 * mostrar a tela de erro normal).
 */
export function reloadPorChunkVelho(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ultima = Number(window.sessionStorage.getItem(K_RELOAD_EM) ?? 0);
    if (Date.now() - ultima < JANELA_MS) return false;
    window.sessionStorage.setItem(K_RELOAD_EM, String(Date.now()));
  } catch {
    // sessionStorage indisponível (modo privado antigo etc.): recarregar
    // mesmo assim é melhor que travar na tela de erro.
  }
  window.location.reload();
  return true;
}

/**
 * Captura o evento que o Vite emite quando um preload de chunk falha,
 * antes mesmo do erro chegar no errorComponent do router.
 */
export function instalarAutoReloadChunkVelho() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadPorChunkVelho()) event.preventDefault();
  });
}

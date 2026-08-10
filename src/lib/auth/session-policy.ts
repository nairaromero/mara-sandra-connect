/**
 * Política de expiração de sessão.
 *
 * O Supabase, sozinho, mantém a sessão viva pra sempre: o refresh token fica no
 * localStorage e `autoRefreshToken` renova o JWT indefinidamente. Na prática
 * quem logou uma vez continua logado por dias — foi o que aconteceu (sessão de
 * sexta ainda aberta na segunda). Num sistema com dados de clientes (LGPD),
 * qualquer pessoa com acesso à máquina destravada entra sem credencial.
 *
 * Duas barreiras, ambas no cliente e compartilhadas entre abas via localStorage
 * (as abas leem/escrevem as mesmas chaves, então a mais ativa segura todas):
 *
 *  - OCIOSIDADE: sem interação por IDLE_MS o sistema desloga, avisando
 *    WARN_BEFORE_MS antes pra dar chance de continuar.
 *  - TETO ABSOLUTO: passadas MAX_SESSION_MS desde o login, desloga mesmo com a
 *    pessoa usando. Garante re-autenticação pelo menos uma vez por dia.
 *
 * Limite conhecido: isso protege a máquina/aba, não o token. Quem copiar o
 * refresh token do localStorage continua conseguindo renovar até o Supabase
 * expirá-lo. O complemento pra isso é server-side (Auth > Sessions no painel:
 * "time-box user sessions" + "inactivity timeout"), que exige plano Pro.
 */

export const IDLE_MS = 60 * 60 * 1000; // 1h sem interação
export const WARN_BEFORE_MS = 60 * 1000; // aviso 1 min antes do fim
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // teto absoluto de 12h
export const CHECK_INTERVAL_MS = 1000;

const K_ULTIMA_ATIVIDADE = "msc.auth.ultima_atividade";
const K_INICIO_SESSAO = "msc.auth.inicio_sessao";
const K_MOTIVO_LOGOUT = "msc.auth.motivo_logout";

export type MotivoLogout = "ociosidade" | "tempo_maximo";

function lerNumero(chave: string): number | null {
  if (typeof window === "undefined") return null;
  const bruto = window.localStorage.getItem(chave);
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

function escrever(chave: string, valor: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(chave, valor);
}

/** Carimba "houve interação agora". Chamado pelos listeners de atividade. */
export function marcarAtividade(agora = Date.now()) {
  escrever(K_ULTIMA_ATIVIDADE, String(agora));
}

export function lerUltimaAtividade() {
  return lerNumero(K_ULTIMA_ATIVIDADE);
}

/**
 * Marca o início da sessão só se ainda não houver marca — o relógio das 12h não
 * pode reiniciar a cada refresh de token ou reload de página. Também semeia a
 * última atividade, senão uma aba recém-aberta nasceria "ociosa há muito tempo".
 */
export function garantirInicioSessao(agora = Date.now()) {
  if (lerNumero(K_INICIO_SESSAO) === null) escrever(K_INICIO_SESSAO, String(agora));
  if (lerUltimaAtividade() === null) marcarAtividade(agora);
}

export function lerInicioSessao() {
  return lerNumero(K_INICIO_SESSAO);
}

/** Zera os marcadores no logout pra que o próximo login comece do zero. */
export function limparMarcadores() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(K_ULTIMA_ATIVIDADE);
  window.localStorage.removeItem(K_INICIO_SESSAO);
}

export function registrarMotivoLogout(motivo: MotivoLogout) {
  escrever(K_MOTIVO_LOGOUT, motivo);
}

/** Lê e apaga o motivo — a tela de login mostra o aviso uma vez só. */
export function consumirMotivoLogout(): MotivoLogout | null {
  if (typeof window === "undefined") return null;
  const motivo = window.localStorage.getItem(K_MOTIVO_LOGOUT);
  if (!motivo) return null;
  window.localStorage.removeItem(K_MOTIVO_LOGOUT);
  return motivo === "ociosidade" || motivo === "tempo_maximo" ? motivo : null;
}

export type EstadoSessao =
  | { situacao: "ok" }
  | { situacao: "avisar"; restanteMs: number }
  | { situacao: "expirou"; motivo: MotivoLogout };

/** Decide o estado da sessão a partir dos marcadores. Pura, pra facilitar teste. */
export function avaliarSessao(agora = Date.now()): EstadoSessao {
  const inicio = lerInicioSessao();
  if (inicio !== null && agora - inicio >= MAX_SESSION_MS) {
    return { situacao: "expirou", motivo: "tempo_maximo" };
  }

  const ultima = lerUltimaAtividade();
  // Sem marca de atividade (aba abriu antes desta versão, ou storage limpo):
  // trata como ativa agora em vez de deslogar por engano.
  if (ultima === null) return { situacao: "ok" };

  const ocioso = agora - ultima;
  if (ocioso >= IDLE_MS) return { situacao: "expirou", motivo: "ociosidade" };

  const restanteMs = IDLE_MS - ocioso;
  if (restanteMs <= WARN_BEFORE_MS) return { situacao: "avisar", restanteMs };

  return { situacao: "ok" };
}

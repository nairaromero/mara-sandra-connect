// Provedores de pasta por link — UMA lista (card #434).
//
// A tela (nome do provedor: "Pasta no OneDrive") e a function que confere o
// compartilhamento (`checar-link-pasta`) leem daqui. Antes eram duas listas e
// já tinham divergido: a tela reconhecia `1drv.com` e a checagem respondia
// "não sei conferir link de 1drv.com".
//
// Módulo PURO (sem import): a tela importa por `@shared/provedores-pasta`
// (régua: e2e/unit/fonte-unica-documentos.test.ts).

/**
 * O que a checagem viu ao tentar abrir o link SEM credencial:
 *   aberto     abriu, sem pedir login — a equipe consegue baixar
 *   fechado    pediu login ou o provedor recusou — falta compartilhar
 *   indefinido não deu para dizer (fora do ar, provedor desconhecido ou opaco)
 * É também o CHECK de `caso_pastas_externas.checado_status`.
 */
export type StatusDoLink = "aberto" | "fechado" | "indefinido";

export interface ProvedorDePasta {
  /** Domínio; vale ele e qualquer subdomínio. */
  dominio: string;
  /** Nome que a pessoa reconhece. */
  nome: string;
  /**
   * Responde a verdade de fora? Sem acesso, manda para o login ou recusa — dá
   * para dizer "compartilhado" com honestidade. Os OPACOS (Dropbox, MEGA,
   * iCloud, WeTransfer) devolvem 200 e uma página de aplicativo para qualquer
   * endereço, exista ou não: no teste, um link falso do Dropbox seria
   * anunciado como "compartilhado". Para esses a resposta é "não sei".
   */
  conferivel: boolean;
}

export const PROVEDORES_DE_PASTA: ProvedorDePasta[] = [
  { dominio: "1drv.ms", nome: "OneDrive", conferivel: true },
  { dominio: "1drv.com", nome: "OneDrive", conferivel: true },
  { dominio: "onedrive.live.com", nome: "OneDrive", conferivel: true },
  { dominio: "sharepoint.com", nome: "SharePoint", conferivel: true },
  { dominio: "drive.google.com", nome: "Google Drive", conferivel: true },
  { dominio: "docs.google.com", nome: "Google Drive", conferivel: true },
  { dominio: "dropbox.com", nome: "Dropbox", conferivel: false },
  { dominio: "wetransfer.com", nome: "WeTransfer", conferivel: false },
  { dominio: "mega.nz", nome: "MEGA", conferivel: false },
  { dominio: "icloud.com", nome: "iCloud", conferivel: false },
];

/**
 * Para onde os provedores mandam quem não tem acesso. Compara HOST (e, no
 * caso do Dropbox e do MEGA, o caminho), nunca o endereço inteiro: um link que
 * só CITA `login.live.com` num parâmetro não é tela de login.
 */
export const LOGIN_DE_PROVEDOR: Array<{ dominio: string; caminho?: string }> = [
  { dominio: "login.microsoftonline.com" },
  { dominio: "login.live.com" },
  { dominio: "login.windows.net" },
  { dominio: "accounts.google.com" },
  { dominio: "idmsa.apple.com" },
  { dominio: "dropbox.com", caminho: "/login" },
  { dominio: "mega.nz", caminho: "/login" },
];

function casaDominio(host: string, dominio: string): boolean {
  const h = host.toLowerCase();
  return h === dominio || h.endsWith("." + dominio);
}

/** O provedor deste host, ou null quando não conhecemos. */
export function provedorDoHost(host: string): ProvedorDePasta | null {
  return PROVEDORES_DE_PASTA.find((p) => casaDominio(host, p.dominio)) ?? null;
}

/** Este endereço é a tela de login de um provedor? */
export function ehTelaDeLogin(url: URL): boolean {
  return LOGIN_DE_PROVEDOR.some(
    (l) => casaDominio(url.hostname, l.dominio) && (!l.caminho || url.pathname.startsWith(l.caminho)),
  );
}

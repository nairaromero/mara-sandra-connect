// O link da pasta abre sem login? (card #434) — a checagem em si, separada da
// function `checar-link-pasta` para dar para testar sem rede (o `buscar` é
// injetável: e2e/unit/checar-link.test.ts).
//
// O que dá para saber, honestamente:
//   aberto     — respondeu página, sem mandar para tela de login
//   fechado    — mandou para login, ou recusou (401/403)
//   indefinido — não deu para dizer (fora do ar, formato estranho, provedor
//                que não conhecemos ou que responde igual com e sem acesso).
//                Nunca chuta.
//
// SSRF: a URL vem de fora. CADA endereço buscado — o colado e o destino de
// cada redirecionamento — passa pela mesma porta: https, sem usuário/senha na
// URL, porta padrão e host de provedor conhecido. Antes só o primeiro passava:
// um redirecionamento aberto num host da lista levava a function a buscar
// `http://169.254.169.254/…` (endereço interno da nuvem) por nós.

import { ehTelaDeLogin, provedorDoHost, type StatusDoLink } from "./provedores-pasta.ts";

export interface Checagem {
  status: StatusDoLink;
  detalhe: string;
}

const TEMPO_LIMITE_MS = 8_000;
const MAX_SALTOS = 4;
/** Quanto da página se lê para procurar a tela de login embutida. */
const MAX_BYTES_PAGINA = 16 * 1024;

// Alguns provedores devolvem 200 com a tela de login dentro.
const MARCAS_DE_LOGIN = [
  "accounts.google.com/servicelogin",
  "login.microsoftonline.com",
  "login.live.com",
  "você precisa fazer login",
  "faça login",
  "request access",
  "solicitar acesso",
];

const indefinido = (detalhe: string): Checagem => ({ status: "indefinido", detalhe });

/** A porta por onde passa todo endereço antes de ser buscado. */
function recusaDoDestino(url: URL): Checagem | null {
  if (url.protocol !== "https:") return indefinido("só confiro endereço https");
  if (url.username || url.password) return indefinido("endereço inválido");
  if (url.port && url.port !== "443") return indefinido("endereço inválido");
  const provedor = provedorDoHost(url.hostname);
  if (!provedor) return indefinido(`não sei conferir link de ${url.hostname}`);
  if (!provedor.conferivel) {
    return indefinido("esse provedor responde igual com ou sem acesso — confira abrindo o link");
  }
  return null;
}

/** O começo da página, sem baixar o resto (o corpo pode ser enorme). */
async function inicioDaPagina(r: Response): Promise<string> {
  const leitor = r.body?.getReader();
  if (!leitor) return "";
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES_PAGINA) {
      const { done, value } = await leitor.read();
      if (done || !value) break;
      partes.push(value);
      total += value.length;
    }
  } finally {
    await leitor.cancel().catch(() => {});
  }
  const junto = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    junto.set(p, pos);
    pos += p.length;
  }
  return new TextDecoder().decode(junto.subarray(0, MAX_BYTES_PAGINA));
}

/** Descarta o corpo de uma resposta que não vamos ler (libera a conexão). */
async function descartar(r: Response): Promise<void> {
  await r.body?.cancel().catch(() => {});
}

export async function checarLink(bruto: string, buscar: typeof fetch = fetch): Promise<Checagem> {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return indefinido("endereço inválido");
  }
  const recusa = recusaDoDestino(url);
  if (recusa) return recusa;

  const sinal = AbortSignal.timeout(TEMPO_LIMITE_MS);
  try {
    for (let salto = 0; salto <= MAX_SALTOS; salto++) {
      // `manual`: os saltos são lidos por nós — é no destino do salto que o
      // provedor revela se está pedindo login, e é ali que se confere o host.
      const r = await buscar(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: sinal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LegalConnect/1.0)" },
      });

      if (r.status >= 300 && r.status < 400) {
        await descartar(r);
        const destino = r.headers.get("location");
        if (!destino) return indefinido("redirecionamento sem destino");
        let proximo: URL;
        try {
          proximo = new URL(destino, url);
        } catch {
          return indefinido("redirecionamento para endereço inválido");
        }
        if (ehTelaDeLogin(proximo)) return { status: "fechado", detalhe: "o link pede login" };
        // Destino fora da lista NÃO é buscado.
        const recusaDoSalto = recusaDoDestino(proximo);
        if (recusaDoSalto) return recusaDoSalto;
        url = proximo;
        continue;
      }
      if (r.status === 401 || r.status === 403) {
        await descartar(r);
        return { status: "fechado", detalhe: "o provedor recusou o acesso" };
      }
      if (r.status === 404 || r.status === 410) {
        await descartar(r);
        return indefinido("o link não existe mais");
      }
      if (r.status >= 200 && r.status < 300) {
        const corpo = (await inicioDaPagina(r)).toLowerCase();
        if (MARCAS_DE_LOGIN.some((m) => corpo.includes(m))) {
          return { status: "fechado", detalhe: "o link pede login" };
        }
        return { status: "aberto", detalhe: "abriu sem pedir login" };
      }
      await descartar(r);
      return indefinido(`o provedor respondeu ${r.status}`);
    }
    return indefinido("redirecionou demais");
  } catch (e) {
    const nome = (e as Error)?.name;
    return indefinido(
      nome === "TimeoutError" || nome === "AbortError"
        ? "o provedor não respondeu a tempo"
        : "não consegui abrir o link",
    );
  }
}
